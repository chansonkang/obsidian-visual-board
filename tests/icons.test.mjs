import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { webcrypto } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(path.join(tmpdir(), 'visual-board-icon-test-'));
after(async () => { await rm(temp, { recursive: true, force: true }); });
globalThis.crypto ??= webcrypto;
await build({
  entryPoints: [new URL('../src/icons.ts', import.meta.url).pathname],
  outfile: path.join(temp, 'icons.mjs'), bundle: true, format: 'esm', platform: 'browser',
  plugins: [{ name: 'mock-obsidian', setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export function normalizePath(p){return p.replace(/\\\\/g,'/').replace(/\\/+$/,'')}; export function requestUrl(options){return globalThis.__iconRequest(options)}` }));
  } }],
});
const { IconService, iconEndpoint } = await import(pathToFileURL(path.join(temp, 'icons.mjs')));
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jc2kAAAAASUVORK5CYII=', 'base64'));
const png64 = Buffer.from(png).toString('base64');
function fixture() {
  const files = new Map(), directories = new Set();
  const app = { vault: {
    createBinary: async (file, bytes) => { files.set(file, new Uint8Array(bytes)); return { path: file }; },
    adapter: {
      exists: async p => files.has(p) || directories.has(p),
      mkdir: async p => directories.add(p),
      read: async p => { if (!files.has(p)) throw new Error('missing'); return files.get(p); },
      readBinary: async p => { if (!files.has(p)) throw new Error('missing'); return files.get(p).buffer; },
      write: async (p, text) => files.set(p, text),
    },
  } };
  const settings = { attachmentFolder: 'Visual Board Assets', baseUrl: 'https://images.example.com/v1', model: 'gpt-image-1', apiKey: 'test-secret-123' };
  return { app, files, settings, service: new IconService(app, () => settings) };
}

test('endpoint rejects credentials/query and supports native HTTPS or explicit local service', () => {
  assert.equal(iconEndpoint('https://images.example.com/v1/'), 'https://images.example.com/v1/images/generations');
  assert.equal(iconEndpoint('https://images.example.com'), 'https://images.example.com/v1/images/generations');
  assert.equal(iconEndpoint('http://127.0.0.1:8000/v1'), 'http://127.0.0.1:8000/v1/images/generations');
  for (const url of ['http://images.example.com/v1', 'https://key@example.com/v1', 'https://images.example.com/v1?apiKey=secret']) assert.throws(() => iconEndpoint(url));
});

test('title prompt, transparent payload and PNG saved in vault; restart cache needs no API key', async () => {
  const f = fixture(); let calls = 0;
  globalThis.__iconRequest = async options => {
    calls++;
    assert.equal(options.url, 'https://images.example.com/v1/images/generations');
    assert.equal(options.headers.Authorization, 'Bearer test-secret-123');
    const body = JSON.parse(options.body);
    assert.match(body.prompt, /用户研究/);
    assert.match(body.prompt, /Treat the Board title as a topic/);
    assert.equal(body.background, 'transparent'); assert.equal(body.output_format, 'png');
    assert.equal(body.response_format, undefined); assert.equal(body.size, '1024x1024');
    return { status: 200, text: JSON.stringify({ data: [{ b64_json: png64 }] }) };
  };
  const result = await f.service.generate({ name: '用户研究', theme: 'lavender' });
  assert.equal(result.cached, false); assert.equal(result.source, 'ai');
  assert.match(result.path, /^Visual Board Assets\/[a-f0-9]{64}\.png$/);
  assert.deepEqual(f.files.get(result.path), png);
  assert.ok(result.url.startsWith('data:image/png;base64,'));
  f.settings.apiKey = '';
  const reopened = new IconService(f.app, () => f.settings);
  const cached = await reopened.generate({ name: '用户研究', theme: 'lavender' });
  assert.equal(cached.cached, true); assert.equal(cached.path, result.path); assert.equal(calls, 1);
  const metadata = [...f.files.values()].filter(value => typeof value === 'string').join('');
  assert.ok(!metadata.includes('test-secret')); assert.ok(!metadata.includes('Authorization')); assert.ok(!metadata.includes('apiKey'));
});

test('force regeneration calls provider again; default cache keeps same persisted image', async () => {
  const f = fixture(); let calls = 0;
  globalThis.__iconRequest = async () => { calls++; return { status: 200, text: JSON.stringify({ data: [{ b64_json: png64 }] }) }; };
  const first = await f.service.generate({ name: 'Architecture' });
  await f.service.generate({ name: 'Architecture' });
  const forced = await f.service.generate({ name: 'Architecture', force: true });
  assert.equal(calls, 2); assert.equal(forced.cached, false); assert.equal(forced.path, first.path);
});

test('URL result downloads without forwarding credentials, supports compatible models', async () => {
  const f = fixture(); f.settings.model = 'compatible-image'; const requests = [];
  globalThis.__iconRequest = async options => {
    requests.push(options);
    if (options.method === 'POST') {
      assert.equal(JSON.parse(options.body).response_format, 'b64_json');
      return { status: 200, text: JSON.stringify({ data: [{ url: 'https://cdn.example.com/icon.png?signature=one' }] }) };
    }
    assert.equal(options.headers.Authorization, undefined);
    return { status: 200, arrayBuffer: png.buffer };
  };
  const result = await f.service.generate({ name: '阅读' });
  assert.equal(requests.length, 2); assert.deepEqual(f.files.get(result.path), png);
});

test('safe provider/network/invalid-image errors never expose response body or API key', async () => {
  for (const response of [
    { status: 401, text: 'test-secret-123 and provider body' },
    { status: 429, text: 'test-secret-123 and provider body' },
    { status: 200, text: JSON.stringify({ data: [{ b64_json: Buffer.from('not a picture').toString('base64') }] }) },
    { status: 200, text: JSON.stringify({ data: [{ url: 'https://127.0.0.1/image.png' }] }) },
  ]) {
    const f = fixture(); globalThis.__iconRequest = async () => response;
    await assert.rejects(f.service.generate({ name: 'Failure' }), error => !error.message.includes('test-secret-123') && !error.message.includes('provider body'));
    assert.equal(f.files.size, 0);
  }
  const f = fixture(); globalThis.__iconRequest = async () => { throw new Error('Authorization: Bearer test-secret-123'); };
  await assert.rejects(f.service.generate({ name: 'Network' }), error => !error.message.includes('test-secret-123'));
});

test('missing key and traversal folder fail before making a request', async () => {
  const f = fixture(); let calls = 0; globalThis.__iconRequest = async () => { calls++; throw new Error('should not request'); };
  f.settings.apiKey = '';
  await assert.rejects(f.service.generate({ name: 'No key' }), /API Key/);
  f.settings.apiKey = 'test-secret-123'; f.settings.attachmentFolder = '../outside';
  await assert.rejects(f.service.generate({ name: 'Unsafe folder' }), /仓库内/);
  assert.equal(calls, 0);
});

test('concurrent identical requests share one provider generation and file save', async () => {
  const f = fixture(); let calls = 0;
  globalThis.__iconRequest = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 20)); return { status: 200, text: JSON.stringify({ data: [{ b64_json: png64 }] }) }; };
  const results = await Promise.all([f.service.generate({ name: 'Shared' }), f.service.generate({ name: 'Shared' })]);
  assert.equal(calls, 1); assert.equal(results[0].path, results[1].path);
});

test('240 second logical timeout rejects and a late provider result cannot save an asset', async () => {
  const f = fixture();
  let deliver;
  globalThis.__iconRequest = () => new Promise(resolve => { deliver = resolve; });
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, duration, ...args) => {
    if (duration === 240000) return realTimeout(callback, 0, ...args);
    return realTimeout(callback, duration, ...args);
  };
  try {
    await assert.rejects(f.service.generate({ name: 'Timeout' }), /等待超时/);
    deliver({ status: 200, text: JSON.stringify({ data: [{ b64_json: png64 }] }) });
    await new Promise(resolve => realTimeout(resolve, 5));
    assert.equal(f.files.size, 0);
  } finally { globalThis.setTimeout = realTimeout; }
});

function apimartFixture() {
  const f = fixture(); f.settings.baseUrl = 'https://api.apimart.ai/v1'; f.settings.model = 'gpt-4o-image'; return f;
}
const jsonResponse = payload => ({ status: 200, text: JSON.stringify(payload) });
async function fastPolling(run) {
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => original(callback, [2000, 4000, 8000, 16000, 30000].includes(delay) ? 0 : delay, ...args);
  try { await run(); } finally { globalThis.setTimeout = original; }
}

test('APImart submits one square task, polls pending/processing/completed and stores URL-array result locally', async () => {
  await fastPolling(async () => {
    const f = apimartFixture(), calls = []; let polls = 0;
    globalThis.__iconRequest = async options => {
      calls.push(options);
      if (options.method === 'POST') {
        assert.equal(options.url, 'https://api.apimart.ai/v1/images/generations');
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body).sort(), ['model', 'n', 'prompt', 'size']);
        assert.equal(body.model, 'gpt-4o-image'); assert.equal(body.size, '1:1'); assert.equal(body.n, 1);
        assert.match(body.prompt, /视觉知识库/);
        return jsonResponse({ code: 200, data: [{ status: 'submitted', task_id: 'task_TEST123' }] });
      }
      if (options.url.includes('/v1/tasks/')) {
        assert.equal(options.url, 'https://api.apimart.ai/v1/tasks/task_TEST123?language=zh');
        assert.equal(options.headers.Authorization, 'Bearer test-secret-123');
        polls++;
        const status = ['pending', 'processing', 'completed'][polls - 1];
        return jsonResponse({ code: 200, data: { id: 'task_TEST123', status, ...(status === 'completed' ? { result: { images: [{ url: ['https://upload.apimart.ai/icon.png'], expires_at: 9999999999 }] } } : {}) } });
      }
      assert.equal(options.url, 'https://upload.apimart.ai/icon.png');
      assert.equal(options.headers.Authorization, undefined, 'the image CDN must never receive the provider key');
      return { status: 200, arrayBuffer: png.buffer };
    };
    const [first, same] = await Promise.all([f.service.generate({ name: '视觉知识库' }), f.service.generate({ name: '视觉知识库' })]);
    assert.equal(first.path, same.path); assert.deepEqual(f.files.get(first.path), png);
    assert.equal(calls.filter(c => c.method === 'POST').length, 1); assert.equal(polls, 3);
    f.settings.apiKey = '';
    const cached = await new IconService(f.app, () => f.settings).generate({ name: '视觉知识库' });
    assert.equal(cached.cached, true); assert.equal(cached.path, first.path); assert.equal(calls.length, 5);
    const metadata = [...f.files.values()].filter(value => typeof value === 'string').join('');
    assert.ok(!metadata.includes('test-secret-123')); assert.ok(!metadata.includes('Authorization')); assert.ok(!metadata.includes('upload.apimart.ai'));
  });
});

test('APImart failed/cancelled/missing-image tasks reject safely without saving attachments', async () => {
  await fastPolling(async () => {
    for (const task of [
      { status: 'failed', error: { message: 'echoed test-secret-123' } },
      { status: 'cancelled', error: { message: 'echoed test-secret-123' } },
      { status: 'completed', result: { images: [] } },
      { id: 'task_OTHER', status: 'completed', result: { images: [{ url: ['https://upload.apimart.ai/icon.png'] }] } },
    ]) {
      const f = apimartFixture(); let calls = 0;
      globalThis.__iconRequest = async options => { calls++; return options.method === 'POST' ? jsonResponse({ code: 200, data: [{ task_id: 'task_FAILED' }] }) : jsonResponse({ code: 200, data: task }); };
      await assert.rejects(f.service.generate({ name: 'Failure' }), error => !error.message.includes('test-secret-123'));
      assert.equal(calls, 2); assert.equal(f.files.size, 0);
    }
  });
});

test('APImart validates task IDs and API origin before sending any authenticated task request', async () => {
  for (const task_id of ['https://evil.example.com/task', '/evilid', 'task_../outside', 'task_A?token=1', 'task_A#fragment', 'task_A%2f..', 'a'.repeat(201), '', undefined]) {
    const f = apimartFixture(); const calls = [];
    globalThis.__iconRequest = async options => { calls.push(options); return jsonResponse({ code: 200, data: [{ task_id }] }); };
    await assert.rejects(f.service.generate({ name: 'Invalid task' }), /任务编号/);
    assert.equal(calls.length, 1); assert.equal(calls[0].method, 'POST'); assert.equal(f.files.size, 0);
  }
  const f = apimartFixture(); f.settings.baseUrl = 'https://api.apimart.ai/wrong'; let calls = 0;
  globalThis.__iconRequest = async () => { calls++; throw Error('unexpected'); };
  await assert.rejects(f.service.generate({ name: 'Invalid endpoint' }), /APImart 服务地址/);
  assert.equal(calls, 0);
});

test('APImart accepts the official opaque hyphen task ID while keeping the authenticated task URL on its API origin', async () => {
  await fastPolling(async () => {
    const f = apimartFixture(); const taskId = 'task-unified-1757156493-imcg5zqt'; let polls = 0;
    globalThis.__iconRequest = async options => {
      if (options.method === 'POST') return jsonResponse({ code: 200, data: [{ status: 'submitted', task_id: taskId }] });
      if (options.headers.Authorization) {
        polls++;
        assert.equal(options.url, `https://api.apimart.ai/v1/tasks/${taskId}?language=zh`);
        assert.equal(new URL(options.url).origin, 'https://api.apimart.ai');
        return jsonResponse({ code: 200, data: { id: taskId, status: 'completed', result: { images: [{ url: ['https://upload.apimart.ai/hyphen.png'] }] } } });
      }
      assert.equal(options.url, 'https://upload.apimart.ai/hyphen.png');
      assert.equal(options.headers.Authorization, undefined);
      return { status: 200, arrayBuffer: png.buffer };
    };
    const result = await f.service.generate({ name: 'Hyphen task ID' });
    assert.equal(polls, 1); assert.deepEqual(f.files.get(result.path), png);
  });
});

