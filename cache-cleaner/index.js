/**
 * Host half of the cache-cleaner bundle.
 *
 * One browser-admitted route pair and one agent tool expose the same two
 * operations: inspect every DSH home on this machine, and delete the cache
 * categories a caller names. All policy lives in `lib/cache.js`; this module
 * only validates requests, translates failures, and formats tool text.
 */

import {
  cleanAll,
  discoverHomes,
  formatClean,
  formatScan,
  inspectAll,
  normalizeTargets,
  readConfig,
} from './lib/cache.js';

/** Services this bundle needs from the Web Host composition. */
export const inject = ['connection'];

/** Browser route returning the scan report. */
const SCAN_PATH = '/api/cache-cleaner/scan';
/** Browser route deleting the selected cache categories. */
const CLEAN_PATH = '/api/cache-cleaner/clean';

/**
 * Build one JSON failure response.
 * @param {number} status - HTTP status.
 * @param {string} code - stable machine-readable reason.
 * @param {string} message - human-readable reason.
 * @returns the response.
 */
function failure(status, code, message) {
  return Response.json(
    { code, message },
    { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } },
  );
}

/**
 * Read one JSON body, translating malformed input into the caller's failure.
 * @param {Request} request - incoming request.
 * @returns the parsed body, or an error response.
 */
async function readBody(request) {
  try {
    return { body: await request.json() };
  } catch {
    return { response: failure(400, 'bad-request', 'request body must be JSON') };
  }
}

/**
 * Describe one thrown cleanup failure.
 * @param {unknown} error - thrown value.
 * @returns `{ code, message }`.
 */
function describe(error) {
  if (error !== null && typeof error === 'object' && typeof error.code === 'string') {
    return { code: error.code, message: error instanceof Error ? error.message : String(error) };
  }
  return { code: 'failed', message: error instanceof Error ? error.message : String(error) };
}

/**
 * Register the cache routes and the `cache_cleaner` tool.
 * @param {object} ctx - Host root Context.
 * @param {unknown} config - the Loader row's config.
 */
export function apply(ctx, config) {
  const settings = readConfig(config);

  /**
   * Scan every home with the row's settings.
   * @param {AbortSignal} [signal] - request cancellation.
   * @returns the public report.
   */
  const scan = async (signal) => {
    const homes = await discoverHomes({ extraHomes: settings.extraHomes });
    const { report } = await inspectAll(homes, {
      minAgeMinutes: settings.minAgeMinutes,
      signal,
    });
    return report;
  };

  /**
   * Clean the requested categories in every home.
   * @param {string[]} targets - `sessions`, `canvas`, or both.
   * @param {AbortSignal} [signal] - request cancellation.
   * @returns the cleanup result.
   */
  const clean = async (targets, signal) => {
    const homes = await discoverHomes({ extraHomes: settings.extraHomes });
    return cleanAll(homes, {
      targets,
      minAgeMinutes: settings.minAgeMinutes,
      signal,
    });
  };

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: SCAN_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            return Response.json(await scan(request.signal), {
              headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
            });
          } catch (error) {
            const detail = describe(error);
            return failure(500, detail.code, detail.message);
          }
        },
      }),
    'cache-cleaner: scan route',
  );

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: CLEAN_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const parsed = await readBody(request);
          if (parsed.response !== undefined) return parsed.response;
          const body = parsed.body !== null && typeof parsed.body === 'object' ? parsed.body : {};
          if (body.confirm !== true) {
            return failure(400, 'confirm-required', 'send { "confirm": true } to delete cache data');
          }
          let targets;
          try {
            targets = normalizeTargets(body.targets);
          } catch (error) {
            return failure(400, 'bad-targets', describe(error).message);
          }
          try {
            const result = await clean(targets, request.signal);
            return Response.json(result, {
              headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
            });
          } catch (error) {
            const detail = describe(error);
            return failure(500, detail.code, detail.message);
          }
        },
      }),
    'cache-cleaner: clean route',
  );

  ctx.inject(['tools'], (scope) => {
    scope.tools.register({
      name: 'cache_cleaner',
      description:
        'Inspect and clear the DSH caches on this machine across every DSH home (this account plus every /home/<account>/.dsh this process can read): archived session logs, their projection checkpoints, and canvas documents. Unarchived session logs are never deleted. '
        + 'Actions: "scan" reports sizes, archived counts, and how many sessions are in use without changing anything; "clean" permanently deletes the selected targets and skips an archived session that any DSH process still holds open or that changed after the scan'
        + (settings.minAgeMinutes > 0 ? `, plus sessions modified in the last ${settings.minAgeMinutes} minute(s)` : '')
        + '. Cleaning is destructive and user data cannot be recovered, so call it only when the user explicitly asked to clear these caches; it requires confirm: true.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['scan', 'clean'],
            description: 'Operation to perform.',
          },
          targets: {
            type: 'array',
            items: { type: 'string', enum: ['sessions', 'canvas'] },
            description: 'For clean: "sessions" removes archived session logs and their projection checkpoints; unarchived sessions are kept. "canvas" removes canvas documents. Defaults to both.',
          },
          confirm: {
            type: 'boolean',
            description: 'For clean: must be true. The deletion cannot be undone.',
          },
        },
        required: ['action'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      async execute(args, exec) {
        if (args === null || typeof args !== 'object' || Array.isArray(args)) {
          throw new Error('arguments must be an object');
        }
        if (args.action === 'scan') {
          return { text: formatScan(await scan(exec?.signal)) };
        }
        if (args.action !== 'clean') {
          throw new Error(`unknown action "${String(args.action)}"; use scan or clean`);
        }
        if (args.confirm !== true) {
          throw new Error('clean requires confirm: true; call scan first to show what would be removed');
        }
        const targets = normalizeTargets(args.targets);
        return { text: formatClean(await clean(targets, exec?.signal)) };
      },
    });
  });
}
