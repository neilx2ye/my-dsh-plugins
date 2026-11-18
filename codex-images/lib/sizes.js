/**
 * Image size helpers free of Harness imports.
 *
 * The image model behind `codex exec` only accepts a subset of pixel sizes:
 * both edges are multiples of 16, no edge exceeds 3840, the long/short ratio is
 * at most 3:1, and the total pixel count stays inside 655_360..8_294_400.
 * Requests such as `1080x1440` therefore cannot be passed through verbatim.
 * Callers snap a request to the nearest legal size for the prompt, then scale
 * the returned image back to the exact size the caller asked for.
 */

/** Largest edge the image model accepts. */
export const MAX_IMAGE_EDGE = 3840;
/** Smallest accepted total pixel count. */
export const MIN_IMAGE_PIXELS = 655_360;
/** Largest accepted total pixel count. */
export const MAX_IMAGE_PIXELS = 8_294_400;
/** Longest accepted long-to-short edge ratio. */
export const MAX_IMAGE_RATIO = 3;

/**
 * Parse a `WIDTHxHEIGHT` size string.
 * @param value - candidate size text, for example `1536x1024`.
 * @returns integer dimensions, or undefined when the text is not a size.
 */
export function parseSizeText(value) {
  if (typeof value !== 'string') return undefined;
  const match = /^\s*(\d{1,5})\s*[x×]\s*(\d{1,5})\s*$/i.exec(value);
  if (match === null) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return undefined;
  return { width, height };
}

/**
 * Format dimensions as `WIDTHxHEIGHT`.
 * @param size - width and height.
 * @returns the canonical size text.
 */
export function sizeText(size) {
  return `${size.width}x${size.height}`;
}

/**
 * Round one edge to a multiple of 16, staying positive.
 * @param value - edge length.
 * @returns the rounded edge.
 */
function round16(value) {
  return Math.max(16, Math.round(value / 16) * 16);
}

/**
 * Test whether the image model accepts these dimensions as-is.
 * @param width - pixel width.
 * @param height - pixel height.
 * @returns whether the size is legal.
 */
export function isLegalImageSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (width <= 0 || height <= 0) return false;
  if (width % 16 !== 0 || height % 16 !== 0) return false;
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) return false;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long / short > MAX_IMAGE_RATIO) return false;
  const pixels = width * height;
  return pixels >= MIN_IMAGE_PIXELS && pixels <= MAX_IMAGE_PIXELS;
}

/**
 * Snap arbitrary dimensions to the nearest size the image model accepts.
 *
 * The aspect ratio is preserved as closely as rounding allows; the result is
 * always legal per {@link isLegalImageSize}.
 * @param width - requested width.
 * @param height - requested height.
 * @returns a legal width and height.
 */
export function snapImageSize(width, height) {
  const rawWidth = Math.max(1, Number(width) || 1);
  const rawHeight = Math.max(1, Number(height) || 1);
  // Keep the requested aspect ratio inside the model's 3:1 envelope.
  const aspect = Math.min(MAX_IMAGE_RATIO, Math.max(1 / MAX_IMAGE_RATIO, rawWidth / rawHeight));
  // Choose a pixel budget the model accepts, then derive a 16px-grid size
  // from it. Building from the budget keeps rounding from undershooting the
  // minimum, which a naive round-then-repair loop can oscillate on.
  const budget = Math.min(MAX_IMAGE_PIXELS, Math.max(MIN_IMAGE_PIXELS, rawWidth * rawHeight));
  let w = clampEdge(round16(Math.sqrt(budget * aspect)));
  let h = clampEdge(round16(w / aspect));
  // A few deterministic nudges settle every remaining bound.
  for (let pass = 0; pass < 64; pass += 1) {
    if (w * h < MIN_IMAGE_PIXELS) {
      w = clampEdge(w + 16);
      h = clampEdge(round16(w / aspect));
      continue;
    }
    if (w * h > MAX_IMAGE_PIXELS) {
      w = clampEdge(w - 16);
      h = clampEdge(round16(w / aspect));
      continue;
    }
    if (w / h > MAX_IMAGE_RATIO) {
      h = clampEdge(round16(w / MAX_IMAGE_RATIO));
      continue;
    }
    if (h / w > MAX_IMAGE_RATIO) {
      w = clampEdge(round16(h / MAX_IMAGE_RATIO));
      continue;
    }
    break;
  }
  return { width: w, height: h };
}

/**
 * Clamp one edge into the model's accepted range.
 * @param value - rounded edge length.
 * @returns the clamped edge.
 */
function clampEdge(value) {
  return Math.min(MAX_IMAGE_EDGE, Math.max(16, Math.round(value / 16) * 16));
}

/**
 * Read the pixel dimensions of a PNG, JPEG, WebP, or GIF buffer.
 * @param buffer - leading bytes of the file (a few hundred KB is enough).
 * @returns dimensions, or undefined when the format is unknown or truncated.
 */
export function imageSizeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return undefined;
  const png = readPngSize(buffer);
  if (png !== undefined) return png;
  const gif = readGifSize(buffer);
  if (gif !== undefined) return gif;
  const webp = readWebpSize(buffer);
  if (webp !== undefined) return webp;
  return readJpegSize(buffer);
}

/**
 * Read a PNG IHDR header.
 * @param buffer - file bytes.
 * @returns dimensions, or undefined.
 */
function readPngSize(buffer) {
  if (buffer.length < 24) return undefined;
  if (buffer[0] !== 0x89 || buffer.toString('ascii', 1, 4) !== 'PNG') return undefined;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/**
 * Read a GIF logical screen descriptor.
 * @param buffer - file bytes.
 * @returns dimensions, or undefined.
 */
function readGifSize(buffer) {
  if (buffer.length < 10) return undefined;
  const head = buffer.toString('ascii', 0, 6);
  if (head !== 'GIF87a' && head !== 'GIF89a') return undefined;
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/**
 * Read a WebP canvas size from its VP8X, VP8, or VP8L header.
 * @param buffer - file bytes.
 * @returns dimensions, or undefined.
 */
function readWebpSize(buffer) {
  if (buffer.length < 30) return undefined;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return undefined;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    const width = 1 + (bits & 0x3fff);
    const height = 1 + ((bits >> 14) & 0x3fff);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  if (chunk === 'VP8 ') {
    const start = 20;
    if (buffer.length < start + 10) return undefined;
    if (buffer[start + 3] !== 0x9d || buffer[start + 4] !== 0x01 || buffer[start + 5] !== 0x2a) return undefined;
    const width = buffer.readUInt16LE(start + 6) & 0x3fff;
    const height = buffer.readUInt16LE(start + 8) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  return undefined;
}

/**
 * Walk JPEG segments until the start-of-frame marker carrying the dimensions.
 * @param buffer - file bytes.
 * @returns dimensions, or undefined.
 */
function readJpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return undefined;
    const length = buffer.readUInt16BE(offset);
    if (length < 2) return undefined;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 7 > buffer.length) return undefined;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += length;
  }
  return undefined;
}