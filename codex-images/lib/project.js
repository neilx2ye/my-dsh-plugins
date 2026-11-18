/**
 * Project-scoped image directory.
 *
 * There is no global library and no copying step: the gallery serves image
 * files that already live inside the Session project, under one configurable
 * directory (default `output/imagegen`). Metadata that cannot be recovered
 * from the filesystem — the prompt and requested size used for a generated
 * image — is kept in a small hidden index inside that same directory, so it
 * stays with the project and never leaks between projects.
 */

import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Extensions the gallery accepts, mapped to their media type. */
const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

/** File the project directory uses for prompt metadata. */
export const INDEX_FILE = '.codex-images.json';

/** Directory names never walked. */
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.cache', '__pycache__', '.venv', 'venv']);

/** Largest number of images returned by one scan. */
const SCAN_FILE_LIMIT = 500;

/** Deepest subdirectory level inspected below the image directory. */
const SCAN_DEPTH = 2;

/**
 * Expand a leading `~` and resolve the result against a base directory.
 * @param value - configured path.
 * @param base - directory used to resolve a relative path.
 * @returns an absolute path.
 */
export function expandPath(value, base = process.cwd()) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('path must be a non-empty string');
  const trimmed = value.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2));
  return path.resolve(base, trimmed);
}

/**
 * Read the media type declared by a file name.
 * @param name - file name or path.
 * @returns the media type, or undefined for a non-image name.
 */
export function mediaTypeOf(name) {
  return IMAGE_TYPES.get(path.extname(name).toLowerCase());
}

/**
 * Test whether a file name carries a supported image extension.
 * @param name - file name or path.
 * @returns whether the gallery can serve it.
 */
export function isImageName(name) {
  return mediaTypeOf(name) !== undefined;
}

/**
 * Normalize one project-relative path and reject escapes.
 * @param value - candidate relative path using `/` or the platform separator.
 * @returns the normalized `/`-separated relative path.
 */
export function normalizeRel(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('path must be a non-empty string');
  const rel = value.split(path.sep).join('/').replace(/^\.\//, '');
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) throw new Error('path must be relative');
  const segments = rel.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('path must not contain empty, "." or ".." segments');
  }
  return segments.join('/');
}

/**
 * Convert arbitrary text into a short readable file stem.
 * @param value - source text.
 * @returns lowercase words joined by hyphens.
 */
export function slugify(value) {
  return String(value)
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48)
    .replace(/^-|-$/g, '');
}

/**
 * One project's image directory: scanning, safe reads, prompt metadata, and
 * copies into the project.
 */
export class ProjectImages {
  /**
   * @param dir - absolute project image directory.
   * @param root - absolute project root; image ids are relative to it.
   */
  constructor(dir, root = dir) {
    this.dir = path.resolve(dir);
    this.root = path.resolve(root);
    this.indexPath = path.join(this.dir, INDEX_FILE);
    /** @type {Map<string, {prompt?: string, size?: string, createdAt?: string}>} */
    this.index = new Map();
    this.loaded = false;
  }

  /** Create the directory when it does not exist yet. */
  async ensure() {
    await fs.mkdir(this.dir, { recursive: true });
    await this.loadIndex();
  }

