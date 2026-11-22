/**
 * Feishu long-connection bridge.
 *
 * The bridge keeps one WebSocket connection to Feishu (the "long connection"
 * event transport, so no public callback URL is needed), turns each accepted
 * chat message into a Harness prompt, and sends the agent's answer back to the
 * same chat. One Feishu chat is bound to one durable Harness Session, so a
 * conversation keeps its context across bridge and Harness restarts.
 *
 * The Feishu SDK is imported lazily: a profile that has the bundle but not the
 * dependency still loads its Settings page and reports the missing dependency
 * instead of failing activation.
 */

import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { hasCredentials, resolveAppSecret } from './config.js';
import {
  assistantTextForTurn,
  inferImageMediaType,
  resourceNote,
  shortTitle,
  textOfAssistantEvent,
  stripBotMention,
  turnFailureText,
} from './format.js';
import { createChatStore } from './state.js';
import { TurnStream } from './turn-stream.js';

/** npm package that carries the Feishu WebSocket client. */
const SDK_PACKAGE = '@larksuiteoapi/node-sdk';
/** Bound on one first WebSocket handshake. */
const CONNECT_TIMEOUT_MS = 20_000;
/** Bound on one reply send. */
const SEND_TIMEOUT_MS = 30_000;
/** Bound on one image download. */
const DOWNLOAD_TIMEOUT_MS = 15_000;
/** A turn that never ends is closed with an error after this long. */
const TURN_TIMEOUT_MS = 30 * 60 * 1000;
/** Largest image forwarded into a prompt. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Most images read from one Feishu message. */
const MAX_IMAGES = 4;
/** How long a processed message id is remembered for duplicate redelivery. */
const SEEN_TTL_MS = 10 * 60 * 1000;
/** Most remembered message ids. */
const SEEN_MAX = 2_000;

/**
 * Render one thrown value as a short message.
 * @param error - thrown value.
 * @returns a message string.
 */
