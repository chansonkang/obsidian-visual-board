import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
const image = 'data:image/png;base64,' + png;
const mkdoc = (path, body, outgoing = []) => ({ id: path, path, title: 'Same', body, outgoing, backlinks: [], mtime: 1 });
const docs = {
  'A/Same.md': mkdoc('A/Same.md', '# Original A\n\nLocal article text', ['B/Same.md']),
  'B/Same.md': mkdoc('B/Same.md', '# Original B'),
  'C/Same.md': mkdoc('C/Same.md', '# Original C'),
};
docs['B/Same.md'].backlinks=['A/Same.md'];
const home = { id: 'home', title: '我的桌面', parent: null, theme: 'product', view: { x: 0, y: 0, zoom: 1 }, iconMode: 'default', nodes: [
  { id: 'a', type: 'article', doc: 'A/Same.md', x: 100, y: 10, w: 280, h: 320 },
  { id: 'b', type: 'article', doc: 'B/Same.md', x: 420, y: 10, w: 280, h: 320 },
  { id: 'c', type: 'article', doc: 'C/Same.md', x: 740, y: 10, w: 280, h: 320 },
], edges: [] };
const payload = { layout: { version: 2, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: { home } }, docs, assets: {}, embeds: {}, settings: { baseUrl: 'https://example.com/v1', model: 'test-image-model', attachmentFolder: 'Assets', defaultIconMode: 'default' }, vaultName: 'Fixture Vault' };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args:['--disable-site-isolation-trials'] });
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(({ html, payload, image }) => {
    const iframe = document.getElementById('frame');
    window.testState = { payload, layouts: [], calls: [], ready: false, clipboard: null };
    window.postSnapshot = extra => iframe.contentWindow.postMessage({ kind: 'vb-event', channel: 'test-channel', type: 'snapshot', payload: { ...payload, ...extra } }, '*');
    addEventListener('message', async event => {
      if (event.source !== iframe.contentWindow) return;
      const message = event.data;
      if (message.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'test-channel', payload }, '*'); return; }
      if (message.channel !== 'test-channel') return;
      if (message.kind === 'vb-ready') { window.testState.ready = true; return; }
      if (message.kind !== 'vb-request') return;
      const { method, payload: p } = message;
      window.testState.calls.push({ method, payload: p });
      let result;
      switch (method) {
        case 'save-layout': window.testState.layouts.push(p); payload.layout = p; result = { ok: true }; break;
        case 'save-settings': Object.assign(payload.settings, p); result = payload.settings; break;
        case 'save-draft': result = { ok: true }; break;
        case 'clear-draft': result = { ok: true }; break;
        case 'create-note': { const path='Created/'+p.title+'.md'; result={id:path,path,title:p.title,body:'# '+p.title+'\n\n',outgoing:[],backlinks:[],mtime:2};payload.docs[path]=result;break; }
        case 'copy-link': window.testState.clipboard = p; result = { url: p.sourceUrl || 'obsidian://open' }; break;
        case 'generate-icon': result = { url: image, path: 'Assets/ai.png', name: p.name, model: 'test-image-model' }; payload.assets[result.path] = image; break;
        case 'import-image': result = { url: image, path: 'Assets/import.png', ...(p.url ? { sourceUrl: p.url } : {}) }; payload.assets[result.path] = image; break;
        case 'update-note': {
          const current = payload.docs[p.path];
          if (!current) result = { ok: false, reason: 'missing' };
          else if (current.body !== p.expectedBody) result = { ok: false, reason: 'conflict', current: current.body };
          else { current.body = p.body; result = { ok: true, doc: current }; }
          break;
        }
        case 'open-note': result = { ok: true }; break;
        default: result = { ok: true };
      }
      iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'test-channel', id: message.id, result }, '*');
    });
    iframe.srcdoc = html;
  }, { html, payload, image });
  await page.waitForFunction(() => window.testState.ready);
  const frame = page.frames().find(f => f.parentFrame());
  assert.ok(frame);
  assert.equal(await frame.locator('.paper').count(), 3);
  assert.match(await frame.locator('[data-node="a"]').innerText(), /Local article text/);
  assert.equal(await frame.locator('#edges .knowledge').count(), 1, 'duplicate basenames must not create a false link to C/Same.md');
  await frame.evaluate(()=>openPreview('B/Same.md'));
  assert.match(await frame.locator('#preview').innerText(),/反向链接 · 1/);
  assert.match(await frame.locator('#preview').innerText(),/A\/Same\.md/);
  await frame.evaluate(()=>$('preview').innerHTML='');
  assert.deepEqual(await frame.evaluate(() => Object.keys(state.docs)), Object.keys(docs));
  assert.equal(await frame.evaluate(() => { try { localStorage.getItem('anything'); return false; } catch { return true; } }), true, 'sandbox should not allow browser storage');
  await frame.evaluate(() => select('a'));
  await frame.getByTestId('copy-selected-url').click();
  await page.waitForFunction(() => window.testState.clipboard?.path === 'A/Same.md');
  // Direct editing and metadata refresh preserve focused draft content.
  const editor = frame.locator('[data-inline-node="a"]');
  await editor.click(); await editor.fill('# Edited A\n\nA live draft');
  await page.evaluate(() => window.postSnapshot({ docs: { ...window.testState.payload.docs, 'A/Same.md': { ...window.testState.payload.docs['A/Same.md'], body: 'stale snapshot' } } }));
  assert.match(await editor.innerText(), /A live draft/);
  await frame.evaluate(() => VBInline.flushAll());
  await editor.blur();
  // Attachment insertion updates the actual note instead of making another photo card.
  await frame.evaluate(() => select('a'));
  await frame.getByTestId('add-image').click();
  await frame.getByTestId('image-file').setInputFiles({ name: 'local.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await frame.getByTestId('import-image').click();
  await page.waitForFunction(() => window.testState.payload.docs['A/Same.md'].body.includes('![[Assets/import.png]]'));
  await frame.waitForFunction(() => document.querySelectorAll('[data-node="a"] .vb-inline-editor .vb-article-image img').length === 1);
  assert.equal(await frame.locator('[data-node="a"] .vb-inline-editor .vb-article-image img').count(), 1);
  assert.equal(await frame.locator('.card-images').count(), 0);
  assert.equal(await frame.evaluate(() => board().nodes.filter(n => n.type === 'photo').length), 0);
  // A URL image creates a local photo card and retains its original source for copy-link.
  await frame.evaluate(() => { selected = null; render(); });
  await frame.getByTestId('add-image').click();
  await frame.getByTestId('image-url').fill('https://example.com/original.png');
  await frame.getByTestId('import-image').click();
  await frame.waitForFunction(() => board().nodes.some(n => n.type === 'photo'));
  assert.equal(await frame.evaluate(() => board().nodes.find(n => n.type === 'photo').imagePath), 'Assets/import.png');
  await frame.getByTestId('copy-selected-url').click();
  await page.waitForFunction(() => window.testState.clipboard?.sourceUrl === 'https://example.com/original.png');
  // Default icons need no generation RPC; AI results persist by their local attachment path.
  await frame.evaluate(() => action('board'));
  await frame.locator('#new-board-title').fill('financial');
  await frame.getByTestId('create-board').click();
  await frame.waitForFunction(() => Object.values(state.boards).some(b => b.title === 'financial'));
  assert.equal(await frame.evaluate(() => Object.values(state.boards).find(b => b.title === 'financial').iconId), 'coins');
  assert.equal(await page.evaluate(() => window.testState.calls.filter(c => c.method === 'generate-icon').length), 0);
  await frame.evaluate(() => { action('board'); sessionApiKey = 'fixture-key'; state.imageService = { baseUrl: 'https://example.com/v1', model: 'test-image-model' }; });
  await frame.locator('#new-board-title').fill('AI space');
  await frame.locator('[data-icon-mode="ai"]').click();
  await frame.getByTestId('create-board').click();
  await frame.waitForFunction(() => Object.values(state.boards).some(b => b.title === 'AI space' && b.iconPath === 'Assets/ai.png'));
  await page.waitForFunction(() => window.testState.layouts.some(layout => Object.values(layout.boards).some(b => b.title === 'AI space' && b.iconPath === 'Assets/ai.png')));
  // Folder selection enters a nested Board, which can create and enter a deeper child.
  const financialId=await frame.evaluate(()=>Object.values(state.boards).find(b=>b.title==='financial').id);
  await frame.evaluate(id=>select(board().nodes.find(n=>n.board===id).id),financialId);
  await frame.getByTestId('enter-selected-board').click();
  assert.equal(await frame.evaluate(()=>state.currentBoard),financialId);
  await frame.getByTestId('add-board').click();
  await frame.locator('#new-board-title').fill('deeper research');
  await frame.getByTestId('create-board').click();
  await frame.getByTestId('enter-selected-board').click();
  const deepId=await frame.evaluate(()=>state.currentBoard);
  assert.equal(await frame.evaluate(()=>board().title),'deeper research');
  assert.equal(await frame.evaluate(()=>board().parent),financialId);
  await frame.getByTestId('crumb-home').click();
  // New Markdown creation routes to the host rather than writing a specimen doc record.
  await frame.getByTestId('add-article').click();
  await frame.getByTestId('library-input').fill('New local note');
  await frame.getByTestId('create-document').click();
  await frame.waitForFunction(()=>board().nodes.some(n=>n.doc==='Created/New local note.md'));
  const saved = await page.evaluate(() => window.testState.layouts.at(-1));
  assert.equal(saved.boards[deepId].parent,financialId);
  assert.ok(saved.boards[financialId].nodes.some(n=>n.board===deepId));
  assert.equal(saved.docs, undefined);
  assert.equal(Object.values(saved.boards).some(b => b.iconUrl), false);
  assert.equal(JSON.stringify(saved).includes('fixture-key'), false);
  await frame.getByTestId('zoom-value').click();
  await frame.getByTestId('zoom-preset-100').click();
  await frame.getByTestId('zoom-out').click();
  assert.equal(await frame.evaluate(() => board().view.zoom), .9);
  await frame.getByTestId('zoom-value').click();
  await frame.getByTestId('zoom-preset-50').click();
  await frame.evaluate(()=>{board().nodes.filter(n=>n.id!=='a').forEach((n,i)=>{n.x=1200+i*400;n.y=650;});render();select('a');});
  const beforeResize=await frame.evaluate(()=>({...board().nodes.find(n=>n.id==='a')}));
  const handle=await frame.getByTestId('resize-a-e').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
  await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+30,handle.y+handle.height/2,{steps:6});await page.mouse.up();
  const afterResize=await frame.evaluate(()=>({...board().nodes.find(n=>n.id==='a')}));
  assert.equal(afterResize.w-beforeResize.w,60,'30 screen pixels at 50% zoom equals three 20px layout units');
  assert.equal(afterResize.x,beforeResize.x,'resizing right edge keeps left edge fixed');
  const card=frame.locator('[data-node="a"]');
  const cardBox=await card.boundingBox();
  await page.mouse.move(cardBox.x+30,cardBox.y+18);await page.mouse.down();await page.mouse.move(cardBox.x+55,cardBox.y+33,{steps:6});await page.mouse.up();
  const afterMove=await frame.evaluate(()=>({...board().nodes.find(n=>n.id==='a')}));
  assert.notEqual(afterMove.x,afterResize.x);
  assert.equal(afterMove.x%20,0);
  assert.equal(afterMove.y%20,0);
  await page.waitForFunction(()=>window.testState.layouts.some(layout=>layout.boards.home.nodes.find(n=>n.id==='a')?.w===340));
  assert.deepEqual(errors, []);
  const evidence=new URL('../evidence/',import.meta.url);await mkdir(evidence,{recursive:true});
  await page.screenshot({path:new URL('plugin-frame-browser.png',evidence).pathname});
  // Visual evidence uses the actual default-icon preview and rendered Board at each zoom.
  const aiCallsBeforeLeaf=await page.evaluate(()=>window.testState.calls.filter(c=>c.method==='generate-icon').length);
  await frame.getByTestId('add-board').click();
  await frame.locator('#new-board-title').fill('leaf');
  await frame.locator('[data-icon-mode="default"]').click();
  const previewSvg=await frame.locator('#board-icon-preview .folder-sticker svg').evaluate(el=>el.outerHTML);
  await frame.locator('#board-icon-preview').screenshot({path:new URL('icon-vector-outline-preview.png',evidence).pathname});
  await frame.getByTestId('create-board').click();
  const leafId=await frame.evaluate(()=>Object.values(state.boards).find(b=>b.title==='leaf').id);
  assert.equal(await frame.evaluate(id=>state.boards[id].iconId,leafId),'leaf');
  const leafFolder=frame.getByTestId('folder-'+leafId);
  assert.equal(await leafFolder.locator('.folder-sticker svg').evaluate(el=>el.outerHTML),previewSvg,'default preview and created Board must render the same icon vector');
  const iconVectorOutline={previewMatchesBoard:true,zooms:{}};
  await frame.evaluate(id=>{const n=board().nodes.find(n=>n.board===id);board().view={zoom:1,x:$('canvas').clientWidth/2-(n.x+150),y:$('canvas').clientHeight/2-(n.y+151.5)};selected=null;render();},leafId);
  for(const percent of [50,100,190]){
    await frame.evaluate(percent=>setCanvasZoom(percent),percent);
    iconVectorOutline.zooms[percent]=await leafFolder.locator('.folder-sticker svg').evaluate(svg=>({rootStrokeWidth:svg.getAttribute('stroke-width'),filter:getComputedStyle(svg).filter,overflow:getComputedStyle(svg).overflow,outline:[...svg.querySelectorAll('.sticker-outline > *')].map(el=>({stroke:getComputedStyle(el).stroke,fill:getComputedStyle(el).fill,width:getComputedStyle(el).strokeWidth,linejoin:getComputedStyle(el).strokeLinejoin})),ink:[...svg.querySelectorAll('.sticker-ink > *')].map(el=>({stroke:getComputedStyle(el).stroke,fill:getComputedStyle(el).fill,width:getComputedStyle(el).strokeWidth,linejoin:getComputedStyle(el).strokeLinejoin}))}));
    assert.ok(iconVectorOutline.zooms[percent].outline.every(path=>path.fill==='rgb(255, 255, 255)'), 'leaf sticker interior must be white at '+percent+'%');
    assert.ok(iconVectorOutline.zooms[percent].ink.every(path=>path.fill==='none'), 'ink paths must preserve their open line details');
    await leafFolder.screenshot({path:new URL('icon-vector-outline-'+percent+'.png',evidence).pathname});
  }
  await page.screenshot({path:new URL('icon-vector-outline.png',evidence).pathname});
  await leafFolder.locator('.folder-name').click();
  assert.equal(await frame.evaluate(()=>state.currentBoard),leafId);
  await frame.getByTestId('crumb-home').click();
  assert.equal(await frame.evaluate(()=>state.currentBoard),'home');
  assert.equal(await page.evaluate(()=>window.testState.calls.filter(c=>c.method==='generate-icon').length),aiCallsBeforeLeaf,'default leaf creation must not invoke AI');
  assert.deepEqual(errors,[]);
  const checks=['opaque sandbox handshake without localStorage','real Markdown paths','duplicate basename graph resolution','inline editing and draft refresh','image embedded in selected article','local photo with source URL copy','default Lucide icon without AI','AI icon attachment path persistence without bodies or keys','nested child Board navigation and persistence','host-created Markdown note','zoom presets and minus','50% mouse resize with fixed opposite edge','20px grid mouse drag'];
  await writeFile(new URL('plugin-frame-verification.json',evidence),JSON.stringify({passed:true,checks,pageErrors:errors,chromeArgs:['--disable-site-isolation-trials'],notes:'Owned Chrome harness disables site isolation to avoid OOPIF footer compositor hit-test anomaly; iframe sandbox remains opaque. Native Obsidian testing is separate.',beforeResize,afterResize,afterMove,nesting:{financialId,deepId},iconVectorOutline},null,2));
  console.log('Host browser checks passed: '+checks.join(', ')+'.');
} finally { await browser.close();server.close(); }
