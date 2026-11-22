/**
 * Host half of the system-usage bundle.
 *
 * One browser-admitted Fetch route reports the CPU and memory load of the
 * machine this Harness process runs on. CPU usage is the idle-time delta over
 * two `os.cpus()` samples bounded by `minSampleMs`; memory prefers Linux
 * `/proc/meminfo`'s `MemAvailable` and falls back to `totalmem`/`freemem`.
 * Sampling happens only while a page polls, and the response describes the
 * machine and this process only — no Session data is read.
 */

import { readFile } from 'node:fs/promises'
import { cpus, freemem, hostname, loadavg, platform, totalmem } from 'node:os'

/** Services this bundle needs from the Web Host composition. */
export const inject = ['connection']

/** Exact browser-admission Fetch route behind the sidebar meter. */
const ROUTE = '/api/system-usage'
/** Minimum interval between two CPU time samples, in milliseconds. */
const DEFAULT_MIN_SAMPLE_MS = 500
/** Longest CPU window a forced (clicked) sample may be shortened to. */
const FORCED_WINDOW_CEILING_MS = 1000

/**
 * Validate the row's config. Invalid values fail activation with a named field
 * instead of silently falling back.
 * @param raw - the Loader row's `config` value.
 * @returns normalized settings.
 */
function readSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const minSampleMs = source.minSampleMs ?? DEFAULT_MIN_SAMPLE_MS
  if (!Number.isInteger(minSampleMs) || minSampleMs < 100 || minSampleMs > 60_000) {
    throw new Error('system-usage: config.minSampleMs must be an integer between 100 and 60000')
  }
  return { minSampleMs }
}

/**
 * Sum one cumulative CPU-time reading across every core.
 * @returns idle milliseconds and total milliseconds since boot.
 */
function cpuTimes() {
  let idle = 0
  let total = 0
  for (const cpu of cpus()) {
    const times = cpu.times
    idle += times.idle
    total += times.user + times.nice + times.sys + times.idle + times.irq
  }
  return { idle, total }
}

/**
 * Read machine memory, preferring the kernel's own available figure on Linux.
 * @returns total and used bytes.
 */
async function memoryUsage() {
  if (platform() === 'linux') {
    try {
      const text = await readFile('/proc/meminfo', 'utf8')
      const total = Number(/^MemTotal:\s+(\d+)\s+kB/m.exec(text)?.[1]) * 1024
      const available = Number(/^MemAvailable:\s+(\d+)\s+kB/m.exec(text)?.[1]) * 1024
      if (Number.isFinite(total) && total > 0 && Number.isFinite(available) && available >= 0) {
        return { totalBytes: total, usedBytes: Math.min(total, Math.max(0, total - available)) }
      }
    } catch {
      // Fall back to the portable totals below.
    }
  }
  const total = totalmem()
  return { totalBytes: total, usedBytes: Math.max(0, total - freemem()) }
}

/**
 * Build the cached sampler behind the route.
 * @param minSampleMs - minimum CPU-time window between two computed samples.
 * @returns a reader that computes at most one sample per window.
 */
function createSampler(minSampleMs) {
  let baseline = cpuTimes()
  let cached = null
  let pending = null

  /** Compute one sample and advance the CPU baseline. */
  async function compute() {
    const sampledAt = Date.now()
    const current = cpuTimes()
    const totalDelta = current.total - baseline.total
    const idleDelta = current.idle - baseline.idle
    const usage = totalDelta > 0 ? Math.min(1, Math.max(0, 1 - idleDelta / totalDelta)) : 0
    baseline = current
    const memory = await memoryUsage()
    const processMemory = process.memoryUsage()
    const cores = cpus()
    cached = {
      v: 1,
      sampledAt,
      host: hostname(),
      platform: platform(),
      cpu: {
        usage,
        cores: cores.length,
        model: cores[0]?.model?.trim() ?? '',
        load: platform() === 'win32' ? null : loadavg().map(value => Math.round(value * 100) / 100),
      },
      memory: {
        totalBytes: memory.totalBytes,
        usedBytes: memory.usedBytes,
        usage: memory.totalBytes > 0 ? memory.usedBytes / memory.totalBytes : 0,
      },
      dsh: {
        pid: process.pid,
        rssBytes: processMemory.rss,
      },
    }
    return cached
  }

  return {
    /**
     * Read the newest sample.
     * @param force - bypass the normal sample window for an explicit refresh.
     * @returns the sample, reused inside the window. A forced read still needs
     *   `min(minSampleMs, 1000)` ms of CPU time, so a click right after a poll
     *   cannot report a 0% or 100% spike from a near-empty window.
     */
    async read(force = false) {
      if (cached !== null) {
        const age = Date.now() - cached.sampledAt
        const windowMs = force ? Math.min(minSampleMs, FORCED_WINDOW_CEILING_MS) : minSampleMs
        if (age < windowMs) return cached
      }
      if (pending !== null) return pending
      pending = compute().finally(() => { pending = null })
      return pending
    },
  }
}

/**
 * Register the browser-admitted usage route.
 * @param ctx - Host root Context.
 * @param config - the Loader row's config.
 */
export function apply(ctx, config) {
  const { minSampleMs } = readSettings(config)
  const sampler = createSampler(minSampleMs)

  ctx.effect(
    () => ctx.connection.fetch.register({
      path: ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const force = new URL(request.url).searchParams.get('fresh') === '1'
        return Response.json(await sampler.read(force), {
          headers: { 'cache-control': 'no-store' },
        })
      },
    }),
    'system-usage: sample route',
  )
}