export function messageOf(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Await a promise with a deadline.
 * @param promise - promise to await.
 * @param ms - deadline in milliseconds.
 * @param label - operation name in the timeout message.
 * @returns the promise's value.
 */
function withTimeout(promise, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Expand one supported `~` prefix.
 * @param path - configured path.
 * @returns an absolute or unchanged path.
 */
function expandHome(path) {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Import the Feishu SDK, naming the package when it is not installed.
 * @returns the SDK module.
 */
async function loadSdk() {
  try {
    return await import(SDK_PACKAGE);
  } catch (error) {
    const wrapped = new Error(`缺少依赖 ${SDK_PACKAGE}：${messageOf(error)}`);
    wrapped.code = 'dependency-missing';
    throw wrapped;
  }
}

/**
 * Build a logger the Feishu SDK accepts that forwards into the Harness logger.
 * @param logger - Harness logger, when present.
 * @returns a four-method logger.
 */
function sdkLogger(logger) {
  const forward = (method, prefix) => (...args) => {
    const text = args.map((value) => (value instanceof Error ? value.message : typeof value === 'string' ? value : JSON.stringify(value))).join(' ');
    const target = logger?.[method] ?? logger?.info;
    if (typeof target === 'function') target.call(logger, `feishu-bridge: ${prefix}${text}`);
  };
  return {
    debug: forward('debug', ''),
    info: forward('info', ''),
    warn: forward('warn', ''),
    error: forward('error', ''),
  };
}

/**
 * Describe a Feishu SDK option set for one credential pair.
 * @param sdk - Feishu SDK module.
 * @param settings - normalized plugin configuration.
 * @param logger - Harness logger.
 * @returns `createLarkChannel` options.
 */
function channelOptions(sdk, settings, logger) {
  return {
    appId: settings.appId,
    appSecret: resolveAppSecret(settings),
    transport: 'websocket',
    domain: settings.domain === 'lark' ? sdk.Domain.Lark : sdk.Domain.Feishu,
    loggerLevel: sdk.LoggerLevel.warn,
    logger: sdkLogger(logger),
    handshakeTimeoutMs: 15_000,
    policy: {
      dmMode: settings.dmMode,
      dmAllowlist: settings.dmAllowlist,
      groupAllowlist: settings.groupAllowlist,
      requireMention: settings.requireMention,
      respondToMentionAll: settings.respondToMentionAll,
    },
    safety: {
      staleMessageWindowMs: 15 * 60 * 1000,
    },
    outbound: {
      streamInitialText: '正在处理…',
      streamThrottleMs: 600,
      streamThrottleChars: 40,
    },
  };
}

/**
 * Probe one credential pair without saving it.
 * @param sdk - loaded Feishu SDK module.
 * @param settings - draft configuration with appId and appSecret.
 * @param logger - Harness logger.
 * @returns `{ bot, state }` after a successful handshake.
 */
export async function probeCredentials(sdk, settings, logger) {
  const channel = sdk.createLarkChannel(channelOptions(sdk, settings, logger));
  try {
    await withTimeout(channel.connect(), CONNECT_TIMEOUT_MS, 'Feishu long connection');
    return {
      bot: channel.botIdentity ?? undefined,
      state: channel.getConnectionStatus?.()?.state ?? 'connected',
    };
  } finally {
    await channel.disconnect().catch(() => undefined);
  }
}

export class FeishuBridge {
  /**
   * @param ctx - Host root Context.
   * @param settings - normalized plugin configuration.
   * @param options - profile data directory and logger.
   */
  constructor(ctx, settings, options) {
    this.ctx = ctx;
    this.settings = settings;
    this.dataDir = options.dataDir;
    this.logger = options.logger;
    /** Default directory for new Feishu conversations. */
    this.cwd = this.resolveCwd();
    /** Durable chat bindings. */
    this.store = createChatStore(join(this.dataDir, 'chats.json'));
    /** Live Feishu channel. */
    this.channel = undefined;
    /** Loaded SDK module. */
    this.sdk = undefined;
    /** Session id -> FIFO of prompts waiting for their turn. */
    this.pendingBySession = new Map();
    /** Recently handled message ids, for duplicate redelivery after reconnect. */
    this.seen = new Map();
    /** Disposer for the channel's event listeners. */
    this.unbindChannel = undefined;
    /** Disposer for the Harness event listeners. */
    this.unbindSession = undefined;
    /** Whether a handshake is in flight. */
    this.connecting = false;
    /** Set while plugin shutdown is in progress. */
    this.stopped = false;
    /** When the current connection was established. */
    this.connectedAt = undefined;
    /** Last connection or send failure. */
    this.lastError = undefined;
    /** Last message the Feishu policy rejected. */
    this.lastRejected = undefined;
    /** Bot identity reported by Feishu. */
    this.botIdentity = undefined;
    /** Missing-dependency message, when the SDK cannot load. */
    this.dependencyError = undefined;
  }

  /**
   * Resolve the default conversation directory.
   * @returns an absolute path.
   */
  resolveCwd() {
    const configured = typeof this.settings.cwd === 'string' ? this.settings.cwd.trim() : '';
    if (configured === '') return join(this.dataDir, 'home');
    const expanded = expandHome(configured);
    return isAbsolute(expanded) ? expanded : resolve(this.dataDir, expanded);
  }

  /**
   * Start the bridge: bind Harness listeners, then connect Feishu.
   * @returns after the first connection attempt settles.
   */
  async start() {
    this.stopped = false;
    if (this.unbindSession === undefined) this.unbindSession = this.bindSessionEvents();
    await mkdir(this.cwd, { recursive: true, mode: 0o700 }).catch(() => undefined);
    await this.connectChannel();
  }

  /**
   * Stop the bridge and release every listener and card.
   * @returns after the Feishu socket closes.
   */
  async stop() {
    this.stopped = true;
    if (typeof this.unbindSession === 'function') {
      this.unbindSession();
      this.unbindSession = undefined;
    }
    for (const queue of this.pendingBySession.values()) {
      for (const pending of queue) {
        clearTimeout(pending.timer);
        pending.stream?.fail('服务已停止。');
      }
    }
    this.pendingBySession.clear();
    await this.disconnectChannel();
    await this.store.flush().catch(() => undefined);
  }

  /**
   * Drop the current socket and connect again with the live configuration.
   * @returns after the new attempt settles.
   */
  async restart() {
    await this.disconnectChannel();
    this.lastError = undefined;
    await this.connectChannel();
  }

  /**
   * Bind the two Harness events the bridge consumes.
   * @returns a disposer.
   */
  bindSessionEvents() {
    const offEvent = this.ctx.on('session/event', (session, event) => this.onSessionEvent(session, event));
    const offStream = this.ctx.on('agent/assistant-stream', (payload) => this.onAssistantStream(payload));
    return () => {
      if (typeof offEvent === 'function') offEvent();
      if (typeof offStream === 'function') offStream();
    };
  }

  /**
   * Open the Feishu long connection when the row is usable.
   * @returns after the attempt settles.
   */
  async connectChannel() {
    if (this.channel !== undefined || this.connecting || this.stopped) return;
    if (!this.settings.enabled) return;
    if (!hasCredentials(this.settings)) return;
    this.connecting = true;
    try {
      const sdk = await loadSdk();
      this.sdk = sdk;
      this.dependencyError = undefined;
      const channel = sdk.createLarkChannel(channelOptions(sdk, this.settings, this.logger));
      this.channel = channel;
      this.unbindChannel = channel.on({
        message: (message) => {
          void this.handleMessage(message).catch((error) => {
            this.lastError = messageOf(error);
            this.logger?.error?.(`feishu-bridge: 处理消息失败: ${messageOf(error)}`);
          });
        },
        reject: (event) => {
          this.lastRejected = { reason: event.reason, chatId: event.chatId, at: new Date().toISOString() };
        },
        botAdded: (event) => {
          void this.welcome(event.chatId);
        },
        error: (error) => {
          this.lastError = messageOf(error);
          this.logger?.warn?.(`feishu-bridge: 长连接错误: ${messageOf(error)}`);
        },
        reconnecting: () => {
          this.connectedAt = undefined;
        },
        reconnected: () => {
          this.connectedAt = new Date().toISOString();
        },
      });
      await withTimeout(channel.connect(), CONNECT_TIMEOUT_MS, 'Feishu long connection');
      this.connectedAt = new Date().toISOString();
      this.botIdentity = channel.botIdentity;
      this.lastError = undefined;
      this.logger?.info?.(`feishu-bridge: 已连接飞书${this.botIdentity?.name ? `（${this.botIdentity.name}）` : ''}`);
    } catch (error) {
      this.dependencyError = error?.code === 'dependency-missing' ? messageOf(error) : undefined;
      this.lastError = messageOf(error);
      this.logger?.error?.(`feishu-bridge: 连接失败: ${messageOf(error)}`);
      await this.disconnectChannel();
    } finally {
      this.connecting = false;
    }
  }

  /**
   * Close the Feishu socket, if one is open.
   * @returns after listeners and socket are released.
   */
  async disconnectChannel() {
    const channel = this.channel;
    this.channel = undefined;
    this.connectedAt = undefined;
    this.botIdentity = undefined;
    if (typeof this.unbindChannel === 'function') {
      this.unbindChannel();
      this.unbindChannel = undefined;
    }
    if (channel !== undefined) {
      await channel.disconnect().catch(() => undefined);
    }
  }

  /**
   * Snapshot the bridge for the Settings page.
   * @returns public status fields.
   */
  status() {
    const socket = this.channel?.getConnectionStatus?.();
    let state;
    if (!this.settings.enabled) state = 'disabled';
    else if (!hasCredentials(this.settings)) state = 'not-configured';
    else if (this.dependencyError !== undefined) state = 'failed';
    else if (this.connecting) state = 'connecting';
    else if (this.connectedAt !== undefined) state = socket?.state ?? 'connected';
    else if (socket?.state === 'reconnecting') state = 'reconnecting';
    else if (this.lastError !== undefined) state = 'failed';
    else state = 'idle';
    return {
      state,
      connected: this.connectedAt !== undefined,
      connecting: this.connecting,
      bot: this.botIdentity ?? undefined,
      connectedAt: this.connectedAt,
      lastError: this.lastError,
      lastRejected: this.lastRejected,
      dependency: this.dependencyError === undefined ? 'ok' : 'missing',
      dependencyError: this.dependencyError,
      cwd: this.cwd,
      boundChats: this.store.count(),
      recentChats: this.store.recent(6),
      socket: socket === undefined ? undefined : { state: socket.state, reconnectAttempts: socket.reconnectAttempts },
    };
  }

  /**
   * Send one message to Feishu, preferring markdown when enabled.
   * @param chatId - target chat.
   * @param text - reply text.
   * @param replyTo - message id to reply to.
   * @returns the SDK result.
   */
  async send(chatId, text, replyTo) {
    if (this.channel === undefined) throw new Error('飞书长连接尚未建立');
    const content = typeof text === 'string' && text.trim() !== '' ? text : '（没有可显示的回复）';
    const options = {
      ...(typeof replyTo === 'string' && replyTo !== '' ? { replyTo } : {}),
      ...(this.settings.replyInThread ? { replyInThread: true } : {}),
    };
    try {
      const input = this.settings.markdown ? { markdown: content } : { text: content };
      return await withTimeout(this.channel.send(chatId, input, options), SEND_TIMEOUT_MS, 'Feishu send');
    } catch (error) {
      if (!this.settings.markdown) throw error;
      this.logger?.warn?.(`feishu-bridge: markdown 发送失败，改用纯文本: ${messageOf(error)}`);
      return await withTimeout(this.channel.send(chatId, { text: content }, options), SEND_TIMEOUT_MS, 'Feishu send');
    }
  }

  /**
   * Send a one-time welcome when the bot joins a group.
   * @param chatId - new chat.
   */
  async welcome(chatId) {
    try {
      await this.send(chatId, '你好，我是 DSH 智能体。群里 @我 并说明要做的事，或私聊直接发消息。');
    } catch (error) {
      this.logger?.warn?.(`feishu-bridge: 欢迎消息发送失败: ${messageOf(error)}`);
    }
  }

  /**
   * Forget a stale message id.
   * @param messageId - Feishu message id.
   * @returns true when this id was already handled.
   */
  markSeen(messageId) {
    const now = Date.now();
    if (this.seen.size > SEEN_MAX) {
      for (const [id, at] of this.seen) {
        if (now - at > SEEN_TTL_MS || this.seen.size > SEEN_MAX) this.seen.delete(id);
        else break;
      }
    }
    const previous = this.seen.get(messageId);
    this.seen.set(messageId, now);
    return previous !== undefined && now - previous < SEEN_TTL_MS;
  }

  /**
   * Handle one normalized Feishu message.
   * @param message - SDK message event.
   * @returns after the prompt is admitted or the rejection is sent.
   */
  async handleMessage(message) {
    if (this.stopped || this.channel === undefined) return;
    if (typeof message?.messageId !== 'string' || typeof message?.chatId !== 'string') return;
    if (this.botIdentity?.openId !== undefined && message.senderId === this.botIdentity.openId) return;
    if (this.markSeen(message.messageId)) return;

    const text = stripBotMention(message.content, message.mentions);
    const images = await this.readImages(message);
    const unsupported = (message.resources ?? []).filter((resource) => resource?.type !== 'image');
    const parts = [];
    let promptText = text;
    if (message.chatType === 'group' && promptText !== '') {
      const sender = typeof message.senderName === 'string' && message.senderName !== '' ? message.senderName : message.senderId;
      promptText = `[${sender}] ${promptText}`;
    }
    if (promptText !== '') parts.push({ type: 'text', text: promptText });
    parts.push(...images);
    if (parts.length === 0) {
      const labels = [...new Set(unsupported.map((resource) => ({ file: '文件', audio: '语音', video: '视频', sticker: '表情' })[resource?.type] ?? '消息'))];
      await this.send(
        message.chatId,
        labels.length === 0
          ? '这条消息没有可读取的文字或图片，请直接发送文字。'
          : `目前还不能读取${labels.join('、')}，请改发文字或图片。`,
        message.messageId,
      ).catch((error) => {
        this.logger?.warn?.(`feishu-bridge: 提示发送失败: ${messageOf(error)}`);
      });
      return;
    }
    if (unsupported.length > 0) {
      parts.push({ type: 'text', text: resourceNote(unsupported) });
    }

    let binding = this.store.get(message.chatId);
    if (binding === undefined) {
      binding = await this.createSession(message);
      if (binding === undefined) return;
    }

    const requestId = `feishu:${message.messageId}`;
    const session = this.ctx.sessions.get(binding.sessionId);
    if (session !== undefined && this.sessionSawRequest(session, requestId)) {
      this.logger?.info?.(`feishu-bridge: 重复消息 ${message.messageId} 已在 Session 中，跳过`);
      return;
    }

    await this.prompt(binding, message, parts, requestId, false);
  }

  /**
   * Read up to four image resources into prompt image parts.
   * @param message - normalized Feishu message.
   * @returns image content parts.
   */
  async readImages(message) {
    const resources = (message.resources ?? []).filter((resource) => resource?.type === 'image').slice(0, MAX_IMAGES);
    const images = [];
    for (const resource of resources) {
      try {
        const buffer = await withTimeout(this.channel.downloadResource(resource.fileKey, 'image'), DOWNLOAD_TIMEOUT_MS, 'Feishu image download');
        if (buffer.length > MAX_IMAGE_BYTES) {
          this.logger?.warn?.(`feishu-bridge: 跳过超大图片 ${buffer.length} 字节`);
          continue;
        }
        const mediaType = inferImageMediaType(buffer);
        if (mediaType === undefined) {
          this.logger?.warn?.('feishu-bridge: 跳过无法识别的图片格式');
          continue;
        }
        images.push({
          type: 'image',
          mediaType,
          data: buffer.toString('base64'),
          ...(typeof resource.fileName === 'string' && resource.fileName !== '' ? { name: resource.fileName } : {}),
        });
      } catch (error) {
        this.logger?.warn?.(`feishu-bridge: 图片读取失败: ${messageOf(error)}`);
      }
    }
    return images;
  }

  /**
   * Whether a Session already recorded this request id.
   * @param session - live Session.
   * @param requestId - stable prompt identity.
   * @returns true when the id is in the recent log.
   */
  sessionSawRequest(session, requestId) {
    try {
      const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents(Math.max(0, session.seq - 200)) : [];
      return events.some((event) => event?.type === 'user/message' && event.data?.source?.rpcId === requestId);
    } catch {
      return false;
    }
  }

  /**
   * Create and persist one Session for a Feishu chat.
   * @param message - the first message of the chat.
   * @returns the new binding, or undefined when creation failed.
   */
  async createSession(message) {
    const controller = this.ctx.get('sessionController');
    if (controller === undefined) {
      await this.send(message.chatId, 'Harness 的会话服务不可用，无法创建对话。', message.messageId).catch(() => undefined);
      return undefined;
    }
    try {
      const created = await controller.create({
        cwd: this.cwd,
        ...(this.settings.agentPreset === '' ? {} : { agentPreset: this.settings.agentPreset }),
      });
      const binding = this.store.set(message.chatId, created.sessionId, {
        chatType: message.chatType,
        title: this.defaultTitle(message),
      });
      void this.nameSession(created.sessionId, message, binding);
      return binding;
    } catch (error) {
      this.lastError = messageOf(error);
      this.logger?.error?.(`feishu-bridge: 创建会话失败: ${messageOf(error)}`);
      await this.send(message.chatId, `创建对话失败：${messageOf(error)}`, message.messageId).catch(() => undefined);
      return undefined;
    }
  }

  /**
   * A provisional Session title for a chat.
   * @param message - first message.
   * @returns a short title.
   */
  defaultTitle(message) {
    const sender = typeof message.senderName === 'string' && message.senderName !== '' ? message.senderName : '飞书用户';
    return shortTitle(message.chatType === 'group' ? `飞书群 · ${message.chatId.slice(-6)}` : `飞书 · ${sender}`);
  }

  /**
   * Rename a new Session, using the group name when Feishu reports one.
   * @param sessionId - target Session.
   * @param message - first message.
   * @param binding - stored binding.
   */
  async nameSession(sessionId, message, binding) {
    const controller = this.ctx.get('sessionController');
    if (controller === undefined) return;
    let title = binding.title ?? this.defaultTitle(message);
    if (message.chatType === 'group') {
      try {
        const info = await withTimeout(this.channel.getChatInfo(message.chatId), 5_000, 'Feishu chat info');
        if (typeof info?.name === 'string' && info.name !== '') title = shortTitle(`飞书群 · ${info.name}`);
      } catch {
        // A missing chat-info permission must not block the conversation.
      }
    }
    try {
      await controller.rename({ sessionId, title });
      this.store.set(message.chatId, sessionId, { title, chatType: message.chatType });
    } catch {
      // Renaming is cosmetic; the Session already has a usable provisional title.
    }
  }

  /**
   * Ask Harness to run one prompt, rebinding once when the stored Session is gone.
   * @param binding - chat binding.
   * @param message - Feishu message.
   * @param parts - prompt content.
   * @param requestId - stable prompt identity.
   * @param retried - whether this is the second attempt.
   */
  async prompt(binding, message, parts, requestId, retried) {
    const controller = this.ctx.get('sessionController');
    if (controller === undefined) return;
    const sessionId = binding.sessionId;
    const session = this.ctx.sessions.get(sessionId);
    const startSeq = typeof session?.seq === 'number' ? session.seq : 0;
    const pending = {
      sessionId,
      chatId: message.chatId,
      messageId: message.messageId,
      requestId,
      startSeq,
      turn: undefined,
      messages: [],
      deltaChars: 0,
      stream: undefined,
      timer: undefined,
    };
    pending.timer = setTimeout(() => this.expire(pending), TURN_TIMEOUT_MS);
    pending.timer.unref?.();
    const queue = this.pendingBySession.get(sessionId) ?? [];
    queue.push(pending);
    this.pendingBySession.set(sessionId, queue);

    try {
      await controller.prompt(
        {
          sessionId,
          content: parts,
          mode: 'queue',
          requestId,
        },
        AbortSignal.timeout(20_000),
      );
      this.store.touch(message.chatId);
    } catch (error) {
      this.removePending(pending);
      const code = error?.code;
      if (!retried && (code === 'session/not-found' || code === 'session/conflict')) {
        this.logger?.warn?.(`feishu-bridge: 会话 ${sessionId} 不可用，重建: ${messageOf(error)}`);
        const rebound = await this.createSession(message);
        if (rebound !== undefined) await this.prompt(rebound, message, parts, requestId, true);
        return;
      }
      this.lastError = messageOf(error);
      this.logger?.error?.(`feishu-bridge: 提交消息失败: ${messageOf(error)}`);
      await this.send(message.chatId, `消息未能送入智能体：${messageOf(error)}`, message.messageId).catch(() => undefined);
    }
  }

  /**
   * Remove one pending prompt and clear its timer.
   * @param pending - prompt record.
   */
  removePending(pending) {
    clearTimeout(pending.timer);
    const queue = this.pendingBySession.get(pending.sessionId);
    if (queue === undefined) return;
    const index = queue.indexOf(pending);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) this.pendingBySession.delete(pending.sessionId);
  }

  /**
   * Close a prompt that never reached a turn end.
   * @param pending - prompt record.
   */
  expire(pending) {
    const queue = this.pendingBySession.get(pending.sessionId);
    if (queue === undefined || !queue.includes(pending)) return;
    this.removePending(pending);
    const text = '这次处理超过 30 分钟还没有结束，已放弃等待。可以稍后重新发送。';
    pending.stream?.fail(text);
    void this.send(pending.chatId, text, pending.messageId).catch(() => undefined);
  }

  /**
   * Begin the streaming card for one turn.
   * @param pending - active prompt record.
   */
  startStream(pending) {
    if (!this.settings.streaming || pending.stream !== undefined || this.channel === undefined) return;
    pending.stream = new TurnStream(async (producer) => {
      return await this.channel.stream(
        pending.chatId,
        { markdown: producer },
        {
          replyTo: pending.messageId,
          ...(this.settings.replyInThread ? { replyInThread: true } : {}),
        },
      );
    });
  }

  /**
   * Consume one Harness Session event.
   * @param session - emitting Session.
   * @param event - committed event.
   */
  onSessionEvent(session, event) {
    const queue = this.pendingBySession.get(session.id);
    if (queue === undefined || queue.length === 0) return;
    const pending = queue[0];
    if (event.type === 'turn/start') {
      if (pending.turn === undefined) {
        pending.turn = event.data.turn;
        this.startStream(pending);
      }
      return;
    }
    if (event.type === 'step/start') {
      if (pending.turn === event.data.turn && event.data.step > 1 && pending.deltaChars > 0) {
        pending.stream?.push('\n\n');
      }
      return;
    }
    if (event.type === 'assistant/message') {
      if (pending.turn !== undefined && event.data.turn !== pending.turn) return;
      if (event.surfaceOp === 'replace' || event.surfaceOp?.op === 'replace') return;
      const text = textOfAssistantEvent(event);
      if (text !== '') pending.messages.push(text);
      return;
    }
    if (event.type === 'turn/end') {
      if (pending.turn !== undefined && event.data.turn !== pending.turn) return;
      pending.turn = event.data.turn;
      void this.finalize(pending, event.data.reason);
    }
  }

  /**
   * Feed one live assistant text delta into the active card.
   * @param payload - `agent/assistant-stream` payload.
   */
  onAssistantStream(payload) {
    const sessionId = payload?.agent?.session?.id;
    if (typeof sessionId !== 'string') return;
    const queue = this.pendingBySession.get(sessionId);
    if (queue === undefined || queue.length === 0) return;
    const pending = queue[0];
    const frame = payload.frame;
    if (frame?.type !== 'chunk' || frame.chunk?.type !== 'text-delta' || typeof frame.chunk.text !== 'string') return;
    if (pending.turn !== undefined && frame.turn !== pending.turn) return;
    if (pending.stream === undefined) this.startStream(pending);
    pending.deltaChars += frame.chunk.text.length;
    pending.stream?.push(frame.chunk.text);
  }

  /**
   * Finish one turn and deliver its answer.
   * @param pending - prompt record.
   * @param reason - `turn/end` reason.
   */
  async finalize(pending, reason) {
    this.removePending(pending);
    const session = this.ctx.sessions.get(pending.sessionId);
    let finalText = pending.messages.join('\n\n').trim();
    if (finalText === '' && session !== undefined && typeof session.snapshotEvents === 'function') {
      try {
        const from = typeof session.seq === 'number' ? Math.max(0, session.seq - 2_000) : pending.startSeq;
        finalText = assistantTextForTurn(session.snapshotEvents(from), pending.turn);
      } catch {
        finalText = '';
      }
    }
    const failure = turnFailureText(reason);
    const text = finalText !== '' ? finalText : failure !== '' ? failure : '已完成。';

    if (pending.stream !== undefined) {
      try {
        await pending.stream.close(text);
        if (pending.stream.failed !== undefined) throw pending.stream.failed;
        return;
      } catch (error) {
        this.logger?.warn?.(`feishu-bridge: 流式卡片失败，改发文本: ${messageOf(error)}`);
      }
    }
    try {
      await this.send(pending.chatId, text, pending.messageId);
    } catch (error) {
      this.lastError = messageOf(error);
      this.logger?.error?.(`feishu-bridge: 回复发送失败: ${messageOf(error)}`);
    }
  }
}