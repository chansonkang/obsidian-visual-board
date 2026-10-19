import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { webcrypto } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(path.join(tmpdir(), 'visual-board-images-test-'));
after(async () => { await rm(temp, { recursive: true, force: true }); });
globalThis.crypto ??= webcrypto;
await build({ entryPoints: [new URL('../src/images.ts', import.meta.url).pathname], outfile: path.join(temp, 'images.mjs'), bundle: true, format: 'esm', platform: 'browser', plugins: [{ name: 'mock-obsidian', setup(builder) {
  builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
  builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export function normalizePath(p){return p.replace(/\\\\/g,'/').replace(/\\/+$/,'')}; export function requestUrl(options){return globalThis.__imageRequest(options)}` }));
} }] });
const { ImageService, obsidianUrl } = await import(pathToFileURL(path.join(temp, 'images.mjs')));
const png64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jc2kAAAAASUVORK5CYII=';
const gif64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const png = Uint8Array.from(Buffer.from(png64, 'base64'));
function fixture() {
  const files = new Map(), directories = new Set(); let creates = 0;
  const app = { vault: { createBinary: async (p, bytes) => { creates++; files.set(p, new Uint8Array(bytes)); }, adapter: {
    exists: async p => files.has(p) || directories.has(p), mkdir: async p => directories.add(p),
    readBinary: async p => { if (!files.has(p)) throw new Error('missing'); return files.get(p).buffer; },
  } } };
  const config = { folder: 'Attachments/Visual Board' };
  return { files, directories, config, creates: () => creates, service: new ImageService(app, () => config.folder) };
}

test('local file/paste preserves bytes, resolves data URL, and deduplicates content regardless of filename', async () => {
  const f = fixture(); let requests = 0;
  globalThis.__imageRequest = async () => { requests++; throw new Error('unexpected'); };
  const first = await f.service.import({ name: 'cat.png', base64: png64 });
  const second = await f.service.import({ name: 'other-name.jpg', base64: `data:image/png;base64,${png64}` });
  assert.match(first.path, /^Attachments\/Visual Board\/image-[a-f0-9]{64}\.png$/);
  assert.equal(first.path, second.path); assert.equal(f.creates(), 1); assert.equal(requests, 0);
  assert.equal(first.url, `data:image/png;base64,${png64}`);
  assert.deepEqual(f.files.get(first.path), png);
  assert.equal(first.sourceUrl, undefined);
  assert.ok(f.directories.has('Attachments/Visual Board'));
});

test('HTTPS import captures original image URL and never adds Authorization', async () => {
  const f = fixture(); let requests = 0;
  const sourceUrl = 'https://cdn.example.com/image.png?version=2';
  globalThis.__imageRequest = async options => {
    requests++; assert.equal(options.url, sourceUrl); assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, undefined);
    return { status: 200, arrayBuffer: png.buffer };
  };
  const result = await f.service.import({ name: 'Remote', url: sourceUrl });
  assert.equal(requests, 1); assert.equal(result.sourceUrl, sourceUrl);
  assert.deepEqual(f.files.get(result.path), png);
});

test('GIFs preserve their format and animation data; invalid bytes and SVGs rejected', async () => {
  const f = fixture();
  const result = await f.service.import({ name: 'animation.gif', base64: gif64 });
  assert.ok(result.path.endsWith('.gif')); assert.equal(result.url, `data:image/gif;base64,${gif64}`);
  for (const base64 of [Buffer.from('not an image at all').toString('base64'), `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`, 'malformed&stuff']) {
    await assert.rejects(f.service.import({ name: 'bad', base64 }));
  }
  assert.equal(f.creates(), 1);
});

test('article image snapshot returns only accessible supported local image paths', async () => {
  const f = fixture();
  f.files.set('Notes/assets/picture.PNG', png);
  f.files.set('Notes/document.md', png);
  f.files.set('Notes/assets/corrupt.jpg', Uint8Array.from([1, 2, 3]));
  f.files.set('.obsidian/private.png', png);
  const assets = await f.service.imageAssets(['Notes/assets/picture.PNG', 'Notes/assets/picture.PNG', 'Notes/document.md', 'missing.png', 'Notes/assets/corrupt.jpg', '../outside.png', '.obsidian/private.png', 'https://example.com/a.png']);
  assert.deepEqual(Object.keys(assets), ['Notes/assets/picture.PNG']);
  assert.equal(assets['Notes/assets/picture.PNG'], `data:image/png;base64,${png64}`);
});

test('file URIs, local hosts, endpoint credentials and unsafe vault folders rejected without network', async () => {
  const f = fixture(); let requests = 0;
  globalThis.__imageRequest = async () => { requests++; throw new Error('unexpected'); };
  for (const url of ['http://example.com/a.png', 'file:///tmp/a.png', 'https://localhost/a.png', 'https://127.0.0.1/a.png', 'https://192.168.1.4/a.png', 'https://user:pass@example.com/a.png']) await assert.rejects(f.service.import({ name: 'bad', url }));
  f.config.folder = '../outside';
  await assert.rejects(f.service.import({ name: 'bad', base64: png64 }));
  assert.equal(requests, 0); assert.equal(f.creates(), 0);
});

test('image size limit and provider failures do not save attachments or disclose request details', async () => {
  const f = fixture();
  const oversized = new Uint8Array(20 * 1024 * 1024 + 1); oversized.set(png);
  globalThis.__imageRequest = async () => ({ status: 200, arrayBuffer: oversized.buffer });
  await assert.rejects(f.service.import({ name: 'large', url: 'https://cdn.example.com/a.png' }), /20 MiB/);
  globalThis.__imageRequest = async () => { throw new Error('secret token from provider'); };
  await assert.rejects(f.service.import({ name: 'error', url: 'https://cdn.example.com/a.png' }), error => !error.message.includes('secret token'));
  assert.equal(f.creates(), 0);
});

test('copyable Obsidian URL encodes vault and exact file path including CJK, spaces and hashes', () => {
  const raw = obsidianUrl('我的知识库', '笔记/图片 A #1.png');
  assert.ok(raw.startsWith('obsidian://open?'));
  const url = new URL(raw);
  assert.equal(url.searchParams.get('vault'), '我的知识库');
  assert.equal(url.searchParams.get('file'), '笔记/图片 A #1.png');
});
