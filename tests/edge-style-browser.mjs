import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// Real opaque plugin frame + actual persistent layout sanitizer. No user notes are written.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const { buildSync } = require('esbuild');
const compiled = buildSync({ entryPoints: [new URL('../src/model.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
const modelModule = { exports: {} }; new Function('require', 'module', 'exports', compiled)(require, modelModule, modelModule.exports);
const { stripEphemeral } = modelModule.exports;
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const makeDoc = (path, outgoing = [], backlinks = []) => ({ id: path, path, title: path.replace(/\.md$/, ''), body: '# ' + path + '\n\nLocal article body. ' + (outgoing.length ? '[[B]]' : ''), outgoing, backlinks, mtime: 1 });
const payload = { layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: {
  home: { id: 'home', title: '连线样式验收', parent: null, theme: 'research', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes: [
    { id: 'a', type: 'article', doc: 'A.md', x: 120, y: 40, w: 300, h: 360 },
    { id: 'b', type: 'article', doc: 'B.md', x: 860, y: 40, w: 300, h: 360 },
    { id: 'c', type: 'note', title: '手动起点', text: 'Space connection source', x: 120, y: 500, w: 260, h: 240 },
    { id: 'd', type: 'note', title: '手动终点', text: 'Space connection target', x: 860, y: 500, w: 260, h: 240 },
  ], edges: [{ from: 'c', to: 'd' }] },
} }, docs: { 'A.md': makeDoc('A.md', ['B.md']), 'B.md': makeDoc('B.md', [], ['A.md']) }, assets: {}, embeds: {}, drafts: [], settings: { defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'Edge fixture' };
const originalDocs = JSON.parse(JSON.stringify(payload.docs));
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
const errors = [], externalRequests = [], allCalls = [];
let page;
try {
  async function initialize(init) {
    const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => { if (/^https:\/\//.test(request.url())) externalRequests.push(request.url()); });
    await page.route('https://**', route => route.abort());
    await page.exposeFunction('edgeSanitize', layout => stripEphemeral(layout));
    await page.exposeFunction('edgeCallRecord', call => { allCalls.push(call); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(({ html, init }) => {
      const iframe = document.getElementById('frame');
      window.edgeHost = { payload: init, ready: false, calls: [], layouts: [] };
      addEventListener('message', async event => {
        if (event.source !== iframe.contentWindow) return;
        const m = event.data;
        if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'edge-channel', payload: init }, '*'); return; }
        if (m.channel !== 'edge-channel') return;
        if (m.kind === 'vb-ready') { window.edgeHost.ready = true; return; }
        if (m.kind !== 'vb-request') return;
        window.edgeHost.calls.push({ method: m.method, payload: structuredClone(m.payload) });
        await window.edgeCallRecord({ method: m.method, payload: m.payload });
        let result = { ok: true }, error;
        if (m.method === 'save-layout') { init.layout = await window.edgeSanitize(m.payload); window.edgeHost.layouts.push(structuredClone(init.layout)); }
        else if (m.method === 'update-note' || m.method === 'rename-note' || m.method === 'move-article') error = 'Connection style must never modify an article';
        iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'edge-channel', id: m.id, result, error }, '*');
      });
      iframe.srcdoc = html;
    }, { html, init });
    await page.waitForFunction(() => window.edgeHost.ready);
    const frame = page.frames().find(frame => frame.parentFrame()); assert.ok(frame);
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await frame.evaluate(() => { board().view = { x: 20, y: -10, zoom: .8 }; render(); });
    return { page, frame };
  }
  const checks = {};
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
  let initialized = await initialize(payload); page = initialized.page; let frame = initialized.frame;

  assert.equal(await frame.locator('#edges .edge.space').count(), 1);
  assert.equal(await frame.locator('#edges .edge.knowledge').count(), 1);
  const line = kind => frame.getByTestId(kind === 'space' ? 'edge-line-space-c-d' : 'edge-line-knowledge-a-b');
  const hit = kind => frame.getByTestId(kind === 'space' ? 'edge-hit-space-c-d' : 'edge-hit-knowledge-a-b');
  const paint = kind => line(kind).evaluate(el => ({ width: Number.parseFloat(getComputedStyle(el).strokeWidth), dashed: getComputedStyle(el).strokeDasharray !== 'none', dasharray: getComputedStyle(el).strokeDasharray, d: el.getAttribute('d') }));
  const positions = () => frame.evaluate(() => ({ view: { ...board().view }, nodes: board().nodes.map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h })) }));
  async function selectHit(kind, offset = 5) {
    const point = await hit(kind).evaluate((el, offset) => {
      const middle = el.getPointAtLength(el.getTotalLength() / 2), transform = el.getScreenCTM();
      const p = new DOMPoint(middle.x, middle.y).matrixTransform(transform);
      const x = p.x, y = p.y + offset, receiver = document.elementFromPoint(x, y);
      return { x, y, hitsWideStroke: receiver === el, hitWidth: Number.parseFloat(getComputedStyle(el).strokeWidth), pointerEvents: getComputedStyle(el).pointerEvents, stroke: getComputedStyle(el).stroke };
    }, offset);
    assert.equal(point.hitWidth, 18); assert.equal(point.pointerEvents, 'stroke'); assert.equal(point.hitsWideStroke, true, 'a point 5 screen pixels off the visible line must hit the transparent path');
    await page.mouse.click(point.x, point.y);
    assert.equal(await frame.getByTestId('edge-style-panel').isVisible(), true);
    assert.equal(await frame.evaluate(() => $('modal-root').childElementCount), 0, 'line editing stays in the board rather than opening a modal');
    assert.equal(await frame.evaluate(() => VBEdgeStyle.selected?.kind), kind);
    return point;
  }
  async function setRange(width) {
    const range = frame.getByTestId('edge-style-width');
    await range.press('Home');
    for (let i = 0; i < Math.round((width - 1) / .5); i++) await range.press('ArrowRight');
    assert.equal(Number(await range.inputValue()), width);
  }
  const originalPosition = await positions();
  const defaultSpace = await paint('space'), defaultKnowledge = await paint('knowledge');
  assert.equal(defaultSpace.width, 2); assert.equal(defaultSpace.dashed, false);
  assert.equal(defaultKnowledge.width, 1.5); assert.equal(defaultKnowledge.dashed, true);
  checks.legacyDefaultsStaySolid2AndKnowledgeDashed1_5 = { space: defaultSpace, knowledge: defaultKnowledge };
  const hitPoint = await selectHit('space');
  assert.deepEqual(await positions(), originalPosition, 'selecting an edge must neither pan nor move its nodes');
  checks.wideTransparentStrokeSelectsLineInBoardPanel = hitPoint;
  const range = frame.getByTestId('edge-style-width');
  assert.equal(await range.getAttribute('min'), '1'); assert.equal(await range.getAttribute('max'), '8'); assert.equal(await range.getAttribute('step'), '0.5');
  await frame.getByTestId('edge-style-dashed').click(); assert.equal((await paint('space')).dashed, true);
  await range.press('Home'); assert.equal((await paint('space')).width, 1);
  await range.press('ArrowRight'); assert.equal((await paint('space')).width, 1.5);
  await range.press('End'); assert.equal((await paint('space')).width, 8);
  await range.press('ArrowLeft'); assert.equal((await paint('space')).width, 7.5);
  await setRange(5.5); assert.equal((await paint('space')).width, 5.5);
  assert.equal(await frame.getByTestId('edge-style-dashed').getAttribute('aria-pressed'), 'true');
  await frame.getByTestId('edge-style-solid').click(); assert.equal((await paint('space')).dashed, false);
  await frame.getByTestId('edge-style-dashed').click();
  const panelHeader = await frame.locator('#edge-style-panel .vb-edge-header strong').boundingBox(); assert.ok(panelHeader);
  await page.mouse.move(panelHeader.x + 8, panelHeader.y + 8); await page.mouse.down();
  await page.mouse.move(panelHeader.x + 40, panelHeader.y + 28, { steps: 6 }); await page.mouse.up();
  assert.deepEqual(await positions(), originalPosition, 'dragging editor panel text must not pan the canvas or drag a node');
  assert.equal(await frame.getByTestId('edge-style-panel').isVisible(), true);
  await frame.getByTestId('edge-style-reset').click();
  assert.equal((await paint('space')).width, 2); assert.equal((await paint('space')).dashed, false);
  await frame.getByTestId('edge-style-dashed').click(); await setRange(5.5);
  await frame.evaluate(() => save());
  const savedManual = await page.evaluate(() => window.edgeHost.payload.layout.boards.home.edges[0]);
  assert.deepEqual(savedManual, { from: 'c', to: 'd', lineStyle: 'dashed', width: 5.5 });
  checks.manualStyleAndHalfPixelWidthPaintLivePersistAndReset = savedManual;
  checks.panelControlsDoNotMoveCanvasOrNodes = true;
  await page.screenshot({ path: new URL('edge-style-manual-editor.png', evidence).pathname });
  await frame.getByTestId('edge-style-close').click();
  assert.equal(await frame.getByTestId('edge-style-panel').isVisible(), false);
  assert.equal(await frame.evaluate(() => VBEdgeStyle.selected), null);

  await selectHit('knowledge');
  assert.equal(await frame.getByTestId('edge-style-delete').innerText(), '在此画板隐藏');
  assert.ok((await frame.getByTestId('edge-style-panel').innerText()).includes('原文双向链接保留'));
  assert.ok((await frame.getByTestId('edge-style-panel').innerText()).includes('只隐藏当前画板中的连线'));
  await frame.getByTestId('edge-style-solid').click(); await setRange(4.5);
  assert.equal((await paint('knowledge')).width, 4.5); assert.equal((await paint('knowledge')).dashed, false);
  await frame.evaluate(() => save());
  const savedKnowledge = await page.evaluate(() => window.edgeHost.payload.layout.boards.home.knowledgeEdgeStyles);
  assert.deepEqual(savedKnowledge, [{ from: 'a', to: 'b', lineStyle: 'solid', width: 4.5 }]);
  assert.deepEqual(await frame.evaluate(() => state.docs), originalDocs);
  assert.deepEqual(await page.evaluate(() => window.edgeHost.payload.docs), originalDocs);
  checks.knowledgeAppearancePersistsWithoutEditingWikiLinks = savedKnowledge;
  await page.screenshot({ path: new URL('edge-style-knowledge-editor.png', evidence).pathname });
  await page.keyboard.press('Escape');
  assert.equal(await frame.getByTestId('edge-style-panel').isVisible(), false); assert.equal(await frame.evaluate(() => VBEdgeStyle.selected), null);
  await selectHit('space'); await page.mouse.click(1460, 660);
  assert.equal(await frame.getByTestId('edge-style-panel').isVisible(), false); assert.equal(await frame.evaluate(() => VBEdgeStyle.selected), null);
  await selectHit('knowledge'); await frame.getByTestId('select-a').click();
  assert.equal(await frame.getByTestId('edge-style-panel').isVisible(), false); assert.equal(await frame.evaluate(() => VBEdgeStyle.selected), null);
  assert.equal(await frame.evaluate(() => selected), 'a');
  checks.escapeBlankClickAndNodeSelectionExitEdgeSelection = true;

  await frame.evaluate(() => save());
  const persisted = await page.evaluate(() => structuredClone(window.edgeHost.payload));
  await page.close(); initialized = await initialize(persisted); page = initialized.page; frame = initialized.frame;
  assert.equal((await paint('space')).width, 5.5); assert.equal((await paint('space')).dashed, true);
  assert.equal((await paint('knowledge')).width, 4.5); assert.equal((await paint('knowledge')).dashed, false);
  assert.deepEqual(await frame.evaluate(() => board().edges), [{ from: 'c', to: 'd', lineStyle: 'dashed', width: 5.5 }]);
  assert.deepEqual(await frame.evaluate(() => board().knowledgeEdgeStyles), savedKnowledge);
  checks.stylesRestoreAfterReopeningOpaqueFrame = true;

  const beforeDragPaint = await paint('space');
  const c = frame.locator('[data-node="c"]'), cBox = await c.boundingBox(); assert.ok(cBox);
  await page.mouse.move(cBox.x + 25, cBox.y + 25); await page.mouse.down();
  await page.mouse.move(cBox.x + 65, cBox.y + 45, { steps: 8 }); await page.mouse.up();
  const afterDragPaint = await paint('space');
  assert.notEqual(afterDragPaint.d, beforeDragPaint.d); assert.equal(afterDragPaint.width, 5.5); assert.equal(afterDragPaint.dashed, true);
  const beforeResizeKnowledge = await paint('knowledge');
  await frame.evaluate(() => select('a'));
  const handle = await frame.getByTestId('resize-a-e').boundingBox(); assert.ok(handle);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 64, handle.y + handle.height / 2, { steps: 8 }); await page.mouse.up();
  const afterResizePaint = await paint('space'), afterResizeKnowledge = await paint('knowledge');
  assert.equal(afterResizePaint.d, afterDragPaint.d); assert.equal(afterResizePaint.width, 5.5); assert.equal(afterResizePaint.dashed, true);
  assert.notEqual(afterResizeKnowledge.d, beforeResizeKnowledge.d); assert.equal(afterResizeKnowledge.width, 4.5); assert.equal(afterResizeKnowledge.dashed, false);
  checks.nodeDragAndResizeUpdateGeometryKeepBothStyles = { beforeDragPaint, afterDragPaint, afterResizePaint, beforeResizeKnowledge, afterResizeKnowledge };

  await selectHit('space');
  const nodesBeforeDelete = await positions();
  await frame.getByTestId('edge-style-delete').click();
  assert.equal(await frame.locator('#edges .edge.space').count(), 0); assert.equal(await frame.locator('#edges .edge.knowledge').count(), 1);
  assert.deepEqual(await frame.evaluate(() => board().edges), []); assert.deepEqual(await positions(), nodesBeforeDelete);
  assert.deepEqual(await frame.evaluate(() => state.docs), originalDocs);
  await frame.evaluate(() => save());
  assert.deepEqual(await page.evaluate(() => window.edgeHost.payload.layout.boards.home.edges), []);
  assert.deepEqual(await page.evaluate(() => window.edgeHost.payload.layout.boards.home.knowledgeEdgeStyles), savedKnowledge);
  assert.equal(allCalls.filter(call => ['update-note', 'rename-note', 'move-article'].includes(call.method)).length, 0);
  checks.manualDeleteOnlyRemovesEdgeAndKnowledgeLinksRemain = true;
  await page.screenshot({ path: new URL('edge-style-final.png', evidence).pathname });
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  await writeFile(new URL('edge-style-browser.json', evidence), JSON.stringify({ passed: true, checks, pageErrors: errors, externalRequests, articleWrites: allCalls.filter(call => ['update-note', 'rename-note', 'move-article'].includes(call.method)), userVaultAccessed: false, chromeArgs: ['--disable-site-isolation-trials'] }, null, 2));
  console.log('Edge style frame checks passed.');
} catch (error) {
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
  if (page) {
    await page.screenshot({ path: new URL('edge-style-failure.png', evidence).pathname }).catch(() => {});
    const failure = await page.evaluate(() => window.edgeHost).catch(() => ({}));
    await writeFile(new URL('edge-style-failure.json', evidence), JSON.stringify({ error: String(error), host: failure }, null, 2));
  }
  throw error;
} finally { await browser.close(); server.close(); }
