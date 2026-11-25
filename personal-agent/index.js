/**
 * Host half of the Personal Agent bundle.
 *
 * The bundle turns ONE DSH profile into a set of named personal identities
 * instead of a project container:
 *
 * - each identity has its own agent-scoped persona and memory sections, so two
 *   identities can talk at the same time without seeing each other's notes;
 * - each identity has a home directory, registered as one Harness workspace
 *   titled after the identity, and the browser's sidebar lists identities
 *   rather than workspaces or sessions;
 * - `remember` / `recall` resolve the calling agent's identity from its working
 *   directory and write that identity's memory only;
 * - clicking an identity returns its newest non-archived conversation, and the
 *   Host decides whether a conversation exists at all. The user never picks a
 *   workspace or presses New Session.
 *
 * Nothing here is device-global. The Loader layer exists only in the profile
 * that lists this bundle, and every file this plugin owns lives under that
 * profile's own directory (`<profile>/personal-agent/`). A profile without the
 * bundle is untouched.
 *
 * The Harness data model still binds sessions to a directory, so the workspace
 * registry is reused rather than bypassed. What changes is the presentation:
 * one home per identity, no workspace/session browser, and no New Session
 * control (the client hides the shell's control).
 */

import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

import {
  composeDirectMessagePrompt,
  composePeerSection,
  describeCancelledWait,
  dmPairKey,
  normalizeDirectMessage,
  waitForReply,
  DM_TRANSCRIPT_LIMIT,
  DM_WAIT_DEADLINE_MS,
  WAIT_CANCELLED,
} from './lib/direct-message.js';
import { createActivityLog } from './lib/activity.js';
import { conversationsToClear } from './lib/conversations.js';
import {
  DELEGATION_EVENT,
  delegationDenyFilter,
  readDelegationChoice,
} from './lib/delegation.js';
import {
  Config,
  composeIdentitySection,
  composeMemorySection,
  mergeIdentity,
  normalizeIdentity,
  parseConfig,
  serializeIdentity,
} from './lib/identity.js';
import { appendMemory, byteLength, countNotes, normalizeMemoryText, readMemorySync, renderNotes, searchMemory, writeMemory } from './lib/memory.js';
import { resolveIdentityPaths } from './lib/paths.js';
import {
  PERSONAL_PRESET_ID,
  hidePersonalPreset,
  personalPresetAllowed,
  workspaceFallbackPreset,
} from './lib/presets.js';

export { Config };

/** Identity state and manager payload. */
const STATE_PATH = '/api/personal-agent/state';
/** Per-conversation subagent permission for one identity chat. */
const DELEGATION_PATH = '/api/personal-agent/delegation';
/** Create or update one identity through the profile config editor. */
const IDENTITY_PATH = '/api/personal-agent/identity';
/** Remove one identity: archive its conversations, hide its workspace, move its data. */
const REMOVE_PATH = '/api/personal-agent/identity/remove';
/** Replace one identity's memory note file. */
const MEMORY_PATH = '/api/personal-agent/memory';
/** Ensure one identity's home and return its newest conversation, if any. */
const OPEN_PATH = '/api/personal-agent/open';
/** Start a group conversation hosted by one identity with the others as guests. */
const GROUP_PATH = '/api/personal-agent/group';
/** Close a group and archive its host conversation. */
const GROUP_REMOVE_PATH = '/api/personal-agent/group/remove';
/** Rename one group. */
const GROUP_RENAME_PATH = '/api/personal-agent/group/rename';
/** Post one user message to a multi-agent group and fan it out. */
const GROUP_SEND_PATH = '/api/personal-agent/group/send';
/** Read a multi-agent group's transcript and participant status. */
const GROUP_STATE_PATH = '/api/personal-agent/group/state';
/** Read one image attached to a multi-agent group message. */
const GROUP_IMAGE_PATH = '/api/personal-agent/group/image';
/** Acknowledge an opened `/new` target so the Host can archive the old history. */
const FRESH_CONSUME_PATH = '/api/personal-agent/fresh/consume';
/** Compact the forked transcript after a fresh-conversation switch. */
const COMPACT_PATH = '/api/personal-agent/compact';
/** Mark an identity or group as read. */
const READ_PATH = '/api/personal-agent/read';

/** Prompt section order just after the fixed Harness identity and before any preset persona. */
const IDENTITY_SECTION_ORDER = -999;
/** Memory renders after the tool guidance, before the deployment persona suffix. */
const MEMORY_SECTION_ORDER = 10150;
/** Group protocol sits after the identity and before memory. */
const GROUP_SECTION_ORDER = -998;
/** Peer roster and direct-message guidance sit just after the group protocol. */
const PEER_SECTION_ORDER = -997;
/** Subagent backend used for guest replies. */
const SUBAGENT_PROVIDER = 'spawn';

/** Name of the agent preset this bundle declares. */
const PRESET_ID = PERSONAL_PRESET_ID;

/** Refusal text for a workspace conversation that asks for the personal preset. */
const PERSONAL_REFUSED = 'Personal 模式只用于个人身份会话，工作区会话不能使用。';

/** Image media types a group message may carry, with their file extension. */
const GROUP_IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);
/** Most images one group message may carry. */
const GROUP_IMAGE_MAX_COUNT = 6;
/** Largest encoded image one group message may carry. */
const GROUP_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
/** Largest combined encoded image payload one group message may carry. */
const GROUP_IMAGE_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

/**
 * Resolve the DSH home the same way the launcher does: `$DSH_HOME`, then
 * `~/.dsh`.
 * @returns absolute Harness home.
 */
function dshHome() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
  return configured === '' ? join(homedir(), '.dsh') : resolve(configured);
}

/**
 * Describe a thrown value as one readable line.
 * @param error - thrown value.
 * @returns message text.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read the plugin's workspace-id state file.
 *
 * Version 0.1 stored one top-level `{ workspaceId, titledName }`; that record
 * is read as the legacy identity `default`. The new shape maps identity ids to
 * their workspace facts.
 * @param file - absolute state file path.
 * @returns identity id to workspace facts.
 */
function readState(file) {
  const states = new Map();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return states;
    if (parsed.identities !== null && typeof parsed.identities === 'object' && !Array.isArray(parsed.identities)) {
      for (const [id, value] of Object.entries(parsed.identities)) {
        if (value === null || typeof value !== 'object') continue;
        states.set(id, {
          workspaceId: typeof value.workspaceId === 'string' ? value.workspaceId : undefined,
          titledName: typeof value.titledName === 'string' ? value.titledName : undefined,
        });
      }
    }
    if (typeof parsed.workspaceId === 'string' && !states.has('default')) {
      states.set('default', {
        workspaceId: parsed.workspaceId,
        titledName: typeof parsed.titledName === 'string' ? parsed.titledName : undefined,
      });
    }
  } catch {
    // A missing or damaged file means "rediscover by path", never a failure.
  }
  return states;
}

/**
 * Commit the identity state file atomically; a failure is logged, never fatal.
 * @param file - absolute state file path.
 * @param states - identity id to workspace facts.
 * @param logger - optional logger.
 */
async function writeState(file, states, logger) {
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const document = { identities: Object.fromEntries(states) };
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    logger?.warn?.(`personal-agent: could not persist ${file}: ${messageOf(error)}`);
  }
}

/**
 * Build one JSON response.
 * @param body - JSON payload.
 * @param status - HTTP status.
 * @returns the response.
 */
/**
 * Release a disposer that may be a plain function or a disposable object.
 * @param handle - value returned by a scoped injection or a service method.
 */
function releaseDisposable(handle) {
  if (handle === null || handle === undefined) return;
  if (typeof handle === 'function') {
    handle();
    return;
  }
  if (typeof handle.dispose === 'function') void handle.dispose();
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * Build one structured failure.
 * @param status - HTTP status.
 * @param code - stable machine-readable code.
 * @param message - readable message.
 * @returns the response.
 */
function failure(status, code, message) {
  return json({ code, message }, status);
}

/**
 * Parse one JSON object request body.
 * @param request - buffered request.
 * @returns the parsed object.
 */
async function readObjectBody(request) {
  const value = await request.json();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('request body must be a JSON object');
  }
  return value;
}

/**
 * Decide whether encoded bytes really are the declared image type. This keeps
 * arbitrary bytes out of the group transcript and the participant prompt.
 * @param bytes - decoded image bytes.
 * @param mediaType - declared media type.
 * @returns whether the magic bytes match.
 */
function imageBytesMatchMediaType(bytes, mediaType) {
  if (!(bytes instanceof Uint8Array)) return false;
  const starts = (...signature) => signature.every((value, index) => bytes[index] === value);
  if (mediaType === 'image/png') return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mediaType === 'image/jpeg') return starts(0xff, 0xd8, 0xff);
  if (mediaType === 'image/gif') return starts(0x47, 0x49, 0x46, 0x38);
  if (mediaType === 'image/webp') {
    return starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return false;
}

/**
 * Build the prompt content parts for one group participant: the text prompt
 * first, then every image as an image part the Host admits into the Session.
 * @param prompt - participant prompt text.
 * @param images - normalized images from normalizeGroupImages.
 * @returns prompt content parts.
 */
function promptContent(prompt, images) {
  const content = [{ type: 'text', text: prompt }];
  for (const image of images) {
    content.push({
      type: 'image',
      mediaType: image.mediaType,
      data: image.data,
      ...(typeof image.name === 'string' && image.name !== '' ? { name: image.name } : {}),
    });
  }
  return content;
}

/**
 * Validate and decode the images a browser submitted with one group message.
 * A data: URL prefix is accepted so the composer can send a FileReader result
 * unchanged.
 * @param value - request `images` field.
 * @returns normalized images with `data` (base64), `extension`, and byte size.
 */
function normalizeGroupImages(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('images must be an array');
  if (value.length > GROUP_IMAGE_MAX_COUNT) {
    throw new Error(`a message can carry at most ${GROUP_IMAGE_MAX_COUNT} images`);
  }
  const images = [];
  let total = 0;
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('every image must be an object');
    }
    const mediaType = typeof entry.mediaType === 'string' ? entry.mediaType.trim().toLowerCase() : '';
    const extension = GROUP_IMAGE_TYPES.get(mediaType);
    if (extension === undefined) throw new Error(`unsupported image type "${mediaType}"`);
    let data = typeof entry.data === 'string' ? entry.data.trim() : '';
    const comma = data.startsWith('data:') ? data.indexOf(',') : -1;
    if (comma !== -1) data = data.slice(comma + 1);
    data = data.replace(/\s+/g, '');
    if (data === '' || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw new Error('image data must be base64');
    }
    const bytes = Buffer.from(data, 'base64');
    if (bytes.byteLength === 0) throw new Error('image data is empty');
    if (bytes.byteLength > GROUP_IMAGE_MAX_BYTES) {
      throw new Error(`an image can be at most ${GROUP_IMAGE_MAX_BYTES} bytes`);
    }
    if (!imageBytesMatchMediaType(bytes, mediaType)) {
      throw new Error(`image data does not match ${mediaType}`);
    }
    total += bytes.byteLength;
    if (total > GROUP_IMAGE_MAX_TOTAL_BYTES) throw new Error('the message carries too many image bytes');
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 200) : '';
    const dimension = (candidate) => (Number.isSafeInteger(candidate) && candidate > 0 && candidate <= 65535 ? candidate : undefined);
    const width = dimension(entry.width);
    const height = dimension(entry.height);
    images.push({
      id: `image-${randomUUID()}`,
      mediaType,
      extension,
      data,
      name,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      bytes: bytes.byteLength,
    });
  }
  return images;
}

/**
 * Build the model-facing `remember` tool.
 * @param recordFor - resolve the calling agent's identity record.
 * @returns a tool definition accepted by `ctx.tools.register`.
 */
function buildRememberTool(recordFor) {
  return {
    name: 'remember',
    description:
      'Save one durable fact to this identity\u2019s memory so later conversations with the same identity remember it. Use it for stable preferences, how the user wants to be addressed, ongoing projects, decisions, and anything the user explicitly asks you to remember. Do not store secrets, credentials, or session-only trivia.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        note: { type: 'string', description: 'The fact, written as one self-contained sentence.' },
        topic: { type: 'string', description: 'Optional short topic label, such as "preferences" or "work".' },
      },
      required: ['note'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          saved: { type: 'boolean' },
          notes: { type: 'integer' },
          bytes: { type: 'integer' },
        },
        required: ['saved', 'notes', 'bytes'],
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.saved
            ? `Saved to memory (${value.notes} notes, ${value.bytes} bytes).`
            : 'That note is already in memory; nothing was written.',
        },
      ],
    },
    execute(args, exec) {
      const record = recordFor(exec);
      return record.store.mutate(async () => {
        const result = appendMemory(record.store.read(), args.note, args.topic, record.store.maxBytes());
        if (result.saved) {
          const text = await writeMemory(record.paths.memoryFile, result.text, record.store.maxBytes());
          record.store.commit(text);
        }
        return {
          saved: result.saved,
          notes: countNotes(record.store.read()),
          bytes: byteLength(record.store.read()),
        };
      });
    },
  };
}

/**
 * Build the model-facing `recall` tool.
 * @param recordFor - resolve the calling agent's identity record.
 * @returns a tool definition accepted by `ctx.tools.register`.
 */
function buildRecallTool(recordFor) {
  return {
    name: 'recall',
    description:
      'Search this identity\u2019s memory notes. Pass a query to find related notes, or omit it to read everything this identity has saved. Use it before asking the user something earlier conversations may already answer.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Case-insensitive words to look for. Omit to read the whole memory.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          matches: { type: 'integer' },
          notes: { type: 'integer' },
          text: { type: 'string' },
        },
        required: ['matches', 'notes', 'text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute(args, exec) {
      const record = recordFor(exec);
      const lines = searchMemory(record.store.read(), typeof args.query === 'string' ? args.query : '', 60);
      const notes = countNotes(record.store.read());
      return Promise.resolve({
        matches: lines.length,
        notes,
        text:
          lines.length === 0
            ? notes === 0
              ? 'This identity\u2019s memory is empty. Use remember to save durable facts about the user.'
              : 'No saved notes match that query.'
            : renderNotes(lines),
      });
    },
  };
}

/**
 * Move one removed identity's home and memory out of the active paths.
 *
 * Nothing is deleted: files the identity created are moved under
 * `<profile>/personal-agent/removed/<id>-<timestamp>/` for recovery. Paths a
 * custom configuration placed outside the plugin data directory are retained
 * where they are and reported back.
 * @param record - identity record.
 * @param dataDir - the plugin's profile-local data directory.
 * @returns the removal destination and any retained external paths.
 */
