import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const compiled = require('esbuild').buildSync({ entryPoints: [new URL('../src/model.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
const model = { exports: {} }; new Function('require', 'module', 'exports', compiled)(require, model, model.exports);
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const base = { x: 100, y: 80, w: 260, h: 240 };
const payload = { layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: {
 home: { id: 'home', title: '拖拽连线验收', parent: null, theme: 'research', iconMode: 'default', view: { x: 40, y: -30, zoom: .8 }, nodes: [
  { id: 'note', type: 'note', title: '便签', text: '便签内容保持', color: 'yellow', ...base },
  { id: 'target', type: 'note', title: '目标便签', text: '目标内容保持', color: 'pink', ...base, x: 660 },
  { id: 'article', type: 'article', doc: 'A.md', ...base }, { id: 'linked', type: 'article', doc: 'B.md', ...base },
  { id: 'photo', type: 'photo', title: '图片', imagePath: 'Images/a.png', ...base },
  { id: 'pdf', type: 'pdf', title: 'PDF', filePath: 'Media/a.pdf', ...base, h: 340 },
  { id: 'audio', type: 'audio', title: '音频', filePath: 'Media/a.wav', ...base, h: 340 },
  { id: 'folder', type: 'board', board: 'child', ...base, w: 300, h: 303 },
 ], edges: [] },
 child: { id: 'child', title: '子画板', parent: 'home', theme: 'research', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes: [{ id: 'child-a', type: 'article', doc: 'A.md', ...base }, { id: 'child-b', type: 'article', doc: 'B.md', ...base, x: 680 }], edges: [] },
} }, docs: {
 'A.md': { path: 'A.md', title: 'A', body: '# A\n\n[[B]] 保持原文', outgoing: ['B.md'], backlinks: [], mtime: 1 },
 'B.md': { path: 'B.md', title: 'B', body: '# B\n\n保持原文 B', outgoing: [], backlinks: ['A.md'], mtime: 1 },
}, assets: { 'Images/a.png': image }, embeds: {}, drafts: [], mediaAssets: {}, settings: { defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'Connections Fixture' };
const docsBefore = structuredClone(payload.docs), errors = [], requests = [], calls = [], checks = {};
const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="height:100%;margin:0;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="width:100%;height:100%;border:0;display:block"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials', '--mute-audio'] });
let page, frame;
try {
 async function initialize() {
  page = await browser.newPage({ viewport: { width: 1536, height: 1024 } }); page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (/^https:\/\//.test(r.url())) requests.push(r.url()); }); await page.route('https://**', r => r.abort());
  await page.exposeFunction('connectionPayload', () => payload);
  await page.exposeFunction('connectionRPC', (method, p) => { calls.push({ method, payload: p });
   if (method === 'save-layout') { payload.layout = model.exports.stripEphemeral(p); return { ok: true }; }
   if (method === 'media-assets') return {};
   if (['update-note', 'rename-note', 'move-article'].includes(method)) throw Error('Connections cannot modify Vault text'); return { ok: true };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(html => { const iframe = document.getElementById('frame'); window.connectionReady = false;
   addEventListener('message', async event => { if (event.source !== iframe.contentWindow) return; const m = event.data;
    if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'connection-channel', payload: await window.connectionPayload() }, '*'); return; }
    if (m.channel !== 'connection-channel') return; if (m.kind === 'vb-ready') { window.connectionReady = true; return; } if (m.kind !== 'vb-request') return;
    try { const result = await window.connectionRPC(m.method, m.payload); iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'connection-channel', id: m.id, result }, '*'); }
    catch (e) { iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'connection-channel', id: m.id, error: String(e.message || e) }, '*'); }
   }); iframe.srcdoc = html;
  }, html); await page.waitForFunction(() => window.connectionReady); frame = page.frames().find(f => f.parentFrame());
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
 }
 const card = id => frame.locator('#nodes>.node[data-node="' + id + '"]');
 const geometry = () => frame.evaluate(() => ({ view: { ...board().view }, nodes: board().nodes.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })) }));
 const edges = () => frame.evaluate(() => board().edges.map(e => ({ ...e })));
 async function arrange(from = 'note', to = 'target', zoom = .8) {
  await frame.evaluate(({ from, to, zoom }) => { board().view = { x: 40, y: -30, zoom }; for (const n of board().nodes) { n.x = n.id === from ? 120 : n.id === to ? 680 : 5000; n.y = n.id === from || n.id === to ? 100 : 5000; } render(); }, { from, to, zoom });
  await frame.getByTestId('select-' + from).click();
  const handle = await frame.getByTestId('connect-handle-' + from).boundingBox(); assert.ok(handle);
  assert.equal(await frame.locator('[data-connect-node]').count(), 1);
 }
 async function start(from, to) {
  const button = await frame.getByTestId('connect-handle-' + from).boundingBox(), target = await card(to).boundingBox(); assert.ok(button && target);
  const x = button.x + button.width / 2, y = button.y + button.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(target.x + target.width / 2, target.y + Math.min(80, target.height / 2), { steps: 9 });
  assert.equal(await frame.evaluate(() => VBConnections.dragging), true); assert.equal(await card(to).evaluate(el => el.classList.contains('vb-connection-target')), true);
  assert.equal(await frame.locator('.vb-connection-preview').isVisible(), true);
 }
 await initialize();
 await arrange(); const before = await geometry();
 await start('note', 'target'); await page.screenshot({ path: new URL('connections-drag-preview.png', evidence).pathname }); await page.mouse.up();
 assert.deepEqual(await geometry(), before); assert.deepEqual(await edges(), [{ from: 'note', to: 'target' }]);
 assert.equal(await frame.evaluate(() => VBConnections.dragging), false); assert.equal(await frame.getByTestId('edge-style-panel').isVisible(), true);
 checks.noteCircleDragPreviewsHighlightsAndCreatesWithoutMovingAnything = true;
 await frame.getByTestId('edge-style-delete').click(); assert.deepEqual(await edges(), []); await frame.evaluate(() => save()); assert.deepEqual(payload.layout.boards.home.edges, []);
 checks.rightDetailsDeleteReallyRemovesManualRelation = true;

 const results = [];
 for (const from of ['article', 'photo', 'pdf', 'audio', 'folder', 'note']) {
  const zoom = from === 'photo' ? .5 : from === 'folder' ? 1.3 : .8;
  await arrange(from, 'target', zoom); const original = await geometry();
  await frame.evaluate(() => { window.preservedEditors = [...document.querySelectorAll('.vb-inline-editor,.vb-media-body')]; });
  await start(from, 'target'); await page.mouse.up(); await frame.evaluate(() => save());
  assert.deepEqual(await geometry(), original); assert.ok((await edges()).some(e => e.from === from && e.to === 'target'));
  assert.equal(await frame.evaluate(() => window.preservedEditors.every(el => el.isConnected)), true, 'drawing connections must preserve editor and media DOM');
  assert.equal(await frame.getByTestId('edge-line-space-' + from + '-target').count(), 1);
  results.push({ type: from, zoom, edge: { from, to: 'target' } });
 }
 checks.allComponentTypesConnectAtZoomAndPanWithoutRebuildingEditors = results;
 const validEdges = await edges(); await arrange('target', 'note'); const original = await geometry();
 await start('target', 'note'); await page.mouse.up(); assert.deepEqual(await edges(), validEdges); assert.deepEqual(await geometry(), original);
 checks.reverseDuplicateUsesExistingRelation = true;

 await arrange(); const originalCount = (await edges()).length;
 const handle = await frame.getByTestId('connect-handle-note').boundingBox();
 await page.mouse.click(handle.x + handle.width / 2, handle.y + handle.height / 2); assert.equal((await edges()).length, originalCount); assert.equal(await frame.evaluate(() => VBConnections.dragging), false);
 await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 + 4, handle.y + handle.height / 2);
 assert.equal(await frame.locator('.vb-connection-preview').isVisible(), false); await page.mouse.up(); assert.equal((await edges()).length, originalCount);
 await start('note', 'target'); await page.keyboard.press('Escape'); await page.mouse.up(); assert.equal((await edges()).length, originalCount);
 assert.equal(await frame.locator('.vb-connection-target').count(), 0); assert.equal(await frame.locator('.vb-connection-preview').isVisible(), false);
 await frame.evaluate(() => addEventListener('pointerdown', e => { window.testConnectionPointer = e.pointerId; }, { once: true, capture: true }));
 await arrange(); await start('note', 'target');
 await frame.evaluate(() => $('connection-controls').dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.testConnectionPointer, bubbles: true })));
 await page.mouse.up(); assert.equal(await frame.evaluate(() => VBConnections.dragging), false); assert.equal((await edges()).length, originalCount);
 assert.equal(await frame.locator('.vb-connection-target').count(), 0);
 await arrange(); const source = await card('note').boundingBox(), button = await frame.getByTestId('connect-handle-note').boundingBox();
 await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2); await page.mouse.down(); await page.mouse.move(source.x + 80, source.y + 60, { steps: 7 }); await page.mouse.up(); assert.equal((await edges()).length, originalCount);
 await arrange(); const blankButton = await frame.getByTestId('connect-handle-note').boundingBox();
 await page.mouse.move(blankButton.x + 14, blankButton.y + 14); await page.mouse.down(); await page.mouse.move(1100, 700, { steps: 9 }); await page.mouse.up(); assert.equal((await edges()).length, originalCount);
 checks.clickThresholdEscapePointerCancelSelfAndBlankNeverCreateRelations = true;
 await arrange(); const blankState = await geometry();
 await frame.evaluate(() => { $('preview').innerHTML = '<aside>原文章预览</aside>'; });
 await page.mouse.click(1100, 700);
 assert.equal(await frame.evaluate(() => selected), null); assert.equal(await frame.evaluate(() => $('preview').childElementCount), 0);
 assert.equal(await frame.locator('[data-connect-node]').count(), 0); assert.deepEqual(await geometry(), blankState);
 checks.blankClickClearsNodeAndPreviousArticlePreviewWithoutChangingView = true;
 await arrange(); await frame.getByTestId('connect-mode').click(); assert.equal(await frame.evaluate(() => mode), 'select'); assert.equal(await frame.getByTestId('connect-handle-note').count(), 1);
 checks.toolbarConnectionEntryUsesCircleDragAndKeepsSelectMode = true;

 await arrange('article', 'linked');
 assert.equal(await frame.getByTestId('edge-line-knowledge-article-linked').count(), 1);
 await frame.evaluate(() => { $('preview').innerHTML = '<aside data-testid="previous-article-preview">原文章预览</aside>'; });
 await frame.evaluate(() => VBEdgeStyle.selectEdge({ kind: 'knowledge', from: 'article', to: 'linked' }));
 assert.equal(await frame.getByTestId('previous-article-preview').count(), 0);
 assert.equal(await frame.getByTestId('edge-style-delete').innerText(), '在此画板隐藏'); assert.ok((await frame.getByTestId('edge-style-panel').innerText()).includes('原文双向链接保留'));
 await frame.getByTestId('edge-style-dashed').click(); await frame.getByTestId('edge-style-width').press('End');
 await frame.getByTestId('edge-style-delete').click(); await frame.evaluate(() => save());
 assert.equal(await frame.getByTestId('edge-line-knowledge-article-linked').count(), 0); assert.equal(await frame.getByTestId('restore-knowledge-edges').isVisible(), true);
 assert.deepEqual(payload.docs, docsBefore); assert.equal(payload.layout.boards.home.knowledgeEdgeStyles[0].hidden, true);
 const hiddenSaved = structuredClone(payload.layout.boards.home.knowledgeEdgeStyles);
 await frame.evaluate(() => navigate('child')); assert.equal(await frame.getByTestId('edge-line-knowledge-child-a-child-b').count(), 1);
 await frame.getByTestId('crumb-home').click(); assert.equal(await frame.getByTestId('edge-line-knowledge-article-linked').count(), 0);
 checks.knowledgeHiddenOnlyInCurrentBoard = true;
 await page.screenshot({ path: new URL('connections-hidden-knowledge.png', evidence).pathname });
 await page.close(); await initialize();
 assert.equal(await frame.getByTestId('edge-line-knowledge-article-linked').count(), 0); assert.equal(await frame.getByTestId('restore-knowledge-edges').isVisible(), true);
 assert.deepEqual(await edges(), validEdges);
 await frame.getByTestId('restore-knowledge-edges').click(); await frame.evaluate(() => save());
 assert.equal(await frame.getByTestId('edge-line-knowledge-article-linked').count(), 1); assert.equal(await frame.getByTestId('restore-knowledge-edges').isVisible(), false);
 assert.equal(payload.layout.boards.home.knowledgeEdgeStyles[0].hidden, undefined); assert.equal(payload.layout.boards.home.knowledgeEdgeStyles[0].width, 8);
 assert.deepEqual(payload.docs, docsBefore); assert.equal(calls.some(c => ['update-note', 'rename-note', 'move-article'].includes(c.method)), false);
 checks.knowledgeHidePersistsAndRestoreRetainsOriginalWikiLinksAndStyle = { hiddenSaved, restored: payload.layout.boards.home.knowledgeEdgeStyles };
 await page.screenshot({ path: new URL('connections-final.png', evidence).pathname });
 assert.deepEqual(errors, []); assert.deepEqual(requests, []);
 await writeFile(new URL('connections-browser.json', evidence), JSON.stringify({ passed: true, checks, pageErrors: errors, externalRequests: requests, userVaultAccessed: false }, null, 2)); console.log('Connections actual frame checks passed.');
} catch (error) {
 if (page) await page.screenshot({ path: new URL('connections-failure.png', evidence).pathname }).catch(() => {});
 await writeFile(new URL('connections-failure.json', evidence), JSON.stringify({ error: String(error), checks, calls, errors }, null, 2)); throw error;
} finally { await browser.close(); server.close(); }
