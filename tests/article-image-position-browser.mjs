import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
const fixtureImage = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
const data = fixtureImage('INSERTED IMAGE', '#b6ddc9');
const articlePath = 'Notes/Image article.md';
const original = '# 图片位置验收\n\n第一段：图片之前\n\n![[Assets/one.png|120x80]]\n\n第二段：需要替换\n\n![second](<Assets/two image.png> "caption")\n\n第三段：图片之后\n\n![[Assets/one.png|80]]\n\n```markdown\n![[Assets/hidden.png]]\n```\n\n行内代码 `![[Assets/hidden.png]]`\n\n尾段：最后保留';
const doc = { id: articlePath, path: articlePath, title: 'Image article', body: original, outgoing: [], backlinks: [], mtime: 1 };
const payload = { layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: { home: { id: 'home', title: '正文图片位置', parent: null, iconMode: 'default', theme: 'research', view: { x: 0, y: 0, zoom: 1 }, nodes: [{ id: 'first', type: 'article', doc: articlePath, x: 80, y: 0, w: 500, h: 660 }, { id: 'peer', type: 'article', doc: articlePath, x: 900, y: 0, w: 450, h: 660 }], edges: [] } } }, docs: { [articlePath]: doc }, assets: { 'Assets/one.png': fixtureImage('FIRST IMAGE', '#bed9ea'), 'Assets/two image.png': fixtureImage('SECOND IMAGE', '#d5c5e5'), 'Assets/hidden.png': data }, embeds: { [articlePath]: [{ path: 'Assets/one.png', link: 'Assets/one.png' }, { path: 'Assets/two image.png', link: 'Assets/two image.png' }] }, drafts: [], settings: { defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'Image position fixture' };
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(({ html, payload, data }) => {
    const iframe = document.getElementById('frame');
    window.imageHost = { ready: false, payload, calls: [], layouts: [], imported: 0, clipboard: null };
    window.imageSnapshot = () => iframe.contentWindow.postMessage({ kind: 'vb-event', channel: 'image-position', type: 'snapshot', payload: { ...payload, layout: undefined } }, '*');
    addEventListener('message', event => {
      if (event.source !== iframe.contentWindow) return;
      const message = event.data;
      if (message.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'image-position', payload }, '*'); return; }
      if (message.channel !== 'image-position') return;
      if (message.kind === 'vb-ready') { window.imageHost.ready = true; return; }
      if (message.kind !== 'vb-request') return;
      const p = message.payload; window.imageHost.calls.push({ method: message.method, payload: p });
      let result = { ok: true };
      if (message.method === 'save-layout') { payload.layout = p; window.imageHost.layouts.push(p); }
      if (message.method === 'copy-link') { window.imageHost.clipboard = p; result = { url: 'obsidian://open?file=' + encodeURIComponent(p.path) }; }
      if (message.method === 'import-image') { const path = `Assets/import-${++window.imageHost.imported}.png`; payload.assets[path] = data; result = { path, url: data }; }
      if (message.method === 'update-note') {
        const current = payload.docs[p.path];
        if (!current) result = { ok: false, reason: 'missing' };
        else if (current.body !== p.expectedBody) result = { ok: false, reason: 'conflict', current: current.body };
        else { current.body = p.body; current.mtime++; result = { ok: true, doc: current }; payload.embeds[p.path] = Object.keys(payload.assets).filter(path => p.body.includes(path)).map(path => ({ path, link: path })); }
      }
      iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'image-position', id: message.id, result }, '*');
    });
    iframe.srcdoc = html;
  }, { html, payload, data });
  await page.waitForFunction(() => window.imageHost.ready);
  const frame = page.frames().find(f => f.parentFrame()); assert.ok(frame);
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
  const paths = () => frame.locator('[data-node="first"] .vb-article-image img[data-image-path]').evaluateAll(images => images.map(image => image.dataset.imagePath));
  const originalOrder = ['Assets/one.png', 'Assets/two image.png', 'Assets/one.png'];
  assert.deepEqual(await paths(), originalOrder);
  assert.equal(await frame.locator('.card-images').count(), 0, 'images must no longer collect in a bottom gallery');
  assert.equal(await frame.evaluate(path => state.docs[path].body, articlePath), original);
  const sourceOrder = await frame.locator('[data-node="first"] .vb-inline-editor').evaluate(editor => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT), texts = []; let text;
    while (text = walker.nextNode()) texts.push(text);
    const find = word => texts.find(node => node.textContent.includes(word));
    const before = find('第一段'), middle = find('第二段'), after = find('第三段'), tail = find('尾段');
    const images = [...editor.querySelectorAll('.vb-article-image')];
    const precedes = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { beforeFirst: precedes(before, images[0]), firstBeforeMiddle: precedes(images[0], middle), middleBeforeSecond: precedes(middle, images[1]), secondBeforeAfter: precedes(images[1], after), afterBeforeThird: precedes(after, images[2]), thirdBeforeTail: precedes(images[2], tail), markdown: images.map(image => image.dataset.imageMarkdown) };
  });
  assert.ok(Object.entries(sourceOrder).filter(([key]) => key !== 'markdown').every(([, value]) => value), 'paragraph/image DOM positions must follow source order');
  assert.deepEqual(sourceOrder.markdown, ['![[Assets/one.png|120x80]]', '![second](<Assets/two image.png> "caption")', '![[Assets/one.png|80]]']);
  await page.screenshot({ path: new URL('article-image-order.png', evidence).pathname });
  const editor = frame.locator('[data-node="first"] .vb-inline-editor');
  // Real DOM Range represents the user's selection before toolbar focus leaves the body.
  async function selectText(needle, collapse = false) {
    await editor.getByText(needle, { exact: true }).click();
    await editor.evaluate((el, { needle, collapse }) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
      while (node = walker.nextNode()) {
        const start = node.textContent.indexOf(needle); if (start < 0) continue;
        const range = document.createRange(); range.setStart(node, start); range.setEnd(node, collapse ? start : start + needle.length);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return;
      }
      throw Error('selection target not found: ' + needle);
    }, { needle, collapse });
  }
  await selectText('第一段：图片之前');
  assert.equal(await editor.getAttribute('contenteditable'), 'true');
  assert.equal(await editor.locator('pre code.language-markdown').count(), 1, 'code stays rendered while the article is editable');
  const edited = original.replace('第一段：图片之前', '第一段：修改后的文字');
  await page.keyboard.insertText('第一段：修改后的文字');
  await frame.evaluate(() => VBInline.flushAll()); await editor.blur();
  assert.equal(await page.evaluate(path => window.imageHost.payload.docs[path].body, articlePath), edited, 'editing rendered text must preserve every original image token, code block and Markdown blank line');
  assert.deepEqual(await paths(), originalOrder);
  assert.deepEqual(await frame.locator('[data-node="peer"] .vb-article-image img').evaluateAll(images => images.map(image => image.dataset.imagePath)), originalOrder);
  await selectText('第二段：需要替换');
  await frame.getByTestId('add-image').click();
  await frame.getByTestId('image-file').setInputFiles({ name: 'cursor.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await frame.getByTestId('import-image').click();
  await page.waitForFunction(path => window.imageHost.payload.docs[path].body.includes('![[Assets/import-1.png]]'), articlePath);
  await frame.waitForFunction(() => !document.getElementById('modal-root').innerHTML);
  const imported = await page.evaluate(path => window.imageHost.payload.docs[path].body, articlePath);
  assert.equal(imported, edited.replace('第二段：需要替换', '![[Assets/import-1.png]]'), 'toolbar selection mapping must preserve every byte outside its selected paragraph');
  assert.equal(imported.includes('第二段：需要替换'), false, 'toolbar import must replace the selected text');
  assert.ok(imported.indexOf('Assets/import-1.png') > imported.indexOf('Assets/one.png') && imported.indexOf('Assets/import-1.png') < imported.indexOf('Assets/two image.png'), 'toolbar image must occupy the selected location');
  assert.equal(imported.endsWith('尾段：最后保留'), true, 'toolbar import must not blindly append');
  await editor.blur();
  assert.deepEqual(await paths(), ['Assets/one.png', 'Assets/import-1.png', 'Assets/two image.png', 'Assets/one.png']);
  // Simulate an image ClipboardEvent with a File; actual OS clipboard is separate.
  await selectText('第三段：图片之后', true);
  await editor.evaluate((el, png) => {
    const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, png);
  await page.waitForFunction(path => window.imageHost.payload.docs[path].body.includes('![[Assets/import-2.png]]'), articlePath);
  await frame.waitForFunction(() => !document.getElementById('modal-root').innerHTML);
  const pasted = await page.evaluate(path => window.imageHost.payload.docs[path].body, articlePath);
  assert.equal(pasted, imported.replace('第三段：图片之后', '![[Assets/import-2.png]]\n\n第三段：图片之后'), 'paste offset mapping must preserve the complete surrounding Markdown');
  assert.ok(pasted.indexOf('Assets/import-2.png') < pasted.indexOf('第三段：图片之后') && pasted.indexOf('Assets/import-2.png') > pasted.indexOf('Assets/two image.png'));
  assert.equal(pasted.endsWith('尾段：最后保留'), true, 'paste must insert at the caret instead of article end');
  await editor.blur();
  const finalOrder = ['Assets/one.png', 'Assets/import-1.png', 'Assets/two image.png', 'Assets/import-2.png', 'Assets/one.png'];
  assert.deepEqual(await paths(), finalOrder);
  await page.evaluate(() => window.imageSnapshot());
  await frame.waitForFunction(path => state.docs[path].body.includes('Assets/import-2.png'), articlePath);
  assert.deepEqual(await paths(), finalOrder);
  await frame.evaluate(() => select('first')); await frame.getByTestId('copy-selected-url').click();
  await page.waitForFunction(path => window.imageHost.clipboard?.path === path, articlePath);
  await page.screenshot({ path: new URL('article-image-caret-insertion.png', evidence).pathname });
  const beforeResize = await frame.evaluate(() => ({ ...board().nodes.find(node => node.id === 'first') }));
  const geometryScale = await frame.evaluate(() => sceneScale * board().view.zoom);
  const handle = await frame.getByTestId('resize-first-e').boundingBox(); assert.ok(handle);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 80, handle.y + handle.height / 2, { steps: 6 }); await page.mouse.up();
  const afterResize = await frame.evaluate(() => ({ ...board().nodes.find(node => node.id === 'first') }));
  const expectedWidth = Math.round((beforeResize.w + 80 / geometryScale) / 20) * 20;
  assert.equal(afterResize.w, expectedWidth); assert.equal(afterResize.x, beforeResize.x);
  assert.deepEqual(await paths(), finalOrder);
  assert.equal(await page.evaluate(path => window.imageHost.payload.docs[path].body, articlePath), pasted);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: new URL('article-image-card-resize.png', evidence).pathname });
  const checks = ['source-ordered wiki/Markdown/repeated images between exact paragraphs', 'fenced/inline code ignored without changing source', 'rendered text editing preserves original tokens, code styling and shared references', 'toolbar import replaces selection at its location', 'image paste inserts at caret and preserves tail paragraph', 'snapshot retains image order', 'article copied link retains real path', 'mouse resize preserves images and original Markdown'];
  await writeFile(new URL('article-image-position-browser.json', evidence), JSON.stringify({ passed: true, checks, sourceOrder, originalOrder, finalOrder, resizeScale: geometryScale, expectedWidth, beforeResize: { x: beforeResize.x, w: beforeResize.w }, afterResize: { x: afterResize.x, w: afterResize.w }, pageErrors: errors, pasteVerification: 'DOM ClipboardEvent with a real File in owned Chrome; OS clipboard is separate', chromeArgs: ['--disable-site-isolation-trials'] }, null, 2));
  console.log('Article image position browser checks passed: ' + checks.join('; ') + '.');
} finally { await browser.close(); server.close(); }
