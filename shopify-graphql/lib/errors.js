/** Typed Host errors carried to tools and browser routes. */

/**
 * An error with a stable machine-readable code.
 */
export class AppError extends Error {
  /**
   * @param code - stable code for callers.
   * @param message - human-readable message.
   * @param details - optional structured context.
   */
  constructor(code, message, details) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

/**
 * Normalize any thrown value to a message.
 * @param error - thrown value.
 * @returns message text.
 */
export function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Build a plain JSON failure for a browser route.
 * @param error - thrown value.
 * @param status - HTTP status.
 * @returns a JSON Response.
 */
export function failureResponse(error, status = 400) {
  const code = error instanceof AppError ? error.code : 'internal_error'
  const message = messageOf(error)
  return Response.json({ ok: false, code, message }, { status })
}

/**
 * Assert a condition, throwing an AppError with a code.
 * @param condition - value that must be truthy.
 * @param code - failure code.
 * @param message - failure message.
 * @returns when the condition held.
 */
export function assert(condition, code, message) {
  if (!condition) throw new AppError(code, message)
}