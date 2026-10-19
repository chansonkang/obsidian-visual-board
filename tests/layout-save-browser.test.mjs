import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { diskFixture, lifecycle, primary } from './layout-host-harness.mjs';

// Opt-in: this test uses real Chromium and the built frame, with the real host
// operating exclusively on an in-memory Vault. No installed Obsidian data is read.
const enabled = Boolean(process.env.PLAYWRIGHT_CORE_PATH);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function harness() {
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE_PATH);
  const disk = diskFixture();
  const initial = JSON.parse(disk.files.get(primary));
  initial.layout.boards.research.nodes = initial.layout.boards.research.nodes.filter(n => ['article-a', 'article-b', 'sticky'].includes(n.id));
  Object.assign(initial.layout.boards.research.nodes.find(n => n.id === 'sticky'), { x: 40, y: 80 });
  initial.layout.boards.research.view = { x: 0, y: 0, zoom: 1 };
  disk.files.set(primary, JSON.stringify(initial));
  const host = await lifecycle(disk); assert.equal(host.failure, undefined);
  const brokers = [host.createFrame(), host.createFrame()];
  const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html><body style="margin:0"><iframe id="f0" style="width:49vw;height:96vh" sandbox="allow-scripts allow-modals allow-downloads"></iframe><iframe id="f1" style="width:49vw;height:96vh" sandbox="allow-scripts allow-modals allow-downloads"></iframe></body></html>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
  const page = await browser.newPage({ viewport: { width: 2200, height: 1000 } });
  const controls = { gate: null, fail: false, saves: [] }, errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('https://**', route => route.abort());
  await page.exposeFunction('layoutRPC', async (index, method, payload) => {
    if (method === 'save-layout') {
      controls.saves.push({ index, payload });
      if (controls.gate?.index === index) { const gate = controls.gate; controls.gate = null; gate.started.resolve(); await gate.release.promise; }
      if (controls.fail) throw Error('Isolated save unavailable');
    }
    return brokers[index].rpc(method, payload);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const snapshot = await host.rpc('snapshot', {});
  await page.evaluate(({ html, snapshot }) => {
    window.layoutFramesReady = [false, false];
    const frames = [document.getElementById('f0'), document.getElementById('f1')];
    addEventListener('message', async event => {
      const index = frames.findIndex(frame => frame.contentWindow === event.source); if (index < 0) return;
      const m = event.data, channel = 'layout-browser-' + index, frame = frames[index];
      if (m.kind === 'vb-boot') { frame.contentWindow.postMessage({ kind: 'vb-init', channel, payload: snapshot }, '*'); return; }
      if (m.channel !== channel) return;
      if (m.kind === 'vb-ready') { window.layoutFramesReady[index] = true; return; }
      if (m.kind !== 'vb-request') return;
      let result, error; try { result = await window.layoutRPC(index, m.method, m.payload); } catch (e) { error = e.message; }
      frame.contentWindow.postMessage({ kind: 'vb-response', channel, id: m.id, result, error }, '*');
    });
    for (const frame of frames) frame.srcdoc = html;
  }, { html, snapshot });
  await page.waitForFunction(() => window.layoutFramesReady.every(Boolean));
  const frames = await Promise.all([0, 1].map(async i => (await page.locator('#f' + i).elementHandle()).contentFrame()));
  await Promise.all(frames.map(frame => frame.waitForFunction(() => !!window.VBSticky && !!window.VBHost.flushLayout)));
  await Promise.all(frames.map(frame => frame.evaluate(() => VBHost.flushLayout())));
  async function sendSnapshot(index, incoming) {
    await page.evaluate(({ index, incoming }) => document.getElementById('f' + index).contentWindow.postMessage({ kind: 'vb-event', channel: 'layout-browser-' + index, type: 'snapshot', payload: { ...incoming, preserveView: true } }, '*'), { index, incoming });
    // Delivery and the frame's asynchronous merge have separate turns.
    await frames[index].evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await frames[index].evaluate(() => VBHost.flushLayout());
  }
  return { disk, host, page, frames, controls, errors, sendSnapshot,
    async close() { host.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}
const node = (layout, id) => layout.boards.research.nodes.find(n => n.id === id);

test('real frames preserve sticky edits and arrangement through reordered saves, pending typing and conflicting snapshots', { skip: !enabled, timeout: 60000 }, async () => {
  const h = await harness(), [a, b] = h.frames;
  try {
    await a.evaluate(() => { state.boards.research.nodes.push({ id: 'new-sticky', type: 'note', title: 'New sticky', text: 'Keep across stale saves', x: 1000, y: 500, w: 280, h: 300, color: 'blue' }); });
    await b.evaluate(() => { state.boards.research.nodes.find(n => n.id === 'article-a').x = 2220; });
    await b.evaluate(() => save()); await a.evaluate(() => save());
    let stored = JSON.parse(h.disk.files.get(primary)).layout;
    assert.equal(node(stored, 'new-sticky').text, 'Keep across stale saves');
    assert.equal(node(stored, 'article-a').x, 2220);

    const gate = { index: 0, started: deferred(), release: deferred() }; h.controls.gate = gate;
    await a.evaluate(() => {
      const el = document.querySelector('[data-sticky-node="sticky"][data-sticky-field="text"]');
      el.focus(); el.textContent = 'First edit'; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      window.pendingSave = VBSticky.flush().then(() => 'saved', e => e.message);
    });
    await gate.started.promise;
    await a.evaluate(() => {
      const el = document.querySelector('[data-sticky-node="sticky"][data-sticky-field="text"]');
      el.textContent = 'Typed while saving'; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      window.followingSave = VBSticky.flush().then(() => 'saved', e => e.message);
    });
    gate.release.resolve();
    assert.deepEqual(await a.evaluate(async () => [await window.pendingSave, await window.followingSave]), ['saved', 'saved']);
    stored = JSON.parse(h.disk.files.get(primary)).layout;
    assert.equal(node(stored, 'sticky').text, 'Typed while saving');
    assert.equal(node(stored, 'article-a').x, 2220);

    const oldSnapshot = await h.host.rpc('snapshot', {});
    await h.sendSnapshot(1, oldSnapshot);
    await a.evaluate(() => { state.boards.research.nodes.find(n => n.id === 'sticky').color = 'purple'; });
    await a.evaluate(() => save());
    await a.evaluate(() => {
      const el = document.querySelector('[data-sticky-node="sticky"][data-sticky-field="text"]');
      el.textContent = 'Unsaved latest draft'; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    await h.sendSnapshot(0, oldSnapshot);
    assert.equal(await a.evaluate(() => state.boards.research.nodes.find(n => n.id === 'sticky').text), 'Unsaved latest draft');
    assert.equal(await a.evaluate(() => state.boards.research.nodes.find(n => n.id === 'sticky').color), 'purple');
    await a.evaluate(() => VBSticky.flush());

    await b.evaluate(() => { state.boards.research.nodes.find(n => n.id === 'sticky').color = 'yellow'; });
    await b.evaluate(() => save());
    stored = JSON.parse(h.disk.files.get(primary)).layout;
    assert.equal(node(stored, 'sticky').color, 'purple', 'saved current value wins conflicting stale color change');
    const conflicts = [...h.disk.files].filter(([path]) => path.includes('/conflicts/')).map(([, text]) => JSON.parse(text));
    assert.ok(conflicts.some(item => node(item.layout, 'sticky')?.color === 'yellow'), 'losing edit has a durable recoverable copy');
    assert.equal(node(stored, 'sticky').text, 'Unsaved latest draft');
    assert.equal(node(stored, 'new-sticky').text, 'Keep across stale saves');

    const beforeFailure = h.disk.files.get(primary); h.controls.fail = true;
    const failure = await a.evaluate(async () => { state.boards.research.nodes.find(n => n.id === 'article-a').x = 4440; try { await save(); return null; } catch (e) { return e.message; } });
    assert.match(failure, /Isolated save unavailable/);
    assert.equal(h.disk.files.get(primary), beforeFailure, 'a failed RPC must not be represented as saved data');
    assert.equal(await a.evaluate(() => state.boards.research.nodes.find(n => n.id === 'article-a').x), 4440);
    h.controls.fail = false; await a.evaluate(() => save());
    assert.equal(node(JSON.parse(h.disk.files.get(primary)).layout, 'article-a').x, 4440);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
