/**
 * Pure formatting helpers shared by the Host bridge and its tests.
 *
 * Feishu delivers messages as text plus resource descriptors. The bridge turns
 * those into Harness prompt parts, reads assistant text out of the durable log
 * at turn end, and renders a short error line when a turn fails.
 */

/** Image media types the Harness accepts from a Feishu image resource. */
const IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

/**
 * Extract the visible text of one assistant message content array.
 * @param content - message content blocks.
 * @returns joined text.
 */
export function textOfContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim();
}

/**
 * Extract the visible text of one recorded `assistant/message` event.
 * @param event - session event.
 * @returns joined text.
 */
export function textOfAssistantEvent(event) {
  return textOfContent(event?.data?.message?.content);
}

/**
 * Collect the assistant text of one turn from a list of recorded events.
 * @param events - session events, in log order.
 * @param turn - turn number; omitted collects every assistant message.
 * @returns one markdown string, separated by blank lines.
 */
export function assistantTextForTurn(events, turn) {
  if (!Array.isArray(events)) return '';
  const parts = [];
  for (const event of events) {
    if (event?.type !== 'assistant/message') continue;
    if (turn !== undefined && event.data?.turn !== turn) continue;
    if (event.surfaceOp === 'replace' || event.surfaceOp?.op === 'replace') continue;
    const text = textOfAssistantEvent(event);
    if (text !== '') parts.push(text);
  }
  return parts.join('\n\n').trim();
}

/**
 * Render a failure line for a turn end reason.
 * @param reason - `turn/end` reason object.
 * @returns a user-facing message, or an empty string for a normal completion.
 */
export function turnFailureText(reason) {
  if (reason === null || typeof reason !== 'object') return '';
  if (reason.kind === 'error') {
    const failure = reason.error ?? {};
    const message = typeof failure.message === 'string' && failure.message !== '' ? failure.message : '未知错误';
    return `处理失败：${message}`;
  }
  if (reason.kind === 'blocked') return '这次请求被拦下了，没有执行。';
  if (reason.kind === 'aborted') return '这次请求已中断。';
  if (reason.kind === 'max-tokens') return '回复达到长度上限，已截断。';
  if (reason.kind === 'interrupted') return '这次请求在服务重启时中断了，请重新发送。';
  return '';
}

/**
 * Infer an image media type from a buffer's first bytes.
 * @param buffer - downloaded bytes.
 * @returns a supported media type, or undefined.
 */
export function inferImageMediaType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return undefined;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  return undefined;
}

/**
 * Describe unsupported message resources in one short line.
 * @param resources - Feishu resource descriptors.
 * @returns a sentence, or an empty string.
 */
export function resourceNote(resources) {
  if (!Array.isArray(resources) || resources.length === 0) return '';
  const kinds = [...new Set(resources.map((resource) => (typeof resource?.type === 'string' ? resource.type : 'file')))];
  const labels = kinds.map((kind) => ({ image: '图片', file: '文件', audio: '语音', video: '视频', sticker: '表情' })[kind] ?? kind);
  return `（收到 ${labels.join('、')}，其中无法读取的内容已省略）`;
}

/**
 * Remove the bot mention from a group message's text.
 * @param text - normalized message text.
 * @param mentions - message mentions.
 * @returns text without `@bot` tokens.
 */
export function stripBotMention(text, mentions) {
  let out = typeof text === 'string' ? text : '';
  if (!Array.isArray(mentions)) return out.trim();
  for (const mention of mentions) {
    if (mention?.isBot !== true) continue;
    if (typeof mention.name === 'string' && mention.name !== '') {
      out = out.split(`@${mention.name}`).join('');
    }
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Truncate a chat title for the Session list.
 * @param value - raw title.
 * @returns a short single-line title.
 */
export function shortTitle(value) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (text === '') return '飞书对话';
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

export { IMAGE_TYPES };