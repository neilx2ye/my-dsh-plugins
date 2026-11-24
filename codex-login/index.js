/**
 * Host half of the codex-login bundle.
 *
 * A "Sign in with ChatGPT" button for the Models settings page. The credential
 * itself belongs to `@deepseek-ai/dsh-llm-pi-ai`'s `openai-codex` route, whose
 * flow is registered on the authorization seam; this bundle only gives that
 * flow a browser surface, because the seam has no clickable entry of its own in
 * this release.
 *
 * One attempt runs at a time, in this process. The attempt's notices and its
 * current question are kept in a small in-memory snapshot that the page polls
 * through the Fetch routes below; answers travel the other way. Nothing here
 * reads, stores, or returns the token: the flow commits the record itself.
 */

/** Services this bundle needs from the Web Host composition. */
export const inject = ['connection', 'authorization', 'credentials']

/** Credential record the pi-ai Codex flow writes; also the flow's registry key. */
const KEY = 'llm-pi-ai/openai-codex'
/** Route prefix below `/api` for this bundle's own surface. */
const ROUTE = '/api/codex-login'
/** The only login method the Codex flow offers. */
const METHOD = 'oauth'
/**
 * pi-ai's Codex login asks which way to sign in — a browser callback on port
 * 1455, or a device code. A Harness page cannot own a port on the user's
 * machine, and the button reads "device code" to the person clicking it, so the
 * select is answered here instead of being rendered.
 */
const AUTO_SELECT = 'device_code'
/** How many notices the snapshot keeps, newest last. */
const NOTICE_LIMIT = 4

/**
 * Read one field from an unknown value without trusting its shape.
 * @param value - anything.
 * @param field - property to read.
 * @returns the value, or undefined when it is not a plain property.
 */
function field(value, field) {
  return value !== null && typeof value === 'object' ? value[field] : undefined
}

/**
 * Register the login surface.
 * @param ctx - Host root Context.
 */
