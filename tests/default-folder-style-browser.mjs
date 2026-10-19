import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// Actual opaque plugin frame; only mock host operations, no provider or user Vault access.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const { buildSync } = require('esbuild');
const compiled = buildSync({ entryPoints: [new URL('../src/model.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
const modelModule = { exports: {} }; new Function('require', 'module', 'exports', compiled)(require, modelModule, modelModule.exports);
const { stripEphemeral } = modelModule.exports;
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const board = (id, title, parent, folderPath, nodes = []) => ({ id, title, parent, folderPath, folderMissing: false, theme: 'research', iconMode: 'default', iconId: 'book-open', iconManual: true, folderColor: 'sky', view: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] });
const path = '已有空间/Exact.md';
const payload = { layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: {
  home: board('home', '默认文件夹样式', null, '', [{ id: 'existing-entry', type: 'board', board: 'existing-folder', folderManaged: true, x: 400, y: 100 }]),
  'existing-folder': board('existing-folder', '已有空间', 'home', '已有空间', [{ id: 'existing-article', type: 'article', doc: path, folderManaged: true, x: -12740, y: 8520, w: 460, h: 540 }, { id: 'nested-entry', type: 'board', board: 'existing-nested', folderManaged: true, x: -12240, y: 8500 }]),
  'existing-nested': board('existing-nested', 'Deep', 'existing-folder', '已有空间/Deep', [{ id: 'nested-note', type: 'note', title: '嵌套内容', text: 'Keep my layout', x: 380, y: 200, w: 240, h: 240 }]),
} }, docs: { [path]: { id: path, path, title: 'Exact', body: '# Exact\n\nLocal article stays in its folder', outgoing: [], backlinks: [], mtime: 1 } }, assets: {}, embeds: {}, drafts: [], settings: { baseUrl: 'https://api.apimart.ai/v1', model: 'gpt-4o-image', defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'Style fixture' };
payload.layout.boards['existing-folder'].view = { x: 12470, y: -8010, zoom: .7 };
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
const errors = [], externalRequests = [];
try {
  async function initialize(init) {
    const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => { if (/^https:\/\//.test(request.url())) externalRequests.push(request.url()); });
    await page.route('https://**', route => route.abort());
    await page.exposeFunction('saveStyleFrameLayout', layout => stripEphemeral(layout));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(({ html, init }) => {
      const iframe = document.getElementById('frame');
      window.styleHost = { payload: init, ready: false, calls: [], layouts: [], next: 0 };
      addEventListener('message', async event => {
        if (event.source !== iframe.contentWindow) return;
        const m = event.data;
        if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'style-channel', payload: init }, '*'); return; }
        if (m.channel !== 'style-channel') return;
        if (m.kind === 'vb-ready') { window.styleHost.ready = true; return; }
        if (m.kind !== 'vb-request') return;
        window.styleHost.calls.push({ method: m.method, payload: m.payload });
        let result = { ok: true }, error;
        if (m.method === 'save-layout') { init.layout = await window.saveStyleFrameLayout(m.payload); window.styleHost.layouts.push(structuredClone(init.layout)); }
        else if (m.method === 'create-folder') {
          const parent = init.layout.boards[m.payload.parentBoard], id = 'style-created-' + ++window.styleHost.next;
          const path = [parent.folderPath, m.payload.title].filter(Boolean).join('/');
          init.layout.boards[id] = { id, title: m.payload.title, parent: parent.id, folderPath: path, folderMissing: false, theme: 'research', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] };
          parent.nodes.push({ id: 'entry-' + id, type: 'board', board: id, folderManaged: true, ...m.payload.position });
          result = { path, boardId: id, layout: structuredClone(init.layout) };
        } else if (m.method === 'rename-folder') {
          const b = init.layout.boards[m.payload.board]; b.title = m.payload.title;
          result = { path: b.folderPath, boardId: b.id, layout: structuredClone(init.layout) };
        } else if (m.method === 'generate-icon') error = 'This default-style fixture must never request generated images';
        iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'style-channel', id: m.id, result, error }, '*');
      });
      iframe.srcdoc = html;
    }, { html, init });
    await page.waitForFunction(() => window.styleHost.ready);
    const frame = page.frames().find(frame => frame.parentFrame()); assert.ok(frame);
    return { page, frame };
  }
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
  const checks = {};
  let { page, frame } = await initialize(payload);

  assert.equal(await frame.getByTestId('folder-existing-folder').count(), 1);
  checks.fixtureHasRealFolderHierarchy = true;
  const colors = ['lavender', 'rose', 'peach', 'mint', 'sky', 'sand', 'slate'];
  const previewStyle = () => frame.locator('#board-icon-preview .default-folder').evaluate(el => ({ color: el.dataset.folderColor, tint: el.style.getPropertyValue('--vb-folder-tint'), filter: getComputedStyle(el.querySelector('img')).filter, sticker: el.querySelector('.folder-sticker svg').outerHTML }));
  await frame.getByTestId('add-board').click();
  await frame.getByTestId('new-board-title').fill('自然资料');
  assert.equal(await frame.getByTestId('default-folder-style').isVisible(), true);
  assert.equal(await frame.locator('[data-folder-color-choice]').count(), 7);
  const automaticSticker = (await previewStyle()).sticker;
  const colorPreviews = {};
  for (const color of colors) {
    await frame.getByTestId('folder-color-' + color).click();
    const preview = await previewStyle();
    assert.equal(preview.color, color); assert.equal(preview.sticker, automaticSticker, 'color selection must not change the sticker');
    assert.equal(await frame.getByTestId('folder-color-' + color).getAttribute('aria-pressed'), 'true');
    colorPreviews[color] = { tint: preview.tint, filter: preview.filter };
  }
  assert.equal(new Set(Object.values(colorPreviews).map(p => p.filter)).size, 7, 'all seven swatches must change the actual rendered material');
  checks.sevenColorsPreviewIndependently = colorPreviews;
  await frame.getByTestId('folder-color-mint').click();
  await frame.getByTestId('icon-picker').click();
  await frame.getByTestId('icon-book-open').click();
  const manualPreview = await previewStyle();
  assert.equal(manualPreview.color, 'mint'); assert.notEqual(manualPreview.sticker, automaticSticker);
  assert.equal(await frame.evaluate(() => chosenIcon), 'book-open');
  assert.equal(await frame.evaluate(() => manualIcon), true);
  await frame.getByTestId('new-board-title').fill('换一个名称');
  assert.equal((await previewStyle()).sticker, manualPreview.sticker, 'a manually selected sticker must survive title input');
  assert.equal((await previewStyle()).color, 'mint');
  await frame.getByTestId('folder-auto-icon').click();
  assert.equal(await frame.evaluate(() => manualIcon), false);
  assert.equal(await frame.evaluate(() => chosenIcon === matchIcon($('new-board-title').value)), true);
  assert.equal((await previewStyle()).color, 'mint', 'automatic sticker matching must keep the selected material color');
  await frame.getByTestId('icon-picker').click();
  await frame.getByTestId('icon-book-open').click();
  await frame.getByTestId('new-board-title').fill('自然资料');
  const selectedStyle = await previewStyle();
  await frame.getByTestId('mode-ai').click();
  assert.equal(await frame.getByTestId('default-folder-style').isVisible(), false);
  await frame.getByTestId('mode-default').click();
  assert.equal(await frame.getByTestId('default-folder-style').isVisible(), true);
  assert.deepEqual(await previewStyle(), selectedStyle, 'AI/default toggles preserve independent default color and manual sticker');
  assert.equal(await page.evaluate(() => window.styleHost.calls.some(c => c.method === 'generate-icon')), false);
  checks.manualStickerAndAutomaticMatchingKeepColor = true;
  checks.AIToggleHidesDefaultControlsAndPreservesChoiceWithoutGeneration = true;
  await page.screenshot({ path: new URL('default-folder-style-create-preview.png', evidence).pathname });
  await frame.getByTestId('create-board').click();
  await frame.getByTestId('new-board-title').waitFor({ state: 'detached' });
  const createdId = await frame.evaluate(() => Object.values(state.boards).find(b => b.title === '自然资料').id);
  const createdBoard = await frame.evaluate(id => ({ ...state.boards[id] }), createdId);
  assert.equal(createdBoard.folderColor, 'mint'); assert.equal(createdBoard.iconId, 'book-open'); assert.equal(createdBoard.iconManual, true);
  assert.equal(createdBoard.folderPath, '自然资料');
  const createdSticker = await frame.getByTestId('folder-' + createdId).locator('.folder-sticker svg').evaluate(el => el.outerHTML);
  assert.equal(createdSticker, selectedStyle.sticker, 'preview and saved folder render the same chosen sticker');
  assert.equal(await frame.getByTestId('folder-' + createdId).locator('.default-folder').getAttribute('data-folder-color'), 'mint');
  await frame.evaluate(() => save());
  const persistedAfterCreate = await page.evaluate(id => window.styleHost.payload.layout.boards[id], createdId);
  assert.equal(persistedAfterCreate.folderColor, 'mint'); assert.equal(persistedAfterCreate.iconId, 'book-open');
  checks.creationPersistsColorAndStickerThroughRealSanitizer = true;

  const reload = await page.evaluate(() => structuredClone(window.styleHost.payload));
  await page.close(); ({ page, frame } = await initialize(reload));
  assert.equal(await frame.evaluate(id => state.boards[id].folderColor, createdId), 'mint');
  assert.equal(await frame.evaluate(id => state.boards[id].iconId, createdId), 'book-open');
  assert.equal(await frame.getByTestId('folder-' + createdId).locator('.default-folder').getAttribute('data-folder-color'), 'mint');
  assert.equal(await frame.getByTestId('folder-' + createdId).locator('.folder-sticker svg').evaluate(el => el.outerHTML), createdSticker);
  checks.reopenRestoresDefaultColorAndStickerOffline = true;

  const beforeEdit = await frame.evaluate(() => ({ board: structuredClone(state.boards['existing-folder']), child: structuredClone(state.boards['existing-nested']), homeNodes: structuredClone(state.boards.home.nodes), homeView: { ...state.boards.home.view } }));
  await frame.evaluate(() => select('existing-entry'));
  await frame.getByTestId('selection-more').click();
  await frame.getByTestId('edit-folder-style').click();
  assert.equal(await frame.locator('.board-modal').getAttribute('aria-label'), '修改 Board 样式与名称');
  assert.equal((await previewStyle()).color, 'sky'); assert.equal(await frame.evaluate(() => chosenIcon), 'book-open');
  await frame.getByTestId('folder-color-rose').click();
  const bookWithNewColor = await previewStyle();
  assert.equal(bookWithNewColor.sticker, createdSticker, 'editing color keeps existing manual sticker');
  await frame.getByTestId('icon-picker').click();
  await frame.getByTestId('icon-leaf').click();
  const editedPreview = await previewStyle();
  assert.equal(editedPreview.color, 'rose');
  await page.screenshot({ path: new URL('default-folder-style-existing-edit.png', evidence).pathname });
  await frame.getByTestId('create-board').click();
  await frame.getByTestId('new-board-title').waitFor({ state: 'detached' });
  const afterEdit = await frame.evaluate(() => ({ board: structuredClone(state.boards['existing-folder']), child: structuredClone(state.boards['existing-nested']), homeNodes: structuredClone(state.boards.home.nodes), homeView: { ...state.boards.home.view } }));
  assert.equal(afterEdit.board.folderColor, 'rose'); assert.equal(afterEdit.board.iconId, 'leaf'); assert.equal(afterEdit.board.iconManual, true);
  for (const field of ['id', 'title', 'folderPath', 'parent', 'view', 'nodes', 'edges']) assert.deepEqual(afterEdit.board[field], beforeEdit.board[field], `editing style must preserve ${field}`);
  assert.deepEqual(afterEdit.child, beforeEdit.child); assert.deepEqual(afterEdit.homeNodes, beforeEdit.homeNodes); assert.deepEqual(afterEdit.homeView, beforeEdit.homeView);
  assert.equal(await frame.getByTestId('folder-existing-folder').locator('.default-folder').getAttribute('data-folder-color'), 'rose');
  assert.equal(await frame.getByTestId('folder-existing-folder').locator('.folder-sticker svg').evaluate(el => el.outerHTML), editedPreview.sticker);
  await frame.evaluate(() => save());
  const persistedEdited = await page.evaluate(() => window.styleHost.payload.layout.boards['existing-folder']);
  assert.equal(persistedEdited.folderColor, 'rose'); assert.equal(persistedEdited.iconId, 'leaf');
  checks.existingStyleEditPreservesIdentityFolderHierarchyAndNodeLayout = { before: beforeEdit, after: afterEdit };

  const folder = frame.getByTestId('folder-existing-folder');
  const alpha = await folder.locator('.default-folder > img').evaluate(async img => {
    await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const width = canvas.width, height = canvas.height;
    return { width, height, corners: [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3]) };
  });
  assert.ok(alpha.width > 0); assert.deepEqual(alpha.corners, [0, 0, 0, 0], 'the glass folder asset must retain transparent corners');
  const zooms = {};
  for (const percent of [50, 100, 190]) {
    await frame.evaluate(percent => {
      const n = board().nodes.find(n => n.id === 'existing-entry'), zoom = percent / 100;
      board().view = { x: $('canvas').clientWidth / 2 - (n.x + 150) * zoom, y: ($('canvas').clientHeight - 125) / 2 - (n.y + 151.5) * zoom, zoom };
      selected = null; render();
    }, percent);
    const style = await folder.locator('.default-folder').evaluate(el => {
      const svg = el.querySelector('.folder-sticker svg'), img = el.querySelector('img'), sticker = el.querySelector('.folder-sticker');
      return { color: el.dataset.folderColor, imageFilter: getComputedStyle(img).filter, backgrounds: [el, img, sticker, svg].map(part => getComputedStyle(part).backgroundColor), outline: [...svg.querySelectorAll('.sticker-outline > *')].map(path => ({ fill: getComputedStyle(path).fill, stroke: getComputedStyle(path).stroke, width: getComputedStyle(path).strokeWidth })), ink: [...svg.querySelectorAll('.sticker-ink > *')].map(path => ({ fill: getComputedStyle(path).fill, stroke: getComputedStyle(path).stroke })) };
    });
    assert.equal(style.color, 'rose'); assert.ok(style.imageFilter.includes('hue-rotate(55deg)'));
    assert.ok(style.backgrounds.every(background => background === 'rgba(0, 0, 0, 0)'), 'folder and sticker elements must not acquire a white rectangular background');
    assert.ok(style.outline.length > 0); assert.ok(style.outline.every(path => path.fill === 'rgb(255, 255, 255)'));
    assert.ok(style.ink.every(path => path.fill === 'none'));
    zooms[percent] = style;
    await folder.screenshot({ path: new URL('default-folder-style-zoom-' + percent + '.png', evidence).pathname });
  }
  checks.transparentGlassAndVectorStickerAt50_100_190 = { alpha, zooms };
  assert.equal(await page.evaluate(() => window.styleHost.calls.some(c => c.method === 'generate-icon')), false);
  checks.noImageGenerationRPC = true;

  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  await writeFile(new URL('default-folder-style-browser.json', evidence), JSON.stringify({ passed: true, checks, pageErrors: errors, externalRequests, generationMocked: true, userVaultAccessed: false, chromeArgs: ['--disable-site-isolation-trials'] }, null, 2));
  console.log('Default folder style frame checks passed.');
} finally { await browser.close(); server.close(); }
