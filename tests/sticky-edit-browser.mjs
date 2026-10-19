import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// Actual plugin frame, geometry and layout sanitizer; no real Vault or article writes.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const { buildSync } = require('esbuild');
const compiled = buildSync({ entryPoints: [new URL('../src/model.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
const modelModule = { exports: {} }; new Function('require', 'module', 'exports', compiled)(require, modelModule, modelModule.exports);
const { stripEphemeral } = modelModule.exports;
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const longText = Array.from({ length: 55 }, (_, i) => `第 ${i + 1} 条记录：这是需要保留的便签内容。`).join('\n');
const note = (id, title, x, y) => ({ id, type: 'note', title, text: id === 'a' ? longText : '保持原来的内容 ' + id, color: 'yellow', x, y, w: 320, h: 240 });
const payload = { layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: {
  home: { id: 'home', title: '便签编辑验收', parent: null, theme: 'research', iconMode: 'default', view: { x: 20, y: -10, zoom: .8 }, nodes: [note('a', '长便签', 240, 80), note('b', '第二张便签', 900, 520), note('c', '第三张便签', 1260, 520)], edges: [] },
} }, docs: {}, assets: {}, embeds: {}, drafts: [], settings: { defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'Sticky fixture' };
const originalContent = payload.layout.boards.home.nodes.map(({ id, title, text }) => ({ id, title, text }));
const calls = [], errors = [], externalRequests = [], checks = {};
const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
let page, frame, failSave=false;
try {
  async function initialize() {
    page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => { if (/^https:\/\//.test(request.url())) externalRequests.push(request.url()); });
    await page.route('https://**', route => route.abort());
    await page.exposeFunction('stickyFixturePayload', () => payload);
    await page.exposeFunction('stickyFixtureRPC', (method, p) => {
      calls.push({ method, payload: p });
      if (method === 'save-layout') { if(failSave)throw Error('Fixture save failure');payload.layout = stripEphemeral(p); return { ok: true }; }
      if (['update-note', 'rename-note', 'move-article'].includes(method)) throw Error('Sticky edits must never write article text');
      return { ok: true };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(html => {
      const iframe = document.getElementById('frame'); window.stickyReady = false;
      addEventListener('message', async event => {
        if (event.source !== iframe.contentWindow) return; const m = event.data;
        if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'sticky-channel', payload: await window.stickyFixturePayload() }, '*'); return; }
        if (m.channel !== 'sticky-channel') return;
        if (m.kind === 'vb-ready') { window.stickyReady = true; return; }
        if (m.kind !== 'vb-request') return;
        try { const result = await window.stickyFixtureRPC(m.method, m.payload); iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'sticky-channel', id: m.id, result }, '*'); }
        catch (e) { iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'sticky-channel', id: m.id, error: String(e.message || e) }, '*'); }
      }); iframe.srcdoc = html;
    }, html);
    await page.waitForFunction(() => window.stickyReady);
    frame = page.frames().find(frame => frame.parentFrame()); assert.ok(frame);
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  const card = id => frame.locator('#nodes>.sticky[data-node="' + id + '"]');
  const currentNode = id => frame.evaluate(id => ({ ...board().nodes.find(n => n.id === id) }), id);
  const positions = () => frame.evaluate(() => ({ view: { ...board().view }, nodes: board().nodes.map(({ id, x, y, w, h, title, text }) => ({ id, x, y, w, h, title, text })) }));
  async function resize(id, dir, dx, dy) {
    const box = await frame.getByTestId('resize-' + id + '-' + dir).boundingBox(); assert.ok(box, 'selected sticky exposes ' + dir + ' resize handle');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
  }
  await initialize();
  await frame.evaluate(() => { board().view = { x: 20, y: -10, zoom: .8 }; render(); });
  const startingView = await frame.evaluate(() => ({ ...board().view }));
  const handleResults = [];
  for (const dir of ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw']) {
    await frame.evaluate(() => { Object.assign(board().nodes.find(n => n.id === 'a'), { x: 240, y: 80, w: 320, h: 240 }); render(); });
    await frame.getByTestId('select-a').click();
    assert.equal(await card('a').locator('[data-resize]').count(), 8);
    const horizontal = /[ew]/.test(dir), vertical = /[ns]/.test(dir);
    await resize('a', dir, horizontal ? (dir.includes('w') ? -16 : 16) : 0, vertical ? (dir.includes('n') ? -16 : 16) : 0);
    const changed = await currentNode('a');
    assert.equal(changed.w, 320 + (horizontal ? 20 : 0)); assert.equal(changed.h, 240 + (vertical ? 20 : 0));
    assert.equal(changed.x, 240 - (dir.includes('w') ? 20 : 0)); assert.equal(changed.y, 80 - (dir.includes('n') ? 20 : 0));
    assert.equal(changed.title, originalContent[0].title); assert.equal(changed.text, longText);
    await frame.evaluate(() => save());
    const saved = payload.layout.boards.home.nodes.find(n => n.id === 'a');
    for (const field of ['x', 'y', 'w', 'h']) assert.equal(saved[field], changed[field]);
    handleResults.push({ dir, x: changed.x, y: changed.y, w: changed.w, h: changed.h });
  }
  await frame.evaluate(() => save());
  assert.deepEqual(await frame.evaluate(() => ({ ...board().view })), startingView);
  assert.equal(payload.layout.boards.home.nodes.find(n => n.id === 'a').w, 340);
  checks.allEightResizeHandlesUseTwentyUnitGridAndPersistGeometry = handleResults;
  await frame.evaluate(() => { Object.assign(board().nodes.find(n => n.id === 'a'), { x: 240, y: 80, w: 320, h: 240 }); render(); });
  await frame.getByTestId('select-a').click(); await resize('a', 's', 0, -64);
  const compact = await card('a').evaluate(el => { const text = el.querySelector('.excerpt'); return { cardHeight: el.offsetHeight, textClientHeight: text.clientHeight, textScrollHeight: text.scrollHeight, overflow: getComputedStyle(text).overflowY }; });
  assert.equal((await currentNode('a')).h, 160); assert.equal(compact.cardHeight, 160);
  assert.ok(compact.textScrollHeight > compact.textClientHeight); assert.ok(['auto', 'scroll'].includes(compact.overflow));
  checks.shortStickyScrollsInsideFixedCard = compact;
  await page.screenshot({ path: new URL('sticky-short-scroll.png', evidence).pathname });

  const panel = () => frame.getByTestId('sticky-style-panel');
  async function openStyle(id) {
    await frame.evaluate(id => select(id), id);
    await frame.getByTestId('edit-sticky-style').click();
    assert.equal(await panel().isVisible(), true);
    assert.equal(await frame.evaluate(() => $('modal-root').childElementCount), 0, 'editing stays in the board');
  }
  await openStyle('a');
  const beforePanel = await positions(), panelBox = await panel().boundingBox(); assert.ok(panelBox);
  await page.mouse.move(panelBox.x + 15, panelBox.y + 12); await page.mouse.down(); await page.mouse.move(panelBox.x + 48, panelBox.y + 24, { steps: 5 }); await page.mouse.up();
  assert.deepEqual(await positions(), beforePanel, 'style panel pointer gestures must not pan or move cards');
  checks.styleEditorIsInPlaceAndNeverPansBoard = true;
  const colors = ['yellow', 'green', 'pink', 'blue', 'purple', 'peach', 'white'], colorResults = [];
  for (const color of colors) {
    await openStyle('a');
    await frame.getByTestId('sticky-color-' + color).click();
    const live = await card('a').evaluate(el => ({ classes: el.className.split(/\s+/).filter(value => value && value !== 'selected').join(' '), background: getComputedStyle(el).backgroundImage, x: el.style.left, y: el.style.top }));
    assert.equal((await currentNode('a')).color, color); assert.ok(live.classes.split(' ').includes(color));
    await frame.evaluate(() => save());
    assert.equal(payload.layout.boards.home.nodes.find(n => n.id === 'a').color, color);
    await page.close(); await initialize();
    const reopened = await card('a').evaluate(el => ({ classes: el.className.split(/\s+/).filter(value => value && value !== 'selected').join(' '), background: getComputedStyle(el).backgroundImage, x: el.style.left, y: el.style.top }));
    assert.equal((await currentNode('a')).color, color); assert.deepEqual(reopened, live);
    assert.equal((await currentNode('a')).text, longText); assert.equal((await currentNode('a')).h, 160);
    colorResults.push({ color, live, reopened });
  }
  assert.equal(new Set(colorResults.map(result => result.live.background)).size, 7, 'each preset must paint its own actual background');
  checks.allSevenColorsPaintLiveSurviveSanitizedSaveAndReopen = colorResults;
  await page.screenshot({ path: new URL('sticky-seven-colors-reopened.png', evidence).pathname });

  // The node array is the actual paint order: every operation changes overlap hit testing.
  await frame.evaluate(() => {
    board().view = { x: 20, y: -10, zoom: .8 };
    for (const n of board().nodes) Object.assign(n, { x: 440, y: 200, w: 320, h: 240 });
    board().nodes.sort((a, b) => a.id.localeCompare(b.id)); render();
  });
  const overlappingGeometry = await positions();
  const overlapHit = () => card('c').evaluate(el => { const box = el.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('[data-node]')?.dataset.node; });
  const order = () => frame.evaluate(() => ({ model: board().nodes.map(n => n.id), dom: [...$('nodes').children].map(el => el.dataset.node) }));
  assert.equal(await overlapHit(), 'c');
  const layerResults = [];
  for (const { id, action, expectedOrder, top } of [
    { id: 'a', action: 'front', expectedOrder: ['b', 'c', 'a'], top: 'a' },
    { id: 'a', action: 'back', expectedOrder: ['a', 'b', 'c'], top: 'c' },
    { id: 'b', action: 'forward', expectedOrder: ['a', 'c', 'b'], top: 'b' },
    { id: 'b', action: 'backward', expectedOrder: ['a', 'b', 'c'], top: 'c' },
  ]) {
    await openStyle(id); await frame.getByTestId('sticky-order-' + action).click();
    const changedOrder = await order(); assert.deepEqual(changedOrder.model, expectedOrder); assert.deepEqual(changedOrder.dom, expectedOrder);
    assert.equal(await overlapHit(), top, action + ' must change the real overlapping painted receiver');
    const changed = await positions(); assert.deepEqual(changed.view, overlappingGeometry.view);
    assert.deepEqual(changed.nodes.slice().sort((a, b) => a.id.localeCompare(b.id)), overlappingGeometry.nodes.slice().sort((a, b) => a.id.localeCompare(b.id)));
    await frame.evaluate(() => save()); assert.deepEqual(payload.layout.boards.home.nodes.map(n => n.id), expectedOrder);
    layerResults.push({ action, id, order: changedOrder, hit: top });
  }
  checks.fourLayerActionsChangeRealHitOrderWithoutMovingOrEditingContent = layerResults;
  await frame.evaluate(() => save()); await page.close(); await initialize();
  assert.deepEqual((await order()).model, ['a', 'b', 'c']); assert.deepEqual((await order()).dom, ['a', 'b', 'c']); assert.equal(await overlapHit(), 'c');
  checks.savedLayerOrderRestoresWhenReopened = await order();

  // Drag the visible top sticky through real pointer events; camera and paint order must stay.
  await frame.evaluate(() => { board().view = { x: 20, y: -10, zoom: .8 }; render(); });
  const beforeDragView = await frame.evaluate(() => ({ ...board().view })), beforeDragOrder = await order(), beforeDragNode = await currentNode('c');
  assert.equal(beforeDragView.zoom, .8);
  const box = await frame.getByTestId('sticky-drag-c').boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width/2, box.y + box.height/2); await page.mouse.down(); await page.mouse.move(box.x + box.width/2 + 80, box.y + box.height/2 + 40, { steps: 8 }); await page.mouse.up();
  const afterDragNode = await currentNode('c');
  assert.ok(afterDragNode.x !== beforeDragNode.x || afterDragNode.y !== beforeDragNode.y);
  assert.equal(afterDragNode.x % 20, 0); assert.equal(afterDragNode.y % 20, 0);
  assert.deepEqual(await frame.evaluate(() => ({ ...board().view })), beforeDragView); assert.deepEqual(await order(), beforeDragOrder);
  assert.deepEqual((await positions()).nodes.map(({ id, title, text }) => ({ id, title, text })).sort((a, b) => a.id.localeCompare(b.id)), originalContent);
  await frame.evaluate(() => save());
  checks.realStickyDragPreservesZoomOrderAndContent = { before: beforeDragNode, after: afterDragNode, view: beforeDragView, order: beforeDragOrder };
  assert.equal(calls.some(call => ['update-note', 'rename-note', 'move-article'].includes(call.method)), false);
  assert.equal(payload.layout.docs, undefined);
  await page.screenshot({ path: new URL('sticky-layer-order-and-drag.png', evidence).pathname });
  // Existing note editing uses real fields and keeps unrelated Board data.
  await page.close();
  payload.layout={version:2,articleSizingVersion:1,currentBoard:'home',showKnowledge:true,showSpace:true,boards:{
    home:{id:'home',title:'便签内容编辑',parent:null,theme:'research',iconMode:'default',view:{x:20,y:-10,zoom:.8},nodes:[note('b','保持同伴',900,520),{...note('a','原标题',240,80),color:'pink',w:360,h:280},note('c','另一便签',1260,520)],edges:[{from:'a',to:'b',lineStyle:'dashed',width:3}]},
    child:{id:'child',title:'更深一层',parent:'home',theme:'research',iconMode:'default',view:{x:0,y:0,zoom:1},nodes:[],edges:[]},
  }};
  await initialize();await frame.evaluate(()=>{board().view={x:20,y:-10,zoom:.8};render();});await frame.evaluate(()=>save());
  const stableShape=n=>Object.fromEntries(Object.entries(n).filter(([key])=>!['title','text'].includes(key)));
  const editBaseline=await currentNode('a'),editCamera=await frame.evaluate(()=>({...board().view})),editOrder=await frame.evaluate(()=>board().nodes.map(n=>n.id)),editEdges=await frame.evaluate(()=>structuredClone(board().edges));
  const title=()=>frame.getByTestId('sticky-title-a'),body=()=>frame.getByTestId('sticky-text-a');
  failSave=true;await title().click();await title().fill('草稿标题 <img src=x onerror=alert(1)>');await title().evaluate(el=>{el.__stickyTestIdentity='native-dom';});
  await frame.evaluate(()=>VBSticky.flush());assert.equal(payload.layout.boards.home.nodes.find(n=>n.id==='a').title,'原标题');
  payload.layout.boards.home.nodes.find(n=>n.id==='a').x+=40;payload.layout.boards.home.nodes.find(n=>n.id==='a').color='blue';
  const snapshot=async()=>{await page.evaluate(async()=>document.getElementById('frame').contentWindow.postMessage({kind:'vb-event',channel:'sticky-channel',type:'snapshot',payload:{...await window.stickyFixturePayload(),preserveView:true}},'*'));await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));};
  const caretBefore=await title().evaluate(el=>{const s=getSelection();return{identity:el.__stickyTestIdentity,offset:s.rangeCount?s.getRangeAt(0).startOffset:null,active:document.activeElement===el};});await snapshot();
  assert.equal((await currentNode('a')).title,'草稿标题 <img src=x onerror=alert(1)>');assert.equal((await currentNode('a')).x,editBaseline.x+40);assert.equal((await currentNode('a')).color,'blue');
  assert.deepEqual(await title().evaluate(el=>{const s=getSelection();return{identity:el.__stickyTestIdentity,offset:s.rangeCount?s.getRangeAt(0).startOffset:null,active:document.activeElement===el};}),caretBefore);
  assert.equal(await card('a').locator('img').count(),0,'title stays safe literal text');failSave=false;await frame.evaluate(()=>VBSticky.flush());await snapshot();assert.equal(payload.layout.boards.home.nodes.find(n=>n.id==='a').title,'草稿标题 <img src=x onerror=alert(1)>');
  checks.failedAutosaveAndStaleSnapshotKeepTitleDraftCaretAndFreshGeometryStyle=true;
  const beforeBody=await currentNode('a');await body().click();await body().fill('Native body');const undoCount=await frame.evaluate(()=>VBHistory.counts);await page.keyboard.type(' marker');await page.keyboard.press('Meta+z');
  assert.equal((await body().innerText()).includes('marker'),false);assert.deepEqual(await frame.evaluate(()=>VBHistory.counts),undoCount);await page.keyboard.press('Backspace');assert.equal((await frame.evaluate(()=>board().nodes.filter(n=>n.id==='a').length)),1);assert.deepEqual(stableShape(await currentNode('a')),stableShape(beforeBody));
  await body().fill('');assert.equal((await currentNode('a')).text,'');assert.equal(await body().evaluate(el=>el.dataset.empty),'true');assert.ok((await body().boundingBox()).height>20,'empty note still exposes clickable text region');
  const inlineBody='正文 <b>不会成为HTML</b>\n第二行\n\n最后一行';await body().fill(inlineBody);await frame.evaluate(()=>render());assert.equal((await currentNode('a')).text,inlineBody);assert.equal(await card('a').locator('b').count(),0);assert.deepEqual(await frame.evaluate(()=>({...board().view})),editCamera);
  await frame.evaluate(()=>VBSticky.flush());checks.inlineTextNativeUndoBackspaceEmptyAndSafeMultilinePersist=true;
  await frame.getByTestId('edit-sticky').click();await frame.getByTestId('sticky-edit-title').fill('取消的标题');await frame.getByTestId('sticky-edit-text').fill('取消的内容');const preCancel=await currentNode('a');await frame.getByTestId('sticky-edit-cancel').click();assert.deepEqual(await currentNode('a'),preCancel);assert.equal((await frame.evaluate(()=>board().nodes.length)),3);
  await frame.getByTestId('edit-sticky').click();await frame.getByTestId('sticky-edit-title').fill('表单修改后的标题');await frame.getByTestId('sticky-edit-text').fill('表单修改后的正文\n保留换行');await frame.getByTestId('sticky-edit-save').click();await frame.evaluate(()=>VBSticky.flush());
  const formSaved=await currentNode('a');assert.equal(formSaved.title,'表单修改后的标题');assert.equal(formSaved.text,'表单修改后的正文\n保留换行');assert.deepEqual(stableShape(formSaved),stableShape(beforeBody));assert.deepEqual(await frame.evaluate(()=>board().nodes.map(n=>n.id)),editOrder);assert.deepEqual(await frame.evaluate(()=>structuredClone(board().edges)),editEdges);assert.deepEqual(await frame.evaluate(()=>({...board().view})),editCamera);
  checks.explicitEditFormCancelIsNonMutatingAndSaveUpdatesOriginalIdOnly=true;
  await body().click();await body().fill('立即切层也保留的正文');await frame.getByTestId('board-tree').click();await frame.getByTestId('tree-board-child').click();await frame.waitForFunction(()=>state.currentBoard==='child');await frame.getByTestId('crumb-home').click();await frame.waitForFunction(()=>state.currentBoard==='home');assert.equal((await currentNode('a')).text,'立即切层也保留的正文');
  await body().click();await body().fill('关闭前最后一段正文');await page.evaluate(()=>{window.stickyFlushed=false;addEventListener('message',e=>{if(e.data.kind==='vb-flushed'&&e.data.channel==='sticky-channel')window.stickyFlushed=true;});document.getElementById('frame').contentWindow.postMessage({kind:'vb-event',channel:'sticky-channel',type:'flush'},'*');});await page.waitForFunction(()=>window.stickyFlushed);assert.equal(payload.layout.boards.home.nodes.find(n=>n.id==='a').text,'关闭前最后一段正文');
  const beforeReopen=await currentNode('a');await page.close();await initialize();assert.deepEqual(await currentNode('a'),beforeReopen);assert.deepEqual(await frame.evaluate(()=>board().nodes.map(n=>n.id)),editOrder);assert.deepEqual(await frame.evaluate(()=>structuredClone(board().edges)),editEdges);
  checks.navigationAndHostCloseFlushSaveLastTypingAndReopenOriginalGeometryStyleRelations=true;
  assert.equal(calls.some(c=>['update-note','rename-note','move-article','trash-components'].includes(c.method)),false);
  await page.screenshot({path:new URL('sticky-text-edit-reopened.png',evidence).pathname});
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  await writeFile(new URL('sticky-edit-browser.json', evidence), JSON.stringify({ passed: true, checks, pageErrors: errors, externalRequests, userVaultAccessed: false }, null, 2));
  console.log('Sticky actual frame checks passed.');
} catch (error) {
  if (page) await page.screenshot({ path: new URL('sticky-edit-failure.png', evidence).pathname }).catch(() => {});
  await writeFile(new URL('sticky-edit-failure.json', evidence), JSON.stringify({ error: String(error), checks, calls, pageErrors: errors }, null, 2)); throw error;
} finally { await browser.close(); server.close(); }