export function apply(ctx) {
  /** Latest attempt state, as the page sees it. */
  const state = {
    /** `idle` | `running` | `authorized` | `cancelled` | `failed` */
    phase: 'idle',
    /** One-way reports from the flow, oldest first. */
    notices: [],
    /** The question the flow is waiting on, if any. */
    prompt: null,
    /** Failure text of the last attempt. */
    error: null,
    /** Epoch milliseconds of the last phase change. */
    changedAt: null,
  }
  /** Withdraws the running attempt; non-null exactly while one runs. */
  let running = null
  /** Resolver of the question the flow is blocked on. */
  let pending = null
  /** Monotonic id so a late answer cannot settle a newer question. */
  let questionId = 0

  /**
   * The credential record the flow would write, described without its secrets.
   * @returns whether the route is signed in, and when the stored grant expires.
   */
  const grant = async () => {
    const record = await ctx.credentials.readRecord(KEY).catch(() => undefined)
    if (record?.kind !== 'grant') return { signedIn: false, accountId: null, expiresAt: null }
    const payload = record.payload
    const accountId = field(payload, 'accountId')
    const expires = field(payload, 'expires')
    return {
      signedIn: true,
      accountId: typeof accountId === 'string' ? accountId : null,
      expiresAt: typeof expires === 'number' ? expires : null,
    }
  }

  /**
   * The whole page-visible snapshot: attempt state plus the stored grant.
   * @returns a JSON-safe description; never a token.
   */
  const snapshot = async () => ({
    phase: state.phase,
    notices: state.notices.slice(),
    prompt: state.prompt,
    error: state.error,
    changedAt: state.changedAt,
    inFlight: running !== null,
    ...(await grant()),
  })

  /**
   * Settle the question the flow is blocked on.
   * @param id - the question id the page saw.
   * @param value - the answer, or a decline.
   * @returns whether the answer matched the live question.
   */
  const answer = (id, value) => {
    if (pending === null || pending.id !== id) return false
    const settle = pending
    pending = null
    state.prompt = null
    settle.resolve(value)
    return true
  }

  /** Start one attempt; the promise settles the snapshot when the flow ends. */
  const start = () => {
    if (running !== null) return false
    state.phase = 'running'
    state.notices = []
    state.prompt = null
    state.error = null
    state.changedAt = Date.now()
    const controller = new AbortController()
    running = controller

    void ctx.authorization
      .begin({
        key: KEY,
        method: METHOD,
        signal: controller.signal,
        interaction: {
          notify: (notice) => {
            state.notices.push({
              message: typeof notice?.message === 'string' ? notice.message : '',
              ...(typeof notice?.url === 'string' ? { url: notice.url } : {}),
              ...(typeof notice?.code === 'string' ? { code: notice.code } : {}),
            })
            if (state.notices.length > NOTICE_LIMIT) state.notices.shift()
          },
          prompt: (prompt) => new Promise((resolve, reject) => {
            const options = Array.isArray(prompt?.options)
              ? prompt.options.map((option) => ({
                  id: String(option?.id ?? ''),
                  label: String(option?.label ?? option?.id ?? ''),
                  ...(typeof option?.description === 'string' ? { description: option.description } : {}),
                }))
              : undefined
            if (prompt?.kind === 'select' && options?.some((option) => option.id === AUTO_SELECT)) {
              resolve(AUTO_SELECT)
              return
            }
            const id = ++questionId
            state.prompt = {
              id,
              kind: String(prompt?.kind ?? 'text'),
              message: typeof prompt?.message === 'string' ? prompt.message : '',
              ...(typeof prompt?.placeholder === 'string' ? { placeholder: prompt.placeholder } : {}),
              ...(options === undefined ? {} : { options }),
            }
            pending = { id, resolve, reject }
            prompt?.signal?.addEventListener('abort', () => {
              if (pending?.id !== id) return
              pending = null
              state.prompt = null
              reject(new Error('codex-login: the flow withdrew its question'))
            }, { once: true })
          }),
        },
      })
      .then((outcome) => {
        state.phase = outcome?.status === 'authorized' ? 'authorized' : 'cancelled'
        if (state.phase === 'authorized') state.notices = []
      })
      .catch((error) => {
        state.phase = controller.signal.aborted ? 'cancelled' : 'failed'
        state.error = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        running = null
        pending = null
        state.prompt = null
        state.changedAt = Date.now()
      })
    return true
  }

  /**
   * Answer one JSON request.
   * @param request - the browser's request.
   * @param handler - action to run with the decoded body.
   * @returns the resulting snapshot.
   */
  const json = async (request, handler) => {
    let body = {}
    if (request.method === 'POST' && request.headers.get('content-length') !== '0') {
      body = await request.json().catch(() => ({}))
    }
    const result = await handler(body ?? {})
    return Response.json({ ok: true, ...(await snapshot()), ...result }, {
      headers: { 'cache-control': 'no-store' },
    })
  }

  ctx.effect(() => ctx.connection.fetch.register({
    path: `${ROUTE}/state`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => Response.json(await snapshot(), {
      headers: { 'cache-control': 'no-store' },
    }),
  }), 'codex-login: state route')

  ctx.effect(() => ctx.connection.fetch.register({
    path: `${ROUTE}/action`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => json(request, async (body) => {
      switch (body.action) {
        case 'start':
          if (!start()) return { error: 'ALREADY_IN_FLIGHT' }
          return {}
        case 'cancel':
          running?.abort()
          return {}
        case 'answer':
          if (typeof body.id !== 'number' || typeof body.value !== 'string') return { error: 'BAD_ANSWER' }
          if (!answer(body.id, body.value)) return { error: 'STALE_QUESTION' }
          return {}
        case 'signout':
          await ctx.credentials.deleteRecord(KEY)
          state.phase = 'idle'
          state.error = null
          state.notices = []
          state.changedAt = Date.now()
          return {}
        default:
          return { error: 'UNKNOWN_ACTION' }
      }
    }),
  }), 'codex-login: action route')
}