import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// Opaque plugin frame; all native moves are mocked, with the actual layout save sanitizer.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const { buildSync } = require('esbuild');
const compiled = buildSync({ stdin: { contents: "export {stripEphemeral,renameReferences} from './src/model.ts'; export {relocateArticle} from './src/article-move.ts';", resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
const modelModule = { exports: {} }; new Function('require', 'module', 'exports', compiled)(require, modelModule, modelModule.exports);
const { stripEphemeral, renameReferences, relocateArticle } = modelModule.exports;
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const doc = path => ({ id: path, path, title: path.split('/').at(-1).replace(/\.md$/, ''), body: '# ' + path + '\n\nLocal text can be selected and directly edited.\n\nKeep the original body before dragging.', outgoing: [], backlinks: [], mtime: 1 });
const paths = ['Move me.md', 'Conflict.md', 'Plain.md', 'Archive/Conflict.md'];
const board = (id, title, parent, folderPath, nodes = []) => ({ id, title, parent, folderPath, folderMissing: false, theme: 'research', iconMode: 'default', iconId: 'folder', folderColor: 'mint', view: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] });
const payload = { layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: {
  home: board('home', '文章拖入文件夹验收', null, '', [
    { id: 'success-card', type: 'article', doc: 'Move me.md', folderManaged: true, x: 120, y: 40, w: 360, h: 420 },
    { id: 'conflict-card', type: 'article', doc: 'Conflict.md', folderManaged: true, x: 120, y: 500, w: 360, h: 300 },
    { id: 'plain-card', type: 'article', doc: 'Plain.md', folderManaged: true, x: 1060, y: 50, w: 300, h: 400 },
    { id: 'archive-entry', type: 'board', board: 'archive-board', folderManaged: true, x: 650, y: 80 },
  ]),
  'archive-board': board('archive-board', 'Archive', 'home', 'Archive', [{ id: 'already-conflict', type: 'article', doc: 'Archive/Conflict.md', folderManaged: true, x: 260, y: 60, w: 300, h: 360 }]),
  'other-refs': { ...board('other-refs', '跨画板引用', 'home', undefined, [{ id: 'duplicate-reference', type: 'article', doc: 'Move me.md', x: -2500, y: 8700, w: 460, h: 500 }]), hiddenFolderDocs: ['Move me.md'] },
} }, docs: Object.fromEntries(paths.map(path => [path, doc(path)])), assets: {}, embeds: {}, drafts: [], settings: { defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'Drop fixture' };
payload.layout.boards['archive-board'].hiddenFolderDocs = ['Archive/Move me.md'];
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
const errors = [], externalRequests = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { if (/^https:\/\//.test(request.url())) externalRequests.push(request.url()); });
  await page.route('https://**', route => route.abort());
  await page.exposeFunction('dropSanitize', layout => stripEphemeral(layout));
  await page.exposeFunction('dropMigrate', ({ layout, oldPath, newPath }) => renameReferences(layout, oldPath, newPath));
  await page.exposeFunction('dropRelocate', ({ layout, sourceBoard, node, targetBoard, newPath, capturedNode }) => {
    assert.equal(relocateArticle(layout, sourceBoard, node, targetBoard, newPath, capturedNode), true);
    return layout;
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(({ html, payload }) => {
    const iframe = document.getElementById('frame');
    window.dropHost = { payload, ready: false, calls: [], layouts: [], failNextMove: false, updateDelay: 100, completedUpdates: 0, nativeRenamePosted: false, layoutsAfterNativeRename: [] };
    addEventListener('message', async event => {
      if (event.source !== iframe.contentWindow) return;
      const m = event.data;
      if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'drop-channel', payload }, '*'); return; }
      if (m.channel !== 'drop-channel') return;
      if (m.kind === 'vb-ready') { window.dropHost.ready = true; return; }
      if (m.kind !== 'vb-request') return;
      window.dropHost.calls.push({ method: m.method, payload: structuredClone(m.payload) });
      let result = { ok: true }, error;
      try {
        if (m.method === 'save-layout') { payload.layout = await window.dropSanitize(m.payload); window.dropHost.layouts.push(structuredClone(payload.layout)); if(window.dropHost.nativeRenamePosted)window.dropHost.layoutsAfterNativeRename.push(structuredClone(payload.layout)); }
        else if (m.method === 'update-note') {
          await new Promise(resolve => setTimeout(resolve, window.dropHost.updateDelay));
          const d = payload.docs[m.payload.path];
          if (!d) result = { ok: false, reason: 'missing' };
          else if (d.body !== m.payload.expectedBody) result = { ok: false, reason: 'conflict', current: d.body };
          else { d.body = m.payload.body; d.mtime++; window.dropHost.completedUpdates++; result = { ok: true, doc: structuredClone(d) }; }
        } else if (m.method === 'move-article') {
          if (window.dropHost.failNextMove) { window.dropHost.failNextMove = false; throw Error('目标目录已有同名文章，无法覆盖。'); }
          const { sourceBoard, node, targetBoard } = m.payload;
          const source = payload.layout.boards[sourceBoard], target = payload.layout.boards[targetBoard];
          const entry = source.nodes.find(n => n.id === node), oldPath = entry.doc;
          const staleSnapshot = structuredClone(payload);
          const newPath = [target.folderPath, oldPath.split('/').at(-1)].filter(Boolean).join('/');
          if (payload.docs[newPath] && newPath !== oldPath) throw Error('目标目录已有同名文章，无法覆盖。');
          const d = payload.docs[oldPath];
          delete payload.docs[oldPath]; payload.docs[newPath] = { ...d, id: newPath, path: newPath, title: newPath.split('/').at(-1).replace(/\.md$/, ''), mtime: d.mtime + 1 };
          payload.layout = await window.dropMigrate({ layout: payload.layout, oldPath, newPath });
          payload.layout = await window.dropRelocate({ layout: payload.layout, sourceBoard, node, targetBoard, newPath, capturedNode: entry });
          window.dropHost.nativeRenamePosted = true;
          iframe.contentWindow.postMessage({ kind: 'vb-event', channel: 'drop-channel', type: 'rename', payload: { oldPath, newPath, folder: false, doc: structuredClone(payload.docs[newPath]) } }, '*');
          iframe.contentWindow.postMessage({ kind: 'vb-event', channel: 'drop-channel', type: 'snapshot', payload: { ...staleSnapshot, preserveView: true } }, '*');
          result = { oldPath, newPath, doc: structuredClone(payload.docs[newPath]), layout: structuredClone(payload.layout) };
        }
      } catch (e) { error = String(e.message || e); }
      iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'drop-channel', id: m.id, result, error }, '*');
    });
    iframe.srcdoc = html;
  }, { html, payload });
  await page.waitForFunction(() => window.dropHost.ready);
  const frame = page.frames().find(frame => frame.parentFrame()); assert.ok(frame);
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await frame.evaluate(() => { board().view = { x: 20, y: -10, zoom: .8 }; render(); });
  const checks = {};
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });

  assert.equal(await frame.locator('[data-node="success-card"]').count(), 1);
  await frame.locator('[data-node="success-card"]').hover();
  await frame.getByTestId('select-success-card').click();
  await page.waitForFunction(() => window.dropHost.calls.some(c => c.method === 'reveal-entry' && c.payload.path === 'Move me.md'));
  assert.equal(await frame.evaluate(() => selected), 'success-card');
  await frame.locator('[data-node="archive-entry"]').hover();
  await frame.getByTestId('select-archive-entry').click();
  await page.waitForFunction(() => window.dropHost.calls.some(c => c.method === 'reveal-entry' && c.payload.path === 'Archive'));
  assert.equal(await frame.evaluate(() => selected), 'archive-entry');
  checks.selectionRevealsNativeArticleAndFolderPaths = true;

  const targetBox = await frame.getByTestId('folder-archive-board').locator('.folder-art').boundingBox(); assert.ok(targetBox);
  const targetPoint = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  const nativeMoveCount = () => page.evaluate(() => window.dropHost.calls.filter(c => c.method === 'move-article').length);
  async function mouseGesture(start, finish, release = true) {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(finish.x, finish.y, { steps: 12 });
    if (release) await page.mouse.up();
  }
  const beforeText = await frame.evaluate(() => ({ node: { ...board().nodes.find(n => n.id === 'plain-card') }, view: { ...board().view } }));
  const plainEditor = frame.locator('[data-inline-node="plain-card"]');
  await plainEditor.click();
  const textPoint = await plainEditor.evaluate(el => {
    const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode(), range = document.createRange();
    range.setStart(node, 0); range.setEnd(node, Math.min(12, node.length));
    const r = range.getClientRects()[0]; return { x: r.left + 2, y: r.top + r.height / 2 };
  });
  await mouseGesture(textPoint, targetPoint);
  assert.equal(await nativeMoveCount(), 0, 'dragging a text selection over a folder must not move the Markdown file');
  assert.ok(await frame.evaluate(() => getSelection().toString().length > 0), 'mouse gesture must create an actual text selection');
  assert.deepEqual(await frame.evaluate(() => ({ node: { ...board().nodes.find(n => n.id === 'plain-card') }, view: { ...board().view } })), beforeText);
  await plainEditor.blur();
  checks.textSelectionDoesNotStartFolderDrop = true;

  await frame.evaluate(() => select('plain-card'));
  const beforeResize = await frame.evaluate(() => ({ ...board().nodes.find(n => n.id === 'plain-card') }));
  const handle = await frame.getByTestId('resize-plain-card-e').boundingBox(); assert.ok(handle);
  await mouseGesture({ x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, targetPoint);
  const resized = await frame.evaluate(() => ({ ...board().nodes.find(n => n.id === 'plain-card') }));
  assert.notEqual(resized.w, beforeResize.w); assert.equal(resized.x, beforeResize.x); assert.equal(resized.y, beforeResize.y);
  assert.equal(await nativeMoveCount(), 0, 'resize gesture over a folder must stay a resize');
  checks.resizeDoesNotMoveArticle = { beforeResize, resized };

  // A header drag to blank canvas remains an ordinary 20 px layout move.
  const beforePlainDrag = await frame.evaluate(() => ({ ...board().nodes.find(n => n.id === 'plain-card') }));
  const plainBox = await frame.locator('[data-node="plain-card"]').boundingBox(); assert.ok(plainBox);
  await mouseGesture({ x: plainBox.x + 55, y: plainBox.y + 18 }, { x: 1220, y: 680 });
  const afterPlainDrag = await frame.evaluate(() => ({ ...board().nodes.find(n => n.id === 'plain-card') }));
  assert.notEqual(afterPlainDrag.x, beforePlainDrag.x); assert.notEqual(afterPlainDrag.y, beforePlainDrag.y);
  assert.equal(afterPlainDrag.x % 20, 0); assert.equal(afterPlainDrag.y % 20, 0);
  assert.equal(await nativeMoveCount(), 0);
  checks.headerToBlankCanvasUsesGridMovementOnly = { beforePlainDrag, afterPlainDrag };

  const successEditor = frame.locator('[data-inline-node="success-card"]');
  await successEditor.click();
  const editedBody = '# Move me\n\nDIRECT_EDIT_BEFORE_DROP\n\nThe dirty draft must save before moving the actual Markdown file.';
  await successEditor.fill(editedBody);
  assert.equal(await frame.evaluate(() => document.activeElement?.dataset.inlineNode), 'success-card');
  assert.ok(await successEditor.innerText().then(text => text.includes('DIRECT_EDIT_BEFORE_DROP')));
  const beforeSuccess = await frame.evaluate(() => ({ current: state.currentBoard, view: { ...board().view }, nodes: board().nodes.map(n => ({ id: n.id, x: n.x, y: n.y })), duplicate: { ...state.boards['other-refs'].nodes[0] } }));
  const callStart = await page.evaluate(() => window.dropHost.calls.length);
  const dragHandle = await frame.getByTestId('drag-success-card').boundingBox(); assert.ok(dragHandle);
  await mouseGesture({ x: dragHandle.x + dragHandle.width / 2, y: dragHandle.y + dragHandle.height / 2 }, targetPoint, false);
  assert.equal(await frame.getByTestId('folder-archive-board').evaluate(el => el.classList.contains('drop-target')), true, 'article header handle must highlight the folder under the pointer');
  assert.equal(await frame.locator('.vb-folder-drop-hint').isVisible(), true);
  await page.screenshot({ path: new URL('article-folder-drop-highlight.png', evidence).pathname });
  await page.mouse.up();
  await frame.waitForFunction(() => !board().nodes.some(n => n.id === 'success-card'));
  await frame.waitForFunction(() => !document.body.classList.contains('vb-moving-article'));
  const afterSuccess = await frame.evaluate(() => ({ current: state.currentBoard, view: { ...board().view }, nodes: board().nodes.map(n => ({ id: n.id, x: n.x, y: n.y })), target: { ...state.boards['archive-board'].nodes.find(n => n.doc === 'Archive/Move me.md') }, duplicate: { ...state.boards['other-refs'].nodes[0] }, otherHidden: state.boards['other-refs'].hiddenFolderDocs, targetHidden: state.boards['archive-board'].hiddenFolderDocs, oldDocPresent: !!state.docs['Move me.md'], movedDoc: { ...state.docs['Archive/Move me.md'] } }));
  assert.equal(afterSuccess.current, beforeSuccess.current); assert.deepEqual(afterSuccess.view, beforeSuccess.view);
  assert.deepEqual(afterSuccess.nodes, beforeSuccess.nodes.filter(n => n.id !== 'success-card'));
  assert.equal(afterSuccess.target.id, 'success-card'); assert.equal(afterSuccess.target.doc, 'Archive/Move me.md');
  assert.equal(afterSuccess.target.w, 360); assert.equal(afterSuccess.target.h, 420);
  assert.equal(afterSuccess.duplicate.doc, 'Archive/Move me.md');
  assert.deepEqual({ ...afterSuccess.duplicate, doc: beforeSuccess.duplicate.doc }, beforeSuccess.duplicate);
  assert.deepEqual(afterSuccess.otherHidden, ['Archive/Move me.md'], 'unrelated hidden references follow the native path migration');
  assert.deepEqual(afterSuccess.targetHidden, [], 'the actual relocateArticle helper restores the dropped reference in the target folder');
  assert.equal(afterSuccess.oldDocPresent, false); assert.equal(afterSuccess.movedDoc.body, editedBody);
  const calls = await page.evaluate(start => window.dropHost.calls.slice(start), callStart);
  const moveIndex = calls.findIndex(c => c.method === 'move-article');
  assert.ok(moveIndex >= 0); assert.deepEqual(calls[moveIndex].payload, { sourceBoard: 'home', node: 'success-card', targetBoard: 'archive-board' });
  assert.ok(calls.slice(0, moveIndex).some(c => c.method === 'save-draft'));
  assert.ok(calls.slice(0, moveIndex).some(c => c.method === 'update-note' && c.payload.body === editedBody));
  assert.ok(calls.slice(0, moveIndex).some(c => c.method === 'clear-draft' && c.payload.body === editedBody), 'the saved recovery draft must clear before the file moves');
  assert.ok(calls.slice(0, moveIndex).some(c => c.method === 'save-layout'));
  assert.equal(await page.evaluate(() => window.dropHost.completedUpdates), 1);
  const nativeSnapshots = await page.evaluate(() => window.dropHost.layoutsAfterNativeRename);
  assert.ok(nativeSnapshots.every(layout => !layout.boards.home.nodes.some(n => n.id === 'success-card') && Object.values(layout.boards).every(b => !b.nodes.some(n => n.doc === 'Move me.md'))), 'native rename during the drop must not save an obsolete source layout');
  checks.handleDropFlushesDraftThenMovesRealPathAndAllReferencesWithoutCameraJump = { beforeSuccess, afterSuccess, nativeRequest: calls[moveIndex].payload, callOrder: calls.map(c => c.method) };
  checks.nativeRenameAndStaleSnapshotDoNotOverwriteSuccessfulMove = true;
  await page.screenshot({ path: new URL('article-folder-drop-success.png', evidence).pathname });

  await page.evaluate(() => { window.dropHost.failNextMove = true; });
  const beforeConflict = await frame.evaluate(() => ({ card: { ...board().nodes.find(n => n.id === 'conflict-card') }, view: { ...board().view } }));
  const conflictBox = await frame.locator('[data-node="conflict-card"]').boundingBox(); assert.ok(conflictBox);
  await mouseGesture({ x: conflictBox.x + 55, y: conflictBox.y + 18 }, targetPoint, false);
  assert.equal(await frame.getByTestId('folder-archive-board').evaluate(el => el.classList.contains('drop-target')), true, 'ordinary non-editable article header must support folder drop');
  await page.mouse.up();
  await page.waitForFunction(() => window.dropHost.calls.filter(c => c.method === 'move-article').length === 2);
  await frame.waitForFunction(() => !document.body.classList.contains('vb-moving-article'));
  assert.deepEqual(await frame.evaluate(() => ({ card: { ...board().nodes.find(n => n.id === 'conflict-card') }, view: { ...board().view } })), beforeConflict, 'failed native move rolls back the original card position and keeps the current camera');
  assert.equal(await frame.evaluate(() => state.docs['Conflict.md'].path), 'Conflict.md');
  assert.ok(await frame.locator('#toast').textContent().then(text => text.includes('无法覆盖')));
  assert.equal(await nativeMoveCount(), 2);
  checks.conflictRollsBackHeaderDragAndPreservesArticle = beforeConflict;
  await page.screenshot({ path: new URL('article-folder-drop-conflict.png', evidence).pathname });
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  await writeFile(new URL('article-folder-drop-browser.json', evidence), JSON.stringify({ passed: true, checks, pageErrors: errors, externalRequests, nativeMovesMocked: true, userVaultAccessed: false, chromeArgs: ['--disable-site-isolation-trials'] }, null, 2));
  console.log('Article folder drop frame checks passed.');
} catch (error) {
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
  if (page) {
    await page.screenshot({ path: new URL('article-folder-drop-failure.png', evidence).pathname }).catch(() => {});
    const failure = await page.evaluate(() => ({ host: window.dropHost, frameReady: window.dropHost?.ready })).catch(() => ({}));
    await writeFile(new URL('article-folder-drop-failure.json', evidence), JSON.stringify({ error: String(error), ...failure }, null, 2));
  }
  throw error;
} finally { await browser.close(); server.close(); }
