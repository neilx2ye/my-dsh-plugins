import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * Load the browser bundle's factory without a DOM.
 *
 * The bundle is a `window.__ModuleLoader__.load` registration; a stub facade
 * captures the registration, and an inert React keeps the component
 * definitions from rendering. Only the exported pure helpers are exercised.
 * @returns {object} the module's factory exports.
 */
function loadClientExports(source) {
  let registration = null;
  const inert = new Proxy({}, { get: () => () => null });
  const require = (id) => (id === 'react' || id === 'react-dom' || id === 'react-dom/client' ? inert : {});
  const node = () => ({ dataset: {}, style: {}, remove() {}, appendChild() {}, querySelector: () => null });
  const window = { __ModuleLoader__: { load(module) { registration = module; } } };
  const run = new Function('window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame', 'fetch', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'require', source);
  run(window, node(), { language: 'zh-CN', languages: ['zh-CN'] }, { getItem: () => null, setItem() {}, removeItem() {} }, () => 0, async () => ({ ok: true, status: 200, data: {} }), console, () => 0, () => {}, () => 0, () => {}, require);
  assert.notEqual(registration, null, 'the bundle registers one client module');
  assert.equal(registration.id, '@local/personal-agent');
  return registration.factory(require);
}

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const { __images } = loadClientExports(source);
const { groupImageMediaType, imageBase64Of, imageBytesOf } = __images;

test('supported image types are normalized, including the browser image/jpg spelling', () => {
  assert.equal(groupImageMediaType('image/png'), 'image/png');
  assert.equal(groupImageMediaType('IMAGE/JPEG'), 'image/jpeg');
  assert.equal(groupImageMediaType('image/jpg'), 'image/jpeg');
  assert.equal(groupImageMediaType('image/webp'), 'image/webp');
  assert.equal(groupImageMediaType('image/gif'), 'image/gif');
});

test('anything else is rejected rather than sent to the Host', () => {
  assert.equal(groupImageMediaType('image/svg+xml'), null);
  assert.equal(groupImageMediaType('application/pdf'), null);
  assert.equal(groupImageMediaType(''), null);
  assert.equal(groupImageMediaType(undefined), null);
});

test('a data URL is reduced to its base64 payload', () => {
  assert.equal(imageBase64Of('data:image/png;base64,QUJD'), 'QUJD');
  assert.equal(imageBase64Of('QUJD'), 'QUJD');
  assert.equal(imageBase64Of(''), '');
  assert.equal(imageBase64Of(null), '');
});

test('the byte estimate tracks the base64 payload', () => {
  // "QUJD" is 3 decoded bytes.
  assert.equal(imageBytesOf('data:image/png;base64,QUJD'), 3);
  assert.equal(imageBytesOf('QUJDRA=='), 4);
});