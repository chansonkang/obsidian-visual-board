import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// The actual built frame and pure model/folder synchronization; all Vault writes are mocked.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const { buildSync } = require('esbuild');
const source = buildSync({ stdin: { contents: "export {initialLayout,stripEphemeral} from './src/model.ts'; export {syncFolderLayout,findFolderBoard} from './src/folder-layout.ts';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
const module = { exports: {} }; new Function('require', 'module', 'exports', source)(require, module, module.exports);
const { initialLayout, stripEphemeral, syncFolderLayout, findFolderBoard } = module.exports;
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
const cases = [];
try {
  for (const folder of ['', 'Projects/Deep']) for (const snapshotFirst of [false, true]) for (const failReveal of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
    const errors = [], remoteRequests = [], calls = [], files = new Map(), folders = ['Projects', 'Projects/Deep'];
    const existing = path => ({ id: path, path, title: path.split('/').pop().replace(/\.md$/i, ''), body: '# 既有文章\r\n\r\n原文与 [[双向链接]] 必须保持原字节。\r\n', outgoing: [], backlinks: [], mtime: 10 });
    for (const path of ['Root Existing.md', 'Projects/Deep/Existing.md']) files.set(path, existing(path));
    const beforeDocs = clone(Object.fromEntries(files));
    const layout = initialLayout(); syncFolderLayout(layout, folders, [...files.keys()]);
    for (const b of Object.values(layout.boards)) {
      b.nodes.forEach((node, i) => { node.x = i * 380; node.y = 0; if (node.type === 'article') { node.w = 280; node.h = 260; } });
      b.nodes.push({ id: 'unchanged-' + b.id, type: 'note', title: '原有便签', text: '保持位置和内容', color: 'green', x: 280, y: 480, w: 240, h: 280 });
    }
    const target = findFolderBoard(layout, folder); assert.ok(target); layout.currentBoard = target.id;
    const payload = { layout, docs: Object.fromEntries(files), assets: {}, embeds: {}, drafts: [], settings: { defaultIconMode: 'default', attachmentFolder: 'Assets', noteFolder: 'Wrong fallback' }, vaultName: 'Discovery fixture' };
    const title = '新建文章位置验收', expectedPath = (folder ? folder + '/' : '') + title + '.md';
    let frame, rejectReveal = failReveal, pendingReveals = 0;
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:')) remoteRequests.push(request.url()); });
    await page.route('https://**', route => route.abort());
    await page.exposeFunction('discoveryRevealCount', () => calls.filter(call => call.method === 'reveal-entry').length);
    await page.exposeFunction('discoveryNative', async (method, p) => {
      calls.push({ method, payload: clone(p) });
      if (method === 'save-layout') { payload.layout = stripEphemeral(p); return { ok: true }; }
      if (['update-note', 'rename-note', 'move-article'].includes(method)) throw Error('Creating a note must not change an existing article');
      if (method === 'create-note') {
        assert.equal(p.board, target.id); assert.equal(p.title, title);
        const parent = payload.layout.boards[p.board].folderPath;
        const path = (parent ? parent + '/' : '') + p.title + '.md';
        assert.equal(path, expectedPath); assert.equal(files.has(path), false, 'create may happen only once and must not overwrite');
        const doc = { id: path, path, title: p.title, body: '# ' + p.title + '\n\n', outgoing: [], backlinks: [], mtime: 20 };
        files.set(path, doc); payload.docs[path] = doc;
        if (snapshotFirst) {
          syncFolderLayout(payload.layout, folders, [...files.keys()]);
          await page.evaluate(payload => document.getElementById('frame').contentWindow.postMessage({ kind: 'vb-event', channel: 'discovery', type: 'snapshot', payload: { ...payload, preserveView: true } }, '*'), clone(payload));
          await frame.waitForFunction(path => board().nodes.some(node => node.folderManaged && node.doc === path), path);
        }
        return clone(doc);
      }
      if (method === 'reveal-entry') {
        pendingReveals++;
        try { assert.ok(files.has(p.path), 'the article must already exist before file-list discovery'); assert.equal(p.path, expectedPath); if (rejectReveal) throw Error('测试文件列表暂时无法定位'); return { ok: true }; }
        finally { pendingReveals--; }
      }
      return { ok: true };
    });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(({ html, payload }) => {
        const iframe = document.getElementById('frame'); window.discoveryReady = false;
        addEventListener('message', async event => {
          if (event.source !== iframe.contentWindow) return; const m = event.data;
          if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'discovery', payload }, '*'); return; }
          if (m.channel !== 'discovery') return;
          if (m.kind === 'vb-ready') { window.discoveryReady = true; return; }
          if (m.kind !== 'vb-request') return;
          try { const result = await window.discoveryNative(m.method, m.payload); iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'discovery', id: m.id, result }, '*'); }
          catch (error) { iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'discovery', id: m.id, error: String(error.message || error) }, '*'); }
        }); iframe.srcdoc = html;
      }, { html, payload: clone(payload) });
      await page.waitForFunction(() => window.discoveryReady);
      frame = page.frames().find(item => item.parentFrame()); assert.ok(frame);
      await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await frame.evaluate(() => { board().view = { x: -67, y: 29, zoom: .6 }; applyView(); });
      const before = await frame.evaluate(() => ({ current: board().id, view: { ...board().view }, nodes: Object.fromEntries(Object.values(state.boards).map(b => [b.id, b.nodes.map(n => ({ ...n }))])) }));
      await frame.getByTestId('add-article').click();
      await frame.locator('#library-input').fill(title);
      await frame.getByTestId('create-document').click();
      await frame.waitForFunction(path => board().nodes.some(node => node.doc === path), expectedPath);
      await frame.waitForFunction(path => $('toast').textContent.includes('已保存') && $('toast').textContent.includes(path), expectedPath);
      // The existing managed-card branch also has a 70ms debounced selection reveal.
      await page.waitForTimeout(180);
      assert.equal(pendingReveals, 0);
      assert.equal(calls.filter(call => call.method === 'create-note').length, 1);
      assert.ok(calls.some(call => call.method === 'reveal-entry' && call.payload.path === expectedPath));
      const toast = await frame.locator('#toast').textContent();
      assert.ok(toast.includes('已保存') && toast.includes(expectedPath), 'the final success or partial-failure message must retain the real saved path');
      assert.equal(toast.includes('创建失败'), false);
      if (failReveal) assert.ok(toast.includes('文件列表定位失败'), 'a discovery failure must describe the saved file and failed discovery separately');
      const after = await frame.evaluate(() => ({ current: board().id, view: { ...board().view }, nodes: Object.fromEntries(Object.values(state.boards).map(b => [b.id, b.nodes.map(n => ({ ...n }))])) }));
      assert.equal(after.current, before.current); assert.deepEqual(after.view, before.view);
      for (const [id, nodes] of Object.entries(before.nodes)) for (const node of nodes) assert.deepEqual(after.nodes[id].find(item => item.id === node.id), node, 'creation must preserve all earlier geometry/style/content');
      const references = after.nodes[target.id].filter(node => node.doc === expectedPath);
      assert.equal(references.length, 1, 'snapshot-first managed insertion must not add a duplicate card');
      if (snapshotFirst) assert.equal(references[0].folderManaged, true);
      for (const [path, doc] of Object.entries(beforeDocs)) assert.deepEqual(files.get(path), doc);
      assert.equal(calls.some(call => ['update-note', 'rename-note', 'move-article'].includes(call.method)), false);
      if (failReveal) {
        rejectReveal = false;
        const beforeRetry = calls.filter(call => call.method === 'reveal-entry').length;
        await frame.getByTestId('reveal-article-in-explorer').click();
        await page.waitForFunction(async before => await window.discoveryRevealCount() > before, beforeRetry);
        assert.ok(calls.filter(call => call.method === 'reveal-entry').length > beforeRetry);
        assert.equal(calls.filter(call => call.method === 'create-note').length, 1, 'retry discovery must never recreate the article');
      }
      assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
      if (folder && snapshotFirst) await page.screenshot({ path: new URL('create-note-discovery-' + (failReveal ? 'partial-failure' : 'saved') + '.png', evidence).pathname });
      cases.push({ folder, snapshotFirst, failReveal, savedPath: expectedPath, createCount: 1, revealPaths: calls.filter(call => call.method === 'reveal-entry').map(call => call.payload.path), toast, earlierDocsUnchanged: true, viewUnchanged: true, noDuplicateCard: true });
    } catch (error) {
      await page.screenshot({ path: new URL('create-note-discovery-failure.png', evidence).pathname }).catch(() => {});
      await writeFile(new URL('create-note-discovery-failure.json', evidence), JSON.stringify({ error: String(error), folder, snapshotFirst, failReveal, calls, toast: frame ? await frame.locator('#toast').textContent().catch(() => null) : null, errors }, null, 2)); throw error;
    } finally { await page.close(); }
  }
  await writeFile(new URL('create-note-discovery-browser.json', evidence), JSON.stringify({ passed: true, cases, actualBuiltFrame: true, actualModelSanitizer: true, actualFolderSynchronization: true, existingArticlesUnchanged: true, userVaultAccessed: false }, null, 2));
  console.log('Create-note discovery checks passed: ' + cases.length + ' root/nested, new/managed-snapshot and reveal-success/failure paths.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
