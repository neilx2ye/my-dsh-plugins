/**
 * Project-scoped artifact storage.
 *
 * One artifact is a directory holding a small `meta.json` and one text file per
 * version. Metadata is the only thing a listing reads, so the canvas never has
 * to load a large document just to draw a card. Content files are written with
 * a same-directory rename, which keeps a reader from ever seeing a half-written
 * document while the agent is updating it.
 *
 * Artifacts belong to a workspace, not to a chat: the same canvas is reachable
 * from every conversation open on that project, and each artifact remembers the
 * Session that created it so a gallery can filter back to one conversation.
 */

import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Supported artifact kinds and how each one is stored and served. */
export const ARTIFACT_TYPES = Object.freeze({
  html: { ext: 'html', mime: 'text/html; charset=utf-8', label: 'HTML' },
  svg: { ext: 'svg', mime: 'image/svg+xml; charset=utf-8', label: 'SVG' },
  markdown: { ext: 'md', mime: 'text/markdown; charset=utf-8', label: 'Markdown' },
  mermaid: { ext: 'mmd', mime: 'text/plain; charset=utf-8', label: 'Mermaid' },
  chart: { ext: 'json', mime: 'application/json; charset=utf-8', label: 'Chart' },
  code: { ext: 'txt', mime: 'text/plain; charset=utf-8', label: 'Code' },
});

/** Longest accepted title. */
export const MAX_TITLE = 120;
/** Longest accepted description. */
export const MAX_DESCRIPTION = 600;
/** Longest accepted language hint on a code artifact. */
export const MAX_LANGUAGE = 40;

/** Artifact ids are opaque lowercase hex so a request can never name a path. */
const ID_PATTERN = /^[a-f0-9]{10}$/;
/** Version numbers name files, so they are plain positive integers. */
const VERSION_PATTERN = /^[1-9][0-9]{0,5}$/;

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
 * The Harness home this process runs from.
 * @returns absolute DSH home path.
 */
export function dshHome() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
  return configured === '' ? path.join(os.homedir(), '.dsh') : configured;
}

/**
 * Stable directory name for one workspace under the shared artifact root.
 * @param cwd - absolute project directory.
 * @returns `<hash>-<readable>` directory name.
 */
export function workspaceKey(cwd) {
  const hash = createHash('sha1').update(cwd).digest('hex').slice(0, 12);
  const readable = path.basename(cwd).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return readable === '' ? hash : `${hash}-${readable}`;
}

/**
 * Normalize one artifact type, rejecting unknown names.
 * @param value - raw type.
 * @returns the supported type.
 */
export function normalizeType(value) {
  if (typeof value !== 'string' || !Object.hasOwn(ARTIFACT_TYPES, value)) {
    throw new Error(`type must be one of ${Object.keys(ARTIFACT_TYPES).join(', ')}`);
  }
  return value;
}

/**
 * Normalize a title, rejecting empty or oversized input.
 * @param value - raw title.
 * @returns trimmed title.
 */
export function normalizeTitle(value) {
  if (typeof value !== 'string') throw new Error('title must be a string');
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed === '') throw new Error('title must not be empty');
  if (trimmed.length > MAX_TITLE) throw new Error(`title must not exceed ${MAX_TITLE} characters`);
  return trimmed;
}

/**
 * Normalize an optional free-text field.
 * @param value - raw value.
 * @param field - field name for the error.
 * @param max - longest accepted value.
 * @returns trimmed text, or an empty string.
 */
