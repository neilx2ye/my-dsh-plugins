/**
 * Durable chat-to-Session bindings for the Feishu bridge.
 *
 * One small JSON file under the profile's own plugin directory maps a Feishu
 * chat id to the Harness Session that answers it. The file is written
 * atomically and only ever holds non-secret routing data.
 */

import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Bumped when the stored shape changes incompatibly. */
const VERSION = 1;

/**
 * Build an empty state object.
 * @returns `{ version, chats }`.
 */
function emptyState() {
  return { version: VERSION, chats: {} };
}

/**
 * Validate and copy one stored binding.
 * @param value - candidate from disk.
 * @returns a binding, or undefined.
 */
function bindingOf(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (typeof value.sessionId !== 'string' || value.sessionId === '') return undefined;
  return {
    sessionId: value.sessionId,
    ...(typeof value.title === 'string' && value.title !== '' ? { title: value.title } : {}),
    ...(typeof value.chatType === 'string' ? { chatType: value.chatType } : {}),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
  };
}

/**
 * Read a state file, falling back to an empty state on a missing or corrupt file.
 * @param file - absolute state path.
 * @returns the parsed state.
 */
function readState(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return emptyState();
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyState();
    const chats = {};
    if (parsed.chats !== null && typeof parsed.chats === 'object' && !Array.isArray(parsed.chats)) {
      for (const [chatId, value] of Object.entries(parsed.chats)) {
        const binding = bindingOf(value);
        if (binding !== undefined) chats[chatId] = binding;
      }
    }
    return { version: VERSION, chats };
  } catch {
    return emptyState();
  }
}

/**
 * Create the chat binding store.
 * @param file - absolute state file path.
 * @returns the store.
 */
export function createChatStore(file) {
  let state = readState(file);
  /** Serializes writes so two chats cannot interleave a partial file. */
  let chain = Promise.resolve();

  /**
   * Persist the current state atomically.
   * @returns a promise that settles after the rename.
   */
  function save() {
    const snapshot = JSON.stringify(state, null, 2);
    chain = chain
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, file);
      });
    return chain;
  }

  return {
    /**
     * Read one chat's binding.
     * @param chatId - Feishu chat id.
     * @returns the binding, or undefined.
     */
    get(chatId) {
      return state.chats[chatId];
    },

    /**
     * Bind one chat to a Session, creating or replacing the binding.
     * @param chatId - Feishu chat id.
     * @param sessionId - Harness Session id.
     * @param extra - optional title and chat type.
     * @returns the stored binding.
     */
    set(chatId, sessionId, extra = {}) {
      const now = new Date().toISOString();
      const previous = state.chats[chatId];
      const binding = {
        sessionId,
        ...(typeof extra.title === 'string' && extra.title !== '' ? { title: extra.title } : previous?.title === undefined ? {} : { title: previous.title }),
        ...(typeof extra.chatType === 'string' && extra.chatType !== '' ? { chatType: extra.chatType } : previous?.chatType === undefined ? {} : { chatType: previous.chatType }),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      state.chats[chatId] = binding;
      void save().catch(() => undefined);
      return binding;
    },

    /**
     * Update the last-used time of one binding.
     * @param chatId - Feishu chat id.
     */
    touch(chatId) {
      const binding = state.chats[chatId];
      if (binding === undefined) return;
      binding.updatedAt = new Date().toISOString();
      void save().catch(() => undefined);
    },

    /**
     * Forget one chat, or every chat.
     * @param chatId - Feishu chat id; omit to clear all.
     * @returns the number of removed bindings.
     */
    remove(chatId) {
      if (chatId === undefined) {
        const count = Object.keys(state.chats).length;
        state = emptyState();
        void save().catch(() => undefined);
        return count;
      }
      if (state.chats[chatId] === undefined) return 0;
      delete state.chats[chatId];
      void save().catch(() => undefined);
      return 1;
    },

    /**
     * Count bound chats.
     * @returns the number of bindings.
     */
    count() {
      return Object.keys(state.chats).length;
    },

    /**
     * List recent bindings, newest first.
     * @param limit - maximum rows.
     * @returns public binding rows with chat ids.
     */
    recent(limit = 8) {
      return Object.entries(state.chats)
        .map(([chatId, binding]) => ({ chatId, ...binding }))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit);
    },

    /**
     * Wait until pending writes settle. Used by tests and shutdown.
     * @returns the write chain.
     */
    flush() {
      return chain.catch(() => undefined);
    },
  };
}