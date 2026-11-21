import assert from 'node:assert/strict';
import test from 'node:test';

import { __groupImages } from '../index.js';

const { normalizeGroupImages, imageBytesMatchMediaType, promptContent, GROUP_IMAGE_MAX_COUNT } = __groupImages;

/** A byte string with a PNG signature; the Host only checks magic bytes. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('payload')]);

/**
 * Build one base64 image payload.
 * @param {Buffer} bytes - encoded image bytes.
 * @returns {string} base64 text.
 */
const base64 = (bytes) => bytes.toString('base64');

test('a PNG is accepted with its name and dimensions', () => {
  const [image] = normalizeGroupImages([
    { mediaType: 'image/png', data: base64(PNG), name: ' screenshot.png ', width: 640, height: 480 },
  ]);
  assert.equal(image.mediaType, 'image/png');
  assert.equal(image.extension, 'png');
  assert.equal(image.name, 'screenshot.png');
  assert.equal(image.width, 640);
  assert.equal(image.height, 480);
  assert.equal(image.data, base64(PNG));
  assert.match(image.id, /^image-/);
});

test('a data URL prefix is accepted', () => {
  const [image] = normalizeGroupImages([
    { mediaType: 'image/png', data: `data:image/png;base64,${base64(PNG)}` },
  ]);
  assert.equal(image.data, base64(PNG));
});

test('an empty payload means no images', () => {
  assert.deepEqual(normalizeGroupImages(undefined), []);
  assert.deepEqual(normalizeGroupImages(null), []);
  assert.deepEqual(normalizeGroupImages([]), []);
});

test('the declared media type must match the bytes', () => {
  assert.equal(imageBytesMatchMediaType(PNG, 'image/png'), true);
  assert.equal(imageBytesMatchMediaType(PNG, 'image/jpeg'), false);
  assert.throws(
    () => normalizeGroupImages([{ mediaType: 'image/jpeg', data: base64(PNG) }]),
    /does not match image\/jpeg/,
  );
});

test('unsupported media types and malformed payloads are rejected', () => {
  assert.throws(() => normalizeGroupImages([{ mediaType: 'image/svg+xml', data: base64(PNG) }]), /unsupported image type/);
  assert.throws(() => normalizeGroupImages([{ mediaType: 'image/png', data: 'not-base64!' }]), /base64/);
  assert.throws(() => normalizeGroupImages([{ mediaType: 'image/png', data: '' }]), /base64/);
});

test('an invalid dimension is dropped instead of stored', () => {
  const [image] = normalizeGroupImages([{ mediaType: 'image/png', data: base64(PNG), width: -1, height: 0 }]);
  assert.equal(image.width, undefined);
  assert.equal(image.height, undefined);
});

test('a message is capped at the maximum image count', () => {
  const many = Array.from({ length: GROUP_IMAGE_MAX_COUNT + 1 }, () => ({ mediaType: 'image/png', data: base64(PNG) }));
  assert.throws(() => normalizeGroupImages(many), /at most/);
});

test('an image larger than the per-image budget is rejected', () => {
  const huge = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]);
  assert.throws(() => normalizeGroupImages([{ mediaType: 'image/png', data: base64(huge) }]), /at most/);
});

test('a participant prompt carries the text first and one image part per image', () => {
  const [image] = normalizeGroupImages([
    { mediaType: 'image/png', data: base64(PNG), name: 'shot.png', width: 2, height: 3 },
  ]);
  const content = promptContent('请看这张图', [image]);
  assert.equal(content.length, 2);
  assert.deepEqual(content[0], { type: 'text', text: '请看这张图' });
  assert.equal(content[1].type, 'image');
  assert.equal(content[1].mediaType, 'image/png');
  assert.equal(content[1].data, base64(PNG));
  assert.equal(content[1].name, 'shot.png');
});

test('a nameless image omits the optional name field', () => {
  const [image] = normalizeGroupImages([{ mediaType: 'image/png', data: base64(PNG) }]);
  const [, part] = promptContent('x', [image]);
  assert.equal('name' in part, false);
});
