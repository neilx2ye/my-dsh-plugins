import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const IMAGE_LIMIT = 8 * 1024 * 1024
const EXTENSIONS = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' })
const IMAGE_KEY = /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/u

/** Only server-generated keys can resolve to files. */
export function imageMime(key) {
  const match = typeof key === 'string' ? IMAGE_KEY.exec(key) : null
  return match && match[0] === key ? EXTENSIONS[match[1]] : undefined
}

const IMAGE_MARKDOWN = /!\[(?:\\[^\r\n]|[^\\\]\r\n])*\]\(media\/([a-f0-9]{64}\.(?:png|jpg|gif|webp))\)/gu

export function imageReferences(markdown) {
  return new Set(Array.from(markdown.matchAll(IMAGE_MARKDOWN), (match) => match[1]))
}

export function withoutImageReferences(markdown) {
  return markdown.replace(IMAGE_MARKDOWN, ' ')
}

function detectExtension(bytes) {
  if (bytes.length < 16) return undefined
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'gif'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return undefined
}

/** Size-check even when there is no Content-Length. The carrier closes unread requests. */
async function readLimited(request) {
  if (Number(request.headers.get('content-length')) > IMAGE_LIMIT) return null
  const reader = request.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return Buffer.concat(chunks, size)
      size += value.byteLength
      if (size > IMAGE_LIMIT) return null
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength))
    }
  } finally {
    reader.releaseLock()
  }
}

/** Content-addressed and immutable; old versions can still use removed images. */
export function createMediaStore(dir) {
  return {
    async upload(request) {
      const bytes = await readLimited(request)
      if (bytes === null) return { ok: false, code: 'image-size' }
      const extension = detectExtension(bytes)
      if (!extension) return { ok: false, code: 'image-type' }
      const key = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const temporary = join(dir, `.upload-${randomUUID()}`)
      try {
        await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
        await rename(temporary, join(dir, key))
      } finally {
        await rm(temporary, { force: true })
      }
      return { ok: true, key }
    },
    async read(key) {
      if (!imageMime(key)) return undefined
      try {
        return await readFile(join(dir, key))
      } catch (error) {
        if (error?.code === 'ENOENT') return undefined
        throw error
      }
    },
  }
}
