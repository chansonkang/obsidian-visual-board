import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// Optional actual-frame UI regression; build first and install playwright-core/Chrome.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
const original = 'A/Original.md';
const mkdoc = (path, body, outgoing = [], backlinks = []) => ({ id: path, path, title: path.split('/').pop().replace(/\.md$/i, ''), body, outgoing, backlinks, mtime: 1 });
const docs = {
  [original]: mkdoc(original, '# Original\n\nLocal body and attachment.\n\n![[Assets/local.png]]', ['B/Other.md'], ['B/Other.md']),
  'B/Other.md': mkdoc('B/Other.md', '# Other\n\n[[Original]]', [original], [original]),
  'A/Collision.md': mkdoc('A/Collision.md', '# Existing conflicting file'),
};
const board = (id, parent, nodes) => ({ id, title: id === 'home' ? '标题编辑验收' : '嵌套重复引用', parent, iconMode: 'default', theme: 'research', view: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] });
const node = (id, x, y = 0) => ({ id, type: 'article', doc: original, x, y, w: 340, h: 360 });
const payload = { layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: { home: board('home', null, [node('first', 100), node('copy', 500), { id: 'other', type: 'article', doc: 'B/Other.md', x: 900, y: 0, w: 280, h: 260 }]), nested: board('nested', 'home', [node('deep-copy', 1000, -1500)]) } }, docs, assets: { 'Assets/local.png': png }, embeds: { [original]: [{ path: 'Assets/local.png', link: 'Assets/local.png' }] }, drafts: [], settings: { defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'Title fixture' };
const positions = Object.fromEntries(Object.entries(payload.layout.boards).map(([id, b]) => [id, b.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }))]));
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(({ html, payload }) => {
    const iframe = document.getElementById('frame');
    window.titleHost = { ready: false, payload, calls: [], layouts: [], clipboard: null, holdRename: false, holdUpdate: false, held: [] };
    window.titleSnapshot = () => iframe.contentWindow.postMessage({ kind: 'vb-event', channel: 'title-channel', type: 'snapshot', payload: { ...payload, layout: undefined } }, '*');
    const respond = (m, result, error) => iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'title-channel', id: m.id, result, error }, '*');
    function handle(m) {
      const p = m.payload; let result = { ok: true }, error;
      if (m.method === 'save-layout') { payload.layout = p; window.titleHost.layouts.push(p); }
      else if (m.method === 'copy-link') { window.titleHost.clipboard = p; result = { url: 'obsidian://open?file=' + encodeURIComponent(p.path) }; }
      else if (m.method === 'update-note') {
        const d = payload.docs[p.path];
        if (!d) result = { ok: false, reason: 'missing' };
        else if (d.body !== p.expectedBody) result = { ok: false, reason: 'conflict', current: d.body };
        else { d.body = p.body; d.mtime++; result = { ok: true, doc: d }; }
      } else if (m.method === 'rename-note') {
        const d = payload.docs[p.path], title = p.title.trim(), next = p.path.slice(0, p.path.lastIndexOf('/') + 1) + title + '.md';
        if (!d) error = '原文不存在';
        else if (next !== p.path && payload.docs[next]) error = '同名文章已存在，请换一个标题';
        else {
          delete payload.docs[p.path]; result = { ...d, id: next, path: next, title, mtime: d.mtime + 1 }; payload.docs[next] = result;
          for (const doc of Object.values(payload.docs)) { doc.outgoing = doc.outgoing.map(path => path === p.path ? next : path); doc.backlinks = doc.backlinks.map(path => path === p.path ? next : path); }
          if (payload.embeds[p.path]) { payload.embeds[next] = payload.embeds[p.path]; delete payload.embeds[p.path]; }
          for (const b of Object.values(payload.layout.boards)) for (const n of b.nodes) if (n.doc === p.path) n.doc = next;
        }
      }
      respond(m, result, error);
    }
    window.titleRelease = method => { const held = window.titleHost.held.filter(m => m.method === method); window.titleHost.held = window.titleHost.held.filter(m => m.method !== method); if (method === 'rename-note') window.titleHost.holdRename = false; if (method === 'update-note') window.titleHost.holdUpdate = false; held.forEach(handle); };
    addEventListener('message', e => {
      if (e.source !== iframe.contentWindow) return;
      const m = e.data;
      if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'title-channel', payload }, '*'); return; }
      if (m.channel !== 'title-channel') return;
      if (m.kind === 'vb-ready') { window.titleHost.ready = true; return; }
      if (m.kind !== 'vb-request') return;
      window.titleHost.calls.push({ method: m.method, payload: m.payload });
      if (m.method === 'rename-note' && window.titleHost.holdRename || m.method === 'update-note' && window.titleHost.holdUpdate) window.titleHost.held.push(m);
      else handle(m);
    });
    iframe.srcdoc = html;
  }, { html, payload });
  await page.waitForFunction(() => window.titleHost.ready);
  const frame = page.frames().find(f => f.parentFrame()); assert.ok(frame);
  const title = frame.locator('[data-node="first"] .vb-inline-title');
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
  const checks = [];
  await title.click();
  assert.equal(await title.getAttribute('contenteditable'), 'plaintext-only');
  assert.equal(await title.evaluate(el => document.activeElement === el), true);
  assert.deepEqual(await frame.evaluate(() => Object.fromEntries(Object.entries(state.boards).map(([id, b]) => [id, b.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }))]))), positions);
  checks.push('single click focuses title without moving cards');
  // Hold the real RPC contract to exercise a snapshot while rename is pending.
  await page.evaluate(() => { window.titleHost.holdRename = true; });
  await title.fill('中文标题'); await title.press('Enter');
  await page.waitForFunction(() => window.titleHost.held.some(m => m.method === 'rename-note'));
  await title.evaluate(el => { el.__titleIdentity = 'pending-title'; });
  await page.evaluate(() => window.titleSnapshot());
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await title.textContent(), '中文标题');
  assert.equal(await title.evaluate(el => el.__titleIdentity === 'pending-title' && document.activeElement === el), true);
  await page.evaluate(() => window.titleRelease('rename-note'));
  let currentPath = 'A/中文标题.md';
  await frame.waitForFunction(path => state.boards.home.nodes.find(n => n.id === 'first').doc === path, currentPath);
  assert.equal(await frame.locator('[data-node="copy"] .vb-inline-title').textContent(), '中文标题');
  assert.equal(await frame.evaluate(() => state.boards.nested.nodes[0].doc), currentPath);
  assert.equal(await frame.evaluate(path => state.docs[path].path, currentPath), currentPath);
  assert.equal(await frame.evaluate(() => state.docs['A/Original.md']), undefined);
  assert.deepEqual(await frame.evaluate(() => state.docs['B/Other.md'].outgoing), [currentPath]);
  assert.deepEqual(await frame.evaluate(() => state.docs['B/Other.md'].backlinks), [currentPath]);
  assert.equal(await frame.locator('[data-node="first"] .vb-inline-editor .vb-article-image img').count(), 1);
  assert.match(await frame.locator('[data-node="copy"] .source').textContent(), /A\/中文标题\.md/);
  await frame.getByTestId('copy-selected-url').click();
  await page.waitForFunction(path => window.titleHost.clipboard?.path === path, currentPath);
  checks.push('Chinese Enter rename survives pending snapshot and synchronizes documents, all Board copies, links, attachments, source paths and copied URL');
  // A real focus change commits; Escape restores the saved title without an RPC.
  await title.click(); await title.fill('失焦保存'); await frame.locator('#canvas').click({ position: { x: 1400, y: 30 } });
  currentPath = 'A/失焦保存.md';
  await frame.waitForFunction(path => state.boards.home.nodes.find(n => n.id === 'first').doc === path, currentPath);
  const countBeforeEscape = await page.evaluate(() => window.titleHost.calls.filter(c => c.method === 'rename-note').length);
  await title.click(); await title.fill('取消的标题'); await title.press('Escape');
  assert.equal(await title.textContent(), '失焦保存');
  assert.equal(await page.evaluate(() => window.titleHost.calls.filter(c => c.method === 'rename-note').length), countBeforeEscape);
  checks.push('blur saves and Escape cancels without renaming');
  // A host failure keeps the exact input and can be corrected in the same title field.
  await title.click(); await title.fill('Collision'); await title.press('Enter');
  await frame.waitForFunction(() => document.querySelector('[data-node="first"] .vb-inline-title')?.getAttribute('aria-invalid') === 'true');
  assert.equal(await title.textContent(), 'Collision');
  assert.match(await frame.locator('[data-node="first"] .vb-title-status').textContent(), /同名文章/);
  assert.equal(await frame.evaluate(() => state.boards.home.nodes.find(n => n.id === 'first').doc), currentPath);
  await page.screenshot({ path: new URL('title-inline-conflict.png', evidence).pathname });
  await title.fill('重试成功'); await title.press('Enter');
  currentPath = 'A/重试成功.md';
  await frame.waitForFunction(path => state.boards.home.nodes.find(n => n.id === 'first').doc === path, currentPath);
  checks.push('duplicate filename error preserves input and permits retry');
  // Simulated IME composition lifecycle: snapshots may render, but must retain the DOM/input/focus.
  await title.click(); await title.dispatchEvent('compositionstart', { data: '' });
  await title.fill('输入法完整名称');
  await title.evaluate(el => { el.__titleIdentity = 'ime-title'; });
  const countBeforeIME = await page.evaluate(() => window.titleHost.calls.filter(c => c.method === 'rename-note').length);
  await title.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229, bubbles: true, cancelable: true });
  await page.evaluate(() => window.titleSnapshot());
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await title.textContent(), '输入法完整名称');
  assert.equal(await title.evaluate(el => el.__titleIdentity === 'ime-title' && document.activeElement === el), true);
  assert.equal(await page.evaluate(() => window.titleHost.calls.filter(c => c.method === 'rename-note').length), countBeforeIME);
  await title.dispatchEvent('compositionend', { data: '输入法完整名称' }); await title.press('Enter');
  currentPath = 'A/输入法完整名称.md';
  await frame.waitForFunction(path => state.boards.home.nodes.find(n => n.id === 'first').doc === path, currentPath);
  checks.push('IME Enter does not submit; composition survives snapshot and commits on normal Enter');
  // Body saves are held until released: renaming must wait for the actual dirty-body acknowledgement.
  await page.evaluate(() => { window.titleHost.holdUpdate = true; });
  const body = frame.locator('[data-node="first"] .vb-inline-editor');
  await body.click(); await body.fill('# Body draft\n\nDraft must be committed before rename.\n\n![[Assets/local.png]]');
  const sequenceStart = await page.evaluate(() => window.titleHost.calls.length);
  await title.click(); await title.fill('正文保存后更名'); await title.press('Enter');
  await page.waitForFunction(() => window.titleHost.held.some(m => m.method === 'update-note'));
  assert.equal(await page.evaluate(start => window.titleHost.calls.slice(start).some(c => c.method === 'rename-note'), sequenceStart), false, 'rename must await pending body save');
  await page.evaluate(() => window.titleRelease('update-note'));
  currentPath = 'A/正文保存后更名.md';
  await frame.waitForFunction(path => state.boards.home.nodes.find(n => n.id === 'first').doc === path, currentPath);
  const orderedCalls = await page.evaluate(start => window.titleHost.calls.slice(start).map(c => ({ method: c.method, path: c.payload.path })), sequenceStart);
  assert.ok(orderedCalls.findIndex(c => c.method === 'update-note') < orderedCalls.findIndex(c => c.method === 'rename-note'));
  assert.match(await frame.evaluate(path => state.docs[path].body, currentPath), /Draft must be committed/);
  await body.click(); await body.fill('# Body after rename\n\nNew path receives all later edits.\n\n![[Assets/local.png]]');
  await frame.evaluate(() => VBInline.flushAll()); await body.blur();
  await page.waitForFunction(path => window.titleHost.calls.some(c => c.method === 'update-note' && c.payload.path === path), currentPath);
  await page.evaluate(() => window.titleSnapshot());
  assert.match(await frame.locator('[data-node="copy"] .vb-inline-editor').textContent(), /New path receives all later edits/);
  assert.equal(await body.getAttribute('data-inline-path'), currentPath);
  checks.push('dirty body flush precedes rename; subsequent body drafts, peers and snapshot use the new file path');
  const finalPositions = await frame.evaluate(() => Object.fromEntries(Object.entries(state.boards).map(([id, b]) => [id, b.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }))])));
  assert.deepEqual(finalPositions, positions);
  await frame.getByTestId('copy-selected-url').click();
  await page.waitForFunction(path => window.titleHost.clipboard?.path === path, currentPath);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: new URL('title-inline-browser.png', evidence).pathname });
  await writeFile(new URL('title-inline-browser.json', evidence), JSON.stringify({ passed: true, checks, finalPath: currentPath, positionsPreserved: true, orderedBodyRenameCalls: orderedCalls, pageErrors: errors, chromeArgs: ['--disable-site-isolation-trials'], imeVerification: 'DOM CompositionEvent lifecycle in Chrome; native IME verification is separate' }, null, 2));
  console.log('Inline title checks passed: ' + checks.join('; ') + '.');
} finally { await browser.close(); server.close(); }