async function moveRemovedIdentityData(record, dataDir) {
  const inside = (path) => path === dataDir || path.startsWith(`${dataDir}${sep}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetRoot = join(dataDir, 'removed', `${record.identity.id}-${stamp}`);
  const moved = [];
  const retained = [];
  const move = async (source, target) => {
    if (!existsSync(source)) return;
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await rename(source, target);
    moved.push(target);
  };
  if (record.identity.id !== 'default' && inside(record.paths.root)) {
    // A generated identity keeps home and memory inside its own root.
    await move(record.paths.root, targetRoot);
    if (!inside(record.paths.home)) retained.push(record.paths.home);
    if (!inside(record.paths.memoryFile)) retained.push(record.paths.memoryFile);
  } else {
    // The legacy identity uses the data root's own home/ and memory.md.
    if (inside(record.paths.home)) await move(record.paths.home, join(targetRoot, 'home'));
    else retained.push(record.paths.home);
    if (inside(record.paths.memoryFile)) await move(record.paths.memoryFile, join(targetRoot, 'memory.md'));
    else retained.push(record.paths.memoryFile);
  }
  return { movedTo: moved.length > 0 ? targetRoot : null, retained };
}

/**
 * Create one identity's in-memory note cache.
 * @param file - absolute memory file path.
 * @param maxBytes - memory budget.
 * @returns the store with read/commit/serialized mutation helpers.
 */
function createMemoryStore(file, maxBytes) {
  let text = normalizeMemoryText(readMemorySync(file));
  let tail = Promise.resolve();
  return {
    file: () => file,
    maxBytes: () => maxBytes,
    read: () => text,
    commit: (next) => {
      text = normalizeMemoryText(next);
    },
    mutate: (operation) => {
      const run = () => operation();
      const next = tail.then(run, run);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}

/**
 * Compose the host protocol for one group conversation.
 * @param host - host identity.
 * @param guests - guest identities.
 * @param name - group display name.
 * @returns the prompt section text.
 */
function composeGroupSection(host, guests, name) {
  const roster = guests
    .map((guest) => `- ${guest.name} (id: ${guest.id}, role: ${guest.role || 'personal agent'})`)
    .join('\n');
  return [
    `This conversation is a group chat (${name}). You are ${host.name}; you host ${guests.map((guest) => guest.name).join(', ')}.`,
    '',
    'Participants:',
    roster,
    '',
    'The user writes to the group. For each user message:',
    '1. Call `ask_identity` once for every guest, passing the user message and enough recent group context for the guest to reply. Never invent a guest reply and never answer on their behalf.',
    '2. Present each guest reply under **their name**, then add your own reply as **' + host.name + '**. Keep your framing short; the participants are the voices.',
    '3. When the user asks the participants to discuss, debate, or respond to each other, relay each participant’s latest reply into `ask_identity` for the others for the requested number of rounds, then stop and summarize. You are the moderator and may add a brief synthesis.',
  ].join('\n');
}

/**
 * Compose the per-participant protocol for a multi-agent group. There is no
 * host or moderator: every participant receives the user's message and replies
 * as itself.
 * @param identity - the participant identity.
 * @param participants - every participant identity.
 * @param name - group display name.
 * @returns the prompt section text.
 */
function composeParticipantSection(identity, participants, name) {
  const others = participants.filter((participant) => participant.id !== identity.id);
  return [
    `This conversation is group chat "${name}". You are ${identity.name}; you are one of ${participants.length} participants, not a host or moderator.`,
    `Other participants: ${others.map((participant) => participant.name).join(', ') || 'none'}.`,
    'Every participant sees the user’s message. Reply as yourself, in your own voice, and do not speak for the other participants or invent their replies.',
    'When the user mentions you directly, they especially want your answer; answer that request rather than summarizing the group.',
  ].join('\n');
}

/**
 * Build the model-facing `new_conversation` tool.
 * @param recordFor - resolve the calling agent's identity record.
 * @param createConversation - create a fresh conversation in that identity's home.
 * @returns a tool definition accepted by `ctx.tools.register`.
 */
function buildNewConversationTool(recordFor, scheduleConversation) {
  return {
    name: 'new_conversation',
    description:
      'Start a fresh conversation after the current turn with an empty model context. The earlier conversation stays in the identity history but is not shown again and is not sent to the model. Before switching, save anything durable the user wants to keep with the remember tool. The UI automatically switches to the new conversation; the user does not need to click anything. Use it when the user asks for a fresh start or the topic changes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { type: 'string', description: 'Optional short reason for starting a fresh conversation.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scheduled: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['scheduled', 'note'],
      },
      render: (_args, value) => [{ type: 'text', text: value.note }],
    },
    async execute(_args, exec) {
      const record = recordFor(exec);
      scheduleConversation(record, exec);
      return {
        scheduled: true,
        note: `A new conversation with ${record.identity.name} will start after this turn with an empty model context. Its earlier conversation stays in the identity history but is not shown again, and the old Session remains available there. Save durable facts to long-term memory before switching if the user wants them kept.`,
      };
    },
  };
}

/**
 * Build the model-facing `ask_identity` tool for the host of a group chat.
 * @param groupFor - resolve a group from the host Session id.
 * @param ask - deliver one guest prompt and return its reply.
 * @returns a tool definition.
 */
function buildAskIdentityTool(groupFor, ask) {
  return {
    name: 'ask_identity',
    description:
      'Ask one participant of this group conversation to reply. Pass their id (or exact name) and the message/context they should answer. Use it once for each guest on a normal user message; when the user wants the participants to discuss or respond to each other, pass the other participant’s latest reply as context and call again for each requested round. Never invent a guest reply.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        identity: { type: 'string', description: 'Guest participant id or exact name.' },
        message: { type: 'string', description: 'What the guest should answer.' },
        context: { type: 'string', description: 'Optional recent group exchange to include.' },
      },
      required: ['identity', 'message'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          identityId: { type: 'string' },
          name: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['identityId', 'name', 'text'],
      },
      render: (_args, value) => [{ type: 'text', text: `**${value.name}**\n${value.text}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const group = groupFor(exec.agent?.session?.id, exec.agent);
      if (group === undefined) throw new Error('personal-agent: ask_identity is only available in a group conversation');
      return ask(group, args, exec);
    },
  };
}

/**
 * Build the model-facing `message_identity` tool: one private 1:1 direct
 * message to another identity in the same profile, answered in this turn.
 * @param recordFor - resolve the calling agent's identity record.
 * @param send - deliver one message and return the target identity's reply.
 * @returns a tool definition accepted by `ctx.tools.register`.
 */
