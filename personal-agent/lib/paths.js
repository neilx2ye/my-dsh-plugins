/**
 * Identity paths for the Personal Agent bundle.
 *
 * Every identity owns one home directory (a Harness workspace) and one memory
 * file. Both live under the profile's plugin data directory unless the config
 * names an absolute path. The first legacy identity keeps the original
 * single-identity locations, so installing this version over an earlier one
 * does not move its home or memory.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** Identity id whose default locations are the pre-multi-identity ones. */
export const LEGACY_IDENTITY_ID = 'default';

/**
 * Expand the supported tilde prefixes in a configured path.
 * @param path - configured absolute or `~` path.
 * @returns an absolute path.
 */
export function expandHome(path) {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  if (path.startsWith('~\\')) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Resolve one identity's owned directories.
 * @param identity - normalized identity.
 * @param dataDir - the plugin's profile-local data directory.
 * @returns the home directory, memory file, and the identity's own root.
 */
export function resolveIdentityPaths(identity, dataDir) {
  const root = join(dataDir, 'identities', identity.id);
  const legacy = identity.id === LEGACY_IDENTITY_ID;
  return {
    root,
    home: identity.home === '' ? (legacy ? join(dataDir, 'home') : join(root, 'home')) : expandHome(identity.home),
    memoryFile: identity.memoryFile === '' ? (legacy ? join(dataDir, 'memory.md') : join(root, 'memory.md')) : expandHome(identity.memoryFile),
  };
}