export function normalizeText(value, field, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${field} must not exceed ${max} characters`);
  return trimmed;
}

/** Check a chart artifact's JSON before it is stored, so a bad spec fails the tool call. */
function validateContent(type, content) {
  if (type !== 'chart') return;
  let spec;
  try {
    spec = JSON.parse(content);
  } catch {
    throw new Error('chart content must be valid JSON: {"kind":"bar","labels":[],"series":[{"name":"","values":[]}]}');
  }
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('chart content must be a JSON object');
  }
  if (!Array.isArray(spec.labels) || spec.labels.length === 0) {
    throw new Error('chart content needs a non-empty "labels" array');
  }
  if (!Array.isArray(spec.series) || spec.series.length === 0) {
    throw new Error('chart content needs at least one series with a "values" array');
  }
  for (const [index, series] of spec.series.entries()) {
    if (series === null || typeof series !== 'object' || !Array.isArray(series.values)) {
      throw new Error(`chart series[${index}] must be an object with a "values" array`);
    }
    if (series.values.length !== spec.labels.length) {
      throw new Error(`chart series[${index}].values has ${series.values.length} entries; labels has ${spec.labels.length}`);
    }
  }
}

/** One artifact directory: metadata plus immutable version files. */
export class ArtifactStore {
  /**
   * @param root - absolute directory holding every artifact of this workspace.
   * @param project - absolute project directory this store belongs to.
   * @param options - limits applied to every write.
   */
  constructor(root, project, options) {
    this.root = root;
    this.project = project;
    this.maxBytes = options.maxBytes;
    this.maxVersions = options.maxVersions;
  }

  /** Create the root directory if it is not there yet. */
  async ensure() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  /**
   * Directory holding one artifact, refusing anything that is not a valid id.
   * @param id - artifact id.
   * @returns absolute directory path.
   */
  dirOf(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error('id must be a 10-character lowercase hex artifact id');
    return path.join(this.root, id);
  }

  /**
   * Read one artifact's metadata.
   * @param id - artifact id.
   * @returns metadata, or undefined when the artifact does not exist.
   */
  async meta(id) {
    let text;
    try {
      text = await fs.readFile(path.join(this.dirOf(id), 'meta.json'), 'utf8');
    } catch (error) {
      if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return undefined;
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return undefined;
    }
    if (parsed === null || typeof parsed !== 'object' || parsed.id !== id) return undefined;
    return parsed;
  }

  /**
   * List every readable artifact, newest update first.
   * @returns metadata records, without content.
   */
  async list() {
    let entries;
    try {
      entries = await fs.readdir(this.root, { withFileTypes: true });
    } catch (error) {
      if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return [];
      throw error;
    }
    const metas = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
      const meta = await this.meta(entry.name);
      if (meta !== undefined) metas.push(meta);
    }
    metas.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    return metas;
  }

  /**
   * Read one version's text.
   * @param id - artifact id.
   * @param version - exact version, or the current one when omitted.
   * @returns content and the metadata it belongs to.
   */
  async read(id, version) {
    const meta = await this.meta(id);
    if (meta === undefined) throw new Error(`artifact ${id} does not exist`);
    const wanted = version === undefined || version === null || version === '' ? meta.current : Number(version);
    if (!Number.isInteger(wanted) || wanted < 1) throw new Error('version must be a positive integer');
    const record = Array.isArray(meta.versions) ? meta.versions.find((item) => item.v === wanted) : undefined;
    if (record === undefined) throw new Error(`artifact ${id} has no version ${wanted}`);
    const content = await fs.readFile(path.join(this.dirOf(id), record.file), 'utf8');
    return { meta, version: wanted, record, content };
  }

  /**
   * Create one artifact at version 1.
   * @param input - validated creation input.
   * @returns the stored metadata.
   */
  async create(input) {
    await this.ensure();
    const type = normalizeType(input.type);
    const title = normalizeTitle(input.title);
    const content = this.checkContent(input.content);
    validateContent(type, content);
    const id = randomBytes(5).toString('hex');
    const dir = this.dirOf(id);
    await fs.mkdir(dir, { recursive: false, mode: 0o700 });
    const now = new Date().toISOString();
    const file = `v1.${ARTIFACT_TYPES[type].ext}`;
    await this.writeFile(dir, file, content);
    const meta = {
      id,
      title,
      type,
      language: normalizeText(input.language, 'language', MAX_LANGUAGE),
      description: normalizeText(input.description, 'description', MAX_DESCRIPTION),
      project: this.project,
      sessionId: typeof input.sessionId === 'string' ? input.sessionId : '',
      createdAt: now,
      updatedAt: now,
      current: 1,
      versions: [{ v: 1, file, bytes: Buffer.byteLength(content, 'utf8'), createdAt: now }],
    };
    await this.writeMeta(dir, meta);
    return meta;
  }

  /**
   * Append a new version to an artifact.
   * @param id - artifact id.
   * @param input - validated update input.
   * @returns the updated metadata.
   */
  async update(id, input) {
    const meta = await this.meta(id);
    if (meta === undefined) throw new Error(`artifact ${id} does not exist`);
    let type = meta.type;
    if (input.type !== undefined) type = normalizeType(input.type);
    const content = this.checkContent(input.content);
    validateContent(type, content);
    // Restoring an older version rewinds `current`; the next write must still
    // land after every stored version or it would overwrite that version's file.
    const version = meta.versions.reduce((highest, record) => Math.max(highest, record.v), 0) + 1;
    const file = `v${version}.${ARTIFACT_TYPES[type].ext}`;
    const dir = this.dirOf(id);
    const now = new Date().toISOString();
    await this.writeFile(dir, file, content);
    const versions = [
      ...meta.versions,
      { v: version, file, bytes: Buffer.byteLength(content, 'utf8'), createdAt: now },
    ];
    const pruned = this.prune(versions, version);
    for (const record of versions) {
      if (pruned.includes(record.v)) await fs.rm(path.join(dir, record.file), { force: true });
    }
    const next = {
      ...meta,
      title: input.title === undefined ? meta.title : normalizeTitle(input.title),
      type,
      ...(input.language === undefined ? {} : { language: normalizeText(input.language, 'language', MAX_LANGUAGE) }),
      ...(input.description === undefined ? {} : { description: normalizeText(input.description, 'description', MAX_DESCRIPTION) }),
      updatedAt: now,
      current: version,
      versions: versions.filter((record) => !pruned.includes(record.v)),
    };
    await this.writeMeta(dir, next);
    return next;
  }

  /**
   * Rename one artifact without touching its content.
   * @param id - artifact id.
   * @param title - replacement title.
   * @returns the updated metadata.
   */
  async rename(id, title) {
    const meta = await this.meta(id);
    if (meta === undefined) throw new Error(`artifact ${id} does not exist`);
    const next = { ...meta, title: normalizeTitle(title), updatedAt: new Date().toISOString() };
    await this.writeMeta(this.dirOf(id), next);
    return next;
  }

  /**
   * Point one artifact back at an older version without writing a new file.
   * @param id - artifact id.
   * @param version - version to make current.
   * @returns the updated metadata.
   */
  async restore(id, version) {
    const meta = await this.meta(id);
    if (meta === undefined) throw new Error(`artifact ${id} does not exist`);
    const wanted = Number(version);
    if (!Number.isInteger(wanted) || !meta.versions.some((record) => record.v === wanted)) {
      throw new Error(`artifact ${id} has no version ${String(version)}`);
    }
    const next = { ...meta, current: wanted, updatedAt: new Date().toISOString() };
    await this.writeMeta(this.dirOf(id), next);
    return next;
  }

  /**
   * Delete one artifact and every version file it owns.
   * @param id - artifact id.
   * @returns the removed metadata.
   */
  async remove(id) {
    const meta = await this.meta(id);
    if (meta === undefined) throw new Error(`artifact ${id} does not exist`);
    await fs.rm(this.dirOf(id), { recursive: true, force: true });
    return meta;
  }

  /**
   * Reject content that is empty or beyond the configured ceiling.
   * @param content - candidate text.
   * @returns the accepted text.
   */
  checkContent(content) {
    if (typeof content !== 'string') throw new Error('content must be a string');
    if (content.trim() === '') throw new Error('content must not be empty');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > this.maxBytes) {
      throw new Error(`content is ${bytes} bytes, over the ${this.maxBytes}-byte artifact limit`);
    }
    return content;
  }

  /**
   * Keep the newest `maxVersions` files while never dropping the current one.
   * @param versions - every version record.
   * @param current - the version that must survive.
   * @returns versions to delete.
   */
  prune(versions, current) {
    if (versions.length <= this.maxVersions) return [];
    const keep = new Set(
      [...versions]
        .sort((left, right) => right.v - left.v)
        .slice(0, Math.max(1, this.maxVersions))
        .map((record) => record.v),
    );
    keep.add(current);
    return versions.filter((record) => !keep.has(record.v)).map((record) => record.v);
  }

  /**
   * Write one content file atomically inside the artifact directory.
   * @param dir - artifact directory.
   * @param file - file name.
   * @param content - text to write.
   */
  async writeFile(dir, file, content) {
    const target = path.join(dir, file);
    const temp = `${target}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
    await fs.writeFile(temp, content, { mode: 0o600 });
    await fs.rename(temp, target);
  }

  /**
   * Write metadata atomically inside the artifact directory.
   * @param dir - artifact directory.
   * @param meta - metadata to persist.
   */
  async writeMeta(dir, meta) {
    const target = path.join(dir, 'meta.json');
    const temp = `${target}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, target);
  }
}

/**
 * Validate one version query value.
 * @param value - raw version.
 * @returns a version number, or undefined for "current".
 */
export function normalizeVersion(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) throw new Error('version must be a positive integer');
  return Number(value);
}

/**
 * Describe one artifact for the browser without leaking its content.
 * @param meta - stored metadata.
 * @returns compact descriptor.
 */
export function describe(meta) {
  const current = Array.isArray(meta.versions) ? meta.versions.find((item) => item.v === meta.current) : undefined;
  return {
    id: meta.id,
    title: meta.title,
    type: meta.type,
    language: meta.language ?? '',
    description: meta.description ?? '',
    sessionId: meta.sessionId ?? '',
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    version: meta.current,
    bytes: current === undefined ? 0 : current.bytes,
    versions: Array.isArray(meta.versions)
      ? meta.versions.map((record) => ({ v: record.v, bytes: record.bytes, createdAt: record.createdAt }))
      : [],
  };
}