function buildMessageIdentityTool(recordFor, send) {
  return {
    name: 'message_identity',
    description:
      'Send a private direct message to another personal agent in this profile and wait for their own reply. Use it when the user asks you to consult, ask, coordinate with, or hand something to one of the other identities; the reply comes back in this turn. This is a 1:1 conversation, not a group chat, and the exchange is saved for later direct messages with that identity. Never invent their reply and never answer on their behalf.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        identity: { type: 'string', description: 'Target identity id or exact name.' },
        message: { type: 'string', description: 'What to say to that identity. Be specific about what you need from them.' },
      },
      required: ['identity', 'message'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          identityId: { type: 'string' },
          name: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['identityId', 'name', 'text'],
      },
      render: (_args, value) => [{ type: 'text', text: `**${value.name}**\n${value.text}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const record = recordFor(exec);
      const wanted = typeof args.identity === 'string' ? args.identity.trim() : '';
      if (wanted === '') throw new Error('personal-agent: message_identity needs an identity id or name');
      return send(record, wanted, args.message, exec);
    },
  };
}

/**
 * Register the identity model, tools, homes, and browser routes.
 * @param ctx - Host root Context.
 * @param rawConfig - Loader row configuration, validated by {@link Config}.
 */
export function apply(ctx, rawConfig) {
  const settings = parseConfig(rawConfig);
  /**
   * Per-Agent delegation gate: a private identity conversation may spawn
   * subagents only when the conversation itself recorded that permission. The
   * restriction lives on the Agent's own scope, so it never touches a group, a
   * project Session, or another identity.
   * @type {Map<object, { sync: () => void, dispose: () => void }>}
   */
  const delegationGates = new Map();
  const profile = ctx.get('profileContext');
  const dataDir = profile === undefined ? join(dshHome(), 'personal-agent') : join(profile.dir, 'personal-agent');
  const logger = ctx.logger;

  /**
   * Last observable activity per Session. The working bubble judges a turn by
   * silence, never by how long it has been running; see `lib/activity.js`.
   */
  const activity = createActivityLog();

  // Both halves of the activity signal: durable events cover tool calls,
  // results, steps, and settled replies, while model tokens are transient
  // stream frames that never append a durable event.
  ctx.on('session/event', (session) => activity.touch(session?.id));
  ctx.on('agent/assistant-stream', ({ agent }) => activity.touch(agent?.session?.id));

  /**
   * One identity plus every path it owns.
   * @type {Array<{ identity: object, paths: { home: string, memoryFile: string, root: string }, canonicalHome: string, store: ReturnType<typeof createMemoryStore> }>}
   */
  const records = settings.identities.map((identity) => {
    const paths = resolveIdentityPaths(identity, dataDir);
    return {
      identity,
      paths,
      canonicalHome: resolve(paths.home),
      store: createMemoryStore(paths.memoryFile, settings.memory.maxBytes),
    };
  });

  /**
   * Group conversations. A legacy group is keyed by its host Session id and
   * has a host plus guests. A multi-agent group is keyed by its own group id;
   * it owns one Session per participant and has no host or moderator.
   * @type {Map<string, object>}
   */
  const groupsFile = join(dataDir, 'groups.json');
  const groups = new Map();
  /** Participant Session id -> { group, identityId }. */
  const participantSessions = new Map();
  /** Return the stable key of a group record. */
  const groupKey = (group) => (typeof group.id === 'string' ? group.id : group.sessionId);
  /** Rebuild the participant-Session index from every multi-agent group. */
  const indexParticipants = () => {
    participantSessions.clear();
    for (const group of groups.values()) {
      if (!Array.isArray(group.participantIds)) continue;
      for (const identityId of group.participantIds) {
        const sessionId = group.sessions?.[identityId];
        if (typeof sessionId === 'string') participantSessions.set(sessionId, { group, identityId });
      }
    }
  };
  try {
    if (existsSync(groupsFile)) {
      const parsed = JSON.parse(readFileSync(groupsFile, 'utf8'));
      if (Array.isArray(parsed.groups)) {
        for (const group of parsed.groups) {
          if (group === null || typeof group !== 'object' || typeof group.name !== 'string') continue;
          if (
            typeof group.id === 'string' &&
            Array.isArray(group.participantIds) &&
            group.participantIds.every((id) => typeof id === 'string') &&
            group.sessions !== null &&
            typeof group.sessions === 'object'
          ) {
            const sessions = {};
            for (const identityId of group.participantIds) {
              if (typeof group.sessions[identityId] === 'string') sessions[identityId] = group.sessions[identityId];
            }
            groups.set(group.id, {
              id: group.id,
              name: group.name,
              participantIds: [...group.participantIds],
              sessions,
              createdAt: typeof group.createdAt === 'string' ? group.createdAt : new Date().toISOString(),
              ...(typeof group.workspaceId === 'string' ? { workspaceId: group.workspaceId } : {}),
              ...(typeof group.home === 'string' ? { home: group.home } : {}),
            });
          } else if (typeof group.sessionId === 'string' && typeof group.hostId === 'string' && Array.isArray(group.guestIds)) {
            groups.set(group.sessionId, {
              sessionId: group.sessionId,
              name: group.name,
              hostId: group.hostId,
              guestIds: group.guestIds.filter((id) => typeof id === 'string'),
              createdAt: typeof group.createdAt === 'string' ? group.createdAt : new Date().toISOString(),
              ...(typeof group.workspaceId === 'string' ? { workspaceId: group.workspaceId } : {}),
              ...(typeof group.home === 'string' ? { home: group.home } : {}),
            });
          }
        }
      }
    }
  } catch (error) {
    logger?.warn?.(`personal-agent: could not read groups: ${messageOf(error)}`);
  }
  indexParticipants();
  /**
   * Persist the current group registry atomically enough for this plugin.
   * @returns when the file is written.
   */
  async function writeGroups() {
    await mkdir(dirname(groupsFile), { recursive: true, mode: 0o700 });
    await writeFile(groupsFile, `${JSON.stringify({ groups: [...groups.values()] }, null, 2)}\n`, { mode: 0o600 });
  }

  /**
   * Transcript file for one group. Multi-agent groups persist their own feed;
   * legacy groups use their host Session log.
   * @param group - group record.
   * @returns absolute file path.
   */
  function transcriptFile(group) {
    return join(groupsRoot, groupKey(group), 'transcript.json');
  }

  /**
   * Directory holding one group's message images.
   * @param group - group record.
   * @returns absolute directory path.
   */
  function groupImagesDir(group) {
    return join(groupsRoot, groupKey(group), 'images');
  }

  /**
   * Persist the images attached to one user message. The transcript only holds
   * metadata, so status polling never repeats image bytes.
   * @param group - group record.
   * @param images - normalized images from normalizeGroupImages.
   * @returns stored image metadata for the transcript.
   */
  async function storeGroupImages(group, images) {
    if (images.length === 0) return [];
    const directory = groupImagesDir(group);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stored = [];
    for (const image of images) {
      await writeFile(join(directory, `${image.id}.${image.extension}`), Buffer.from(image.data, 'base64'), { mode: 0o600 });
      stored.push({
        id: image.id,
        mediaType: image.mediaType,
        ...(image.name === '' ? {} : { name: image.name }),
        ...(image.width === undefined ? {} : { width: image.width }),
        ...(image.height === undefined ? {} : { height: image.height }),
        bytes: image.bytes,
      });
    }
    return stored;
  }

  /**
   * Shape one transcript message for the browser: image bytes stay on disk and
   * each image becomes a same-origin URL the feed can render.
   * @param group - group record.
   * @param message - transcript message.
   * @returns the browser-safe message.
   */
  function publicGroupMessage(group, message) {
    const images = Array.isArray(message?.images)
      ? message.images.filter((image) => image !== null && typeof image === 'object' && typeof image.id === 'string')
      : [];
    if (images.length === 0) return message;
    const groupId = encodeURIComponent(groupKey(group));
    return {
      ...message,
      images: images.map((image) => ({
        id: image.id,
        ...(image.name === undefined ? {} : { name: image.name }),
        mediaType: image.mediaType,
        ...(image.width === undefined ? {} : { width: image.width }),
        ...(image.height === undefined ? {} : { height: image.height }),
        url: `${GROUP_IMAGE_PATH.replace(/^\/+/, '')}?groupId=${groupId}&imageId=${encodeURIComponent(image.id)}`,
      })),
    };
  }

  /**
   * Read one group transcript.
   * @param group - group record.
   * @returns messages oldest first.
   */
  function readTranscript(group) {
    try {
      if (!existsSync(transcriptFile(group))) return [];
      const parsed = JSON.parse(readFileSync(transcriptFile(group), 'utf8'));
      return Array.isArray(parsed.messages) ? parsed.messages.filter((message) => message !== null && typeof message === 'object') : [];
    } catch (error) {
      logger?.warn?.(`personal-agent: could not read group transcript: ${messageOf(error)}`);
      return [];
    }
  }

  /**
   * Replace one group transcript, keeping the feed bounded.
   * @param group - group record.
   * @param messages - complete message list.
   */
  async function writeTranscript(group, messages) {
    const bounded = messages.slice(-400);
    const dropped = messages.slice(0, Math.max(0, messages.length - bounded.length));
    const file = transcriptFile(group);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, `${JSON.stringify({ version: 1, messages: bounded }, null, 2)}\n`, { mode: 0o600 });
    if (dropped.length === 0) return;
    // Images of messages that fell out of the bounded feed are unreachable, so
    // remove their files best-effort instead of accumulating them forever.
    const directory = groupImagesDir(group);
    const stale = dropped
      .flatMap((message) => (Array.isArray(message?.images) ? message.images : []))
      .filter((image) => image !== null && typeof image === 'object' && typeof image.id === 'string')
      .map((image) => {
        const extension = GROUP_IMAGE_TYPES.get(image.mediaType);
        return extension === undefined ? undefined : join(directory, `${image.id}.${extension}`);
      })
      .filter((path) => path !== undefined);
    await Promise.allSettled(stale.map((path) => unlink(path)));
  }

  /** Per-group write chains so parallel replies cannot overwrite each other. */
  const transcriptChains = new Map();

  /**
   * Append one message to a group transcript, serialized per group.
   * @param group - group record.
   * @param message - { id, role, text, time, identityId?, name? }.
   * @returns the appended message.
   */
  async function appendTranscript(group, message) {
    const key = groupKey(group);
    if (message.role === 'assistant') {
      unreadGroups.set(key, (unreadGroups.get(key) ?? 0) + 1);
    }
    const previous = transcriptChains.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const messages = readTranscript(group);
      messages.push(message);
      await writeTranscript(group, messages);
    });
    transcriptChains.set(key, next);
    try {
      await next;
    } finally {
      if (transcriptChains.get(key) === next) transcriptChains.delete(key);
    }
    return message;
  }

  /** Sessions prompted for a multi-agent group, awaiting their turn end. */
  const pendingReplies = new Map();

  // ── private direct messages between two identities ───────────────────────
  // A direct message is one pair's own thread: the caller identity asks, the
  // target identity answers as itself (a one-shot child running in its home),
  // and the exchange is persisted so a later message carries the thread.

  /** Root holding every pair's direct-message transcript. */
  const dmsRoot = join(dataDir, 'dms');
  /** Pair key -> tail of the serialized exchange chain. */
  const dmExchanges = new Map();

  /**
   * Transcript file for one pair.
   * @param key - pair key from dmPairKey.
   * @returns absolute file path.
   */
  function dmTranscriptFile(key) {
    return join(dmsRoot, key, 'transcript.json');
  }

  /**
   * Read one pair's direct-message transcript.
   * @param key - pair key.
   * @returns stored messages, oldest first.
   */
  function readDm(key) {
    try {
      if (!existsSync(dmTranscriptFile(key))) return [];
      const parsed = JSON.parse(readFileSync(dmTranscriptFile(key), 'utf8'));
      return Array.isArray(parsed.messages) ? parsed.messages.filter((message) => message !== null && typeof message === 'object') : [];
    } catch (error) {
      logger?.warn?.(`personal-agent: could not read direct messages: ${messageOf(error)}`);
      return [];
    }
  }

  /**
   * Replace one pair's transcript, keeping it bounded.
   * @param key - pair key.
   * @param messages - complete message list.
   */
  async function writeDm(key, messages) {
    const file = dmTranscriptFile(key);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const bounded = messages.slice(-DM_TRANSCRIPT_LIMIT);
    await writeFile(file, `${JSON.stringify({ version: 1, messages: bounded }, null, 2)}\n`, { mode: 0o600 });
  }

  /**
   * Append one message to a pair's transcript. The caller holds the pair's
   * exchange lock, so this does not need a write chain of its own.
   * @param key - pair key.
   * @param message - { id, role, identityId, name, text, time }.
   */
  async function appendDm(key, message) {
    const messages = readDm(key);
    messages.push(message);
    await writeDm(key, messages);
  }

  /**
   * Serialize whole exchanges for one pair, so two concurrent messages cannot
   * read the same history and interleave their writes.
   * @param key - pair key.
   * @param operation - exchange to run.
   * @returns the operation's result.
   */
  function withDmExchange(key, operation) {
    const previous = dmExchanges.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    dmExchanges.set(key, next);
    const cleanup = () => {
      if (dmExchanges.get(key) === next) dmExchanges.delete(key);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  /**
   * Deliver one direct message to another identity and wait for its reply.
   * The reply is a one-shot child in the target's home, so the target's own
   * persona and memory apply; nothing in the pair's thread is shared with any
   * other identity.
   * @param caller - calling identity record.
   * @param wanted - target identity id or exact name.
   * @param rawMessage - model-supplied message text.
   * @param exec - tool execution context.
   * @returns the target identity and its reply.
   */
  async function sendDirectMessage(caller, wanted, rawMessage, exec) {
    const target = records.find((record) => record.identity.id === wanted || record.identity.name === wanted);
    if (target === undefined) {
      const available = records.map((record) => `${record.identity.name} (${record.identity.id})`).join(', ');
      throw new Error(`personal-agent: no identity "${wanted}". Available identities: ${available}`);
    }
    if (target.identity.id === caller.identity.id) {
      throw new Error('personal-agent: an identity cannot send a direct message to itself');
    }
    const message = normalizeDirectMessage(rawMessage);
    const key = dmPairKey(caller.identity.id, target.identity.id);
    return withDmExchange(key, async () => {
      const subagents = ctx.get('subagents');
      const provider = subagents?.getProvider?.(SUBAGENT_PROVIDER);
      if (subagents === undefined || provider === undefined) {
        throw new Error('personal-agent: direct messages need a subagent provider, which this Host does not expose');
      }
      const history = readDm(key);
      const prompt = composeDirectMessagePrompt({
        caller: caller.identity,
        target: target.identity,
        message,
        history,
      });
      const timeout = AbortSignal.timeout(DM_WAIT_DEADLINE_MS);
      const signal = exec.signal == null ? timeout : AbortSignal.any([exec.signal, timeout]);
      const activation = await subagents.startActivation({
        provider: provider.name,
        label: `${caller.identity.name} \u2192 ${target.identity.name}`,
        cwd: target.paths.home,
        agentPreset: PRESET_ID,
        prompt: [{ type: 'text', text: prompt }],
        parent: exec.agent,
        signal,
        delivery: 'caller',
      });
      // Record the message only after the target's child was accepted: a
      // rejected start never reached the target, so it must not appear in the
      // shared thread.
      await appendDm(key, {
        id: `dm-${randomUUID()}`,
        role: 'agent',
        identityId: caller.identity.id,
        name: caller.identity.name,
        text: message,
        time: new Date().toISOString(),
      });
      try {
        let result;
        try {
          result = await waitForReply(activation.result, signal);
        } catch (error) {
          if (error === null || typeof error !== 'object' || error.code !== WAIT_CANCELLED) throw error;
          return {
            identityId: target.identity.id,
            name: target.identity.name,
            text: describeCancelledWait({
              name: target.identity.name,
              reason: signal.reason,
              deadlineSeconds: DM_WAIT_DEADLINE_MS / 1000,
            }),
          };
        }
        const text = result.output
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n')
          .trim();
        if (text !== '') {
          await appendDm(key, {
            id: `dm-${randomUUID()}`,
            role: 'assistant',
            identityId: target.identity.id,
            name: target.identity.name,
            text,
            time: new Date().toISOString(),
          });
        }
        return {
          identityId: target.identity.id,
          name: target.identity.name,
          text:
            text !== ''
              ? text
              : `${target.identity.name} did not produce a reply (${result.stopReason}${result.diagnostic === undefined ? '' : `: ${result.diagnostic}`}).`,
        };
      } finally {
        await activation.dispose().catch((error) => logger?.warn?.(`personal-agent: direct-message cleanup failed: ${messageOf(error)}`));
      }
    });
  }

  /**
   * Extract the visible text of an assistant event.
   * @param event - session event.
   * @returns joined text.
   */
  function assistantText(event) {
    const content = event?.data?.message?.content;
    if (!Array.isArray(content)) return '';
    return content
      .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim();
  }

  // Count unread assistant messages for identity and legacy-group Sessions.
  // Multi-agent group replies are counted when they are appended to the feed.
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'assistant/message') return;
    if (session.header.origin === 'subagent' || session.header.parentSession !== undefined) return;
    if (event.surfaceOp === 'replace') return;
    if (assistantText(event) === '') return;
    const group = groups.get(session.id) ?? groupForCwd(session.header.cwd);
    if (group !== undefined) {
      if (Array.isArray(group.participantIds)) return;
      unreadGroups.set(groupKey(group), (unreadGroups.get(groupKey(group)) ?? 0) + 1);
      return;
    }
    const record = recordForCwd(session.header.cwd);
    if (record === undefined) return;
    unreadIdentities.set(record.identity.id, (unreadIdentities.get(record.identity.id) ?? 0) + 1);
  });

  // A participant agent answers in its own Session. When that turn ends, copy...
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return;
    const queue = pendingReplies.get(session.id);
    if (queue === undefined || queue.length === 0) return;
    const pending = queue.shift();
    if (queue.length === 0) pendingReplies.delete(session.id);
    const group = groups.get(pending.groupId);
    if (group === undefined) return;
    const identity = records.find((record) => record.identity.id === pending.identityId)?.identity;
    if (identity === undefined) return;
    const answered = [...session.log].reverse().find((candidate) => candidate.type === 'assistant/message' && candidate.seq >= pending.startSeq);
    const text = assistantText(answered);
    if (text === '') return;
    void appendTranscript(group, {
      id: `message-${randomUUID()}`,
      role: 'assistant',
      identityId: identity.id,
      name: identity.name,
      text,
      time: new Date().toISOString(),
    }).catch((error) => logger?.warn?.(`personal-agent: could not append a group reply: ${messageOf(error)}`));
  });

  /**
   * Fresh-conversation markers: identity id -> blank Session id. The
   * new_conversation tool and the `/new` command create the blank Session; the
   * client auto-switches to it.
   * @type {Map<string, string>}
   */
  const freshFile = join(dataDir, 'fresh.json');
  const freshSessions = new Map();
  // /new waits for the browser to open the replacement before archiving its
  // source. Persist the handoff so reloading mid-switch does not lose it.
  const pendingResets = new Map();
  const startingResets = new Set();
  const finishingResets = new Map();
  /** Unread assistant messages by identity id and group key. */
  const unreadIdentities = new Map();
  const unreadGroups = new Map();
  try {
    if (existsSync(freshFile)) {
      const parsed = JSON.parse(readFileSync(freshFile, 'utf8'));
      if (parsed !== null && typeof parsed === 'object' && parsed.identities !== null && typeof parsed.identities === 'object') {
        for (const [identityId, value] of Object.entries(parsed.identities)) {
          const sessionId = typeof value === 'string' ? value : value?.sessionId;
          if (typeof sessionId !== 'string') continue;
          freshSessions.set(identityId, sessionId);
          const reset = value?.reset;
          if (typeof reset?.source === 'string' && typeof reset.workspaceId === 'string' && Array.isArray(reset.stale)) {
            pendingResets.set(identityId, { sessionId, source: reset.source, workspaceId: reset.workspaceId, stale: reset.stale });
          }
        }
      }
    }
  } catch (error) {
    logger?.warn?.(`personal-agent: could not read fresh conversations: ${messageOf(error)}`);
  }
  /**
   * Persist the pending fresh-conversation markers.
   * @returns when the file is written.
   */
  let freshWrite = Promise.resolve();
  function writeFresh() {
    const attempt = freshWrite.then(async () => {
      const identities = Object.fromEntries([...freshSessions].map(([identityId, sessionId]) => {
        const reset = pendingResets.get(identityId);
        return [identityId, reset === undefined ? { sessionId } : { sessionId, reset }];
      }));
      await mkdir(dirname(freshFile), { recursive: true, mode: 0o700 });
      const temporary = `${freshFile}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify({ identities }, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, freshFile);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    });
    freshWrite = attempt.catch(() => undefined);
    return attempt;
  }

  // Two identities must not share a home or a memory file: both would fight
  // over one workspace and one set of notes.
  const homes = new Map();
  const memories = new Map();
  for (const record of records) {
    const otherHome = homes.get(record.paths.home);
    if (otherHome !== undefined) {
      throw new Error(`personal-agent: identities "${otherHome}" and "${record.identity.name}" share the home directory ${record.paths.home}`);
    }
    homes.set(record.paths.home, record.identity.name);
    const otherMemory = memories.get(record.paths.memoryFile);
    if (otherMemory !== undefined) {
      throw new Error(`personal-agent: identities "${otherMemory}" and "${record.identity.name}" share the memory file ${record.paths.memoryFile}`);
    }
    memories.set(record.paths.memoryFile, record.identity.name);
  }

  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    for (const record of records) {
      mkdirSync(record.paths.home, { recursive: true, mode: 0o700 });
      try {
        record.canonicalHome = realpathSync(record.paths.home);
      } catch {
        record.canonicalHome = resolve(record.paths.home);
      }
      mkdirSync(dirname(record.paths.memoryFile), { recursive: true, mode: 0o700 });
    }
  } catch (error) {
    logger?.warn?.(`personal-agent: could not create its data directory: ${messageOf(error)}`);
  }

  const stateFile = join(dataDir, 'state.json');
  const states = readState(stateFile);
  /** Live home details by identity id. */
  const homesInfo = new Map();
  for (const record of records) {
    const state = states.get(record.identity.id);
    homesInfo.set(record.identity.id, {
      workspaceId: state?.workspaceId,
      titledName: state?.titledName,
      title: record.identity.name,
      path: record.paths.home,
      error: undefined,
    });
  }

  /**
   * Choose the identity whose home contains a working directory.
   * @param cwd - effective working directory, or undefined.
   * @returns the nearest identity record, or the first identity as fallback.
   */
  function recordForCwd(cwd) {
    if (typeof cwd === 'string' && cwd !== '') {
      let nearest;
      for (const record of records) {
        const home = record.canonicalHome;
        const inside = cwd === home || cwd.startsWith(home.endsWith(sep) ? home : `${home}${sep}`);
        if (inside && (nearest === undefined || home.length > nearest.canonicalHome.length)) nearest = record;
      }
      return nearest;
    }
    return undefined;
  }

  /**
   * Read the effective working directory of one session without I/O.
   * @param session - session to inspect.
   * @param source - context that may provide `workingDirectory`.
   * @returns the directory, or undefined.
   */
  function cwdOf(session, source) {
    try {
      const workingDirectory = source.get('workingDirectory');
      if (workingDirectory !== undefined) return workingDirectory.get(session);
    } catch {
      // Fall through to the recorded header.
    }
    return session?.header?.cwd;
  }

  /** Root that holds every group home; a Session under it is group-scoped. */
  const groupsRoot = join(dataDir, 'groups');

  /**
   * Test whether one path is a root or lives under it.
   * @param root - absolute directory.
   * @param candidate - absolute path.
   * @returns whether candidate is inside root.
   */
  function inside(root, candidate) {
    return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
  }

  /**
   * Find the group that owns a working directory. New groups have a home under
   * `groups/`; matching by directory keeps a group recognised even when its
   * registry row is out of date, so a guest turn can never be mistaken for a
   * private identity conversation.
   * @param cwd - effective working directory.
   * @returns the group or undefined.
   */
  function groupForCwd(cwd) {
    if (typeof cwd !== 'string' || cwd === '') return undefined;
    for (const group of groups.values()) {
      const home = typeof group.home === 'string' && group.home !== '' ? group.home : join(groupsRoot, groupKey(group), 'home');
      if (inside(home, cwd)) return group;
    }
    return undefined;
  }

  /**
   * Resolve the group for one Agent, by Session id and then by its working
   * directory. The registry can lag behind a renamed or re-created Session;
   * the directory is the durable half of the group's identity.
   * @param agent - live agent.
   * @param source - context that may provide `workingDirectory`.
   * @returns the group or undefined.
   */
  function groupForAgent(agent, source) {
    if (agent === undefined) return undefined;
    const participant = participantSessions.get(agent.session.id);
    if (participant !== undefined) return participant.group;
    const registered = groups.get(agent.session.id);
    if (registered !== undefined) return registered;
    return groupForCwd(cwdOf(agent.session, source));
  }

  /**
   * Resolve the identity for one Agent.
   * @param agent - live agent.
   * @param source - context that may provide `workingDirectory`.
   * @returns the identity record.
   */
  function recordForAgent(agent, source) {
    if (agent === undefined) return undefined;
    const participant = participantSessions.get(agent.session.id);
    if (participant !== undefined) return records.find((record) => record.identity.id === participant.identityId);
    const group = groupForAgent(agent, source);
    if (group !== undefined && typeof group.hostId === 'string') {
      return records.find((record) => record.identity.id === group.hostId);
    }
    return recordForCwd(cwdOf(agent.session, source));
  }

  /**
   * Resolve the identity for one tool call.
   * @param exec - tool execution context.
   * @returns the identity record.
   */
  function recordForExec(exec) {
    const record = recordForAgent(exec.agent, ctx);
    if (record === undefined) {
      throw new Error('This conversation is not running inside a personal identity home. Open an identity from the sidebar first.');
    }
    return record;
  }

  // ── per-agent identity and memory prompts ─────────────────────────────────

  ctx.inject(['agents', 'systemPrompt'], (scope) => {
    const installs = new Map();
    /**
     * Attach this profile's identity and memory sections to one agent. The
     * sections live on the agent scope, so two identities never share a prompt.
     * @param agent - agent to decorate.
     */
    const install = (agent) => {
      if (installs.has(agent)) return;
      const record = recordForAgent(agent, scope);
      // Project conversations keep their coding-agent behavior. Only sessions
      // living in an identity's home receive that identity's persona and memory.
      if (record === undefined) return;
      try {
        const fiber = agent.ctx.inject(['systemPrompt'], (scoped) => {
          scoped.systemPrompt.section({
            name: 'personal-agent:identity',
            order: IDENTITY_SECTION_ORDER,
            text: () => composeIdentitySection(record.identity, { siblingCount: records.length }),
          });
          scoped.systemPrompt.section({
            name: 'personal-agent:memory',
            order: MEMORY_SECTION_ORDER,
            text: () => (settings.memory.includeInPrompt ? composeMemorySection(record.identity, record.store.read()) : ''),
          });
          const group = groupForAgent(agent, scope);
          if (group !== undefined && Array.isArray(group.participantIds)) {
            const participants = group.participantIds
              .map((id) => records.find((candidate) => candidate.identity.id === id)?.identity)
              .filter((participant) => participant !== undefined);
            if (participants.length > 0) {
              scoped.systemPrompt.section({
                name: 'personal-agent:group',
                order: GROUP_SECTION_ORDER,
                text: () => composeParticipantSection(record.identity, participants, group.name),
              });
            }
          } else if (group !== undefined && group.hostId === record.identity.id) {
            const guests = group.guestIds
              .map((id) => records.find((candidate) => candidate.identity.id === id)?.identity)
              .filter((guest) => guest !== undefined);
            if (guests.length > 0) {
              scoped.systemPrompt.section({
                name: 'personal-agent:group',
                order: GROUP_SECTION_ORDER,
                text: () => composeGroupSection(record.identity, guests, group.name),
              });
            }
          }
          // No peer roster and no `message_identity`: a private identity
          // conversation may not reach another identity. Reaching a peer meant
          // spawning a child and waiting on it, and a child that never answered
          // froze the whole conversation. Group chats keep their own
          // `ask_identity` route.
        });
        installs.set(agent, fiber);
      } catch (error) {
        logger?.warn?.(`personal-agent: could not register identity prompt for ${agent.id}: ${messageOf(error)}`);
      }
    };
    for (const agent of scope.agents.list()) install(agent);
    scope.on('agent/created', ({ agent }) => install(agent));
    scope.on('agent/disposed', ({ agent }) => {
      const fiber = installs.get(agent);
      if (fiber !== undefined) {
        installs.delete(agent);
        fiber.dispose().catch((error) => logger?.warn?.(`personal-agent: prompt cleanup failed: ${messageOf(error)}`));
      }
    });
    // The agent scope outlives this plugin; unloading must remove our sections.
    scope.effect(
      () => () => {
        const fibers = [...installs.values()];
        installs.clear();
        for (const fiber of fibers) fiber.dispose().catch(() => undefined);
      },
      'personal-agent: identity prompts',
    );
  });

  /**
   * Sessions waiting for their current turn to finish before being forked into
   * a new conversation. The tool schedules; the Host forks at turn end so the
   * new session includes the turn's final assistant message and tool result.
   */
  const pendingConversations = new Map();
  let turnListenerInstalled = false;

  /**
   * Register a post-turn fork for the calling Session.
   * @param record - calling identity.
   * @param exec - tool execution context.
   */
  function scheduleConversation(record, exec) {
    const sourceSessionId = exec.agent?.session?.id;
    if (typeof sourceSessionId !== 'string') throw new Error('personal-agent: no current Session to fork');
    pendingConversations.set(sourceSessionId, { identityId: record.identity.id });
    if (!turnListenerInstalled) {
      turnListenerInstalled = true;
      ctx.on('session/event', (session, event) => {
        if (event.type !== 'turn/end') return;
        const pending = pendingConversations.get(session.id);
        if (pending === undefined) return;
        pendingConversations.delete(session.id);
        void finalizeConversation(session.id, pending).catch((error) => {
          logger?.warn?.(`personal-agent: could not fork a new conversation: ${messageOf(error)}`);
        });
      });
    }
  }

  /**
   * Create a blank conversation in an identity's home. The conversation keeps
   * the identity's prompt and long-term memory but none of the earlier
   * messages; the previous Session remains in the identity's history.
   * @param pending.identityId - owning identity.
   * @param sourceSessionId - Session whose turn just ended.
   * @returns the new Session id.
   */
  async function forkConversation(pending, sourceSessionId) {
    const controller = ctx.get('sessionController');
    if (controller === undefined) throw new Error('personal-agent: session controller is unavailable');
    const registry = await registryWithin(2000);
    if (registry === undefined) throw new Error('personal-agent: workspace registry is unavailable');
    const workspace = await ensureIdentity(pending.identityId, registry);
    if (startingResets.has(pending.identityId) || pendingResets.has(pending.identityId)) return;
    const { sessionId } = await controller.create({ workspaceId: workspace.id, agentPreset: PRESET_ID });
    if (startingResets.has(pending.identityId) || pendingResets.has(pending.identityId)) return;
    freshSessions.set(pending.identityId, sessionId);
    await writeFresh();
    logger?.info?.(`personal-agent: fresh conversation ${sessionId} after ${sourceSessionId}`);
    return sessionId;
  }

  /**
   * Fork a completed Session into a blank conversation and attach it to the
   * identity workspace. The new Session starts with an empty model context;
   * the earlier conversation stays available from the identity's history.
   * @param sourceSessionId - Session whose turn just ended.
   * @param pending.identityId - owning identity.
   */
  async function finalizeConversation(sourceSessionId, pending) {
    const source = ctx.get('sessions')?.get?.(sourceSessionId);
    if (groups.has(sourceSessionId) || groupForCwd(source?.header?.cwd) !== undefined) {
      logger?.warn?.('personal-agent: refused to start a private fresh conversation from a group session');
      return;
    }
    await forkConversation(pending, sourceSessionId);
  }

  /** Prepare `/new` without archiving the Session still on screen. */
  async function prepareConversationReset(record, source) {
    const identityId = record.identity.id;
    if (startingResets.has(identityId) || finishingResets.has(identityId)) {
      throw new Error('该身份正在切换对话，请稍后重试。');
    }
    startingResets.add(identityId);
    try {
      const controller = ctx.get('sessionController');
      if (controller === undefined) throw new Error('personal-agent: session controller is unavailable');
      const registry = await registryWithin(2000);
      if (registry === undefined) throw new Error('personal-agent: workspace registry is unavailable');
      const workspace = await ensureIdentity(identityId, registry);
      const stale = conversationsToClear(workspace.sessionIds, {
        archived: registry.archivedSessionIds,
        excluded: [...groups.keys(), ...participantSessions.keys()],
      });
      const { sessionId } = await controller.create({ workspaceId: workspace.id, agentPreset: PRESET_ID });
      const previousFresh = freshSessions.get(identityId);
      const previousReset = pendingResets.get(identityId);
      freshSessions.set(identityId, sessionId);
      pendingResets.set(identityId, { sessionId, source, workspaceId: workspace.id, stale });
      try {
        await writeFresh();
      } catch (error) {
        if (previousFresh === undefined) freshSessions.delete(identityId);
        else freshSessions.set(identityId, previousFresh);
        if (previousReset === undefined) pendingResets.delete(identityId);
        else pendingResets.set(identityId, previousReset);
        throw error;
      }
    } finally {
      startingResets.delete(identityId);
    }
  }

  /** Archive only the old Sessions from this reset, after the browser handoff. */
  async function archiveResetHistory(identityId, reset, registry) {
    const workspace = registry.get(reset.workspaceId);
    if (workspace === undefined || !workspace.sessionIds.includes(reset.sessionId) ||
        registry.archivedSessionIds.includes(reset.sessionId)) {
      throw new Error('personal-agent: reset target is no longer available');
    }
    const members = new Set(workspace.sessionIds);
    const stale = conversationsToClear(reset.stale.filter((id) => members.has(id)), {
      keep: reset.sessionId,
      archived: registry.archivedSessionIds,
      excluded: [...groups.keys(), ...participantSessions.keys()],
    });
    let cleared = 0;
    let failed = 0;
    for (const oldSessionId of stale) {
      try {
        await registry.archiveSession(oldSessionId, { stopActivity: true });
        cleared += 1;
      } catch (error) {
        // A blank Session that was never persisted has no history to clear.
        if (error?.name === 'WorkspaceUnknownSessionError') continue;
        failed += 1;
        logger?.warn?.(`personal-agent: could not archive conversation ${oldSessionId}: ${messageOf(error)}`);
      }
    }
    pendingResets.delete(identityId);
    await writeFresh();
    logger?.info?.(`personal-agent: /new opened ${reset.sessionId}; archived ${cleared} earlier conversations`);
    return { cleared, failed };
  }

  ctx.effect(
    () => () => {
      pendingConversations.clear();
    },
    'personal-agent: pending conversations',
  );

  /**
   * Ask one group guest for a reply by spawning a one-shot child in the guest's
   * home. The child receives the guest's normal identity prompt and memory; its
   * final answer is returned to the host, which presents it in the group.
   * @param group - resolved group record.
   * @param guest - guest identity record.
   * @param args - tool arguments.
   * @param exec - tool execution context.
   * @returns the guest's reply.
   */
  async function askGuest(group, guest, args, exec) {
    const subagents = ctx.get('subagents');
    const provider = subagents?.getProvider?.(SUBAGENT_PROVIDER);
    if (subagents === undefined || provider === undefined) {
      throw new Error('personal-agent: no subagent provider is available for group guests');
    }
    const host = records.find((record) => record.identity.id === group.hostId)?.identity;
    const message = typeof args.message === 'string' ? args.message.trim() : '';
    if (message === '') throw new Error('personal-agent: ask_identity needs a non-empty message');
    const context = typeof args.context === 'string' ? args.context.trim() : '';
    const prompt = [
      `You are ${guest.identity.name} (${guest.identity.role || 'personal agent'}) in a group conversation hosted by ${host?.name ?? 'the host'}.`,
      `Group: ${group.name}.`,
      context === '' ? '' : `Recent group context:\n${context.slice(0, 12000)}`,
      `The group is discussing:\n${message.slice(0, 12000)}`,
      `Reply as ${guest.identity.name} only, in your own voice and briefly. Do not speak for the host or other participants.`,
    ]
      .filter((line) => line !== '')
      .join('\n\n');
    const activation = await subagents.startActivation({
      provider: provider.name,
      label: `${guest.identity.name} · ${group.name}`,
      cwd: guest.paths.home,
      agentPreset: PRESET_ID,
      prompt: [{ type: 'text', text: prompt }],
      parent: exec.agent,
      signal: exec.signal,
      delivery: 'caller',
    });
    try {
      const result = await activation.result;
      const output = result.output
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      const text = output !== ''
        ? output
        : `${guest.identity.name} did not produce a reply (${result.stopReason}${result.diagnostic === undefined ? '' : `: ${result.diagnostic}`}).`;
      return { identityId: guest.identity.id, name: guest.identity.name, text };
    } finally {
      await activation.dispose().catch((error) => logger?.warn?.(`personal-agent: guest cleanup failed: ${messageOf(error)}`));
    }
  }

  /**
   * Validate the requested guest and ask that identity.
   * @param group - group record.
   * @param args - tool arguments.
   * @param exec - tool execution context.
   * @returns the guest reply.
   */
  async function askGroupGuest(group, args, exec) {
    const guest = records.find(
      (record) =>
        group.guestIds.includes(record.identity.id) &&
        (record.identity.id === args.identity || record.identity.name === args.identity),
    );
    if (guest === undefined) {
      throw new Error(`personal-agent: "${args.identity}" is not a guest in this group`);
    }
    return askGuest(group, guest, args, exec);
  }

  ctx.inject(['tools'], (scope) => {
    const whenIdentity = ({ agent }) => recordForAgent(agent, ctx) !== undefined;
    // Only a legacy host-and-guests group uses the moderator tool. A
    // multi-agent group has no host, so no participant may speak for another.
    const whenGroupHost = ({ agent }) => {
      const group = groupForAgent(agent, ctx);
      return group !== undefined && typeof group.hostId === 'string' && !participantSessions.has(agent.session.id);
    };
    scope.tools.register(buildRememberTool(recordForExec), { when: whenIdentity });
    scope.tools.register(buildRecallTool(recordForExec), { when: whenIdentity });
    scope.tools.register(buildNewConversationTool(recordForExec, scheduleConversation), {
      when: ({ agent }) =>
        whenIdentity({ agent }) && agent.session.origin !== 'subagent' && groupForAgent(agent, ctx) === undefined,
    });
    // `message_identity` is intentionally not registered: a private identity
    // conversation must not spawn a child agent and wait on it. The builder and
    // `sendDirectMessage` stay in place, with their tests, so restoring direct
    // messages is one registration away.
    scope.tools.register(
      buildAskIdentityTool((sessionId, agent) => groups.get(sessionId) ?? groupForAgent(agent, ctx), askGroupGuest),
      { when: whenGroupHost },
    );
  });

  ctx.inject(['agents'], (scope) => {
    const installs = new Map();
    /**
     * Keep one Agent's tool restriction in step with its recorded choice.
     * @param agent - exact live identity Agent.
     * @returns the gate.
     */
    const gateFor = (agent) => {
      let restriction = null;
      const apply = () => {
        const allowed = readDelegationChoice(agent.session.log);
        if (allowed) {
          releaseDisposable(restriction);
          restriction = null;
          return;
        }
        if (restriction !== null) return;
        restriction = agent.ctx.inject(['tools'], (toolScope) => toolScope.tools.restrict(delegationDenyFilter()));
      };
      apply();
      return {
        sync: apply,
        dispose: () => {
          releaseDisposable(restriction);
          restriction = null;
        },
      };
    };
    /**
     * Attach `/new` to one private identity Agent. Registering beneath the
     * Agent context keeps the command out of project, group, and subagent
     * conversations.
     * @param agent - Agent to decorate.
     */
    const install = (agent) => {
      if (installs.has(agent)) return;
      if (recordForAgent(agent, scope) === undefined) return;
      if (agent.session.origin === 'subagent' || groupForAgent(agent, scope) !== undefined) return;
      const fiber = agent.ctx.inject(['commands'], (commandCtx) => {
        commandCtx.commands.register({
          name: 'new',
          description: '开始新的对话并清除该身份的历史对话记录',
          handler: async ({ agent: callingAgent, rawInput }) => {
            if (rawInput.trim() !== '') return { kind: 'error', text: '用法：/new（不需要参数）' };
            const record = recordForAgent(callingAgent, ctx);
            if (record === undefined) return { kind: 'error', text: '/new 只能在身份对话中使用。' };
            if (groupForAgent(callingAgent, ctx) !== undefined) {
              return { kind: 'error', text: '/new 只能在私人的身份对话中使用，群聊不适用。' };
            }
            try {
              await prepareConversationReset(record, callingAgent.session.id);
              return { kind: 'success', text: '新对话已创建，打开后将归档旧对话。' };
            } catch (error) {
              return { kind: 'error', text: `无法开始新的对话：${messageOf(error)}` };
            }
          },
        });
      });
      installs.set(agent, fiber);
      delegationGates.set(agent, gateFor(agent));
    };
    for (const agent of scope.agents.list()) install(agent);
    scope.on('agent/created', ({ agent }) => install(agent));
    scope.on('agent/disposed', ({ agent }) => {
      delegationGates.get(agent)?.dispose();
      delegationGates.delete(agent);
      const fiber = installs.get(agent);
      if (fiber === undefined) return;
      installs.delete(agent);
      fiber.dispose().catch((error) => logger?.warn?.(`personal-agent: command cleanup failed: ${messageOf(error)}`));
    });
    // Flipping the switch appends one selection event; the gate follows it
    // immediately, so the next step already sees the new tool set.
    scope.on('session/event', (session, event) => {
      if (event?.type !== DELEGATION_EVENT) return;
      const agent = scope.agents.get(session.id);
      if (agent === undefined) return;
      delegationGates.get(agent)?.sync();
    });
    scope.effect(
      () => () => {
        const fibers = [...installs.values()];
        installs.clear();
        for (const fiber of fibers) fiber.dispose().catch(() => undefined);
        for (const gate of delegationGates.values()) gate.dispose();
        delegationGates.clear();
      },
      'personal-agent: identity commands',
    );
  });

  // ── one home workspace per identity ──────────────────────────────────────

  /** Ensures in flight, keyed by identity id. */
  const ensureInFlight = new Map();

  /**
   * Ensure one identity's home exists and is registered, then reconcile its
   * title when the identity name changed. A title the user chose by hand is
   * preserved: only a title this plugin applied, or the directory's own name,
   * follows the identity.
   * @param record - identity record.
   * @param registry - Host workspace registry.
   * @returns the workspace entity.
   */
  async function ensureWorkspace(record, registry) {
    const identity = record.identity;
    const info = homesInfo.get(identity.id);
    await mkdir(record.paths.home, { recursive: true, mode: 0o700 });
    const canonical = await realpath(record.paths.home);
    if (!isAbsolute(canonical)) throw new Error('personal-agent: home directory did not resolve to an absolute path');
    record.canonicalHome = canonical;

    const title = identity.name;
    let entity = registry.list().find((workspace) => workspace.path === canonical);
    if (entity === undefined) {
      entity = await registry.create(canonical, title);
      states.set(identity.id, { workspaceId: entity.id, titledName: title });
      await writeState(stateFile, states, logger);
      info.titledName = title;
    } else if (entity.title === info.titledName || entity.title === basename(canonical)) {
      if (entity.title !== title) await entity.setTitle(title);
      if (info.titledName !== title) {
        states.set(identity.id, { workspaceId: entity.id, titledName: title });
        await writeState(stateFile, states, logger);
        info.titledName = title;
      }
    } else {
      states.set(identity.id, { ...states.get(identity.id), workspaceId: entity.id });
      await writeState(stateFile, states, logger);
    }

    info.workspaceId = entity.id;
    info.title = entity.title;
    info.path = canonical;
    info.error = undefined;
    return entity;
  }

  /**
   * Ensure one identity, sharing an in-flight attempt.
   * @param identityId - identity id.
   * @param registry - Host workspace registry.
   * @returns the workspace entity.
   */
  function ensureIdentity(identityId, registry) {
    const running = ensureInFlight.get(identityId);
    if (running !== undefined) return running;
    const record = records.find((candidate) => candidate.identity.id === identityId);
    if (record === undefined) return Promise.reject(new Error(`personal-agent: unknown identity "${identityId}"`));
    const promise = ensureWorkspace(record, registry).finally(() => {
      ensureInFlight.delete(identityId);
    });
    ensureInFlight.set(identityId, promise);
    return promise;
  }

  /**
   * Give one group its own hidden home and workspace. New groups create these
   * up front; this also repairs a group created before groups owned a home,
   * whose Session otherwise sits in the host identity's workspace and can be
   * mistaken for a private conversation.
   * @param group - group record.
   * @param registry - Host workspace registry.
   * @returns whether the record changed.
   */
  async function ensureGroupWorkspace(group, registry) {
    const home = typeof group.home === 'string' && group.home !== ''
      ? group.home
      : join(groupsRoot, groupKey(group), 'home');
    await mkdir(home, { recursive: true, mode: 0o700 });
    const canonical = await realpath(home);
    let entity = registry.list().find((workspace) => workspace.path === canonical);
    if (entity === undefined) entity = await registry.create(canonical, group.name);
    else if (entity.title !== group.name) await entity.setTitle(group.name).catch(() => undefined);
    // A legacy group Session created before groups owned a home is a member
    // of the host identity's workspace. Detach it: the group row opens it by
    // Session id, while the identity's private conversation selection must
    // never see it again. A multi-agent group has no single host Session.
    const hosted = typeof group.sessionId === 'string' ? group.sessionId : undefined;
    for (const workspace of registry.list()) {
      if (workspace.path === canonical || hosted === undefined || !workspace.sessionIds.includes(hosted)) continue;
      try {
        await workspace.detachSession(hosted);
      } catch (error) {
        logger?.warn?.(`personal-agent: could not detach group ${hosted} from ${workspace.title}: ${messageOf(error)}`);
      }
    }
    if (group.home !== canonical || group.workspaceId !== entity.id) {
      group.home = canonical;
      group.workspaceId = entity.id;
      return true;
    }
    return false;
  }

  /**
   * Ensure every group home exists and is registered, then persist repairs.
   * @param registry - Host workspace registry.
   */
  async function ensureGroups(registry) {
    let changed = false;
    for (const group of groups.values()) {
      try {
        if (await ensureGroupWorkspace(group, registry)) changed = true;
      } catch (error) {
        logger?.warn?.(`personal-agent: could not prepare group home ${group.sessionId}: ${messageOf(error)}`);
      }
    }
    if (changed) await writeGroups().catch((error) => logger?.warn?.(`personal-agent: could not save groups: ${messageOf(error)}`));
  }

  /**
   * Keep identity workspaces after the profile's project workspaces, so
   * installing identities does not reorder the user's existing project list.
   * The shipped browser renders the registry order; identity groups belong at
   * the bottom, not in front of the projects.
   * @param registry - Host workspace registry.
   */
  async function reconcileIdentityOrder(registry) {
    const identityHomes = new Set(records.map((record) => record.canonicalHome));
    for (;;) {
      const entities = registry.list();
      let lastProject = -1;
      entities.forEach((workspace, index) => {
        if (!identityHomes.has(workspace.path)) lastProject = index;
      });
      if (lastProject < 0) return;
      const misplaced = entities.findIndex((workspace, index) => index < lastProject && identityHomes.has(workspace.path));
      if (misplaced < 0) return;
      try {
        await registry.insertBefore(entities[misplaced].id);
      } catch {
        return;
      }
    }
  }

  /**
   * Remove identity and group workspaces that no longer belong to this config.
   * A removed identity must not fall through to the project list as an
   * ordinary workspace. Its Sessions are archived first, then the registration
   * is deleted; the transcript and the moved identity data stay recoverable.
   * @param registry - Host workspace registry.
   */
  async function cleanupOrphanWorkspaces(registry) {
    const identitiesRoot = join(dataDir, 'identities');
    const activeHomes = new Set(records.map((record) => record.canonicalHome));
    const groupHomes = new Set();
    for (const group of groups.values()) {
      const home = typeof group.home === 'string' && group.home !== ''
        ? group.home
        : join(groupsRoot, group.sessionId, 'home');
      groupHomes.add(home);
    }
    for (const workspace of registry.list()) {
      const identityOrphan = inside(identitiesRoot, workspace.path) && !activeHomes.has(workspace.path);
      const groupOrphan = inside(groupsRoot, workspace.path) && !groupHomes.has(workspace.path);
      if (!identityOrphan && !groupOrphan) continue;
      for (const sessionId of workspace.sessionIds) {
        try {
          await registry.archiveSession(sessionId, { stopActivity: true });
        } catch (error) {
          logger?.warn?.(`personal-agent: could not archive orphan session ${sessionId}: ${messageOf(error)}`);
        }
      }
      try {
        await registry.delete(workspace.id);
        logger?.info?.(`personal-agent: removed orphan workspace ${workspace.title}`);
      } catch (error) {
        logger?.warn?.(`personal-agent: could not remove orphan workspace ${workspace.title}: ${messageOf(error)}`);
      }
    }
  }

  /**
   * Ensure every identity in order, recording per-identity failures.
   * @param registry - Host workspace registry.
   */
  async function ensureAll(registry) {
    for (const record of records) {
      try {
        await ensureIdentity(record.identity.id, registry);
      } catch (error) {
        const info = homesInfo.get(record.identity.id);
        if (info !== undefined) info.error = messageOf(error);
        logger?.warn?.(`personal-agent: ${record.identity.name}: ${messageOf(error)}`);
      }
    }
  }

  /** Resolves with the workspace registry once the Host provides it. */
  let provideRegistry;
  const registryReady = new Promise((resolveReady) => {
    provideRegistry = resolveReady;
  });

  /**
   * Wait briefly for the workspace registry, which may initialize after the
   * connection routes are already serving.
   * @param milliseconds - longest wait.
   * @returns the registry, or undefined when it did not arrive in time.
   */
  async function registryWithin(milliseconds) {
    const available = ctx.get('workspaceRegistry');
    if (available !== undefined) {
      registryRef = available;
      return available;
    }
    const ready = await Promise.race([
      registryReady,
      new Promise((resolveLater) => {
        setTimeout(() => resolveLater(undefined), milliseconds);
      }),
    ]);
    if (ready !== undefined) registryRef = ready;
    return ready;
  }

  /** Latest registry, used by the project list in the browser payload. */
  let registryRef;

  /** Context-compaction service, injected so the fresh-conversation route can use it. */
  let compactionRef;

  ctx.inject(['compaction'], (scope) => {
    compactionRef = scope.compaction;
    return () => {
      if (compactionRef === scope.compaction) compactionRef = undefined;
    };
  });

  /** Human-command runtime; /compact is scoped to the personal Agent preset. */
  let commandsRef;

  ctx.inject(['commands'], (scope) => {
    commandsRef = scope.commands;
    return () => {
      if (commandsRef === scope.commands) commandsRef = undefined;
    };
  });

  ctx.inject(['workspaceRegistry'], (scope) => {
    registryRef = scope.workspaceRegistry;
    provideRegistry(scope.workspaceRegistry);
    void cleanupOrphanWorkspaces(scope.workspaceRegistry)
      .then(() => ensureGroups(scope.workspaceRegistry))
      .then(() => ensureAll(scope.workspaceRegistry))
      .then(() => reconcileIdentityOrder(scope.workspaceRegistry))
      .catch((error) => {
        logger?.warn?.(`personal-agent: could not prepare identity and group workspaces: ${messageOf(error)}`);
      });
  });

  // ── personal preset policy ─────────────────────────────────────────────────
  // Personal describes a named identity in its own home, so it is not a mode a
  // project conversation may run. Keep it out of the selectable roster and
  // refuse it for every Session whose directory belongs to a workspace.

  /**
   * Whether one working directory may run the personal preset.
   * @param cwd - effective working directory, or undefined when unknown.
   * @returns whether the directory is an identity or group home.
   */
  function personalAllowedFor(cwd) {
    return personalPresetAllowed(cwd, {
      identityHomes: records.map((record) => record.canonicalHome),
      groupsRoot,
    });
  }

  /**
   * Replace one Service prototype method for as long as this plugin row lives.
   * The Service instance is a traced proxy, so the class prototype is the only
   * place a replacement can be installed once and seen by Remote calls.
   * @param service - Service instance or its traced proxy.
   * @param name - method name.
   * @param wrap - builds the replacement from the original method.
   * @returns a disposer that restores the original method.
   */
  function patchServiceMethod(service, name, wrap) {
    const prototype = service === undefined || service === null ? undefined : Object.getPrototypeOf(service);
    const original = prototype?.[name];
    if (typeof original !== 'function') return () => {};
    const patched = wrap(original);
    prototype[name] = patched;
    return () => {
      if (prototype[name] === patched) prototype[name] = original;
    };
  }

  ctx.inject(['agentPresets'], (scope) => {
    const presets = scope.agentPresets;
    if (presets === undefined) return;
    const restoreRoster = patchServiceMethod(presets, 'remoteExportList', (original) =>
      async function listWithoutPersonal(...args) {
        return hidePersonalPreset(await original.apply(this, args));
      });
    const restoreSelect = patchServiceMethod(presets, 'select', (original) =>
      async function selectWithoutPersonal(agent, agentPreset) {
        if (agentPreset === PRESET_ID && !personalAllowedFor(cwdOf(agent?.session, scope))) {
          throw new Error(PERSONAL_REFUSED);
        }
        return original.apply(this, arguments);
      });
    return () => {
      restoreSelect();
      restoreRoster();
    };
  });

  ctx.inject(['sessionController'], (scope) => {
    const controller = scope.sessionController;
    if (controller === undefined) return;
    return patchServiceMethod(controller, 'create', (original) =>
      async function createOutsidePersonal(request) {
        const workspace = request?.workspaceId === undefined
          ? undefined
          : ctx.get('workspaceRegistry')?.get(request.workspaceId);
        const cwd = workspace?.path ?? request?.cwd;
        if (request?.agentPreset === PRESET_ID && !personalAllowedFor(cwd)) {
          throw new Error(PERSONAL_REFUSED);
        }
        // A workspace Session created without a preset must not silently land on
        // a profile default that is personal; use the ordinary preset instead.
        if (request?.agentPreset === undefined && !personalAllowedFor(cwd)) {
          const registry = ctx.get('agentPresets');
          try {
            const resolved = await registry?.resolve();
            if (resolved?.id === PRESET_ID) {
              const fallback = workspaceFallbackPreset(await registry.list());
              if (fallback !== undefined && fallback !== PRESET_ID) {
                return original.call(this, { ...request, agentPreset: fallback });
              }
            }
          } catch (error) {
            logger?.warn?.(`personal-agent: could not resolve a workspace preset: ${messageOf(error)}`);
          }
        }
        return original.call(this, request);
      });
  });

  // ── browser routes ───────────────────────────────────────────────────────

  ctx.inject(['connection'], (scope) => {
    /**
     * Workspaces that are not identity homes: existing projects in this
     * profile. They stay reachable as project rows so installing the bundle
     * into an established profile never hides the user's work.
     * @returns project rows with their newest non-archived conversation.
     */
    function listProjects() {
      const registry = registryRef;
      if (registry === undefined) return [];
      const owned = new Set(records.map((record) => record.canonicalHome));
      for (const group of groups.values()) {
        if (typeof group.home === 'string') owned.add(group.home);
      }
      const archived = new Set(registry.archivedSessionIds);
      return registry
        .list()
        .filter((workspace) => !owned.has(workspace.path))
        .map((workspace) => ({
          workspaceId: workspace.id,
          title: workspace.title,
          path: workspace.path,
          sessionId: workspace.sessionIds.find((id) => !archived.has(id)) ?? null,
          sessionCount: workspace.sessionIds.length,
        }));
    }

    /**
     * Build the complete client-facing state payload.
     * @returns the state object.
     */
    function snapshot() {
      return {
        version: 3,
        profile: profile?.name ?? null,
        preset: PRESET_ID,
        autoOpen: settings.autoOpen,
        // Host clock and per-Session activity, so the browser can tell a long
        // working turn from a silent one without trusting the client clock.
        now: Date.now(),
        sessionActivity: activity.snapshot(),
        projects: listProjects(),
        groups: [...groups.values()]
          .map((group) => {
            if (Array.isArray(group.participantIds)) {
              const participants = group.participantIds
                .map((id) => records.find((record) => record.identity.id === id)?.identity)
                .filter((participant) => participant !== undefined)
                .map((participant) => ({
                  id: participant.id,
                  name: participant.name,
                  role: participant.role,
                  accent: participant.accent,
                  avatar: participant.avatar,
                }));
              if (participants.length === 0) return null;
              return {
                id: group.id,
                name: group.name,
                mode: 'multi',
                participants,
                unread: unreadGroups.get(groupKey(group)) ?? 0,
                ...(typeof group.workspaceId === 'string' ? { workspaceId: group.workspaceId } : {}),
                createdAt: group.createdAt,
              };
            }
            const host = records.find((record) => record.identity.id === group.hostId)?.identity;
            const guests = group.guestIds
              .map((id) => records.find((record) => record.identity.id === id)?.identity)
              .filter((guest) => guest !== undefined)
              .map((guest) => ({ id: guest.id, name: guest.name, role: guest.role }));
            if (host === undefined || guests.length === 0) return null;
            return {
              id: groupKey(group),
              sessionId: group.sessionId,
              name: group.name,
              mode: 'legacy',
              host: { id: host.id, name: host.name, role: host.role },
              guests,
              unread: unreadGroups.get(groupKey(group)) ?? 0,
              ...(typeof group.workspaceId === 'string' ? { workspaceId: group.workspaceId } : {}),
              createdAt: group.createdAt,
            };
          })
          .filter((group) => group !== null),
        identities: records.map((record) => {
          const info = homesInfo.get(record.identity.id);
          const identity = record.identity;
          const registry = registryRef;
          const archived = new Set(registry?.archivedSessionIds ?? []);
          const workspace = registry?.list().find((candidate) => candidate.id === info?.workspaceId);
          const latestSessionId = workspace?.sessionIds.find((id) => !archived.has(id) && !groups.has(id)) ?? null;
          const fresh = freshSessions.get(identity.id);
          const freshSessionId = !startingResets.has(identity.id) && typeof fresh === 'string' &&
            workspace?.sessionIds.includes(fresh) && !archived.has(fresh) ? fresh : null;
          return {
            id: identity.id,
            name: identity.name,
            role: identity.role,
            userName: identity.userName,
            persona: identity.persona,
            accent: identity.accent,
            avatar: identity.avatar,
            home: {
              path: record.paths.home,
              title: info?.title ?? identity.name,
              workspaceId: info?.workspaceId ?? null,
              exists: existsSync(record.paths.home),
              error: info?.error ?? null,
            },
            latestSessionId,
            freshSessionId,
            freshResetFrom: freshSessionId === null ? null : pendingResets.get(identity.id)?.source ?? null,
            unread: unreadIdentities.get(identity.id) ?? 0,
            memory: {
              path: record.paths.memoryFile,
              text: record.store.read(),
              bytes: byteLength(record.store.read()),
              notes: countNotes(record.store.read()),
              maxBytes: settings.memory.maxBytes,
            },
          };
        }),
        memoryPolicy: {
          includeInPrompt: settings.memory.includeInPrompt,
          maxBytes: settings.memory.maxBytes,
        },
        tools: ['remember', 'recall', 'new_conversation', 'ask_identity'],
        editable: ctx.get('configEditor') !== undefined && ctx.fiber?.entry !== undefined,
      };
    }

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: STATE_PATH,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: async () => {
            const registry = await registryWithin(1500);
            if (registry !== undefined) {
              await ensureGroups(registry);
              for (const record of records) {
                const info = homesInfo.get(record.identity.id);
                if (info?.workspaceId === undefined) {
                  try {
                    await ensureIdentity(record.identity.id, registry);
                  } catch (error) {
                    if (info !== undefined) info.error = messageOf(error);
                  }
                }
              }
            }
            return json(snapshot());
          },
        }),
      'personal-agent: state route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: DELEGATION_PATH,
          methods: ['GET', 'POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            const agents = ctx.get('agents');
            if (agents === undefined) return failure(503, 'unavailable', 'agents are not available');
            const agentFor = (sessionId) => (typeof sessionId === 'string' && sessionId !== '' ? agents.get(sessionId) : undefined);
            if (request.method === 'GET') {
              const params = new URL(request.url, 'http://localhost').searchParams;
              const agent = agentFor(params.get('sessionId') ?? '');
              if (agent === undefined) return failure(404, 'unknown-session', 'no such conversation');
              return json({ enabled: readDelegationChoice(agent.session.log) });
            }
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            const agent = agentFor(body.sessionId);
            if (agent === undefined) return failure(404, 'unknown-session', 'no such conversation');
            // Only a private identity chat carries this permission: a group has
            // its own route to its members, and a child must not widen its own.
            if (
              recordForAgent(agent, scope) === undefined ||
              groupForAgent(agent, scope) !== undefined ||
              agent.session.origin === 'subagent'
            ) {
              return failure(400, 'not-an-identity-chat', 'subagent permission belongs to a private identity conversation');
            }
            const enabled = body.enabled === true;
            agent.session.append(DELEGATION_EVENT, { enabled });
            try {
              await ctx.get('sessions')?.flush?.(agent.session);
            } catch (error) {
              logger?.warn?.(`personal-agent: could not persist the subagent choice: ${messageOf(error)}`);
            }
            delegationGates.get(agent)?.sync();
            return json({ enabled: readDelegationChoice(agent.session.log) });
          },
        }),
      'personal-agent: delegation route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: IDENTITY_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }

            const patch = body.identity !== null && typeof body.identity === 'object' ? body.identity : body;
            const updateId = typeof body.id === 'string' && body.id !== '' ? body.id : undefined;
            let nextIdentities;
            let target;
            try {
              if (updateId === undefined) {
                const used = new Set(settings.identities.map((identity) => identity.id));
                target = normalizeIdentity({ ...patch, home: '', memoryFile: '' }, { used });
                nextIdentities = [...settings.identities, target];
              } else {
                const current = settings.identities.find((identity) => identity.id === updateId);
                if (current === undefined) return failure(404, 'unknown-identity', `no identity "${updateId}"`);
                target = mergeIdentity(current, patch);
                nextIdentities = settings.identities.map((identity) => (identity.id === updateId ? target : identity));
              }
              const normalized = parseConfig({ identities: nextIdentities, memory: settings.memory });
              const homesSeen = new Map();
              const memoriesSeen = new Map();
              for (const identity of normalized.identities) {
                const paths = resolveIdentityPaths(identity, dataDir);
                if (homesSeen.has(paths.home)) {
                  throw new Error(`identities "${homesSeen.get(paths.home)}" and "${identity.name}" would share the home directory ${paths.home}`);
                }
                homesSeen.set(paths.home, identity.name);
                if (memoriesSeen.has(paths.memoryFile)) {
                  throw new Error(`identities "${memoriesSeen.get(paths.memoryFile)}" and "${identity.name}" would share the memory file ${paths.memoryFile}`);
                }
                memoriesSeen.set(paths.memoryFile, identity.name);
              }
              target = normalized.identities.find((identity) => identity.id === target.id) ?? target;
              nextIdentities = normalized.identities;
            } catch (error) {
              return failure(400, 'invalid-config', messageOf(error));
            }

            const editor = ctx.get('configEditor');
            const entry = ctx.fiber?.entry;
            if (editor === undefined || entry === undefined) {
              return failure(409, 'not-editable', 'this profile has no configuration editor, so identities cannot be saved from the page');
            }
            try {
              await editor.edit(entry, (current) => {
                const { identity: _legacyIdentity, home: _legacyHome, ...rest } = current;
                return {
                  ...rest,
                  identities: nextIdentities.map(serializeIdentity),
                  memory: { includeInPrompt: settings.memory.includeInPrompt, maxBytes: settings.memory.maxBytes },
                };
              });
            } catch (error) {
              return failure(409, 'save-failed', messageOf(error));
            }
            return json({ ok: true, identity: target });
          },
        }),
      'personal-agent: identity route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: REMOVE_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            const identityId = typeof body.id === 'string' ? body.id : '';
            if (identityId === '') return failure(400, 'invalid-identity', 'id must be a non-empty string');
            const record = records.find((candidate) => candidate.identity.id === identityId);
            if (record === undefined) return failure(404, 'unknown-identity', `no identity "${identityId}"`);
            const editor = ctx.get('configEditor');
            const entry = ctx.fiber?.entry;
            if (editor === undefined || entry === undefined) {
              return failure(409, 'not-editable', 'this profile has no configuration editor, so identities cannot be removed from the page');
            }

            // Stop and archive the identity's conversations, then drop its
            // workspace registration. The directory and logs are retained; the
            // shipped browser hides archived sessions by default.
            const registry = await registryWithin(2000);
            let archived = 0;
            if (registry !== undefined) {
              const workspace = registry.list().find((candidate) => candidate.path === record.canonicalHome);
              if (workspace !== undefined) {
                const alreadyArchived = new Set(registry.archivedSessionIds);
                for (const sessionId of workspace.sessionIds) {
                  if (alreadyArchived.has(sessionId)) continue;
                  try {
                    await registry.archiveSession(sessionId, { stopActivity: true });
                    archived += 1;
                  } catch (error) {
                    return failure(500, 'archive-failed', `could not archive conversation ${sessionId}: ${messageOf(error)}`);
                  }
                }
                try {
                  await registry.delete(workspace.id);
                } catch (error) {
                  return failure(500, 'workspace-delete-failed', messageOf(error));
                }
              }
            }

            states.delete(identityId);
            await writeState(stateFile, states, logger);
            pendingResets.delete(identityId);
            if (freshSessions.delete(identityId)) await writeFresh();

            const nextIdentities = settings.identities.filter((identity) => identity.id !== identityId);
            try {
              await editor.edit(entry, (current) => {
                const { identity: _legacyIdentity, home: _legacyHome, ...rest } = current;
                return {
                  ...rest,
                  identities: nextIdentities.map(serializeIdentity),
                  memory: { includeInPrompt: settings.memory.includeInPrompt, maxBytes: settings.memory.maxBytes },
                };
              });
            } catch (error) {
              return failure(409, 'save-failed', messageOf(error));
            }

            let movedTo = null;
            let retained = [];
            try {
              const moved = await moveRemovedIdentityData(record, dataDir);
              movedTo = moved.movedTo;
              retained = moved.retained;
            } catch (error) {
              logger?.warn?.(`personal-agent: could not move removed identity data: ${messageOf(error)}`);
            }
            return json({ ok: true, removed: identityId, archived, movedTo, retained });
          },
        }),
      'personal-agent: remove identity route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: MEMORY_PATH,
          methods: ['PUT'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            if (typeof body.identityId !== 'string' || body.identityId === '') {
              return failure(400, 'invalid-identity', 'identityId must be a non-empty string');
            }
            if (typeof body.text !== 'string') return failure(400, 'invalid-memory', 'text must be a string');
            const record = records.find((candidate) => candidate.identity.id === body.identityId);
            if (record === undefined) return failure(404, 'unknown-identity', `no identity "${body.identityId}"`);
            try {
              const saved = await record.store.mutate(async () => {
                const text = await writeMemory(record.paths.memoryFile, body.text, settings.memory.maxBytes);
                record.store.commit(text);
                return { text, bytes: byteLength(text), notes: countNotes(text) };
              });
              return json({ ok: true, ...saved });
            } catch (error) {
              return failure(400, 'memory-rejected', messageOf(error));
            }
          },
        }),
      'personal-agent: memory route',
    );

    /**
     * Pick a workspace's newest real conversation, skipping blank Sessions the
     * shipped New Session hero may have created in the background. Blank
     * Sessions are still used when they are the only candidates.
     * @param workspace - workspace entity.
     * @param registry - workspace registry.
     * @returns a Session id or null.
     */
    async function newestConversation(workspace, registry) {
      const archived = new Set(registry.archivedSessionIds);
      const candidates = workspace.sessionIds.filter((id) => !archived.has(id) && !groups.has(id));
      if (candidates.length === 0) return null;
      const controller = ctx.get('sessionController');
      if (controller !== undefined && typeof controller.list === 'function') {
        try {
          const list = await controller.list({}, AbortSignal.timeout(1500));
          const byId = new Map(list.items.map((item) => [item.id, item]));
          // Only a private, human-owned conversation can be an identity's
          // newest conversation. A group Session, a subagent turn, and a guest
          // child all live in the same storage and must never be opened here.
          const usable = candidates.filter((id) => {
            const summary = byId.get(id);
            if (summary === undefined) return true;
            if (summary.origin === 'subagent' || summary.parentSessionId !== undefined) return false;
            return !inside(groupsRoot, summary.cwd ?? '');
          });
          const nonBlank = usable.find((id) => byId.get(id)?.blank === false);
          if (nonBlank !== undefined) return nonBlank;
          if (usable.length > 0) return usable[0];
          return null;
        } catch {
          // A list failure falls back to the registry order.
        }
      }
      return candidates[0];
    }

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: GROUP_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            const participantIds = Array.isArray(body.participantIds)
              ? [...new Set(body.participantIds.filter((id) => typeof id === 'string' && id !== ''))]
              : [];
            const controller = ctx.get('sessionController');
            if (controller === undefined) return failure(409, 'session-controller-unavailable', 'this Host cannot create a group session');
            const registry = await registryWithin(2000);
            if (registry === undefined) return failure(409, 'workspace-unavailable', 'this Host has no workspace registry');
            const requestedName = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim().slice(0, 120) : '';

            // Multi-agent group: one independent Session per identity, no host.
            if (participantIds.length > 0) {
              if (participantIds.length < 2) return failure(400, 'too-few-participants', 'a group needs at least two identities');
              if (participantIds.length > 4) return failure(400, 'too-many-participants', 'a group supports at most four identities');
              const participants = participantIds.map((id) => records.find((record) => record.identity.id === id));
              if (participants.some((participant) => participant === undefined)) {
                return failure(404, 'unknown-participant', 'one or more participant identities do not exist');
              }
              const name = requestedName !== '' ? requestedName : participants.map((participant) => participant.identity.name).join(' + ');
              const groupId = `group-${randomUUID()}`;
              const groupHome = join(dataDir, 'groups', groupId, 'home');
              let groupWorkspace;
              try {
                await mkdir(groupHome, { recursive: true, mode: 0o700 });
                const canonical = await realpath(groupHome);
                groupWorkspace = registry.list().find((candidate) => candidate.path === canonical);
                if (groupWorkspace === undefined) groupWorkspace = await registry.create(canonical, name);
                else if (groupWorkspace.title !== name) await groupWorkspace.setTitle(name).catch(() => undefined);
              } catch (error) {
                return failure(500, 'group-workspace-failed', messageOf(error));
              }
              const sessions = {};
              for (const identityId of participantIds) sessions[identityId] = `session-${randomUUID()}`;
              const record = {
                id: groupId,
                name,
                participantIds,
                sessions,
                createdAt: new Date().toISOString(),
                workspaceId: groupWorkspace.id,
                home: groupWorkspace.path,
              };
              // Index the participants before the Agents are created: the
              // identity prompt is installed on agent/created and needs to know
              // that this Session belongs to this identity.
              groups.set(groupId, record);
              indexParticipants();
              const createdIds = [];
              try {
                for (const identityId of participantIds) {
                  const created = await controller.create({ sessionId: sessions[identityId], workspaceId: groupWorkspace.id, agentPreset: PRESET_ID });
                  createdIds.push(created.sessionId);
                  if (created.sessionId !== sessions[identityId]) {
                    sessions[identityId] = created.sessionId;
                    indexParticipants();
                  }
                }
                await writeGroups();
                await writeTranscript(record, []);
              } catch (error) {
                for (const sessionId of createdIds) {
                  await registry.archiveSession(sessionId, { stopActivity: true }).catch(() => undefined);
                }
                await registry.delete(groupWorkspace.id).catch(() => undefined);
                groups.delete(groupId);
                indexParticipants();
                return failure(500, 'group-create-failed', messageOf(error));
              }
              return json({ ok: true, groupId, name, sessionIds: sessions });
            }

            // Legacy host-and-guests group: kept only so an existing group
            // still opens after the upgrade. New groups use the multi shape.
            const hostId = typeof body.hostId === 'string' ? body.hostId : '';
            const guestIds = Array.isArray(body.guestIds)
              ? body.guestIds.filter((id) => typeof id === 'string' && id !== hostId)
              : [];
            const uniqueGuests = [...new Set(guestIds)];
            const host = records.find((record) => record.identity.id === hostId);
            if (host === undefined) return failure(404, 'unknown-host', `no identity "${hostId}"`);
            if (uniqueGuests.length === 0) return failure(400, 'no-guests', 'a group needs at least one guest identity');
            if (uniqueGuests.length > 3) return failure(400, 'too-many-guests', 'a group supports at most three guests');
            const guests = uniqueGuests.map((id) => records.find((record) => record.identity.id === id));
            if (guests.some((guest) => guest === undefined)) {
              return failure(404, 'unknown-guest', 'one or more guest identities do not exist');
            }
            const name = requestedName !== '' ? requestedName : [host.identity.name, ...guests.map((guest) => guest.identity.name)].join(' + ');
            const sessionId = `session-${randomUUID()}`;
            const groupHome = join(dataDir, 'groups', sessionId, 'home');
            let groupWorkspace;
            try {
              await mkdir(groupHome, { recursive: true, mode: 0o700 });
              const canonical = await realpath(groupHome);
              groupWorkspace = registry.list().find((candidate) => candidate.path === canonical);
              if (groupWorkspace === undefined) groupWorkspace = await registry.create(canonical, name);
              else if (groupWorkspace.title !== name) await groupWorkspace.setTitle(name).catch(() => undefined);
            } catch (error) {
              return failure(500, 'group-workspace-failed', messageOf(error));
            }
            const record = {
              sessionId,
              name,
              hostId,
              guestIds: guests.map((guest) => guest.identity.id),
              createdAt: new Date().toISOString(),
              workspaceId: groupWorkspace.id,
              home: groupWorkspace.path,
            };
            groups.set(sessionId, record);
            try {
              await writeGroups();
              const created = await controller.create({ sessionId, workspaceId: groupWorkspace.id, agentPreset: PRESET_ID });
              if (created.sessionId !== sessionId) {
                groups.delete(sessionId);
                record.sessionId = created.sessionId;
                groups.set(created.sessionId, record);
                await writeGroups();
              }
              try {
                await controller.rename({ sessionId: record.sessionId, title: name });
              } catch {
                // The group name still lives in the module; a title rename is cosmetic.
              }
              return json({ ok: true, sessionId: record.sessionId, name });
            } catch (error) {
              groups.delete(sessionId);
              await writeGroups().catch(() => undefined);
              return failure(500, 'group-create-failed', messageOf(error));
            }
          },
        }),
      'personal-agent: group route',
    );

    /**
     * Resolve which participants a user message addresses. A message without
     * an @mention goes to every participant; a message with one or more
     * mentions goes only to them.
     * @param group - multi-agent group.
     * @param text - user message.
     * @param explicit - optional identity ids or names from the client.
     * @returns addressed identity ids.
     */
    function addressedParticipants(group, text, explicit) {
      const participants = group.participantIds
        .map((id) => records.find((record) => record.identity.id === id)?.identity)
        .filter((identity) => identity !== undefined);
      const found = new Set();
      for (const identity of participants) {
        if (text.includes(`@${identity.name}`)) found.add(identity.id);
        if (text.includes(`@${identity.id}`)) found.add(identity.id);
      }
      if (Array.isArray(explicit)) {
        for (const value of explicit) {
          if (typeof value !== 'string') continue;
          const identity = participants.find((candidate) => candidate.id === value || candidate.name === value);
          if (identity !== undefined) found.add(identity.id);
        }
      }
      return found.size > 0 ? [...found] : [...group.participantIds];
    }

    /**
     * Build one participant's prompt from the user message and the group feed.
     * @param group - multi-agent group.
     * @param identity - addressed identity.
     * @param text - user message.
     * @param history - messages before this user message.
     * @param addressed - whether the user named this identity.
     * @param images - images attached to this user message.
     * @returns prompt text.
     */
    function participantPrompt(group, identity, text, history, addressed, images = []) {
      const participants = group.participantIds
        .map((id) => records.find((record) => record.identity.id === id)?.identity)
        .filter((participant) => participant !== undefined);
      const transcript = history
        .slice(-40)
        .map((message) => {
          if (message.role !== 'user') return `${message.name ?? '参与者'}：${message.text}`;
          const attachment = Array.isArray(message.images) && message.images.length > 0
            ? `[${message.images.length} 张图片]`
            : '';
          const body = typeof message.text === 'string' ? message.text : '';
          return `用户：${[body, attachment].filter((part) => part !== '').join(' ')}`;
        })
        .join('\n')
        .slice(-20000);
      const attachmentLine = images.length === 0
        ? ''
        : `用户这条消息还附了 ${images.length} 张图片，图片就在下面，请直接看图片内容。`;
      return [
        `你正在参加群聊「${group.name}」。参与者：${participants.map((participant) => participant.name).join('、')}。`,
        `你是 ${identity.name}。这是一次群聊，没有主持或主智能体；每位参与者看到用户消息后各自回复。只代表你自己，不要替其他人说话。`,
        addressed ? `用户在这条消息里点名了你，请优先回答用户要你做的事。` : '',
        transcript === '' ? '' : `最近的群聊记录：\n${transcript}`,
        `用户刚刚说：\n${text === '' ? '（用户这条消息只有图片，没有文字。）' : text}`,
        attachmentLine,
        `请以 ${identity.name} 的身份，直接回复群聊。保持简洁，不要写“作为群成员”之类的元叙述。`,
      ]
        .filter((line) => line !== '')
        .join('\n\n');
    }

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: GROUP_STATE_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            const groupId = typeof body.groupId === 'string' ? body.groupId : '';
            const group = groups.get(groupId);
            if (group === undefined || !Array.isArray(group.participantIds)) {
              return failure(404, 'unknown-group', `no multi-agent group "${groupId}"`);
            }
            const pending = new Set();
            for (const [sessionId, queue] of pendingReplies) {
              if (queue.some((entry) => entry.groupId === groupId)) pending.add(sessionId);
            }
            const participants = group.participantIds
              .map((identityId) => {
                const identity = records.find((record) => record.identity.id === identityId)?.identity;
                if (identity === undefined) return null;
                const sessionId = group.sessions?.[identityId];
                return {
                  id: identity.id,
                  name: identity.name,
                  role: identity.role,
                  accent: identity.accent,
                  avatar: identity.avatar,
                  running: typeof sessionId === 'string' && pending.has(sessionId),
                };
              })
              .filter((participant) => participant !== null);
            return json({
              ok: true,
              group: { id: group.id, name: group.name, participants, createdAt: group.createdAt },
              messages: readTranscript(group).map((message) => publicGroupMessage(group, message)),
            });
          },
        }),
      'personal-agent: group state route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: GROUP_SEND_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            const groupId = typeof body.groupId === 'string' ? body.groupId : '';
            const group = groups.get(groupId);
            if (group === undefined || !Array.isArray(group.participantIds)) {
              return failure(404, 'unknown-group', `no multi-agent group "${groupId}"`);
            }
            const text = typeof body.text === 'string' ? body.text.trim() : '';
            let images;
            try {
              images = normalizeGroupImages(body.images);
            } catch (error) {
              return failure(400, 'invalid-image', messageOf(error));
            }
            if (text === '' && images.length === 0) {
              return failure(400, 'empty-message', 'a group message needs text or an image');
            }
            const controller = ctx.get('sessionController');
            if (controller === undefined || typeof controller.prompt !== 'function') {
              return failure(409, 'session-controller-unavailable', 'this Host cannot prompt a group participant');
            }
            const history = readTranscript(group);
            const targets = addressedParticipants(group, text, body.mentions);
            let storedImages;
            try {
              storedImages = await storeGroupImages(group, images);
            } catch (error) {
              return failure(500, 'image-store-failed', messageOf(error));
            }
            const message = {
              id: `message-${randomUUID()}`,
              role: 'user',
              text,
              time: new Date().toISOString(),
              ...(storedImages.length === 0 ? {} : { images: storedImages }),
            };
            await appendTranscript(group, message);
            const failures = [];
            await Promise.all(
              targets.map(async (identityId) => {
                const identity = records.find((record) => record.identity.id === identityId)?.identity;
                const sessionId = group.sessions?.[identityId];
                if (identity === undefined || typeof sessionId !== 'string') {
                  failures.push({ identityId, message: 'participant has no Session' });
                  return;
                }
                const prompt = participantPrompt(group, identity, text, history, targets.length < group.participantIds.length, images);
                const queue = pendingReplies.get(sessionId) ?? [];
                const startSeq = ctx.get('sessions')?.get?.(sessionId)?.log?.length ?? 0;
                const pendingEntry = { groupId, identityId, startSeq };
                queue.push(pendingEntry);
                pendingReplies.set(sessionId, queue);
                const content = promptContent(prompt, images);
                try {
                  await controller.prompt(
                    { sessionId, content, requestId: `group-${randomUUID()}` },
                    AbortSignal.timeout(30000),
                  );
                } catch (error) {
                  const current = pendingReplies.get(sessionId);
                  if (current !== undefined) {
                    const index = current.indexOf(pendingEntry);
                    if (index >= 0) current.splice(index, 1);
                    if (current.length === 0) pendingReplies.delete(sessionId);
                  }
                  failures.push({ identityId, message: error?.details?.reason ?? messageOf(error) });
                }
              }),
            );
            return json({ ok: true, message: publicGroupMessage(group, message), targets, failures });
          },
        }),
      'personal-agent: group send route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: GROUP_IMAGE_PATH,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: async (request) => {
            const params = new URL(request.url, 'http://localhost').searchParams;
            const groupId = params.get('groupId') ?? '';
            const imageId = params.get('imageId') ?? '';
            const group = groups.get(groupId);
            if (group === undefined || !Array.isArray(group.participantIds)) {
              return failure(404, 'unknown-group', `no multi-agent group "${groupId}"`);
            }
            if (!/^image-[0-9a-f-]{36}$/i.test(imageId)) {
              return failure(400, 'invalid-image', 'imageId must name one message image');
            }
            const message = readTranscript(group).find(
              (candidate) => Array.isArray(candidate.images)
                && candidate.images.some((image) => image !== null && typeof image === 'object' && image.id === imageId),
            );
            const image = message?.images?.find(
              (candidate) => candidate !== null && typeof candidate === 'object' && candidate.id === imageId,
            );
            const extension = image === undefined ? undefined : GROUP_IMAGE_TYPES.get(image.mediaType);
            if (image === undefined || extension === undefined) {
              return failure(404, 'unknown-image', `no image "${imageId}" in this group`);
            }
            try {
              const bytes = await readFile(join(groupImagesDir(group), `${image.id}.${extension}`));
              return new Response(bytes, {
                status: 200,
                headers: {
                  'content-type': image.mediaType,
                  'content-length': String(bytes.byteLength),
                  'cache-control': 'private, max-age=31536000, immutable',
                  'x-content-type-options': 'nosniff',
                },
              });
            } catch (error) {
              return failure(404, 'image-unavailable', messageOf(error));
            }
          },
        }),
      'personal-agent: group image route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: GROUP_RENAME_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            const key = typeof body.groupId === 'string' && body.groupId !== '' ? body.groupId : typeof body.sessionId === 'string' ? body.sessionId : '';
            const group = groups.get(key);
            if (group === undefined) return failure(404, 'unknown-group', `no group "${key}"`);
            const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
            if (name === '') return failure(400, 'invalid-name', 'a group needs a non-empty name');
            group.name = name;
            await writeGroups();
            if (typeof group.workspaceId === 'string') {
              try {
                const registry = await registryWithin(1500);
                const workspace = registry?.list().find((candidate) => candidate.id === group.workspaceId);
                if (workspace !== undefined) await workspace.setTitle(name);
              } catch (error) {
                logger?.warn?.(`personal-agent: could not rename group workspace: ${messageOf(error)}`);
              }
            }
            if (typeof group.sessionId === 'string') {
              const controller = ctx.get('sessionController');
              if (controller !== undefined && typeof controller.rename === 'function') {
                try {
                  await controller.rename({ sessionId: group.sessionId, title: name });
                } catch (error) {
                  logger?.warn?.(`personal-agent: could not rename group session: ${messageOf(error)}`);
                }
              }
            }
            return json({ ok: true, groupId: groupKey(group), name });
          },
        }),
      'personal-agent: rename group route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: GROUP_REMOVE_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            const key = typeof body.groupId === 'string' && body.groupId !== '' ? body.groupId : typeof body.sessionId === 'string' ? body.sessionId : '';
            const group = groups.get(key);
            if (group === undefined) return failure(404, 'unknown-group', `no group "${key}"`);
            const registry = await registryWithin(2000);
            if (Array.isArray(group.participantIds)) {
              for (const identityId of group.participantIds) {
                const sessionId = group.sessions?.[identityId];
                if (typeof sessionId !== 'string') continue;
                if (registry !== undefined) {
                  const archived = new Set(registry.archivedSessionIds);
                  if (!archived.has(sessionId)) {
                    try {
                      await registry.archiveSession(sessionId, { stopActivity: true });
                    } catch (error) {
                      return failure(500, 'archive-failed', messageOf(error));
                    }
                  }
                }
                pendingReplies.delete(sessionId);
              }
              if (typeof group.workspaceId === 'string') {
                const groupWorkspace = registry?.list().find((candidate) => candidate.id === group.workspaceId);
                if (groupWorkspace !== undefined) {
                  try {
                    await registry.delete(groupWorkspace.id);
                  } catch (error) {
                    return failure(500, 'workspace-delete-failed', messageOf(error));
                  }
                }
              }
              groups.delete(key);
              indexParticipants();
              await writeGroups();
              return json({ ok: true, groupId: key });
            }
            const sessionId = group.sessionId;
            if (registry !== undefined) {
              const workspace = registry.list().find((candidate) => candidate.sessionIds.includes(sessionId));
              if (workspace !== undefined) {
                const archived = new Set(registry.archivedSessionIds);
                if (!archived.has(sessionId)) {
                  try {
                    await registry.archiveSession(sessionId, { stopActivity: true });
                  } catch (error) {
                    return failure(500, 'archive-failed', messageOf(error));
                  }
                }
              }
            }
            if (registry !== undefined) {
              // A Session created before groups owned a home is still a member
              // of the host identity's workspace. Detach it so a closed group
              // can never be selected as that identity's private conversation.
              for (const workspace of registry.list()) {
                if (!workspace.sessionIds.includes(sessionId)) continue;
                try {
                  await workspace.detachSession(sessionId);
                } catch (error) {
                  logger?.warn?.(`personal-agent: could not detach closed group from ${workspace.title}: ${messageOf(error)}`);
                }
              }
            }
            if (typeof group.workspaceId === 'string') {
              const groupWorkspace = registry?.list().find((candidate) => candidate.id === group.workspaceId);
              if (groupWorkspace !== undefined) {
                try {
                  await registry.delete(groupWorkspace.id);
                } catch (error) {
                  return failure(500, 'workspace-delete-failed', messageOf(error));
                }
              }
            }
            groups.delete(key);
            await writeGroups();
            return json({ ok: true, sessionId });
          },
        }),
      'personal-agent: close group route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: FRESH_CONSUME_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            const identityId = typeof body.identityId === 'string' ? body.identityId : '';
            const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
            const reset = pendingResets.get(identityId);
            // A delayed acknowledgement must never archive a newer reset.
            if (sessionId === '' || reset?.sessionId !== sessionId || startingResets.has(identityId)) {
              return json({ ok: true, cleared: 0, failed: 0 });
            }
            let attempt = finishingResets.get(identityId);
            if (attempt === undefined) {
              attempt = (async () => {
                const registry = await registryWithin(2000);
                if (registry === undefined) throw new Error('workspace registry is unavailable');
                return archiveResetHistory(identityId, reset, registry);
              })().finally(() => finishingResets.delete(identityId));
              finishingResets.set(identityId, attempt);
            }
            try {
              return json({ ok: true, ...await attempt });
            } catch (error) {
              return failure(500, 'archive-failed', messageOf(error));
            }
          },
        }),
      'personal-agent: consume fresh conversation marker',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: READ_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            if (typeof body.identityId === 'string' && body.identityId !== '') {
              const record = records.find((candidate) => candidate.identity.id === body.identityId);
              if (record === undefined) return failure(404, 'unknown-identity', `no identity "${body.identityId}"`);
              unreadIdentities.delete(record.identity.id);
              return json({ ok: true, identityId: record.identity.id });
            }
            if (typeof body.groupId === 'string' && body.groupId !== '') {
              const group = [...groups.values()].find((candidate) => groupKey(candidate) === body.groupId);
              if (group === undefined) return failure(404, 'unknown-group', `no group "${body.groupId}"`);
              unreadGroups.delete(groupKey(group));
              return json({ ok: true, groupId: groupKey(group) });
            }
            return failure(400, 'invalid-target', 'identityId or groupId is required');
          },
        }),
      'personal-agent: mark read route',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: COMPACT_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
            const identityId = [...freshSessions.entries()].find(([, fresh]) => fresh === sessionId)?.[0];
            if (identityId === undefined || pendingResets.has(identityId) || startingResets.has(identityId)) {
              return failure(409, 'not-a-fresh-conversation', 'this Session is not waiting for context compaction');
            }
            const controller = ctx.get('sessionController');
            if (controller === undefined) return failure(409, 'session-controller-unavailable', 'this Host cannot resolve the Agent');
            let resolved;
            try {
              resolved = await controller.resolveAgent(sessionId);
            } catch (error) {
              return failure(500, 'agent-resolve-failed', messageOf(error));
            }
            if (resolved.agent === undefined) {
              return failure(409, 'agent-unavailable', resolved.error?.message ?? 'the Agent is unavailable');
            }
            // The personal preset isolates compaction inside a child group that
            // only the Agent-scoped /compact command can reach.
            const commands = commandsRef;
            if (commands === undefined) return failure(409, 'compaction-unavailable', 'the command runtime is unavailable');
            try {
              const execution = await commands.execute(
                resolved.agent,
                '/compact',
                [],
                AbortSignal.timeout(120_000),
              );
              if (execution === undefined) {
                return failure(409, 'compaction-unavailable', 'the /compact command is unavailable');
              }
              if (execution.result.kind === 'error') {
                return failure(409, 'compact-failed', execution.result.text);
              }
              if (freshSessions.get(identityId) === sessionId && !pendingResets.has(identityId)) {
                freshSessions.delete(identityId);
                await writeFresh();
              }
              return json({ ok: true, compacted: true, sessionId, note: execution.result.text });
            } catch (error) {
              return failure(409, 'compact-failed', messageOf(error));
            }
          },
        }),
      'personal-agent: compact fresh conversation',
    );

    scope.effect(
      () =>
        scope.connection.fetch.register({
          path: OPEN_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body;
            try {
              body = await readObjectBody(request);
            } catch (error) {
              return failure(400, 'invalid-body', messageOf(error));
            }
            const registry = await registryWithin(2000);
            if (registry === undefined) {
              return failure(409, 'workspace-unavailable', 'this Host has no workspace registry, so the home cannot be opened');
            }
            if (typeof body.workspaceId === 'string' && body.workspaceId !== '') {
              const workspace = registry.get(body.workspaceId);
              if (workspace === undefined) return failure(404, 'unknown-workspace', `no workspace "${body.workspaceId}"`);
              const sessionId = await newestConversation(workspace, registry);
              return json({ ok: true, workspaceId: workspace.id, sessionId, title: workspace.title, agentPreset: null });
            }
            if (typeof body.identityId !== 'string' || body.identityId === '') {
              return failure(400, 'invalid-target', 'identityId or workspaceId must be a non-empty string');
            }
            const record = records.find((candidate) => candidate.identity.id === body.identityId);
            if (record === undefined) return failure(404, 'unknown-identity', `no identity "${body.identityId}"`);
            try {
              const workspace = await ensureIdentity(record.identity.id, registry);
              const archived = new Set(registry.archivedSessionIds);
              const fresh = freshSessions.get(record.identity.id);
              const preferFresh = !startingResets.has(record.identity.id) && typeof fresh === 'string' &&
                workspace.sessionIds.includes(fresh) && !archived.has(fresh);
              const sessionId = preferFresh ? fresh : await newestConversation(workspace, registry);
              return json({ ok: true, workspaceId: workspace.id, sessionId, preferFresh, title: workspace.title, agentPreset: PRESET_ID });
            } catch (error) {
              const info = homesInfo.get(record.identity.id);
              if (info !== undefined) info.error = messageOf(error);
              return failure(500, 'open-failed', messageOf(error));
            }
          },
        }),
      'personal-agent: open route',
    );
  });
}

/** Pure group-image helpers, exported for the node test suite. */
export const __groupImages = { imageBytesMatchMediaType, normalizeGroupImages, promptContent, GROUP_IMAGE_TYPES, GROUP_IMAGE_MAX_COUNT, GROUP_IMAGE_MAX_BYTES };
