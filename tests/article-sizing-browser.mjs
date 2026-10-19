import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// Optional browser regression: npm run build first, install playwright-core separately.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const frameHtml = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const bodies = {
  'Fixtures/Short.md': '# Short\n\nA brief local note.',
  'Fixtures/中文长文.md': '# 中文长文\n\n' + '这是用于验证卡片尺寸的中文长文章，不应让组件随正文无限延长。'.repeat(1600) + '\n\n中文正文末尾标记',
  'Fixtures/English-long.md': '# English long article\n\n' + 'A long article should remain within a useful initial viewport and scroll independently. '.repeat(1600) + '\n\nENGLISH_END_SENTINEL',
  'Fixtures/Many-lines.md': '# Many lines\n\n' + Array.from({ length: 2200 }, (_, i) => `Line ${i + 1}: 每一行都需要保留。`).join('\n\n') + '\n\nNEWLINES_END_SENTINEL',
  'Fixtures/Manual.md': '# Manually sized\n\n' + 'Existing manual dimensions are intentional. '.repeat(100),
};
const docs = Object.fromEntries(Object.entries(bodies).map(([path, body]) => [path, { id: path, path, title: path.split('/').pop().replace(/\.md$/, ''), body, outgoing: [], backlinks: [], mtime: 1 }]));
const home = { id: 'home', title: '长文尺寸回归', parent: null, theme: 'product', view: { x: 0, y: 0, zoom: 1 }, iconMode: 'default', nodes: [
  { id: 'short', type: 'article', doc: 'Fixtures/Short.md', x: 40, y: 0 },
  { id: 'chinese', type: 'article', doc: 'Fixtures/中文长文.md', x: 340, y: 0 },
  { id: 'legacy-tall', type: 'article', doc: 'Fixtures/Many-lines.md', x: 860, y: 0, w: 200, h: 33078 },
  { id: 'legacy-narrow', type: 'article', doc: 'Fixtures/Short.md', x: 40, y: 700, w: 200, h: 1000 },
  { id: 'manual', type: 'article', doc: 'Fixtures/Manual.md', x: 1500, y: 0, w: 600, h: 900 },
], edges: [] };
const payload = { layout: { version: 2, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: { home } }, docs, assets: {}, embeds: {}, drafts: [], settings: { defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'Sizing fixture' };
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => {
    window.sizingPaints = [];
    const observe = () => {
      const cards = [...document.querySelectorAll('#nodes > .paper')];
      if (cards.length) {
        const scale = board().view.zoom * sceneScale;
        window.sizingPaints.push(cards.map(card => ({ id: card.dataset.node, w: Math.round(card.getBoundingClientRect().width / scale * 100) / 100, h: Math.round(card.getBoundingClientRect().height / scale * 100) / 100, displayScale: scale })));
      }
      if (window.sizingPaints.length < 60) requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(({ frameHtml, payload }) => {
    const iframe = document.getElementById('frame');
    window.sizingHost = { ready: false, payload, calls: [], layouts: [] };
    window.sizingSnapshot = docs => iframe.contentWindow.postMessage({ kind: 'vb-event', channel: 'sizing-channel', type: 'snapshot', payload: { ...payload, docs, layout: undefined } }, '*');
    addEventListener('message', event => {
      if (event.source !== iframe.contentWindow) return;
      const message = event.data;
      if (message.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'sizing-channel', payload }, '*'); return; }
      if (message.channel !== 'sizing-channel') return;
      if (message.kind === 'vb-ready') { window.sizingHost.ready = true; return; }
      if (message.kind !== 'vb-request') return;
      const { method, payload: p } = message;
      window.sizingHost.calls.push({ method, payload: p });
      let result = { ok: true };
      if (method === 'save-layout') { window.sizingHost.layouts.push(p); payload.layout = p; }
      else if (method === 'update-note') {
        const doc = payload.docs[p.path];
        if (!doc) result = { ok: false, reason: 'missing' };
        else if (doc.body !== p.expectedBody) result = { ok: false, reason: 'conflict', current: doc.body };
        else { doc.body = p.body; doc.mtime++; result = { ok: true, doc }; }
      }
      iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'sizing-channel', id: message.id, result }, '*');
    });
    iframe.srcdoc = frameHtml;
  }, { frameHtml, payload });
  await page.waitForFunction(() => window.sizingHost.ready);
  const frame = page.frames().find(candidate => candidate.parentFrame()); assert.ok(frame);
  await frame.waitForFunction(() => window.sizingPaints?.length > 0);
  const firstPaint = await frame.evaluate(() => window.sizingPaints[0]);
  for (const card of firstPaint) assert.ok(card.h <= 1600, `first paint overflow: ${card.id} ${card.h}`);
  for (const id of ['short', 'chinese', 'legacy-tall', 'legacy-narrow']) {
    const card = firstPaint.find(card => card.id === id); assert.ok(card);
    assert.ok(card.h <= 640, `automatic initial card exceeds 640px: ${id}`);
    assert.ok(card.w >= 280 && card.w <= 480, `automatic initial width out of bounds: ${id}`);
  }
  const firstLayout = await frame.evaluate(() => board().nodes.map(node => ({ id: node.id, w: node.w, h: node.h })));
  assert.deepEqual(firstLayout.find(node => node.id === 'manual'), { id: 'manual', w: 600, h: 900 }, 'intentional manual dimensions must survive initial rendering');
  assert.deepEqual(await frame.evaluate(() => Object.fromEntries(Object.entries(state.docs).map(([path, doc]) => [path, doc.body]))), bodies, 'sizing must not truncate article bodies');
  const scroll = await frame.locator('[data-inline-node="legacy-tall"]').evaluate(el => { const before = el.scrollTop; el.scrollTop = el.scrollHeight; return { before, after: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: getComputedStyle(el).overflowY, tailPresent: el.textContent.includes('NEWLINES_END_SENTINEL') }; });
  assert.ok(scroll.scrollHeight > scroll.clientHeight);
  assert.ok(scroll.after > scroll.before, 'long article must scroll inside its card');
  assert.ok(['auto', 'scroll'].includes(scroll.overflowY)); assert.equal(scroll.tailPresent, true);
  // Importing another long article from the real library UI must assign bounded dimensions.
  await frame.getByTestId('add-article').click();
  await frame.getByTestId('library-input').fill('English-long');
  await frame.locator('[data-search-add="Fixtures/English-long.md"]').click();
  const imported = await frame.evaluate(() => ({ ...board().nodes.find(node => node.doc === 'Fixtures/English-long.md') }));
  assert.ok(imported.w >= 280 && imported.w <= 480); assert.ok(imported.h >= 260 && imported.h <= 640);
  assert.equal(await frame.evaluate(() => state.docs['Fixtures/English-long.md'].body), bodies['Fixtures/English-long.md']);
  await frame.evaluate(() => { const imported = board().nodes.find(node => node.doc === 'Fixtures/English-long.md'); imported.x = 2000; imported.y = 0; board().view = { x: 0, y: 0, zoom: 1 }; render(); });
  // Direct editing retains bounded card geometry even when the Markdown becomes much longer.
  const chineseCard = frame.locator('[data-node="chinese"]');
  const beforeEdit = await chineseCard.boundingBox();
  const chineseEditor = frame.locator('[data-inline-node="chinese"]');
  await chineseEditor.click();
  const editedBody = bodies['Fixtures/中文长文.md'] + '\n\n' + 'Edited paragraph. '.repeat(8000) + '\nEDIT_END_SENTINEL';
  await chineseEditor.fill(editedBody);
  await frame.evaluate(() => VBInline.flushAll());
  assert.equal(await page.evaluate(() => window.sizingHost.payload.docs['Fixtures/中文长文.md'].body), editedBody);
  const afterEdit = await chineseCard.boundingBox(); assert.equal(afterEdit.width, beforeEdit.width); assert.equal(afterEdit.height, beforeEdit.height);
  await chineseEditor.blur();
  // Actual mouse resize must persist across rerender and metadata snapshots.
  await frame.evaluate(() => { for (const node of board().nodes) if (node.id !== 'chinese') { node.x = 2000; node.y = 1000; } board().view = { x: 0, y: 0, zoom: 1 }; render(); select('chinese'); });
  const beforeResize = await frame.evaluate(() => ({ ...board().nodes.find(node => node.id === 'chinese') }));
  const handle = await frame.getByTestId('resize-chinese-e').boundingBox(); assert.ok(handle);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + handle.height / 2, { steps: 8 }); await page.mouse.up();
  const resized = await frame.evaluate(() => ({ ...board().nodes.find(node => node.id === 'chinese') }));
  assert.equal(resized.w - beforeResize.w, 80); assert.equal(resized.h, beforeResize.h);
  await frame.evaluate(() => render());
  await page.evaluate(() => window.sizingSnapshot(window.sizingHost.payload.docs));
  await frame.waitForFunction(expected => board().nodes.find(node => node.id === 'chinese').w === expected, resized.w);
  const afterRefresh = await frame.evaluate(() => ({ ...board().nodes.find(node => node.id === 'chinese') }));
  assert.equal(afterRefresh.w, resized.w); assert.equal(afterRefresh.h, resized.h);
  await page.waitForFunction(width => window.sizingHost.layouts.some(layout => layout.boards.home.nodes.some(node => node.id === 'chinese' && node.w === width)), resized.w);
  const deliberateNarrow = await frame.evaluate(() => { const node = board().nodes.find(node => node.id === 'chinese'); node.w = 200; node.h = 900; render(); return { w: node.w, h: node.h, articleSizingVersion: state.articleSizingVersion }; });
  assert.deepEqual(deliberateNarrow, { w: 200, h: 900, articleSizingVersion: 1 }, 'a narrow tall manual card created after migration must not be mistaken for a legacy natural-height card');
  // The explicit fit action may reset a manually enlarged card to a sensible reading size.
  await frame.getByTestId('fit-article-size').click();
  const fitted = await frame.evaluate(() => ({ ...board().nodes.find(node => node.id === 'chinese') }));
  assert.equal(fitted.w, 480); assert.equal(fitted.h, 640);
  // Negative pan may extend a card above the canvas origin without a mask or cutoff.
  const topOverflow = await frame.evaluate(() => {
    board().view.y = -260; applyView();
    const card = document.querySelector('[data-node="chinese"]'), cardRect = card.getBoundingClientRect(), canvasRect = $('canvas').getBoundingClientRect();
    const x = cardRect.left + 20, y = canvasRect.top - 35;
    const hit = document.elementFromPoint(x, y);
    return { cardTop: cardRect.top, cardBottom: cardRect.bottom, canvasTop: canvasRect.top, point: { x, y }, hitsArticle: !!hit?.closest('#nodes > .node'), overflow: getComputedStyle($('canvas')).overflow, mask: getComputedStyle($('canvas')).maskImage, webkitMask: getComputedStyle($('canvas')).webkitMaskImage, descriptionDisplay: getComputedStyle($('subtitle').parentElement).display, hit: hit?.id || hit?.tagName };
  });
  assert.ok(topOverflow.cardTop < topOverflow.point.y && topOverflow.cardBottom > topOverflow.point.y, 'clipping check point must intersect the underlying article rectangle');
  assert.ok(topOverflow.point.y < topOverflow.canvasTop); assert.equal(topOverflow.hitsArticle, true, 'card body above the canvas origin must remain visible and accept input');
  assert.equal(topOverflow.overflow, 'visible');
  assert.equal(topOverflow.mask, 'none'); assert.equal(topOverflow.webkitMask, 'none');
  assert.equal(topOverflow.descriptionDisplay, 'none', 'Board title description must be hidden');
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: new URL('article-sizing-top-overflow.png', evidence).pathname });
  // Panning may extend a card below the initial toolbar reserve without clipping its body.
  const bottomOverflow = await frame.evaluate(() => {
    selected = null; board().view = { x: 0, y: 140, zoom: 1 }; render();
    const card = document.querySelector('[data-node="chinese"]'), cardRect = card.getBoundingClientRect(), canvasRect = $('canvas').getBoundingClientRect();
    const oldBottom = canvasRect.bottom - 125 * sceneScale;
    const x = cardRect.left + 30, y = oldBottom + 50 * sceneScale;
    const hit = document.elementFromPoint(x, y);
    return { card: cardRect.toJSON(), canvas: canvasRect.toJSON(), oldBottom, viewportBottom: innerHeight, point: { x, y }, hitNode: hit?.closest('#nodes > .node')?.dataset.node, mask: getComputedStyle($('canvas')).maskImage };
  });
  assert.ok(Math.abs(bottomOverflow.canvas.bottom - bottomOverflow.viewportBottom) < 1, 'canvas must extend to the viewport bottom');
  assert.ok(bottomOverflow.card.top < bottomOverflow.oldBottom && bottomOverflow.card.bottom > bottomOverflow.oldBottom, 'fixture must cross the former bottom cutoff');
  assert.ok(bottomOverflow.point.y > bottomOverflow.oldBottom && bottomOverflow.point.y < bottomOverflow.card.bottom && bottomOverflow.point.y < bottomOverflow.canvas.bottom);
  assert.equal(bottomOverflow.hitNode, 'chinese', 'card body below the former cutoff must remain visible and accept input');
  assert.equal(bottomOverflow.mask, 'none', 'canvas must have no mask at either edge');
  await page.screenshot({ path: new URL('article-sizing-bottom-overflow.png', evidence).pathname });
  // Long nested Board names must remain in their header slots in a narrow window.
  await frame.evaluate(() => {
    const label = '这是一个很长的项目空间名称，用于检查窄窗口中的标题与嵌套路径'.repeat(8);
    let parent = 'home';
    for (const id of ['narrow-a', 'narrow-b', 'narrow-c']) { state.boards[id] = { id, title: label, parent, theme: 'research', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] }; parent = id; }
    state.currentBoard = 'narrow-c'; selected = null; render();
  });
  await page.setViewportSize({ width: 620, height: 900 });
  await frame.waitForFunction(() => innerWidth === 620);
  await frame.evaluate(() => { fit(); render(); });
  const narrowHeader = await frame.evaluate(() => {
    const rect = id => $(id).getBoundingClientRect().toJSON();
    const search = document.querySelector('[data-testid="search"]');
    const crumb = [...$('crumbs').querySelectorAll('button')].find(button => getComputedStyle(button).display !== 'none');
    return { crumbs: rect('crumbs'), search: search.getBoundingClientRect().toJSON(), title: rect('board-title'), heading: document.querySelector('.heading').getBoundingClientRect().toJSON(), crumb: crumb?.getBoundingClientRect().toJSON(), titleEllipsis: getComputedStyle($('board-title')).textOverflow, titleWhiteSpace: getComputedStyle($('board-title')).whiteSpace, titleClientWidth: $('board-title').clientWidth, titleScrollWidth: $('board-title').scrollWidth, empty: rect('empty'), canvas: rect('canvas'), emptyText: $('empty').textContent.trim(), visibleSeparators: [...$('crumbs').querySelectorAll('span')].filter(span => getComputedStyle(span).display !== 'none').length };
  });
  assert.ok(narrowHeader.crumbs.right <= narrowHeader.search.left, 'nested breadcrumb slot must not overlap the search button');
  if (narrowHeader.crumb) assert.ok(narrowHeader.crumb.right <= narrowHeader.search.left);
  assert.ok(narrowHeader.title.top >= narrowHeader.search.bottom, 'Board heading must be below search chrome');
  assert.equal(narrowHeader.titleEllipsis, 'ellipsis'); assert.equal(narrowHeader.titleWhiteSpace, 'nowrap');
  assert.ok(narrowHeader.titleScrollWidth > narrowHeader.titleClientWidth, 'fixture must exercise actual title truncation');
  assert.ok(narrowHeader.emptyText.length > 0, 'the empty Board must show its prompt');
  assert.ok(narrowHeader.empty.width > 0 && narrowHeader.empty.height > 0);
  assert.ok(narrowHeader.empty.left >= narrowHeader.canvas.left && narrowHeader.empty.right <= narrowHeader.canvas.right, 'empty prompt must fit horizontally inside the 620px canvas');
  assert.ok(narrowHeader.empty.top >= narrowHeader.canvas.top && narrowHeader.empty.bottom <= narrowHeader.canvas.bottom, 'empty prompt must remain vertically inside the visible canvas');
  assert.ok(Math.abs((narrowHeader.empty.left + narrowHeader.empty.right) / 2 - (narrowHeader.canvas.left + narrowHeader.canvas.right) / 2) <= 1, 'empty prompt must be centered in the narrow canvas');
  assert.equal(narrowHeader.visibleSeparators, 0, 'narrow breadcrumbs must hide separators');
  await page.screenshot({ path: new URL('article-sizing-narrow-header.png', evidence).pathname });
  await page.setViewportSize({ width: 1536, height: 1024 });
  await frame.evaluate(() => { state.currentBoard = 'home'; board().view = { x: 0, y: 0, zoom: 1 }; fit(); render(); select('chinese'); });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: new URL('article-sizing-browser.png', evidence).pathname });
  await writeFile(new URL('article-sizing-browser.json', evidence), JSON.stringify({ passed: true, fixtures: Object.keys(bodies), firstPaint, firstLayout, imported: { w: imported.w, h: imported.h }, scroll, directEditingPreservedSize: true, manualSizePreserved: true, beforeResize: { w: beforeResize.w, h: beforeResize.h }, resized: { w: resized.w, h: resized.h }, afterRefresh: { w: afterRefresh.w, h: afterRefresh.h }, deliberateNarrow, fitted: { w: fitted.w, h: fitted.h }, topOverflow, bottomOverflow, narrowHeader, bodyLengths: Object.fromEntries(Object.entries(bodies).map(([path, body]) => [path, body.length])), pageErrors: errors, chromeArgs: ['--disable-site-isolation-trials'] }, null, 2));
  console.log('Article sizing browser checks passed: bounded first paint, legacy repair, full body preservation, internal scroll, bounded new import, editing stability, manual resize/snapshot persistence, explicit fit reset, no description or mask, visible top/bottom overflow, narrow long-title header, centered visible empty prompt.');
} finally { await browser.close(); server.close(); }