  /** Read the metadata index once, tolerating a missing or corrupt file. */
  async loadIndex() {
    if (this.loaded) return;
    this.loaded = true;
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(this.indexPath, 'utf8'));
    } catch {
      return;
    }
    const images = parsed !== null && typeof parsed === 'object' && parsed.images !== null && typeof parsed.images === 'object' ? parsed.images : {};
    for (const [rel, value] of Object.entries(images)) {
      if (value === null || typeof value !== 'object') continue;
      this.index.set(rel, {
        ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
        ...(typeof value.size === 'string' ? { size: value.size } : {}),
        ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
      });
    }
  }

  /** Persist the metadata index atomically. */
  async saveIndex() {
    const images = {};
    for (const [rel, value] of this.index) images[rel] = value;
    const payload = JSON.stringify({ version: 1, images }, null, 2);
    const temporary = `${this.indexPath}.${randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(temporary, payload, 'utf8');
    await fs.rename(temporary, this.indexPath);
  }

  /**
   * Walk the directory for image files, ignoring hidden entries and the index.
   * @param root - directory to inspect.
   * @param depth - remaining directory depth.
   * @returns raw file records.
   */
  async walk(root = this.dir, depth = SCAN_DEPTH) {
    const found = [];
    let items;
    try {
      items = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return found;
    }
    for (const item of items) {
      if (found.length >= SCAN_FILE_LIMIT) break;
      if (item.name.startsWith('.')) continue;
      const target = path.join(root, item.name);
      if (item.isDirectory()) {
        if (depth <= 0 || SKIP_DIRECTORIES.has(item.name)) continue;
        found.push(...(await this.walk(target, depth - 1)));
        continue;
      }
      if (!item.isFile() || !isImageName(item.name)) continue;
      try {
        const stat = await fs.stat(target);
        found.push({
          rel: path.relative(this.root, target).split(path.sep).join('/'),
          abs: target,
          bytes: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {}
    }
    return found.slice(0, SCAN_FILE_LIMIT);
  }

  /**
   * List the project images, newest first, with prompt metadata when known.
   * @returns image descriptors.
   */
  async list() {
    await this.loadIndex();
    const raw = await this.walk();
    // Metadata for images that no longer exist would otherwise pile up forever
    // and resurface on a later file with the same name.
    const present = new Set(raw.map((file) => file.rel));
    let pruned = false;
    for (const key of [...this.index.keys()]) {
      if (present.has(key)) continue;
      this.index.delete(key);
      pruned = true;
    }
    if (pruned) {
      try {
        await this.saveIndex();
      } catch {}
    }
    return raw
      .map((file) => {
        const meta = this.index.get(file.rel);
        return {
          id: file.rel,
          relPath: file.rel,
          name: path.basename(file.rel),
          path: file.abs,
          bytes: file.bytes,
          createdAt: meta?.createdAt ?? new Date(file.mtimeMs).toISOString(),
          prompt: meta?.prompt ?? '',
          size: meta?.size ?? '',
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, SCAN_FILE_LIMIT);
  }

  /**
   * Snapshot file signatures for change detection around one CLI run.
   * @returns map of relative path to `bytes:mtime`.
   */
  async snapshot() {
    const raw = await this.walk();
    return new Map(raw.map((file) => [file.rel, `${file.bytes}:${Math.round(file.mtimeMs)}`]));
  }

  /**
   * Record prompt metadata for newly generated images.
   * @param entries - descriptors whose metadata should be stored.
   * @param meta - prompt, requested size, and creation instant.
   */
  async record(entries, meta) {
    if (entries.length === 0) return;
    await this.loadIndex();
    for (const entry of entries) {
      this.index.set(entry.relPath, {
        prompt: meta.prompt,
        size: meta.size,
        createdAt: meta.createdAt,
      });
    }
    await this.saveIndex();
  }

  /**
   * Resolve a project-relative image path and prove it stays inside the
   * project image directory, including through symlinks.
   * @param rel - project-relative path from the client or model.
   * @returns the absolute path.
   */
  async resolve(rel) {
    const normalized = normalizeRel(rel);
    const absolute = path.resolve(this.root, normalized);
    const prefix = this.dir.endsWith(path.sep) ? this.dir : `${this.dir}${path.sep}`;
    if (!absolute.startsWith(prefix)) throw new Error('image path is outside the project image directory');
    if (!isImageName(absolute)) throw new Error('only PNG, JPEG, WebP, and GIF previews are supported');
    let realDir;
    try {
      realDir = await fs.realpath(this.dir);
    } catch {
      throw new Error(`image "${rel}" does not exist yet: the project image directory has no images`);
    }
    let realFile;
    try {
      realFile = await fs.realpath(absolute);
    } catch {
      throw new Error(`image "${rel}" does not exist`);
    }
    if (!realFile.startsWith(`${realDir}${path.sep}`)) throw new Error('image path resolves outside the project image directory');
    return realFile;
  }

  /**
   * Read one project image.
   * @param rel - relative path.
   * @returns the descriptor, bytes, and media type; or undefined when absent.
   */
  async read(rel) {
    await this.loadIndex();
    let absolute;
    try {
      absolute = await this.resolve(rel);
    } catch {
      return undefined;
    }
    try {
      const data = await fs.readFile(absolute);
      return {
        entry: {
          id: normalizeRel(rel),
          relPath: normalizeRel(rel),
          name: path.basename(absolute),
          path: absolute,
          bytes: data.length,
        },
        data,
        mediaType: mediaTypeOf(absolute) ?? 'application/octet-stream',
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Prove a project-relative path stays inside the image directory.
   * @param rel - normalized relative path.
   * @returns the absolute path.
   */
  targetInside(rel) {
    const absolute = path.resolve(this.root, rel);
    const prefix = this.dir.endsWith(path.sep) ? this.dir : `${this.dir}${path.sep}`;
    if (!absolute.startsWith(prefix)) throw new Error('path is outside the project image directory');
    return absolute;
  }

  /**
   * Rename one project image inside the image directory and move its metadata.
   * @param rel - source project-relative path.
   * @param target - destination project-relative path.
   * @returns the new descriptor.
   */
  async rename(rel, target) {
    const source = await this.resolve(rel);
    const normalized = normalizeRel(target);
    const absolute = this.targetInside(normalized);
    if (!isImageName(absolute)) throw new Error('the new name must end with .png, .jpg, .jpeg, .webp, or .gif');
    const exists = await fs.access(absolute).then(() => true, () => false);
    if (exists) throw new Error(`"${normalized}" already exists`);
    const realDir = await fs.realpath(this.dir);
    const realParent = await fs.realpath(path.dirname(absolute));
    if (realParent !== realDir && !realParent.startsWith(`${realDir}${path.sep}`)) {
      throw new Error('the new path resolves outside the project image directory');
    }
    await fs.rename(source, absolute);
    const previous = normalizeRel(rel);
    const meta = this.index.get(previous);
    if (meta !== undefined) {
      this.index.delete(previous);
      this.index.set(normalized, meta);
      await this.saveIndex();
    }
    return {
      id: normalized,
      relPath: normalized,
      name: path.basename(normalized),
      path: absolute,
      bytes: (await fs.stat(absolute)).size,
    };
  }

  /**
   * Delete one project image and its metadata.
   * @param rel - project-relative path.
   * @returns the removed descriptor.
   */
  async delete(rel) {
    const source = await this.resolve(rel);
    const normalized = normalizeRel(rel);
    await fs.unlink(source);
    if (this.index.delete(normalized)) await this.saveIndex();
    return { id: normalized, relPath: normalized, name: path.basename(normalized), path: source };
  }

  /**
   * Copy one project image to another project-relative path without
   * overwriting an existing file.
   * @param rel - source project-relative path.
   * @param target - destination project-relative path.
   * @returns the written absolute and project-relative paths.
   */
  async copyTo(rel, target) {
    const found = await this.read(rel);
    if (found === undefined) throw new Error(`image "${rel}" is not in this project's image directory`);
    const cwd = this.root;
    const targetRel = normalizeRel(target);
    const absolute = path.resolve(cwd, targetRel);
    const prefix = path.resolve(cwd).endsWith(path.sep) ? path.resolve(cwd) : `${path.resolve(cwd)}${path.sep}`;
    if (!absolute.startsWith(prefix)) throw new Error('target path is outside the project');
    const extension = path.extname(found.entry.name).toLowerCase();
    const stem = path.basename(targetRel, path.extname(targetRel)) || 'codex-image';
    const directory = path.dirname(absolute);
    await fs.mkdir(directory, { recursive: true });
    let file = `${stem}${extension}`;
    for (let attempt = 2; attempt < 100; attempt += 1) {
      try {
        await fs.access(path.join(directory, file));
        file = `${stem}-${attempt}${extension}`;
      } catch {
        break;
      }
    }
    const written = path.join(directory, file);
    await fs.writeFile(written, found.data);
    return { path: written, relative: path.relative(cwd, written).split(path.sep).join('/') };
  }
}
/**
 * Identify a supported image by signature bytes.
 * @param data - leading bytes of the file.
 * @returns the media type, or undefined.
 */
export function sniffImageType(data) {
  if (!Buffer.isBuffer(data) || data.length < 4) return undefined;
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.length >= 6) {
    const head = data.toString('ascii', 0, 6);
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  return undefined;
}

/**
 * Map a media type to its canonical file extension.
 * @param mediaType - image media type.
 * @returns the extension including the dot.
 */
export function extensionForMedia(mediaType) {
  if (mediaType === 'image/jpeg') return '.jpg';
  if (mediaType === 'image/webp') return '.webp';
  if (mediaType === 'image/gif') return '.gif';
  return '.png';
}
