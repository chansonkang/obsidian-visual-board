import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// Optional actual-frame browser check; build first and provide Chrome/playwright-core.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const frameHtml = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const docPath = 'Fixtures/Exact.md';
const docs = { [docPath]: { id: docPath, path: docPath, title: '精确文章', body: '# 精确文章\n\nBefore context\nNAVIGATION_EXACT_MATCH\nAfter context', outgoing: [], backlinks: [], mtime: 1 } };
const makeBoard = (id, title, parent, nodes) => ({ id, title, parent, theme: 'research', iconMode: 'default', view: { x: 98000, y: -92000, zoom: .4 }, nodes, edges: [] });
const boards = {
  home: makeBoard('home', '导航验收', null, [
    { id: 'folder-child', type: 'board', board: 'child', x: 6000, y: -3000 },
    { id: 'folder-empty', type: 'board', board: 'empty', x: 6400, y: -3000 },
  ]),
  child: makeBoard('child', '深层内容', 'home', [{ id: 'target', type: 'article', doc: docPath, x: -5000, y: 1800, w: 420, h: 640 }]),
  hidden: makeBoard('hidden', '隐藏入口目录', 'home', [{ id: 'hidden-note', type: 'note', title: '目录可找到我', text: 'Persistent hidden Board', x: 12500, y: 6700, w: 320, h: 240 }]),
  empty: makeBoard('empty', '空白层级', 'home', []),
};
const originalPositions = Object.fromEntries(Object.entries(boards).map(([id, board]) => [id, board.nodes.map(n => ({ id: n.id, x: n.x, y: n.y }))]));
const payload = { layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards }, docs, assets: {}, embeds: {}, drafts: [], settings: { defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'Navigation fixture' };
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(({ frameHtml, payload }) => {
    const iframe = document.getElementById('frame');
    window.navHost = { ready: false, layouts: [], calls: [] };
    window.navEvent = (type, p) => iframe.contentWindow.postMessage({ kind: 'vb-event', channel: 'nav-channel', type, payload: p }, '*');
    addEventListener('message', e => {
      if (e.source !== iframe.contentWindow) return;
      const m = e.data;
      if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'nav-channel', payload }, '*'); return; }
      if (m.channel !== 'nav-channel') return;
      if (m.kind === 'vb-ready') { window.navHost.ready = true; return; }
      if (m.kind !== 'vb-request') return;
      window.navHost.calls.push({ method: m.method, payload: m.payload });
      if (m.method === 'save-layout') window.navHost.layouts.push(m.payload);
      iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'nav-channel', id: m.id, result: { ok: true } }, '*');
    });
    iframe.srcdoc = frameHtml;
  }, { frameHtml, payload });
  await page.waitForFunction(() => window.navHost.ready);
  const frame = page.frames().find(f => f.parentFrame()); assert.ok(frame);
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
  const checks = {};
  async function centered(name, boardId, targetId, preview = false) {
    await frame.waitForFunction(id => state.currentBoard === id, boardId);
    const result = await frame.evaluate(({ targetId, preview }) => {
      const rect = el => el.getBoundingClientRect().toJSON();
      const canvas = rect($('canvas')), nodes = [...$('nodes').children].filter(el => !targetId || el.dataset.node === targetId).map(rect);
      const reserved = preview ? ($('preview').offsetWidth + 64) * sceneScale : 0;
      const area = { left: Math.min(...nodes.map(n => n.left)), top: Math.min(...nodes.map(n => n.top)), right: Math.max(...nodes.map(n => n.right)), bottom: Math.max(...nodes.map(n => n.bottom)) };
      const usableBottom = canvas.bottom - 125 * sceneScale;
      return { view: { ...board().view }, canvas, area, usableBottom, expectedX: (canvas.left + canvas.right - reserved) / 2, expectedY: (canvas.top + usableBottom) / 2 + 20 * sceneScale, selected, preview: preview ? rect($('preview')) : undefined };
    }, { targetId, preview });
    assert.ok([result.view.x, result.view.y, result.view.zoom].every(Number.isFinite));
    assert.ok(result.view.zoom >= .3 && result.view.zoom <= 1);
    assert.ok(Math.abs((result.area.left + result.area.right) / 2 - result.expectedX) < 2, `${name}: horizontal content center`);
    assert.ok(Math.abs((result.area.top + result.area.bottom) / 2 - result.expectedY) < 2, `${name}: vertical content center`);
    assert.ok(result.area.left >= result.canvas.left && result.area.right <= result.canvas.right, `${name}: content inside canvas width`);
    assert.ok(result.area.top >= result.canvas.top + 30 && result.area.bottom <= result.usableBottom, `${name}: centered content clear of header fade and bottom controls`);
    if (preview) assert.ok(result.area.right < result.preview.left, 'exact search target must remain left of its preview');
    checks[name] = result;
  }
  async function resizeViewport(width, height) {
    await page.setViewportSize({ width, height });
    await frame.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, { width, height });
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await centered('firstLoadRepairsOldCamera', 'home');
  await resizeViewport(1280, 800);
  await centered('initialHostShrink', 'home');
  assert.notDeepEqual(checks.initialHostShrink.view, checks.firstLoadRepairsOldCamera.view, 'iframe resize must recompute the camera');
  await resizeViewport(1536, 1024);
  await centered('initialHostRestore', 'home');
  await frame.getByTestId('folder-child').locator('.folder-art').dblclick();
  await centered('doubleClickEnterChild', 'child');
  await resizeViewport(1280, 800);
  await centered('tallArticleHostShrink', 'child');
  assert.notDeepEqual(checks.tallArticleHostShrink.view, checks.doubleClickEnterChild.view);
  await page.screenshot({ path: new URL('board-navigation-host-resize.png', evidence).pathname });
  await resizeViewport(1536, 1024);
  await centered('tallArticleHostRestore', 'child');
  await frame.evaluate(() => { board().view = { x: 45000, y: -33000, zoom: .6 }; applyView(); });
  await frame.getByTestId('crumb-home').click();
  await centered('breadcrumbReturnHome', 'home');
  await frame.locator('[data-action="tree"]').click();
  await frame.getByTestId('tree-board-hidden').click();
  await centered('directoryHiddenBoard', 'hidden');
  await frame.getByTestId('search').click();
  await frame.getByTestId('search-input').fill('深层内容');
  await frame.getByTestId('search-board-child').click();
  await centered('searchBoardNavigation', 'child');
  await frame.getByTestId('search').click();
  await frame.getByTestId('search-input').fill('空白层级');
  await frame.getByTestId('search-board-empty').click();
  const empty = await frame.evaluate(() => ({ view: { ...board().view }, prompt: $('empty').textContent.trim() }));
  assert.deepEqual(empty.view, { x: 0, y: 0, zoom: 1 }); assert.ok(empty.prompt); checks.emptyBoard = empty;
  await frame.getByTestId('search').click();
  await frame.getByTestId('search-input').fill('NAVIGATION_EXACT_MATCH');
  await frame.locator('[data-search-hit="Fixtures/Exact.md"][data-search-node="target"]').first().click();
  await centered('exactSearchTarget', 'child', 'target', true);
  assert.equal(await frame.getByTestId('search-matched-line').getAttribute('data-source-line'), '4');
  assert.match(await frame.getByTestId('search-matched-line').textContent(), /NAVIGATION_EXACT_MATCH/);
  await frame.locator('[data-native-open="Fixtures/Exact.md"][data-native-line="3"]').click();
  await page.waitForFunction(() => window.navHost.calls.some(c => c.method === 'open-note' && c.payload.path === 'Fixtures/Exact.md' && c.payload.line === 3));
  await page.screenshot({ path: new URL('board-navigation-search.png', evidence).pathname });
  await frame.locator('[data-action="close-preview"]').click();
  await page.setViewportSize({ width: 620, height: 900 });
  await frame.locator('[data-action="tree"]').click();
  await frame.getByTestId('tree-board-home').click();
  await centered('narrowReturnHome', 'home');
  await page.screenshot({ path: new URL('board-navigation-narrow.png', evidence).pathname });
  const positions = await frame.evaluate(() => Object.fromEntries(Object.entries(state.boards).map(([id, board]) => [id, board.nodes.map(n => ({ id: n.id, x: n.x, y: n.y }))])));
  assert.deepEqual(positions, originalPositions, 'centering must only update view and never move stored cards');
  assert.deepEqual(errors, []);
  await writeFile(new URL('board-navigation-browser.json', evidence), JSON.stringify({ passed: true, checks, positionsPreserved: true, exactLineNativeOpen: true, pageErrors: errors, chromeArgs: ['--disable-site-isolation-trials'] }, null, 2));
  console.log('Board navigation checks passed: first load, host shrink/restore including tall article, double-click entry, breadcrumb return, hidden directory, Board search, empty Board, exact article/line search, narrow return, stable card coordinates.');
} finally { await browser.close(); server.close(); }
