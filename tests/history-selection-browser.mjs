import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// Actual opaque plugin frame and actual model sanitizer. No personal Vault is accessed.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const { buildSync } = require('esbuild');
const compiled = buildSync({ entryPoints: [new URL('../src/model.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
const modelModule = { exports: {} }; new Function('require', 'module', 'exports', compiled)(require, modelModule, modelModule.exports);
const { sanitizeLayout } = modelModule.exports;
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const note = (id, x, y) => ({ id, type: 'note', title: '便签 ' + id, text: '保留的便签正文 ' + id, x, y, w: 320, h: 240, color: 'yellow' });
const b = (id, nodes) => ({ id, title: id === 'home' ? '撤销与选择验收' : '另一层', parent: id === 'home' ? null : 'home', theme: 'research', iconMode: 'default', iconId: 'book-open', folderColor: 'lavender', view: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] });
const initial = { layout: sanitizeLayout({ version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, audioPlayback: { 'Audio/test.mp3': { position: 12, duration: 120 } }, boards: {
  home: b('home', [note('a', 300, 180), note('b', 900, 500), { id: 'article', type: 'article', doc: 'Fixture.md', x: 30, y: 500, w: 320, h: 240 }, { id: 'audio', type: 'audio', filePath: 'Audio/test.mp3', title: '保持音频进度', x: 1300, y: 500, w: 380, h: 340 }]),
  child: b('child', [note('other', 300, 180)]),
} }), docs: { 'Fixture.md': { id: 'Fixture.md', path: 'Fixture.md', title: 'Fixture', body: '# Fixture\n\n原有正文与 [[Linked]]。', mtime: 1, outgoing: ['Linked.md'], backlinks: ['Back.md'] } }, assets: {}, mediaAssets: {}, embeds: {}, drafts: [], settings: { defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'History fixture' };
let payload = clone(initial), page, frame;
const calls = [], errors = [], checks = {};
const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
const geometry = n => Object.fromEntries(['x', 'y', 'w', 'h'].map(k => [k, n[k]]));
async function boot(reset = false) {
  if (page) await page.close(); if (reset) payload = clone(initial);
  page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('https://**', route => route.abort());
  await page.exposeFunction('historyPayload', () => payload);
  await page.exposeFunction('historyRPC', (method, value) => {
    calls.push({ method, payload: value });
    if (method === 'save-layout') { payload.layout = sanitizeLayout(value); return { ok: true }; }
    if (method === 'update-note') { const d = payload.docs[value.path]; if (d.body !== value.expectedBody) return { ok: false, current: d.body }; Object.assign(d, { body: value.body, mtime: d.mtime + 1 }); return { ok: true, doc: d }; }
    return { ok: true };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(html => {
    const iframe = document.getElementById('frame'); window.historyReady = false;
    addEventListener('message', async event => {
      if (event.source !== iframe.contentWindow) return; const m = event.data;
      if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'history-channel', payload: await window.historyPayload() }, '*'); return; }
      if (m.channel !== 'history-channel') return;
      if (m.kind === 'vb-ready') { window.historyReady = true; return; }
      if (m.kind !== 'vb-request') return;
      try { iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'history-channel', id: m.id, result: await window.historyRPC(m.method, m.payload) }, '*'); }
      catch (error) { iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'history-channel', id: m.id, error: error.message }, '*'); }
    }); iframe.srcdoc = html;
  }, html);
  await page.waitForFunction(() => window.historyReady);
  frame = page.frames().find(f => f.parentFrame()); assert.ok(frame);
  await frame.waitForFunction(() => !!window.VBHistory);
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
const stateOf = () => frame.evaluate(() => ({ board: board().id, nodes: board().nodes.map(n => ({ ...n })), view: { ...board().view }, scale: sceneScale, selected, counts: VBHistory.counts, docs: structuredClone(state.docs), audio: structuredClone(state.audioPlayback || {}), edges: structuredClone(board().edges), child: structuredClone(state.boards.child) }));
const nodeOf = async id => (await stateOf()).nodes.find(n => n.id === id);
const card = id => frame.locator('#nodes>.node[data-node="' + id + '"]');
async function settled() { await frame.waitForFunction(() => !suppressClick); }
async function selectNode(id) { await settled(); await frame.getByTestId('select-' + id).click(); }
async function drag(id, dx, dy, { release = true } = {}) {
  await settled(); const before = await stateOf(), grip = frame.getByTestId('sticky-drag-' + id), usesGrip = await grip.count() > 0, rect = await (usesGrip ? grip : card(id)).boundingBox(); assert.ok(rect);
  const x = rect.x + (usesGrip ? rect.width / 2 : 24), y = rect.y + (usesGrip ? rect.height / 2 : 25), factor = before.scale * before.view.zoom;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx * factor, y + dy * factor, { steps: 12 });
  if (release) { await page.mouse.up(); await settled(); }
  return { before, after: await stateOf() };
}
async function resize(id, dir, dx, dy) {
  await selectNode(id); const before = await stateOf(), rect = await frame.getByTestId('resize-' + id + '-' + dir).boundingBox(); assert.ok(rect);
  const factor = before.scale * before.view.zoom, x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx * factor, y + dy * factor, { steps: 9 }); await page.mouse.up(); await settled();
  return { before, after: await stateOf() };
}
async function shortcut(key) { await page.keyboard.press(key); await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve))); }
async function canvasFocus() { await frame.locator('#canvas').focus(); }
async function persisted() {
  const current = await stateOf();
  await page.waitForFunction(async wanted => { const p = await window.historyPayload(); return wanted.nodes.every(n => { const saved = p.layout.boards[wanted.board].nodes.find(v => v.id === n.id); return saved && ['x', 'y', 'w', 'h'].every(k => saved[k] === n[k]); }); }, current);
}
async function snapshot() {
  payload.layout = sanitizeLayout(payload.layout);
  await page.evaluate(async () => document.getElementById('frame').contentWindow.postMessage({ kind: 'vb-event', channel: 'history-channel', type: 'snapshot', payload: { ...await window.historyPayload(), preserveView: true } }, '*'));
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function blankPoint() {
  return frame.evaluate(() => {
    const s = $('scene').getBoundingClientRect();
    for (const y of [s.top + 340, s.top + 650, s.top + 420, s.top + 800]) for (const x of [s.left + 70, s.left + 650, s.left + 1150]) {
      const el = document.elementFromPoint(x, y);
      if (el && $('scene').contains(el) && !el.closest('#nodes>.node,button,#selection-bar,#sticky-style-panel,.bottom-toolbar,#circle-style-panel')) return { x, y };
    } throw Error('No unoccupied scene point found');
  });
}
async function previewBlank() {
  await selectNode('article');
  await frame.locator('#selection-bar [data-preview="Fixture.md"]').click();
  assert.ok(await frame.locator('#preview').evaluate(el => el.childElementCount > 0), 'actual article details are open');
  const p = await blankPoint(), before = await stateOf(); await page.mouse.click(p.x, p.y);
  assert.equal((await stateOf()).selected, null); assert.equal(await frame.locator('#preview').evaluate(el => el.childElementCount), 0);
  assert.equal(await frame.locator('#selection-bar').textContent(), ''); assert.equal(await frame.locator('#connection-controls button').count(), 0);
  assert.deepEqual((await stateOf()).view, before.view); assert.deepEqual((await stateOf()).nodes, before.nodes);
  checks.blankTapClosesArticleDetailsPreview = true;
}
try {
  if (process.env.PREVIEW_ONLY) {
    await boot(true); await previewBlank();
    const path = new URL('history-selection-browser.json', evidence), previous = JSON.parse(await readFile(path, 'utf8'));
    previous.checks.blankTapClosesArticleDetailsPreview = true;
    previous.previewLatestBuildRechecked = true;
    await writeFile(path, JSON.stringify(previous, null, 2));
    console.log('Latest frame blank tap closes actual article details preview.');
  } else {
  await boot(true);
  const original = geometry(await nodeOf('a'));
  const first = await drag('a', 100, 60), afterFirst = geometry(await nodeOf('a'));
  assert.notDeepEqual(afterFirst, original); assert.deepEqual(first.after.counts, { undo: 1, redo: 0 }, '12 mouse moves form one history command');
  const second = await resize('a', 'se', 40, 20), afterSecond = geometry(await nodeOf('a'));
  assert.deepEqual(second.after.counts, { undo: 2, redo: 0 });
  // Pan and zoom are camera changes rather than node history commands.
  const p = await blankPoint(); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 40, p.y + 25, { steps: 6 }); await page.mouse.up(); await settled();
  assert.equal((await stateOf()).selected, 'a', 'panning keeps selection');
  await frame.getByTestId('zoom-out').click(); const currentCamera = (await stateOf()).view;
  await canvasFocus(); await shortcut('Control+z'); assert.deepEqual(geometry(await nodeOf('a')), afterFirst); assert.deepEqual((await stateOf()).view, currentCamera);
  await shortcut('Meta+z'); assert.deepEqual(geometry(await nodeOf('a')), original); assert.deepEqual((await stateOf()).counts, { undo: 0, redo: 2 });
  await shortcut('Control+Shift+z'); assert.deepEqual(geometry(await nodeOf('a')), afterFirst);
  await shortcut('Control+y'); assert.deepEqual(geometry(await nodeOf('a')), afterSecond); assert.deepEqual((await stateOf()).view, currentCamera);
  await persisted();
  checks.twoStepsReverseAndRedoPreserveCamera = { original, afterFirst, afterSecond, camera: currentCamera };
  await page.screenshot({ path: new URL('history-two-steps-redone.png', evidence).pathname });
  await boot(); assert.deepEqual(geometry(await nodeOf('a')), afterSecond); assert.deepEqual((await stateOf()).counts, { undo: 0, redo: 0 });
  checks.sanitizedSaveReopensResultWithFreshSessionHistory = true;

  await boot(true); const resizeResults = [];
  for (const dir of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
    for (const growth of [true, false]) {
      const before = geometry(await nodeOf('a')), sign = growth ? 1 : -1;
      const dx = /[ew]/.test(dir) ? (dir.includes('w') ? -40 : 40) * sign : 0;
      const dy = /[ns]/.test(dir) ? (dir.includes('n') ? -40 : 40) * sign : 0;
      const action = await resize('a', dir, dx, dy), changed = geometry(await nodeOf('a'));
      assert.notDeepEqual(changed, before, dir + ' actually changes dimensions');
      if (dx) assert.equal(changed.w, before.w + 40 * sign); if (dy) assert.equal(changed.h, before.h + 40 * sign);
      assert.deepEqual(action.after.counts, { undo: 1, redo: 0 });
      await shortcut('Control+z'); assert.deepEqual(geometry(await nodeOf('a')), before); assert.deepEqual((await stateOf()).counts, { undo: 0, redo: 1 });
      resizeResults.push({ dir, growth, changed, restored: before });
    }
  }
  checks.eightDirectionsGrowShrinkOneCommand = resizeResults;
  await selectNode('a'); const beforeKeyboard = geometry(await nodeOf('a'));
  await frame.getByTestId('resize-a-e').focus(); await shortcut('ArrowRight'); assert.equal((await nodeOf('a')).w, beforeKeyboard.w + 20);
  assert.deepEqual((await stateOf()).counts, { undo: 1, redo: 0 }); await shortcut('Control+z'); assert.deepEqual(geometry(await nodeOf('a')), beforeKeyboard);
  await drag('a', 60, 40); assert.deepEqual((await stateOf()).counts, { undo: 1, redo: 0 });
  checks.keyboardResizeAndNewGestureClearsRedo = true;
  const beforeCancel = await stateOf(); await drag('a', 50, 30, { release: false });
  // Chromium exposes no OS mouse-cancel command. Cancel a real in-progress pointer gesture at its public event boundary.
  await frame.locator('#canvas').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true });
  await page.mouse.up(); await settled(); assert.deepEqual(geometry(await nodeOf('a')), geometry(beforeCancel.nodes.find(n => n.id === 'a'))); assert.deepEqual((await stateOf()).counts, beforeCancel.counts);
  checks.cancelledRealDragNotRecorded = true;

  await selectNode('a'); assert.equal(await frame.getByTestId('sticky-style-panel').isVisible(), true);
  assert.equal(await frame.getByTestId('connect-handle-a').isVisible(), true);
  const beforeControl = await stateOf(); await frame.getByTestId('sticky-color-blue').click(); assert.equal((await stateOf()).selected, 'a');
  assert.deepEqual((await stateOf()).counts, beforeControl.counts);
  await frame.getByTestId('zoom-value').click(); assert.equal((await stateOf()).selected, 'a'); await frame.getByTestId('zoom-preset-100').click(); assert.equal((await stateOf()).selected, 'a');
  const blank = await blankPoint(), beforeBlank = await stateOf(); await page.mouse.click(blank.x, blank.y);
  assert.equal((await stateOf()).selected, null); assert.equal(await card('a').evaluate(el => el.classList.contains('selected')), false);
  assert.equal(await frame.locator('#connection-controls button').count(), 0, 'blank tap hides circular connect handle');
  assert.equal(await frame.locator('#selection-bar').textContent(), ''); assert.equal(await frame.getByTestId('sticky-style-panel').isVisible(), false);
  assert.deepEqual((await stateOf()).view, beforeBlank.view); assert.deepEqual((await stateOf()).nodes, beforeBlank.nodes);
  checks.blankTapClearsNodeBarStickyWhileControlsKeepSelection = true;
  await previewBlank();
  await page.screenshot({ path: new URL('selection-blank-cleared.png', evidence).pathname });

  // An article editor handles its own text undo; geometry history and selected node survive.
  await drag('a', 80, 20); const beforeText = await stateOf();
  const editor = card('article').locator('.vb-inline-editor'); await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' 临时文本', { delay: 15 });
  const entered = await editor.evaluate(el => el.innerText); assert.ok(entered.includes('临时文本'));
  await shortcut('Meta+z'); const afterTextUndo = await stateOf();
  assert.deepEqual(afterTextUndo.counts, beforeText.counts); assert.deepEqual(geometry(await nodeOf('a')), geometry(beforeText.nodes.find(n => n.id === 'a')));
  assert.equal(afterTextUndo.nodes.length, beforeText.nodes.length); assert.equal((await editor.evaluate(el => el.innerText)).includes('临时文本'), false, 'native text undo removes typed content');
  await page.keyboard.press('Backspace'); assert.equal((await stateOf()).nodes.length, beforeText.nodes.length, 'text Backspace must not remove selected article');
  await shortcut('Meta+z'); await frame.getByTestId('select-a').click();
  checks.articleNativeUndoAndBackspaceDoNotConsumeGeometryOrDeleteCard = true;

  // Actual snapshot from the external host replaces content/style, without stale whole-layout replay.
  await boot(true); await drag('a', 100, 60); await persisted(); const beforeExternal = await stateOf();
  payload.docs['Fixture.md'] = { ...payload.docs['Fixture.md'], body: '# Fixture\n\n外部新正文 [[New Link]]', outgoing: ['New Link.md'], backlinks: ['External.md'], mtime: 9 };
  payload.layout.boards.home.nodes.find(n => n.id === 'a').color = 'pink';
  payload.layout.boards.home.nodes.find(n => n.id === 'a').text = '外部新便签内容';
  payload.layout.boards.home.nodes.reverse(); payload.layout.boards.home.edges = [{ from: 'a', to: 'b', lineStyle: 'dashed', width: 3 }];
  payload.layout.boards.child.iconId = 'fish'; payload.layout.boards.child.folderColor = 'mint';
  payload.layout.audioPlayback['Audio/test.mp3'] = { position: 48, duration: 120, lastPlayedAt: 100 };
  await snapshot(); await canvasFocus(); await shortcut('Control+z');
  const externalAfterUndo = await stateOf(); assert.deepEqual(geometry(await nodeOf('a')), original);
  assert.equal((await nodeOf('a')).text, '外部新便签内容'); assert.equal((await nodeOf('a')).color, 'pink');
  assert.deepEqual(externalAfterUndo.nodes.map(n => n.id), beforeExternal.nodes.map(n => n.id).reverse());
  assert.deepEqual(externalAfterUndo.docs['Fixture.md'], payload.docs['Fixture.md']);
  assert.deepEqual(externalAfterUndo.edges, payload.layout.boards.home.edges); assert.equal(externalAfterUndo.child.iconId, 'fish'); assert.equal(externalAfterUndo.child.folderColor, 'mint');
  assert.equal(externalAfterUndo.audio['Audio/test.mp3'].position, 48); assert.deepEqual(externalAfterUndo.view, beforeExternal.view);
  checks.geometryUndoPreservesExternalTextLinksColorOrderIconsEdgesAudio = true;
  await persisted();
  await drag('a', 40, 40); await persisted(); payload.layout.boards.home.nodes.find(n => n.id === 'a').x += 77;
  await snapshot(); const changedExternal = geometry(await nodeOf('a')); await canvasFocus(); await shortcut('Control+z');
  assert.deepEqual(geometry(await nodeOf('a')), changedExternal); assert.equal((await stateOf()).counts.undo, 0);
  checks.sameNodeExternallyChangedGeometrySkipsStaleCommand = changedExternal;
  await drag('a', 40, 40); await persisted(); const moved = payload.layout.boards.home.nodes.find(n => n.id === 'a');
  payload.layout.boards.home.nodes = payload.layout.boards.home.nodes.filter(n => n.id !== 'a'); payload.layout.boards.child.nodes.push(moved);
  await snapshot(); await canvasFocus(); await shortcut('Control+z'); assert.equal(await nodeOf('a'), undefined); assert.equal((await stateOf()).child.nodes.find(n => n.id === 'a').x, moved.x);
  checks.externallyMovedNodeNeverPulledBackByUndo = true;

  await boot(true); await drag('a', 80, 40); const homeMoved = geometry(await nodeOf('a'));
  await frame.getByTestId('board-tree').click(); await frame.getByTestId('tree-board-child').click();
  await frame.waitForFunction(() => state.currentBoard === 'child'); await canvasFocus(); await shortcut('Control+z'); assert.deepEqual((await stateOf()).counts, { undo: 0, redo: 0 });
  const childOriginal = geometry(await nodeOf('other')); await drag('other', 60, 40); await shortcut('Control+z'); assert.deepEqual(geometry(await nodeOf('other')), childOriginal);
  await frame.getByTestId('crumb-home').click(); await frame.waitForFunction(() => state.currentBoard === 'home');
  assert.deepEqual(geometry(await nodeOf('a')), homeMoved); await canvasFocus(); await shortcut('Control+z'); assert.deepEqual(geometry(await nodeOf('a')), original);
  checks.historyIsIsolatedPerNestedBoard = true;
  assert.deepEqual(errors, []);
  await writeFile(new URL('history-selection-browser.json', evidence), JSON.stringify({ passed: true, checks, pageErrors: errors, persistedWithActualModelSanitizer: true, cancellation: 'Real mouse drag followed by public pointercancel event; Chromium lacks a native OS mouse cancel API.', circleSelection: 'Circular connect handle is present for selected node and removed by blank tap', userVaultAccessed: false }, null, 2));
  console.log('History/selection actual frame checks passed.');
  }
} catch (error) {
  if (page) await page.screenshot({ path: new URL('history-selection-failure.png', evidence).pathname }).catch(() => {});
  await writeFile(new URL('history-selection-failure.json', evidence), JSON.stringify({ error: String(error), checks, lastState: frame ? await stateOf().catch(() => null) : null, pageErrors: errors }, null, 2)); throw error;
} finally { await browser.close(); server.close(); }
