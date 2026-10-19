import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const { buildSync } = require('esbuild');
const compiled = buildSync({ entryPoints: [new URL('../src/model.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
const modelModule = { exports: {} }; new Function('require', 'module', 'exports', compiled)(require, modelModule, modelModule.exports);
const { sanitizeLayout } = modelModule.exports;
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const note = (id, title, x, y, color) => ({ id, type: 'note', title, text: '原有便签正文 ' + id, x, y, w: 200, h: 200, color });
const board = (id, nodes) => ({ id, title: id === 'home' ? '横向等间距' : '纵向等间距', parent: id === 'home' ? null : 'home', theme: 'research', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] });
const payload = { layout: sanitizeLayout({ version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: {
  home: board('home', [note('a', '参考 A', 100, 100, 'yellow'), note('b', '参考 B', 380, 100, 'blue'), note('c', '移动 C', 950, 350, 'pink')]),
  vertical: board('vertical', [note('va', '参考 A', 100, 100, 'yellow'), note('vb', '参考 B', 100, 380, 'blue'), note('vc', '移动 C', 500, 400, 'pink')]),
} }), docs: { 'Fixture.md': { id: 'Fixture.md', path: 'Fixture.md', title: 'Fixture', body: '# Fixture\n\n文章正文不参与拖拽修改。', mtime: 1, outgoing: [], backlinks: [] } }, assets: {}, mediaAssets: {}, embeds: {}, drafts: [], settings: { defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'Spacing fixture' };
const originalNotes = Object.fromEntries(Object.entries(payload.layout.boards).map(([id, b]) => [id, b.nodes.map(({ id, title, text, w, h }) => ({ id, title, text, w, h }))]));
const sourceBody = payload.docs['Fixture.md'].body;
const calls = [], checks = {}, errors = [];
const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.exposeFunction('spacingFixturePayload', () => payload);
  await page.exposeFunction('spacingFixtureRPC', (method, value) => {
    calls.push({ method, payload: value });
    if (method === 'save-layout') { payload.layout = sanitizeLayout(value); return { ok: true }; }
    if (['update-note', 'rename-note', 'create-note'].includes(method)) throw Error('Spacing drag must not write articles');
    return { ok: true };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(html => {
    const iframe = document.getElementById('frame'); window.spacingReady = false;
    addEventListener('message', async event => {
      if (event.source !== iframe.contentWindow) return;
      const message = event.data;
      if (message.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'spacing-channel', payload: await window.spacingFixturePayload() }, '*'); return; }
      if (message.channel !== 'spacing-channel') return;
      if (message.kind === 'vb-ready') { window.spacingReady = true; return; }
      if (message.kind !== 'vb-request') return;
      try { iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'spacing-channel', id: message.id, result: await window.spacingFixtureRPC(message.method, message.payload) }, '*'); }
      catch (error) { iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'spacing-channel', id: message.id, error: error.message }, '*'); }
    }); iframe.srcdoc = html;
  }, html);
  await page.waitForFunction(() => window.spacingReady);
  const frame = page.frames().find(f => f.parentFrame()); assert.ok(frame);
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const stateOf = () => frame.evaluate(() => ({ board: state.currentBoard, view: { ...board().view }, nodes: board().nodes.map(n => ({ ...n })), body: state.docs['Fixture.md'].body, scale: sceneScale }));
  const guideState = () => frame.locator('#snap-guides .spacing-guide').evaluateAll(groups => groups.map(group => ({ axis: group.dataset.axis, gap: Number(group.dataset.gap), label: group.querySelector('text')?.textContent, line: [...group.querySelectorAll('line')].map(line => ({ x1: Number(line.getAttribute('x1')), y1: Number(line.getAttribute('y1')), x2: Number(line.getAttribute('x2')), y2: Number(line.getAttribute('y2')) })) })));
  async function eightyPercent() {
    await frame.waitForFunction(() => !suppressClick);
    await frame.getByTestId('zoom-value').click(); await frame.getByTestId('zoom-preset-100').click();
    await frame.getByTestId('zoom-out').click(); await frame.getByTestId('zoom-out').click();
    assert.equal((await stateOf()).view.zoom, .8);
  }
  async function dragTo(id, x, y, { alt = false, finish = true } = {}) {
    await frame.waitForFunction(() => !suppressClick);
    const before = await stateOf(), moving = before.nodes.find(node => node.id === id);
    const box = await frame.locator('#nodes>.sticky[data-node="' + id + '"]').boundingBox(); assert.ok(box);
    const sx = box.x + 18, sy = box.y + 20, scale = before.view.zoom * before.scale;
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.move(sx, sy); await page.mouse.down();
    await page.mouse.move(sx + (x - moving.x) * scale, sy + (y - moving.y) * scale, { steps: 8 });
    const during = await stateOf(), guides = await guideState();
    if (finish) { await page.mouse.up(); if (alt) await page.keyboard.up('Alt'); await frame.waitForFunction(() => !suppressClick); }
    return { before, during, guides };
  }
  async function finishDrag() { await page.mouse.up(); await frame.waitForFunction(() => !suppressClick); }
  function stable(before, after, movingId) {
    assert.deepEqual(after.view, before.view, 'spacing must not recenter or change zoom');
    assert.deepEqual(after.nodes.filter(node => node.id !== movingId), before.nodes.filter(node => node.id !== movingId));
    assert.equal(after.body, sourceBody);
    assert.deepEqual(after.nodes.map(({ id, title, text, w, h }) => ({ id, title, text, w, h })), originalNotes[before.board]);
  }
  async function saved(boardId, nodeId, x, y) {
    await page.waitForFunction(async ({ boardId, nodeId, x, y }) => {
      const p = await window.spacingFixturePayload(), n = p.layout.boards[boardId].nodes.find(n => n.id === nodeId);
      return Math.abs(n.x - x) < .001 && Math.abs(n.y - y) < .001;
    }, { boardId, nodeId, x, y });
    assert.equal(payload.layout.docs, undefined);
  }
  await eightyPercent();
  // 11 Board units == 8.8 screen pixels at 80%; this is outside the 8px threshold.
  const outside = await dragTo('c', 671, 100);
  assert.deepEqual(outside.guides, []); assert.equal(outside.during.nodes.find(n => n.id === 'c').x, 680);
  stable(outside.before, await stateOf(), 'c'); await saved('home', 'c', 680, 100);
  checks.zoomOutsideTolerance = { desiredX: 671, screenDistance: 8.8, actualX: 680, guides: outside.guides };
  // 8 Board units == 6.4px; actual pointer motion must snap to the 80-unit gap.
  const horizontal = await dragTo('c', 668, 100, { finish: false });
  assert.equal(horizontal.during.nodes.find(n => n.id === 'c').x, 660);
  assert.equal(horizontal.guides.length, 2); assert.ok(horizontal.guides.every(g => g.axis === 'x' && g.gap === 80 && g.label === '80'));
  await page.screenshot({ path: new URL('spacing-horizontal-guides.png', evidence).pathname });
  await finishDrag(); stable(horizontal.before, await stateOf(), 'c'); await saved('home', 'c', 660, 100);
  assert.equal(await frame.locator('.spacing-guide').count(), 0, 'guides clear on mouse release');
  checks.horizontal = { desiredX: 668, screenDistance: 6.4, actualX: 660, guides: horizontal.guides };
  const free = await dragTo('c', 669, 103, { alt: true });
  const freeNode = free.during.nodes.find(n => n.id === 'c');
  assert.ok(Math.abs(freeNode.x - 669) < .0001 && Math.abs(freeNode.y - 103) < .0001);
  assert.deepEqual(free.guides, []); stable(free.before, await stateOf(), 'c'); await saved('home', 'c', 669, 103);
  checks.altBypass = { desired: { x: 669, y: 103 }, actual: { x: freeNode.x, y: freeNode.y }, guides: free.guides };
  // Enter the hidden nested fixture through the actual directory menu, not eval navigation.
  await frame.getByTestId('board-tree').click(); await frame.getByTestId('tree-board-vertical').click();
  await frame.waitForFunction(() => state.currentBoard === 'vertical'); await eightyPercent();
  const vertical = await dragTo('vc', 100, 668, { finish: false });
  assert.equal(vertical.during.nodes.find(n => n.id === 'vc').y, 660);
  assert.equal(vertical.guides.length, 2); assert.ok(vertical.guides.every(g => g.axis === 'y' && g.gap === 80 && g.label === '80'));
  await page.screenshot({ path: new URL('spacing-vertical-guides.png', evidence).pathname });
  await finishDrag(); stable(vertical.before, await stateOf(), 'vc'); await saved('vertical', 'vc', 100, 660);
  checks.vertical = { desiredY: 668, actualY: 660, guides: vertical.guides };
  assert.deepEqual(errors, []);
  assert.equal(calls.some(call => ['update-note', 'rename-note', 'create-note'].includes(call.method)), false);
  await writeFile(new URL('spacing-snap-browser.json', evidence), JSON.stringify({ passed: true, checks, zoom: .8, sourceContentUnchanged: true, cameraAndPeersUnchanged: true, persistedWithActualModelSanitizer: true, pageErrors: errors, chromeArgs: ['--disable-site-isolation-trials'], userVaultAccessed: false }, null, 2));
  console.log('Spacing snap browser checks passed: horizontal/vertical 80-unit gaps, paired SVG labels, actual 80% mouse tolerance, release persistence through model sanitizer, Alt free bypass, stable camera/peers/contents.');
} finally { await browser.close(); server.close(); }
