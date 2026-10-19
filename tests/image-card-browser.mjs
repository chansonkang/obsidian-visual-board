import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const { buildSync } = require('esbuild');
function actualModule(file) {
  const compiled = buildSync({ entryPoints: [new URL('../src/' + file, import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['obsidian'], write: false }).outputFiles[0].text;
  const m = { exports: {} }; new Function('require', 'module', 'exports', compiled)(id => id === 'obsidian' ? { normalizePath: p => p.replace(/\\/g, '/').replace(/\/+$/, ''), requestUrl: () => { throw Error('Network forbidden in image fixture'); } } : require(id), m, m.exports); return m.exports;
}
const { ImageService } = actualModule('images.ts'), { sanitizeLayout } = actualModule('model.ts');
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const files = new Map(), directories = new Set(), calls = [], imports = [], checks = {}, errors = [];
const vault = { adapter: {
  exists: async p => files.has(p) || directories.has(p), mkdir: async p => directories.add(p),
  readBinary: async p => { if (!files.has(p)) throw Error('missing'); return Uint8Array.from(files.get(p)).buffer; },
}, createBinary: async (p, bytes) => { if (files.has(p)) throw Error('do not overwrite'); files.set(p, new Uint8Array(bytes)); } };
const service = new ImageService({ vault }, () => 'Attachments/Board');
const sourceBody = '# Image fixture\n\nBefore image paragraph.\n\nAfter image paragraph.';
let payload = { layout: sanitizeLayout({ version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: { home: { id: 'home', title: '真实图片卡片', parent: null, theme: 'research', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes: [
  { id: 'article', type: 'article', doc: 'Images.md', x: 100, y: 100, w: 360, h: 400 },
  { id: 'note', type: 'note', title: '保持便签', text: '位置/样式/内容', color: 'yellow', x: 740, y: 100, w: 240, h: 240 },
], edges: [] } } }), docs: { 'Images.md': { id: 'Images.md', path: 'Images.md', title: 'Images', body: sourceBody, mtime: 1, outgoing: [], backlinks: [] } }, assets: {}, mediaAssets: {}, embeds: {}, drafts: [], settings: { attachmentFolder: 'Attachments/Board', defaultIconMode: 'default' }, vaultName: 'Bitmap fixture' };
const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
const server = createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
let page, frame, fixtures;
async function boot() {
  if (page) await page.close();
  const paths = Object.values(payload.layout.boards).flatMap(b => b.nodes.map(n => n.imagePath).filter(Boolean));
  payload.assets = await service.imageAssets([...paths, ...Object.values(payload.embeds).flatMap(es => es.map(e => e.path))]);
  page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
  page.on('pageerror', error => errors.push(String(error))); await page.route('https://**', route => route.abort());
  await page.exposeFunction('bitmapPayload', () => payload);
  await page.exposeFunction('bitmapRPC', async (method, p) => {
    calls.push({ method, payload: p });
    if (method === 'import-image') { const result = await service.import(p); imports.push({ ...result, name: p.name }); return result; }
    if (method === 'image-assets') return service.imageAssets(p.paths || []);
    if (method === 'save-layout') { payload.layout = sanitizeLayout(p); return { ok: true }; }
    if (method === 'update-note') { const d = payload.docs[p.path]; if (d.body !== p.expectedBody) return { ok: false, reason: 'conflict', current: d.body }; d.body = p.body; d.mtime++; payload.embeds[p.path] = [...files.keys()].filter(path => p.body.includes(path)).map(path => ({ path, link: path })); return { ok: true, doc: d }; }
    return { ok: true };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  fixtures ||= await page.evaluate(() => Object.fromEntries([['landscape', 1200, 600, 'image/png'], ['portrait', 600, 1000, 'image/jpeg']].map(([name, width, height, mime]) => {
    const c = document.createElement('canvas'); c.width = width; c.height = height; const ctx = c.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, width, height); gradient.addColorStop(0, name === 'landscape' ? '#bbd9c7' : '#d8c4e8'); gradient.addColorStop(1, '#668baa'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 60px sans-serif'; ctx.fillText(name + ' ' + width + ' × ' + height, 40, 100);
    ctx.lineWidth = 12; ctx.strokeStyle = '#fff'; ctx.strokeRect(20, 20, width - 40, height - 40);
    return [name, { width, height, mime, name: name + (mime === 'image/png' ? '.png' : '.jpg'), url: c.toDataURL(mime, .9) }];
  })));
  await page.evaluate(html => {
    const iframe = document.getElementById('frame'); window.bitmapReady = false;
    addEventListener('message', async e => {
      if (e.source !== iframe.contentWindow) return; const m = e.data;
      if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'bitmap-channel', payload: await window.bitmapPayload() }, '*'); return; }
      if (m.channel !== 'bitmap-channel') return;
      if (m.kind === 'vb-ready') { window.bitmapReady = true; return; }
      if (m.kind !== 'vb-request') return;
      try { iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'bitmap-channel', id: m.id, result: await window.bitmapRPC(m.method, m.payload) }, '*'); }
      catch (error) { iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'bitmap-channel', id: m.id, error: error.message }, '*'); }
    }); iframe.srcdoc = html;
  }, html);
  await page.waitForFunction(() => window.bitmapReady); frame = page.frames().find(f => f.parentFrame()); assert.ok(frame);
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
const card = id => frame.locator('#nodes>.photo[data-node="' + id + '"]');
const stateOf = () => frame.evaluate(() => ({ nodes: board().nodes.map(n => ({ ...n })), view: { ...board().view }, scale: sceneScale, body: state.docs['Images.md'].body, counts: VBHistory.counts }));
const photoNodes = async () => (await stateOf()).nodes.filter(n => n.type === 'photo');
async function loaded(id, expected) {
  const selector = '#nodes>.photo[data-node="' + id + '"]>img';
  await frame.waitForFunction(({ selector, w, h }) => { const i = document.querySelector(selector); return i?.complete && i.naturalWidth === w && i.naturalHeight === h; }, { selector, w: expected.width, h: expected.height }, { timeout: 5000 });
  const result=await frame.locator(selector).evaluate(i => {
    const image=i.getBoundingClientRect(),card=i.closest('[data-node]').getBoundingClientRect();
    return { complete:i.complete,width:i.naturalWidth,height:i.naturalHeight,srcStartsData:i.src.startsWith('data:image/'),displayed:{w:i.clientWidth,h:i.clientHeight},scale:sceneScale*board().view.zoom,whiteMargins:{left:image.left-card.left,right:card.right-image.right,top:image.top-card.top,bottom:card.bottom-image.bottom} };
  });
  for(const side of Object.values(result.whiteMargins))assert.ok(Math.abs(side-10*result.scale)<.05,'every physical bitmap margin is 10 Board pixels at current zoom');
  return result;
}
async function paste(name, target = '#canvas') {
  const f = fixtures[name], count = imports.length, beforeCount = (await photoNodes()).length;
  await frame.locator(target).evaluate((el, f) => {
    const bytes = Uint8Array.from(atob(f.url.split(',')[1]), c => c.charCodeAt(0)); const file = new File([bytes], f.name, { type: f.mime });
    const clipboardData = new DataTransfer(); clipboardData.items.add(file); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, f);
  await frame.waitForFunction(count => board().nodes.filter(n => n.type === 'photo').length > count, beforeCount);
  assert.equal(imports.length, count + 1); return (await photoNodes()).at(-1);
}
async function upload(name, replaceId = null) {
  const f = fixtures[name], beforeCount = (await photoNodes()).length, count = imports.length;
  await frame.waitForFunction(() => !suppressClick);
  if (replaceId) await frame.getByTestId('replace-image-' + replaceId).click();
  else await frame.getByTestId('add-image').click();
  await frame.getByTestId('image-file').setInputFiles({ name: f.name, mimeType: f.mime, buffer: Buffer.from(f.url.split(',')[1], 'base64') });
  await frame.getByTestId('import-image').click();
  await frame.waitForFunction(() => !$('modal-root').childElementCount);
  assert.equal(imports.length, count + 1);
  if (!replaceId) assert.equal((await photoNodes()).length, beforeCount + 1);
  return (await photoNodes()).find(n => n.id === replaceId) || (await photoNodes()).at(-1);
}
const geom = n => Object.fromEntries(['x', 'y', 'w', 'h'].map(k => [k, n[k]]));
async function photo(id) { return (await photoNodes()).find(n => n.id === id); }
function ratio(n, f) { assert.ok(Math.abs((n.w-20) / (n.h-20) - f.width / f.height) < .001, 'bitmap inside the equal 10px white frame retains intrinsic aspect ratio'); }
async function selectPhoto(id) { await frame.waitForFunction(() => !suppressClick); await frame.getByTestId('select-' + id).click(); }
async function zoom(value) {
  await frame.getByTestId('zoom-value').click(); await frame.getByTestId('zoom-preset-' + value).click();
  assert.equal((await stateOf()).view.zoom, value / 100);
}
async function resizePhoto(id, dir, shrink = false) {
  await selectPhoto(id); const before = await stateOf(), r = await frame.getByTestId('resize-' + id + '-' + dir).boundingBox(); assert.ok(r);
  const hit = await frame.evaluate(r => document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-node]')?.dataset.node, r);
  assert.equal(hit, id, 'resize handle is unobscured and belongs to intended photo');
  const factor = before.scale * before.view.zoom, sign = shrink ? -1 : 1;
  const dx = /[ew]/.test(dir) ? (dir.includes('w') ? -40 : 40) * factor * sign : 0;
  const dy = /[ns]/.test(dir) ? (dir.includes('n') ? -40 : 40) * factor * sign : 0;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down(); await page.mouse.move(r.x + r.width / 2 + dx, r.y + r.height / 2 + dy, { steps: 8 }); await page.mouse.up();
  await frame.waitForFunction(() => !suppressClick); return { before, after: await stateOf() };
}
async function dragPhoto(id, dx, dy) {
  await frame.waitForFunction(() => !suppressClick); const before = await stateOf(), r = await card(id).boundingBox(); assert.ok(r);
  const factor = before.scale * before.view.zoom, x = r.x + 20, y = r.y + 35;
  const hit = await frame.evaluate(({x,y}) => document.elementFromPoint(x,y)?.closest('[data-node]')?.dataset.node, {x,y});
  assert.equal(hit,id,'drag begins on the intended visible card');
  await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x + dx * factor, y + dy * factor,{steps:12}); await page.mouse.up();
  await frame.waitForFunction(() => !suppressClick);
}
async function center() {
  await page.evaluate(() => document.getElementById('frame').contentWindow.postMessage({ kind: 'vb-event', channel: 'bitmap-channel', type: 'center-board' }, '*'));
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function saveSettled() {
  // Flush through the real host save chain, which does not manufacture geometry.
  await frame.evaluate(() => save());
  const current = await stateOf();
  assert.deepEqual(payload.layout.boards.home.nodes.filter(n => n.type === 'photo').map(geom), current.nodes.filter(n => n.type === 'photo').map(geom));
}
async function staleSnapshot() {
  await page.evaluate(async () => { const p = await window.bitmapPayload(); document.getElementById('frame').contentWindow.postMessage({ kind: 'vb-event', channel: 'bitmap-channel', type: 'snapshot', payload: { ...p, layout: undefined, assets: {}, embeds: p.embeds, preserveView: true } }, '*'); });
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function completeSnapshot() {
  payload.assets = await service.imageAssets([...files.keys()]);
  await page.evaluate(async () => document.getElementById('frame').contentWindow.postMessage({ kind: 'vb-event', channel: 'bitmap-channel', type: 'snapshot', payload: { ...await window.bitmapPayload(), layout: undefined, preserveView: true } }, '*'));
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
try {
  await boot(); const landscape = await paste('landscape'), before = await loaded(landscape.id, fixtures.landscape);
  await staleSnapshot();
  if (process.env.RACE_REPRO) {
    await frame.waitForFunction(id => { const i = document.querySelector('#nodes>.photo[data-node="' + id + '"]>img'); return i?.complete; }, landscape.id);
    const broken = await card(landscape.id).locator('>img').evaluate(i => ({ complete: i.complete, width: i.naturalWidth, height: i.naturalHeight, rawSrc: i.getAttribute('src'), alt: i.alt }));
    assert.equal(broken.width, 0, 'pre-fix stale snapshot drops the just imported asset');
    assert.equal(broken.height, 0); assert.equal(broken.rawSrc, '');
    await page.screenshot({ path: new URL('image-card-race-reproduced.png', evidence).pathname });
    await writeFile(new URL('image-card-race-reproduced.json', evidence), JSON.stringify({ reproduced: true, before, afterStaleSnapshot: broken, actualImageService: true, vaultBytes: files.get(landscape.imagePath).byteLength, userVaultAccessed: false }, null, 2));
    console.log('Reproduced: valid 1200x600 PNG becomes broken img after stale assets:{} snapshot.');
  } else {
    checks.staleSnapshotPreservesImportedBitmap = await loaded(landscape.id, fixtures.landscape);
    ratio(await photo(landscape.id), fixtures.landscape);
    assert.equal((await photo(landscape.id)).w, fixtures.landscape.width+20);assert.equal((await photo(landscape.id)).h,fixtures.landscape.height+20);
    checks.equalTenPixelWhiteFramePreservesInitialNativeBitmapSize=true;
    const inserted=await photo(landscape.id),insertView=(await stateOf()).view,bytesBeforeUndo=files.size;
    await page.keyboard.press('Control+z');assert.equal(await photo(landscape.id),undefined,'undo removes the inserted bitmap component');
    assert.equal(files.size,bytesBeforeUndo,'undo insertion retains shared local asset bytes');
    await page.keyboard.press('Control+Shift+z');assert.deepEqual(await photo(landscape.id),inserted,'redo restores exact bitmap reference and geometry');
    assert.deepEqual((await stateOf()).view,insertView);await loaded(landscape.id,fixtures.landscape);
    checks.bitmapInsertionUndoRedoPreservesAssetAndLayout=true;

    const portrait = await upload('portrait'); await loaded(portrait.id, fixtures.portrait); ratio(portrait, fixtures.portrait);
    checks.realPngJpegFilePasteAndUpload = { png: { natural: await loaded(landscape.id, fixtures.landscape), node: await photo(landscape.id) }, jpeg: { natural: await loaded(portrait.id, fixtures.portrait), node: portrait } };
    await staleSnapshot(); await loaded(landscape.id, fixtures.landscape); await loaded(portrait.id, fixtures.portrait);
    await completeSnapshot(); await loaded(landscape.id, fixtures.landscape); await loaded(portrait.id, fixtures.portrait);
    await saveSettled(); await boot();
    checks.reopenReadsActualImageServiceLocalBytes = { png: await loaded(landscape.id, fixtures.landscape), jpeg: await loaded(portrait.id, fixtures.portrait) };
    ratio(await photo(landscape.id), fixtures.landscape); ratio(await photo(portrait.id), fixtures.portrait);
    // Native-size imports may overlap their default insertion slots. Separate using a real card drag before testing handles.
    await center(); const l=await photo(landscape.id),p=await photo(portrait.id);await dragPhoto(portrait.id,l.x+l.w+400-p.x,0);await center();
    await zoom(100); const originalPhoto = geom(await photo(landscape.id));
    await zoom(50); assert.deepEqual(geom(await photo(landscape.id)), originalPhoto); await loaded(landscape.id, fixtures.landscape);
    // Center through a real host event so original-size photos and all handles are in the visible viewport.
    await page.evaluate(() => document.getElementById('frame').contentWindow.postMessage({ kind: 'vb-event', channel: 'bitmap-channel', type: 'center-board' }, '*'));
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const handleResults = [];
    for (const dir of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
      const before = await stateOf(), n = await photo(landscape.id), other = before.nodes.filter(n => n.id !== landscape.id);
      const change = await resizePhoto(landscape.id, dir), after = await photo(landscape.id);
      assert.notDeepEqual(geom(after), geom(n), dir + ' handle actually resizes'); ratio(after, fixtures.landscape);
      assert.deepEqual(change.after.view, before.view); assert.deepEqual(change.after.nodes.filter(n => n.id !== landscape.id), other);
      assert.equal(change.after.body, sourceBody); assert.equal(change.after.counts.undo, before.counts.undo + 1);
      await page.keyboard.press('Control+z'); assert.deepEqual(geom(await photo(landscape.id)), geom(n));
      await loaded(landscape.id, fixtures.landscape); assert.deepEqual((await stateOf()).view, before.view);
      handleResults.push({ dir, before: geom(n), after: geom(after), undoRestored: geom(await photo(landscape.id)) });
    }
    const shrinkBefore = await photo(portrait.id); await resizePhoto(portrait.id, 'se', true); ratio(await photo(portrait.id), fixtures.portrait);
    assert.ok((await photo(portrait.id)).w < shrinkBefore.w); await page.keyboard.press('Control+z'); assert.deepEqual(geom(await photo(portrait.id)), geom(shrinkBefore));
    checks.eightDirectionsAndPortraitShrinkRetainRatioAndUndo = handleResults;
    await page.screenshot({ path: new URL('image-cards-real-bitmaps.png', evidence).pathname });
    // Replacement changes bitmap identity and ratio while preserving the card ID/reference count.
    const beforeReplacement=await photo(landscape.id),countBeforeReplace = (await photoNodes()).length, replaced = await upload('portrait', landscape.id);
    assert.equal((await photoNodes()).length, countBeforeReplace); assert.equal(replaced.id, landscape.id);
    assert.equal(replaced.imagePath, portrait.imagePath); await loaded(replaced.id, fixtures.portrait); ratio(replaced, fixtures.portrait);
    await page.keyboard.press('Control+z');assert.deepEqual(await photo(replaced.id),beforeReplacement,'undo replacement restores original bitmap and ratio');
    await page.keyboard.press('Control+Shift+z');assert.deepEqual(await photo(replaced.id),replaced,'redo replacement restores new bitmap');
    checks.bitmapReplacementUndoRedo=true;

    await staleSnapshot(); await loaded(replaced.id, fixtures.portrait); await center();
    const replacedBase = await photo(replaced.id); await resizePhoto(replaced.id, 'e'); ratio(await photo(replaced.id), fixtures.portrait);
    await page.keyboard.press('Control+z'); assert.deepEqual(geom(await photo(replaced.id)), geom(replacedBase)); await loaded(replaced.id, fixtures.portrait);
    checks.replaceRetainsNodeIdAndNewRatioThroughHistory = { id: replaced.id, path: replaced.imagePath, natural: await loaded(replaced.id, fixtures.portrait) };
    // Shift-click actual card surfaces, then arrange via actual multi panel controls.
    await selectPhoto(replaced.id); await page.keyboard.down('Shift');
    const r = await card(portrait.id).boundingBox(); assert.ok(r); await page.mouse.click(r.x + 20, r.y + Math.min(60, r.height / 2)); await page.keyboard.up('Shift');
    await frame.waitForFunction(() => VBMultiSelection.ids.length === 2);
    const multiBefore = await stateOf(); await frame.getByTestId('multi-gap').fill('80'); await frame.getByTestId('multi-horizontal').click();
    const arranged = await stateOf(), sorted = arranged.nodes.filter(n => [replaced.id, portrait.id].includes(n.id)).sort((a, b) => a.x - b.x);
    assert.ok(Math.abs(sorted[1].x - (sorted[0].x + sorted[0].w) - 80) < .001);
    for (const n of sorted) ratio(n, fixtures.portrait);
    await page.keyboard.press('Control+z'); assert.deepEqual((await stateOf()).nodes, multiBefore.nodes);
    await loaded(replaced.id, fixtures.portrait); await loaded(portrait.id, fixtures.portrait);
    checks.photosParticipateInMultiGapAndAtomicGeometryUndo = true;
    // Make the source card's controls accessible after replacement grew the portrait's height.
    await selectPhoto(replaced.id);const articleNode=(await stateOf()).nodes.find(n=>n.id==='article'),frontPhoto=await photo(replaced.id);
    await dragPhoto(replaced.id,articleNode.x+articleNode.w+400-frontPhoto.x,0);await center();
    // Paste into a selected source position rather than blindly appending to the article.
    await frame.getByTestId('select-article').click(); const editor = frame.locator('[data-node="article"] .vb-inline-editor'); await editor.click();
    await editor.evaluate(el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
      while (n = walker.nextNode()) { const index = n.textContent.indexOf('Before image paragraph.'); if (index < 0) continue;
        const range = document.createRange(); range.setStart(n, index + 'Before image paragraph.'.length); range.collapse(true);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return;
      } throw Error('source insertion paragraph missing');
    });
    await editor.evaluate((el, f) => {
      const bytes = Uint8Array.from(atob(f.url.split(',')[1]), c => c.charCodeAt(0)), file = new File([bytes], f.name, { type: f.mime }), clipboardData = new DataTransfer(); clipboardData.items.add(file);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }, fixtures.landscape);
    await frame.waitForFunction(() => state.docs['Images.md'].body.includes('![['));
    const articleBody = (await stateOf()).body; assert.ok(articleBody.indexOf('Before image paragraph.') < articleBody.indexOf('![[')); assert.ok(articleBody.indexOf('![[') < articleBody.indexOf('After image paragraph.'));
    await editor.blur(); await frame.waitForFunction(() => { const i = document.querySelector('[data-node="article"] .vb-article-image img'); return i?.complete && i.naturalWidth === 1200 && i.naturalHeight === 600; });
    await staleSnapshot(); await frame.waitForFunction(() => { const i = document.querySelector('[data-node="article"] .vb-article-image img'); return i?.complete && i.naturalWidth === 1200 && i.naturalHeight === 600; });
    checks.articlePasteUsesSourceCaretAndDecodesBitmapThroughStaleSnapshot = true;
    await saveSettled(); await boot(); await loaded(replaced.id, fixtures.portrait); await loaded(portrait.id, fixtures.portrait);
    await frame.waitForFunction(() => { const i = document.querySelector('[data-node="article"] .vb-article-image img'); return i?.complete && i.naturalWidth === 1200 && i.naturalHeight === 600; });
    assert.equal((await stateOf()).body, articleBody); assert.equal(files.size, 2, 'actual ImageService deduplicates pasted/replaced files by bytes');
    assert.deepEqual(errors, []); checks.finalReopenPhotoAndArticleDecodeActualVaultBytes = true;
    await page.screenshot({ path: new URL('image-cards-replaced-and-article-reopened.png', evidence).pathname });
    await writeFile(new URL('image-card-browser.json', evidence), JSON.stringify({ passed: true, checks, pageErrors: errors, actualImageService: true, uniqueLocalFiles: files.size, clipboardBoundary: 'real File/DataTransfer/ClipboardEvent; no OS clipboard access', userVaultAccessed: false }, null, 2));
    console.log('Image card checks passed: actual PNG/JPEG paste/upload, stale asset race, intrinsic ratio, 8 handles/history, zoom, replace, multi, article caret and local reopen.');
  }
} catch (error) {
  if (page) await page.screenshot({ path: new URL('image-card-failure.png', evidence).pathname }).catch(() => {});
  await writeFile(new URL('image-card-failure.json', evidence), JSON.stringify({ error: String(error), checks, lastState: frame ? await stateOf().catch(() => null) : null, pageErrors: errors }, null, 2)); throw error;
} finally { await browser.close(); server.close(); }
