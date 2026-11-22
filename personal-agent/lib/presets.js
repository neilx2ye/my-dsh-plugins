/**
 * Preset policy for the Personal Agent bundle.
 *
 * `personal` describes a named identity that lives in its own home; it is not a
 * way to run a project conversation. The bundle therefore keeps it out of the
 * selectable roster and refuses it for any Session whose working directory is
 * not an identity home or a group home. Workspace conversations keep the
 * profile's ordinary preset instead.
 */

import { sep } from 'node:path';

/** Agent preset this bundle reserves for identity and group conversations. */
export const PERSONAL_PRESET_ID = 'personal';

/** Ordinary preset a workspace conversation falls back to. */
export const WORKSPACE_PRESET_ID = 'standard';

/**
 * Test whether one path is a root or lives under it.
 * @param root - absolute directory.
 * @param candidate - absolute path.
 * @returns whether candidate is inside root.
 */
export function inside(root, candidate) {
  if (typeof root !== 'string' || root === '') return false;
  if (typeof candidate !== 'string' || candidate === '') return false;
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * Whether one working directory may run the personal preset.
 *
 * An empty or missing directory means the caller cannot classify the Session;
 * the caller then leaves the request alone rather than guessing.
 * @param cwd - effective working directory.
 * @param roots.identityHomes - canonical identity home directories.
 * @param roots.groupsRoot - root that holds every group home.
 * @returns whether the preset is allowed here.
 */
export function personalPresetAllowed(cwd, { identityHomes = [], groupsRoot = '' } = {}) {
  if (typeof cwd !== 'string' || cwd === '') return true;
  if (inside(groupsRoot, cwd)) return true;
  return identityHomes.some((home) => inside(home, cwd));
}

/**
 * Remove the reserved preset from one roster payload.
 * @param roster - `agentPresets/list` result.
 * @returns the same roster without the personal preset.
 */
export function hidePersonalPreset(roster) {
  if (roster === null || typeof roster !== 'object' || !Array.isArray(roster.presets)) return roster;
  return { ...roster, presets: roster.presets.filter((preset) => preset?.id !== PERSONAL_PRESET_ID) };
}

/**
 * Pick the preset a workspace Session should use instead of Personal.
 * @param presets - declared presets from the registry.
 * @returns `standard` when healthy, otherwise the first healthy preset, otherwise undefined.
 */
export function workspaceFallbackPreset(presets) {
  const healthy = (Array.isArray(presets) ? presets : [])
    .filter((preset) => preset !== null && typeof preset === 'object' && typeof preset.id === 'string')
    .filter((preset) => preset.id !== PERSONAL_PRESET_ID && preset.broken === undefined)
    .map((preset) => preset.id);
  if (healthy.includes(WORKSPACE_PRESET_ID)) return WORKSPACE_PRESET_ID;
  return healthy[0];
}