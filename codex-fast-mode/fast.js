const PROVIDER = 'openai-codex';
const PROTOCOL = 'openai-codex-responses';
const TIER = 'priority';
const END_EVENTS = new Set(['response.completed', 'response.done', 'response.incomplete', 'response.failed']);
const REPORTED_TIERS = new Set(['fast', 'priority', 'default', 'auto', 'flex', 'scale', 'ultrafast']);

function isCodex(model) {
  if (model?.provider !== PROVIDER || model.api !== PROTOCOL) return false;
  try {
    const url = new URL(model.baseUrl);
    return url.origin === 'https://chatgpt.com'
      && /^\/backend-api(?:\/|$)/u.test(url.pathname)
      && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Compatibility shim: scope the SDK hook to opted-in sessions and the official Codex endpoint. */
export function attachFastMode(prototype) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'streamSimple');
  const original = descriptor?.value;
  if (typeof original !== 'function' || !descriptor.configurable) {
    throw new Error('Unsupported pi-ai stream interface');
  }
  const enabled = new Map();

  function streamSimple(model, context, options) {
    const state = enabled.get(options?.sessionId);
    if (!state || !isCodex(model)) return original.call(this, model, context, options);
    const attempt = { phase: 'pending' };
    state.last = attempt;
    return original.call(this, model, context, {
      ...options,
      // pi-ai 1.6.0 streamSimple drops serviceTier, but preserves onPayload.
      // This hook runs after credential/model resolution, before either WS or SSE serializes the body.
      onPayload: async (body, actualModel) => {
        const replacement = await options.onPayload?.(body, actualModel);
        const payload = replacement ?? body;
        if (enabled.get(options.sessionId) !== state || !isCodex(actualModel)
            || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
          attempt.phase = 'skipped';
          return replacement;
        }
        attempt.phase = 'sent';
        return { ...payload, service_tier: TIER };
      },
      onProviderStreamEvent: async (event, actualModel) => {
        if (attempt.phase === 'sent' && END_EVENTS.has(event?.type)) {
          if (event.type === 'response.failed' || event.response?.status === 'failed' || event.response?.status === 'cancelled') {
            attempt.phase = 'failed';
          } else {
            const tier = event.response?.service_tier;
            if (REPORTED_TIERS.has(tier)) attempt.reported = tier;
            attempt.phase = 'ended';
          }
        }
        await options.onProviderStreamEvent?.(event, actualModel);
      },
    });
  }

  Object.defineProperty(prototype, 'streamSimple', { ...descriptor, value: streamSimple });

  return {
    dispose() {
      enabled.clear();
      if (Object.getOwnPropertyDescriptor(prototype, 'streamSimple')?.value === streamSimple) {
        Object.defineProperty(prototype, 'streamSimple', descriptor);
      }
    },
    setEnabled(sessionId, value) {
      if (!value) enabled.delete(sessionId);
      else if (!enabled.has(sessionId)) enabled.set(sessionId, {});
    },
    statusOf(sessionId) {
      const state = enabled.get(sessionId);
      return { enabled: state !== undefined, last: state?.last ? { ...state.last } : null };
    },
  };
}
