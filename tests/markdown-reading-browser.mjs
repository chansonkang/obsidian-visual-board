import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// Optional Chrome check of the actual built plugin frame; no user Vault or network is used.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
const path = 'Notes/Markdown.md';
const body = [
  '---', 'aliases: [Markdown 验收]', 'custom: "原样保留 : YAML"', '---', '', '# Markdown 验收', '', '## 正文二级标题', '', '段落中的 **加粗文字** 与 *斜体文字*，以及 `inlineCode()`。', '',
  '| 项目 | 数值 |', '| --- | ---: |', '| 本地文件 | 12 |', '| 双向引用 | 3 |', '',
  '- 第一项', '- 第二项', '', '1. 有序第一项', '2. 有序第二项', '', '> 引用块中的 **重要内容**。', '',
  '```javascript', 'const message = "Markdown source is preserved";', 'console.log(message);', '```', '',
  'BEFORE_IMAGE_ONE', '![[Assets/one.png|120]]', 'BETWEEN_IMAGES', '![第二张](Assets/two.png)', 'BEFORE_REPEAT', '![[Assets/one.png]]', 'AFTER_ALL_IMAGES', '',
  '[[Other#Section|原生文章链接]] 与 [Markdown 本地链接](Other.md#Section)。', '',
  '[外部链接](https://example.com/docs)', '', '![[Assets/missing.png]]', '',
  '<script>window.__markdownExecuted = true</script>', '<img src="https://example.com/evil.png" onerror="window.__markdownExecuted=true">', '', 'FULL_SOURCE_TAIL',
].join('\r\n');
const docs = {
  [path]: { id: path, path, title: 'Markdown 验收', body, outgoing: ['Notes/Other.md'], backlinks: [], mtime: 1 },
  'Notes/Other.md': { id: 'Notes/Other.md', path: 'Notes/Other.md', title: 'Other', body: '# Other\n\n## Section\n\nNative target', outgoing: [], backlinks: [path], mtime: 1 },
};
const payload = { layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: { home: { id: 'home', title: 'Markdown 阅读与编辑', parent: null, theme: 'product', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes: [{ id: 'article', type: 'article', doc: path, x: 60, y: 0, w: 620, h: 740 }, { id: 'copy', type: 'article', doc: path, x: 760, y: 0, w: 620, h: 740 }], edges: [] } } }, docs, assets: { 'Assets/one.png': pixel, 'Assets/two.png': pixel }, embeds: { [path]: [{ path: 'Assets/one.png', link: 'Assets/one.png' }, { path: 'Assets/two.png', link: 'Assets/two.png' }] }, drafts: [], settings: { defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'Markdown fixture' };
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  const errors = [], remoteRequests = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('request', request => { if (/^https:\/\//.test(request.url())) remoteRequests.push(request.url()); });
  await page.route('https://**', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(({ html, payload }) => {
    const iframe = document.getElementById('frame');
    window.markdownHost = { ready: false, payload, calls: [], layouts: [] };
    window.markdownSnapshot = () => iframe.contentWindow.postMessage({ kind: 'vb-event', channel: 'markdown-channel', type: 'snapshot', payload: { ...payload, layout: undefined } }, '*');
    addEventListener('message', event => {
      if (event.source !== iframe.contentWindow) return;
      const m = event.data;
      if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'markdown-channel', payload }, '*'); return; }
      if (m.channel !== 'markdown-channel') return;
      if (m.kind === 'vb-ready') { window.markdownHost.ready = true; return; }
      if (m.kind !== 'vb-request') return;
      window.markdownHost.calls.push({ method: m.method, payload: m.payload });
      let result = { ok: true };
      if (m.method === 'save-layout') { payload.layout = m.payload; window.markdownHost.layouts.push(m.payload); }
      else if (m.method === 'update-note') {
        const doc = payload.docs[m.payload.path];
        if (doc.body !== m.payload.expectedBody) result = { ok: false, reason: 'conflict', current: doc.body };
        else { doc.body = m.payload.body; doc.mtime++; result = { ok: true, doc }; }
      } else if (m.method === 'rename-note') {
        const p = m.payload, doc = payload.docs[p.path], next = p.path.slice(0, p.path.lastIndexOf('/') + 1) + p.title + '.md';
        delete payload.docs[p.path]; result = { ...doc, id: next, path: next, title: p.title }; payload.docs[next] = result;
      }
      iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'markdown-channel', id: m.id, result }, '*');
    });
    iframe.srcdoc = html;
  }, { html, payload });
  await page.waitForFunction(() => window.markdownHost.ready);
  const frame = page.frames().find(f => f.parentFrame()); assert.ok(frame);
  const editor = frame.locator('[data-node="article"] .vb-inline-editor'), peer = frame.locator('[data-node="copy"] .vb-inline-editor');
  await frame.waitForFunction(() => document.querySelector('.vb-markdown-read table'));
  assert.equal(await editor.getAttribute('contenteditable'), 'false');
  assert.equal(await editor.locator('h2').textContent(), '正文二级标题');
  assert.equal(await editor.locator('table thead th').count(), 2); assert.equal(await editor.locator('table tbody tr').count(), 2);
  assert.equal(await editor.locator('strong').first().textContent(), '加粗文字');
  assert.equal(await editor.locator('ul li').count(), 2); assert.equal(await editor.locator('ol li').count(), 2);
  assert.match(await editor.locator('blockquote').textContent(), /重要内容/);
  assert.match(await editor.locator('pre code.language-javascript').textContent(), /console\.log/);
  assert.equal(await editor.locator('script').count(), 0); assert.equal(await editor.locator('img[src^="https:"]').count(), 0);
  assert.equal(await frame.evaluate(() => window.__markdownExecuted), undefined);
  const imagePaths = await editor.locator('img[data-image-path]').evaluateAll(images => images.map(img => img.dataset.imagePath));
  assert.deepEqual(imagePaths, ['Assets/one.png', 'Assets/two.png', 'Assets/one.png']);
  assert.equal(await editor.locator('.vb-image-placeholder').count(), 1);
  const firstImageHTML = await editor.evaluate(el => el.innerHTML);
  assert.ok(firstImageHTML.indexOf('BEFORE_IMAGE_ONE') < firstImageHTML.indexOf('data-image-path="Assets/one.png"'));
  assert.ok(firstImageHTML.indexOf('data-image-path="Assets/one.png"') < firstImageHTML.indexOf('BETWEEN_IMAGES'));
  assert.ok(firstImageHTML.indexOf('BEFORE_REPEAT') < firstImageHTML.lastIndexOf('data-image-path="Assets/one.png"'));
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: new URL('markdown-reading-browser.png', evidence).pathname });
  const beforeGeometry = await frame.evaluate(() => ({ ...board().nodes.find(n => n.id === 'article') }));
  // Modified link clicks use host navigation; ordinary clicks remain available for editing.
  await editor.locator('a[data-vb-note-link]').click({ modifiers: ['Meta'] });
  await page.waitForFunction(() => window.markdownHost.calls.some(c => c.method === 'open-note' && c.payload.path === 'Notes/Other.md'));
  await editor.locator('a[data-vb-markdown-link="Other.md#Section"]').click({ modifiers: ['Meta'] });
  await editor.locator('a[data-vb-markdown-link="https://example.com/docs"]').click({ modifiers: ['Meta'] });
  await page.waitForFunction(() => window.markdownHost.calls.some(c => c.method === 'open-external'));
  assert.equal(await editor.getAttribute('data-markdown-mode'), 'read');
  assert.equal(frame.url(), 'about:srcdoc');
  // Use physical mouse clicks on the rendered heading to enter in-place editing.
  async function clickReadingHeading() {
    await editor.evaluate(el => { el.scrollTop = 0; });
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    const box = await editor.locator('h2').boundingBox(); assert.ok(box);
    await page.mouse.click(box.x + Math.min(40, box.width / 2), box.y + box.height / 2);
  }
  const semanticStyle = () => editor.evaluate(el => ({
    headingSize: getComputedStyle(el.querySelector('h2')).fontSize,
    headingWeight: getComputedStyle(el.querySelector('h2')).fontWeight,
    strongWeight: getComputedStyle(el.querySelector('strong')).fontWeight,
    tableBorder: getComputedStyle(el.querySelector('td')).borderTopStyle,
    codeFont: getComputedStyle(el.querySelector('pre code')).fontFamily,
    codeBackground: getComputedStyle(el.querySelector('pre')).backgroundColor,
  }));
  const originalStyle = await semanticStyle();
  const assertSemantics = async () => {
    assert.equal(await editor.locator('table thead th').count(), 2);
    assert.equal(await editor.locator('table tbody tr').count(), 2);
    assert.equal(await editor.locator('h2').count(), 1);
    assert.equal(await editor.locator('strong').first().count(), 1);
    assert.equal(await editor.locator('ul li').count(), 2);
    assert.match(await editor.locator('pre code.language-javascript').textContent(), /console\.log/);
    assert.deepEqual(await semanticStyle(), originalStyle, 'editing must retain semantic rendering and its actual styles');
  };
  async function selectRendered(needle) {
    await editor.evaluate((el, needle) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
      while (node = walker.nextNode()) {
        if (node.parentElement?.closest('.vb-article-image')) continue;
        const start = node.nodeValue.indexOf(needle); if (start < 0) continue;
        const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + needle.length);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return;
      }
      throw Error('Rendered text not found: ' + needle);
    }, needle);
  }
  // Opening and blurring the rendered article must preserve its exact original bytes.
  await clickReadingHeading(); assert.equal(await editor.getAttribute('contenteditable'), 'true');
  await assertSemantics();
  assert.equal(await editor.locator('h1').count(), 0, 'the card title remains hidden in the rendered body');
  assert.equal((await editor.textContent()).includes('custom:'), false, 'frontmatter stays outside the editable DOM');
  await editor.blur();
  await frame.evaluate(() => VBInline.flushAll());
  assert.equal(await page.evaluate(path => window.markdownHost.payload.docs[path].body, path), body);
  assert.equal(await page.evaluate(() => window.markdownHost.calls.filter(c => c.method === 'update-note').length), 0, 'focus/blur alone must never rewrite the original Markdown');
  // Edit rendered heading/strong text through real keyboard input, never replace the source DOM.
  await clickReadingHeading();
  assert.equal(await editor.getAttribute('data-markdown-mode'), 'edit');
  assert.equal(await editor.evaluate(el => document.activeElement === el), true);
  await selectRendered('正文二级标题'); await page.keyboard.insertText('正文二级标题已编辑');
  await editor.locator('strong').first().click(); await selectRendered('加粗文字');
  await editor.evaluate(el => { el.__editingIdentity = 'rendered-editor'; });
  await editor.dispatchEvent('compositionstart', {data:''});
  await page.keyboard.insertText('保存后的加粗');
  await assertSemantics();
  await editor.evaluate(() => { window.__markdownCaretNode=getSelection().anchorNode; window.__markdownCaretOffset=getSelection().anchorOffset; });
  await page.evaluate(() => window.markdownSnapshot());
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const snapshotState = await editor.evaluate(el => ({identity:el.__editingIdentity,active:document.activeElement===el,mode:el.dataset.markdownMode,activeTag:document.activeElement?.outerHTML?.slice(0,160),tail:el.textContent.slice(-100)}));
  assert.equal(snapshotState.identity === 'rendered-editor' && snapshotState.active, true, JSON.stringify(snapshotState));
  assert.match(await editor.textContent(), /保存后的加粗/);
  assert.equal(await editor.evaluate(() => getSelection().anchorNode===window.__markdownCaretNode&&getSelection().anchorOffset===window.__markdownCaretOffset), true);
  assert.equal(await frame.evaluate(() => VBInline.flushAll()), false, 'active IME composition must not be submitted');
  await editor.dispatchEvent('compositionend', {data:'保存后的加粗'});
  await frame.evaluate(() => VBInline.flushAll());
  const expected = body.replace('正文二级标题', '正文二级标题已编辑').replace('加粗文字', '保存后的加粗');
  assert.equal(await page.evaluate(path => window.markdownHost.payload.docs[path].body, path), expected);
  await editor.blur();
  await frame.waitForFunction(() => document.querySelector('[data-node="article"] .vb-markdown-read h2')?.textContent === '正文二级标题已编辑');
  assert.equal(await editor.locator('strong').first().textContent(), '保存后的加粗');
  assert.equal(await peer.locator('h2').textContent(), '正文二级标题已编辑');
  assert.equal(await peer.locator('strong').first().textContent(), '保存后的加粗');
  assert.deepEqual(await editor.locator('img[data-image-path]').evaluateAll(images => images.map(img => img.dataset.imagePath)), imagePaths);
  assert.equal(await editor.locator('table tbody tr').count(), 2);
  const updates = await page.evaluate(() => window.markdownHost.calls.filter(c => c.method === 'update-note'));
  assert.equal(updates.at(-1).payload.body, expected); assert.equal(updates[0].payload.expectedBody, body);
  assert.equal(await page.evaluate(() => window.markdownHost.layouts.some(layout => JSON.stringify(layout).includes('FULL_SOURCE_TAIL'))), false, 'source must not enter layout persistence');
  assert.deepEqual(await frame.evaluate(() => ({ ...board().nodes.find(n => n.id === 'article') })), beforeGeometry);
  const title=frame.locator('[data-node=\"article\"] .vb-inline-title');
  await title.click();await title.fill('阅读标题已修改');await title.press('Enter');
  await frame.waitForFunction(() => state.docs['Notes/阅读标题已修改.md']);
  assert.equal(await editor.locator('h2').textContent(), '正文二级标题已编辑');
  assert.equal(await peer.locator('table tbody tr').count(), 2);
  assert.equal(await frame.evaluate(() => state.docs['Notes/阅读标题已修改.md'].body), expected);
  assert.deepEqual(await frame.evaluate(() => ({...board().nodes.find(n=>n.id==='article')})), {...beforeGeometry,doc:'Notes/阅读标题已修改.md'});
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  await editor.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.screenshot({ path: new URL('markdown-reading-after-edit.png', evidence).pathname });
  await writeFile(new URL('markdown-reading-browser.json', evidence), JSON.stringify({ passed: true, rendered: ['heading', 'thead', 'tbody', 'strong', 'unordered list', 'ordered list', 'blockquote', 'inline code', 'fenced code'], stylesPreservedWhileEditing: originalStyle, sourceOrderedImages: imagePaths, localPlaceholderCount: 1, rawHTMLExecutable: false, localLinksUseNativeRPC: true, externalLinkUsesNativeRPC: true, renderedFocusAndExactCRLFRoundTrip: true, hiddenFrontmatterAndH1Preserved: true, snapshotPreservesActiveRenderedEditor: true, caretAndCompositionPreserved: true, titleRenameStillWorks: true, fullSourceAndImageMarkersPreserved: true, peerReadingUpdated: true, geometryUnchanged: true, sourceExcludedFromLayout: true, updateCount: updates.length, finalSourceLength: expected.length, pageErrors: errors, externalRequests: remoteRequests, chromeArgs: ['--disable-site-isolation-trials'] }, null, 2));
  console.log('Markdown reading checks passed: rendered editing and styles, safe local images/links, exact CRLF/frontmatter save, snapshot/peer preservation, unchanged card geometry.');
} finally { await browser.close(); server.close(); }