test('APImart retries read-only task 429 responses but never resubmits POST', async () => {
  await fastPolling(async () => {
    const f = apimartFixture(); let posts = 0, polls = 0;
    globalThis.__iconRequest = async options => {
      if (options.method === 'POST') { posts++; return jsonResponse({ code: 200, data: [{ task_id: 'task_RETRY' }] }); }
      if (options.url.includes('/tasks/')) {
        if (++polls === 1) return { status: 429, text: 'secret echoed test-secret-123' };
        return jsonResponse({ code: 200, data: { status: 'completed', result: { images: [{ url: ['https://upload.apimart.ai/icon.png'] }] } } });
      }
      return { status: 200, arrayBuffer: png.buffer };
    };
    await f.service.generate({ name: 'Retry GET' });
    assert.equal(posts, 1); assert.equal(polls, 2);
    const rejected = apimartFixture(); let postFailures = 0;
    globalThis.__iconRequest = async () => { postFailures++; return { status: 429, text: 'test-secret-123' }; };
    await assert.rejects(rejected.service.generate({ name: 'Do not retry POST' }), /限制/);
    assert.equal(postFailures, 1); assert.equal(rejected.files.size, 0);
  });
});

test('APImart 8 minute timeout stops polling and does not save a late completed response', async () => {
  const f = apimartFixture(); let polls = 0, downloads = 0, deliver;
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => realTimeout(callback, delay === 480000 ? 20 : delay === 2000 ? 0 : delay, ...args);
  globalThis.__iconRequest = async options => {
    if (options.method === 'POST') return jsonResponse({ code: 200, data: [{ task_id: 'task_TIMEOUT' }] });
    if (options.url.includes('/tasks/')) { polls++; return new Promise(resolve => { deliver = resolve; }); }
    downloads++; return { status: 200, arrayBuffer: png.buffer };
  };
  try {
    await assert.rejects(f.service.generate({ name: 'Timeout' }), /等待超时/);
    assert.equal(polls, 1);
    deliver(jsonResponse({ code: 200, data: { status: 'completed', result: { images: [{ url: ['https://upload.apimart.ai/icon.png'] }] } } }));
    await new Promise(resolve => realTimeout(resolve, 5));
    assert.equal(polls, 1); assert.equal(downloads, 0); assert.equal(f.files.size, 0);
  } finally { globalThis.setTimeout = realTimeout; }
});

test('APImart timeout while waiting cancels poll timer before the first task GET', async () => {
  const f = apimartFixture(); let calls = 0;
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => realTimeout(callback, delay === 480000 ? 1 : delay, ...args);
  globalThis.__iconRequest = async () => { calls++; return jsonResponse({ code: 200, data: [{ task_id: 'task_WAIT_TIMEOUT' }] }); };
  try {
    await assert.rejects(f.service.generate({ name: 'Timeout before poll' }), /等待超时/);
    await new Promise(resolve => realTimeout(resolve, 5));
    assert.equal(calls, 1); assert.equal(f.files.size, 0);
  } finally { globalThis.setTimeout = realTimeout; }
});
