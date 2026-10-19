import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const temporary = await mkdtemp(path.join(tmpdir(), 'vb-folder-browser-'));
await build({ stdin: { contents: `export {FolderBridge} from './src/folders.ts'; export {syncFolderLayout,migrateFolderPaths,findFolderBoard} from './src/folder-layout.ts'; export {sanitizeLayout} from './src/model.ts';`, resolveDir: new URL('../', import.meta.url).pathname }, outfile: path.join(temporary, 'folder-fixture.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { FolderBridge, syncFolderLayout, migrateFolderPaths, findFolderBoard, sanitizeLayout } = await import(pathToFileURL(path.join(temporary, 'folder-fixture.mjs')));
const frameHtml = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const makeDoc = (file, body = 'A real local fixture body') => ({ id: file, path: file, title: file.split('/').at(-1).replace(/\.md$/i, ''), body: '# ' + file + '\n\n' + body, outgoing: [], backlinks: [], mtime: 1 });
const docs = Object.fromEntries(['Root.md', 'Projects/Research/Note.md', 'Projects/Research/Deep/Note.md', 'Archive/Research/Note.md'].map(file => [file, makeDoc(file)]));
const makeBoard = (id, title, parent, nodes = []) => ({ id, title, parent, theme: 'research', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] });
const payload = { layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: {
  home: makeBoard('home', 'Folder fixture', null),
  'legacy-free': makeBoard('legacy-free', '已有自由 Board', 'home', [{ id: 'legacy-note', type: 'note', title: '自由空间保留', text: 'Not a real folder mapping', x: 320, y: 100, w: 280, h: 240 }]),
} }, docs, assets: {}, embeds: {}, drafts: [], settings: { defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'Folder fixture' };
payload.layout.boards.home.nodes.push({ id: 'legacy-entry', type: 'board', board: 'legacy-free', x: 1000, y: 300 });
const files = new Map();
const root = { path: '/', name: '/', children: [] };
for (const folder of ['Projects', 'Projects/Research', 'Projects/Research/Deep', 'Archive', 'Archive/Research']) files.set(folder, { path: folder, name: folder.split('/').at(-1), children: [] });
for (const file of Object.keys(docs)) files.set(file, { path: file, name: file.split('/').at(-1), extension: 'md' });
const app = { vault: {
  getAbstractFileByPath: file => files.get(file), getRoot: () => root, getAllLoadedFiles: () => [...files.values()],
  createFolder: async folder => { if (files.has(folder)) throw Error('exists'); files.set(folder, { path: folder, name: folder.split('/').at(-1), children: [] }); },
}, fileManager: { renameFile: async (file, newPath) => {
  const oldPath = file.path;
  for (const [current, entry] of [...files]) if (current === oldPath || current.startsWith(oldPath + '/')) {
    const next = newPath + current.slice(oldPath.length); files.delete(current); files.set(next, { ...entry, path: next, name: next.split('/').at(-1) });
  }
} } };
const folders = new FolderBridge(app);
function synchronize() { syncFolderLayout(payload.layout, folders.list(), [...files.values()].filter(file => file.extension === 'md').map(file => file.path)); return { ...clone(payload), preserveView: true }; }
function migrateDocs(oldPath, newPath) {
  const migrate = value => value === oldPath || value.startsWith(oldPath + '/') ? newPath + value.slice(oldPath.length) : value;
  for (const [file, doc] of Object.entries(payload.docs)) {
    const next = migrate(file); if (file === next) continue;
    delete payload.docs[file]; payload.docs[next] = { ...doc, id: next, path: next, outgoing: doc.outgoing.map(migrate), backlinks: doc.backlinks.map(migrate) };
  }
  migrateFolderPaths(payload.layout, oldPath, newPath);
}
synchronize();
const originalMappings = Object.fromEntries(['Projects/Research', 'Projects/Research/Deep', 'Archive/Research'].map(folder => [folder, findFolderBoard(payload.layout, folder).id]));
assert.notEqual(originalMappings['Projects/Research'], originalMappings['Archive/Research'], 'same basename folders must be separate Boards');
const host = { calls: [], layouts: [], ready: false };
let releaseCreation;
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.exposeFunction('folderFixtureInit', async () => synchronize());
  await page.exposeFunction('folderFixtureRPC', async (method, request) => {
    host.calls.push({ method, payload: clone(request) });
    switch (method) {
      case 'save-layout': payload.layout = sanitizeLayout(request); synchronize(); host.layouts.push(clone(payload.layout)); return { result: { ok: true } };
      case 'create-folder': {
        if (request.title === 'Background child') await new Promise(resolve => { releaseCreation = resolve; });
        const parent = payload.layout.boards[request.parentBoard];
        const folderPath = await folders.create(parent.folderPath, request.title);
        synchronize(); const mapped = findFolderBoard(payload.layout, folderPath);
        const entry = parent.nodes.find(n => n.board === mapped.id); if (entry && request.position) Object.assign(entry, request.position);
        return { result: { path: folderPath, boardId: mapped.id, layout: clone(payload.layout) }, snapshot: synchronize() };
      }
      case 'rename-folder': {
        const b = payload.layout.boards[request.board], oldPath = b.folderPath;
        const folderPath = await folders.rename(oldPath, request.title); migrateDocs(oldPath, folderPath); const snapshot = synchronize();
        return { result: { path: folderPath, boardId: b.id, layout: clone(payload.layout) }, rename: { oldPath, newPath: folderPath, folder: true }, snapshot };
      }
      case 'move-folder': {
        const b = payload.layout.boards[request.board], oldPath = b.folderPath, parent = payload.layout.boards[request.targetBoard];
        const folderPath = await folders.move(oldPath, parent.folderPath); migrateDocs(oldPath, folderPath); const snapshot = synchronize();
        return { result: { path: folderPath, boardId: b.id, layout: clone(payload.layout) }, rename: { oldPath, newPath: folderPath, folder: true }, snapshot };
      }
      case 'create-note': {
        const folder = payload.layout.boards[request.board]?.folderPath || '';
        const file = `${folder ? folder + '/' : ''}${request.title}.md`; const doc = makeDoc(file); payload.docs[file] = doc;
        files.set(file, { path: file, name: file.split('/').at(-1), extension: 'md' }); return { result: doc };
      }
      case 'save-draft': case 'clear-draft': case 'open-note': return { result: { ok: true } };
      default: return { result: { ok: true } };
    }
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(({ frameHtml, payload }) => {
    const iframe = document.getElementById('frame');
    window.folderHostReady = false;
    window.folderHostCalls = [];
    window.sendFolderSnapshot = snapshot => iframe.contentWindow.postMessage({ kind: 'vb-event', channel: 'folder-channel', type: 'snapshot', payload: snapshot }, '*');
    addEventListener('message', async event => {
      if (event.source !== iframe.contentWindow) return;
      const message = event.data;
      if (message.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'folder-channel', payload: await window.folderFixtureInit() }, '*'); return; }
      if (message.channel !== 'folder-channel') return;
      if (message.kind === 'vb-ready') { window.folderHostReady = true; return; }
      if (message.kind !== 'vb-request') return;
      window.folderHostCalls.push({ method: message.method, payload: message.payload });
      try {
        const { result, rename, snapshot } = await window.folderFixtureRPC(message.method, message.payload);
        if (rename) iframe.contentWindow.postMessage({ kind: 'vb-event', channel: 'folder-channel', type: 'rename', payload: rename }, '*');
        if (snapshot) window.sendFolderSnapshot(snapshot);
        iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'folder-channel', id: message.id, result }, '*');
      } catch (error) { iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'folder-channel', id: message.id, error: String(error.message || error) }, '*'); }
    });
    iframe.srcdoc = frameHtml;
  }, { frameHtml, payload });
  await page.waitForFunction(() => window.folderHostReady);
  let frame = page.frames().find(frame => frame.parentFrame()); assert.ok(frame);
  const checks = {};
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });

  assert.deepEqual(await frame.evaluate(() => Object.keys(state.boards).sort()), Object.keys(payload.layout.boards).sort());
  checks.folderPathsHaveDistinctIds = originalMappings;
  const researchId = originalMappings['Projects/Research'];
  const deepId = originalMappings['Projects/Research/Deep'];
  const archiveId = originalMappings['Archive/Research'];
  const structure = await frame.evaluate(({ researchId, deepId, archiveId }) => ({
    research: { ...state.boards[researchId] }, deep: { ...state.boards[deepId] }, archive: { ...state.boards[archiveId] }, free: { ...state.boards['legacy-free'] },
  }), { researchId, deepId, archiveId });
  assert.equal(structure.deep.parent, researchId);
  assert.deepEqual(structure.research.nodes.filter(n => n.type === 'article').map(n => n.doc), ['Projects/Research/Note.md']);
  assert.deepEqual(structure.deep.nodes.filter(n => n.type === 'article').map(n => n.doc), ['Projects/Research/Deep/Note.md']);
  assert.deepEqual(structure.archive.nodes.filter(n => n.type === 'article').map(n => n.doc), ['Archive/Research/Note.md']);
  assert.equal(structure.free.folderPath, undefined);
  assert.equal(structure.free.nodes[0].id, 'legacy-note');
  checks.actualFolderHierarchyAndDirectArticles = true;

  await frame.evaluate(researchId => {
    navigate(researchId);
    const article = board().nodes.find(n => n.doc === 'Projects/Research/Note.md');
    Object.assign(article, { x: -10520, y: 8960, w: 420, h: 480 });
    board().view = { x: 220 - article.x * .8, y: 100 - article.y * .8, zoom: .8 };
    render(); select(article.id);
  }, researchId);
  await frame.evaluate(() => save());
  const beforeCreate = await frame.evaluate(() => ({ view: { ...board().view }, positions: board().nodes.map(n => ({ id: n.id, x: n.x, y: n.y })), article: { ...board().nodes.find(n => n.doc === 'Projects/Research/Note.md') } }));
  const articleRect = await frame.locator(`[data-node="${beforeCreate.article.id}"]`).boundingBox();
  assert.ok(articleRect.x > 0 && articleRect.y > 210 && articleRect.x + articleRect.width < 1536 && articleRect.y + articleRect.height < 900, 'remote negative-world article is visible at the intentionally offset camera');

  await frame.getByTestId('add-board').click();
  await frame.locator('#new-board-title').fill('Visible child');
  await frame.getByTestId('create-board').click();
  await frame.waitForFunction(() => Object.values(state.boards).some(b => b.title === 'Visible child'));
  await frame.locator('#new-board-title').waitFor({ state: 'detached' });
  const created = await frame.evaluate(() => {
    const sub = Object.values(state.boards).find(b => b.title === 'Visible child');
    return { sub: { ...sub }, entry: { ...board().nodes.find(n => n.board === sub.id) }, view: { ...board().view }, positions: board().nodes.filter(n => n.board !== sub.id).map(n => ({ id: n.id, x: n.x, y: n.y })) };
  });
  assert.deepEqual(created.view, beforeCreate.view, 'creating a Board must preserve the intentionally offset camera');
  assert.deepEqual(created.positions, beforeCreate.positions, 'creating a Board must preserve every existing article and component position');
  const createdRect = await frame.locator(`[data-node="${created.entry.id}"]`).boundingBox();
  assert.ok(createdRect.x >= 0 && createdRect.y >= 210 && createdRect.x + createdRect.width <= 1536 && createdRect.y + createdRect.height <= 950, 'new Board entry is visible in the current viewport');
  assert.ok(Math.abs(createdRect.x - articleRect.x) < 800 && Math.abs(createdRect.y - articleRect.y) < 400, 'new Board is near current article, rather than returning to a global origin');
  assert.equal(created.sub.folderPath, 'Projects/Research/Visible child');
  assert.ok(host.calls.some(c => c.method === 'create-folder' && c.payload.parentBoard === researchId));
  checks.createAtVisibleRemoteArticle = { before: beforeCreate, created, articleRect, createdRect };
  await page.screenshot({ path: new URL('folder-board-visible-create.png', evidence).pathname });

  // Host metadata updates may include a complete layout but must not recenter this working view.
  await frame.evaluate(() => save());
  const snapshotView = await frame.evaluate(() => ({ ...board().view }));
  const snapshotPositions = await frame.evaluate(() => board().nodes.map(n => ({ id: n.id, x: n.x, y: n.y })));
  await page.evaluate(snapshot => window.sendFolderSnapshot(snapshot), synchronize());
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await frame.evaluate(() => ({ ...board().view })), snapshotView);
  assert.deepEqual(await frame.evaluate(() => board().nodes.map(n => ({ id: n.id, x: n.x, y: n.y }))), snapshotPositions);
  checks.snapshotCameraAndPositionsPreserved = true;

  const beforeRenameView = await frame.evaluate(() => ({ ...board().view }));
  const renamed = await frame.evaluate(researchId => VBHost.rpc('rename-folder', { board: researchId, title: 'Renamed research' }), researchId);
  assert.equal(renamed.path, 'Projects/Renamed research');
  await frame.waitForFunction(({ researchId }) => state.boards[researchId].folderPath === 'Projects/Renamed research', { researchId });
  assert.equal(await frame.evaluate(id => state.boards[id].folderPath, deepId), 'Projects/Renamed research/Deep');
  assert.equal(await frame.evaluate(id => state.boards[id].folderPath, created.sub.id), 'Projects/Renamed research/Visible child');
  assert.equal(await frame.evaluate(id => state.boards[id].folderPath, archiveId), 'Archive/Research');
  assert.deepEqual(await frame.evaluate(() => ({ ...board().view })), beforeRenameView);
  assert.deepEqual(await frame.evaluate(() => board().nodes.map(n => ({ id: n.id, x: n.x, y: n.y }))), snapshotPositions);
  assert.ok(await frame.evaluate(() => !!state.docs['Projects/Renamed research/Note.md']));
  checks.renameSubtreeStableBoardIds = true;

  const archiveParentId = findFolderBoard(payload.layout, 'Archive').id;
  const moved = await frame.evaluate(({ researchId, archiveParentId }) => VBHost.rpc('move-folder', { board: researchId, targetBoard: archiveParentId }), { researchId, archiveParentId });
  assert.equal(moved.path, 'Archive/Renamed research');
  await frame.waitForFunction(({ researchId }) => state.boards[researchId].folderPath === 'Archive/Renamed research', { researchId });
  assert.equal(await frame.evaluate(id => state.boards[id].folderPath, deepId), 'Archive/Renamed research/Deep');
  assert.equal(await frame.evaluate(id => state.boards[id].folderPath, created.sub.id), 'Archive/Renamed research/Visible child');
  assert.equal(await frame.evaluate(id => state.boards[id].folderPath, archiveId), 'Archive/Research');
  assert.equal(await frame.evaluate(() => state.currentBoard), researchId);
  assert.deepEqual(await frame.evaluate(() => ({ ...board().view })), beforeRenameView);
  assert.deepEqual(await frame.evaluate(() => board().nodes.map(n => ({ id: n.id, x: n.x, y: n.y }))), snapshotPositions);
  checks.moveSubtreeStableBoardIdsAndCurrentCamera = true;

  await frame.getByTestId('add-article').click();
  await frame.getByTestId('library-input').fill('Created inside current folder');
  await frame.getByTestId('create-document').click();
  await frame.waitForFunction(() => board().nodes.some(n => n.doc === 'Archive/Renamed research/Created inside current folder.md'));
  assert.ok(host.calls.some(c => c.method === 'create-note' && c.payload.board === researchId));
  assert.ok(payload.docs['Archive/Renamed research/Created inside current folder.md']);
  checks.newArticleCreatedInMappedFolder = true;

  const locateId = beforeCreate.article.id;
  await frame.evaluate(locateId => {
    const target = board().nodes.find(n => n.id === locateId); target.x = 19600; target.y = -14120;
    render();
  }, locateId);
  const beforeLocate = await frame.evaluate(() => ({ view: { ...board().view }, nodes: board().nodes.map(n => ({ id: n.id, x: n.x, y: n.y })) }));
  await frame.locator('[data-action="tree"]').click();
  assert.match(await frame.locator('.board-contents h3').textContent(), /当前画板内容/);
  assert.equal(await frame.locator('.board-contents [data-locate-node]').count(), beforeLocate.nodes.length);
  await frame.getByTestId('locate-node-' + locateId).click();
  const afterLocate = await frame.evaluate(() => ({ current: state.currentBoard, selected, view: { ...board().view }, nodes: board().nodes.map(n => ({ id: n.id, x: n.x, y: n.y })) }));
  assert.equal(afterLocate.current, researchId); assert.equal(afterLocate.selected, locateId);
  assert.notDeepEqual(afterLocate.view, beforeLocate.view, 'content location centers an off-screen component');
  assert.deepEqual(afterLocate.nodes, beforeLocate.nodes, 'content location changes only camera, never stored component coordinates');
  const locatedRect = await frame.locator(`[data-node="${locateId}"]`).boundingBox();
  assert.ok(locatedRect.x >= 0 && locatedRect.y >= 210 && locatedRect.x + locatedRect.width <= 1536 && locatedRect.y + locatedRect.height <= 950);
  checks.contentListLocatesRemoteCardWithoutMovingNodes = { beforeLocate, afterLocate, locatedRect };
  await page.screenshot({ path: new URL('folder-board-content-locate.png', evidence).pathname });

  await frame.evaluate(() => { board().nodes.forEach((n, i) => { n.x += i * 5020; n.y += i * 3020; }); render(); });
  const beforeArrange = await frame.evaluate(() => board().nodes.map(n => ({ id: n.id, doc: n.doc, board: n.board, w: n.w, h: n.h, x: n.x, y: n.y })));
  await frame.locator('[data-action="tree"]').click();
  await frame.getByTestId('arrange-board').click();
  const arranged = await frame.evaluate(() => ({ view: { ...board().view }, nodes: board().nodes.map(n => ({ id: n.id, doc: n.doc, board: n.board, w: n.w, h: n.h, x: n.x, y: n.y })) }));
  assert.deepEqual(arranged.nodes.map(({ x, y, ...identity }) => identity), beforeArrange.map(({ x, y, ...identity }) => identity), 'organizing preserves node identity, local file refs and size');
  assert.notDeepEqual(arranged.nodes.map(n => [n.x, n.y]), beforeArrange.map(n => [n.x, n.y]));
  assert.ok(arranged.nodes.every(n => n.x % 20 === 0 && n.y % 20 === 0), 'organize places every card on the standard 20 px world grid');
  const arrangedRects = await frame.locator('#nodes > .node').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.node, ...node.getBoundingClientRect().toJSON() })));
  assert.ok(arrangedRects.every(r => r.x >= 0 && r.y >= 210 && r.right <= 1536 && r.bottom <= 950), 'organized current Board content fits the viewport');
  for (let i = 0; i < arrangedRects.length; i++) for (let j = i + 1; j < arrangedRects.length; j++) {
    const a = arrangedRects[i], b = arrangedRects[j];
    assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, 'organized cards must not overlap');
  }
  checks.organizeRegroupsCurrentCardsOnGridPreservingRefs = { arranged, arrangedRects };
  await page.screenshot({ path: new URL('folder-board-content-arrange.png', evidence).pathname });

  const hiddenDocPath = 'Archive/Renamed research/Note.md';
  await frame.evaluate(id => select(id), created.entry.id);
  await frame.locator('#selection-bar [data-action="remove"]').click();
  await frame.waitForFunction(id => !board().nodes.some(n => n.board === id), created.sub.id);
  await frame.evaluate(() => save());
  assert.ok(payload.layout.boards[researchId].hiddenFolderBoards.includes(created.sub.id));
  assert.ok(files.has('Archive/Renamed research/Visible child'));
  assert.ok(payload.layout.boards[created.sub.id]);
  await frame.evaluate(id => select(id), locateId);
  await frame.locator('#selection-bar [data-action="remove"]').click();
  await frame.waitForFunction(path => !board().nodes.some(n => n.doc === path), hiddenDocPath);
  await frame.evaluate(() => save());
  assert.ok(payload.layout.boards[researchId].hiddenFolderDocs.includes(hiddenDocPath));
  assert.ok(files.has(hiddenDocPath), 'hiding article must preserve the real Markdown file');
  await page.evaluate(snapshot => window.sendFolderSnapshot(snapshot), synchronize());
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await frame.evaluate(id => board().nodes.some(n => n.board === id), created.sub.id), false);
  assert.equal(await frame.evaluate(path => board().nodes.some(n => n.doc === path), hiddenDocPath), false);
  checks.hiddenManagedRefsSurviveMetadataSynchronization = true;

  await page.evaluate(frameHtml => { window.folderHostReady = false; document.getElementById('frame').srcdoc = frameHtml; }, frameHtml);
  await page.waitForFunction(() => window.folderHostReady);
  frame = page.frames().find(frame => frame.parentFrame()); assert.ok(frame);
  assert.equal(await frame.evaluate(() => state.currentBoard), researchId);
  assert.equal(await frame.evaluate(id => board().nodes.some(n => n.board === id), created.sub.id), false);
  assert.equal(await frame.evaluate(path => board().nodes.some(n => n.doc === path), hiddenDocPath), false);
  await frame.locator('[data-action="tree"]').click();
  await frame.getByTestId('tree-board-' + created.sub.id).click();
  assert.equal(await frame.evaluate(() => state.currentBoard), created.sub.id);
  await frame.getByTestId('crumb-' + researchId).click();
  await frame.locator('[data-action="tree"]').click();
  await frame.getByTestId('restore-' + created.sub.id).click();
  await frame.waitForFunction(id => board().nodes.some(n => n.board === id), created.sub.id);
  assert.equal(await frame.evaluate(id => board().hiddenFolderBoards.includes(id), created.sub.id), false);
  await frame.locator('[data-action="tree"]').click();
  await frame.getByTestId('add-article').click();
  await frame.getByTestId('library-input').fill('Note');
  await frame.getByTestId('add-doc-' + hiddenDocPath).click();
  await frame.waitForFunction(path => board().nodes.some(n => n.doc === path), hiddenDocPath);
  assert.equal(await frame.evaluate(path => board().hiddenFolderDocs.includes(path), hiddenDocPath), false);
  await frame.evaluate(() => save());
  checks.hiddenRefsPersistAfterReopenAndCanRestore = true;

  const restoredChildEntry = await frame.evaluate(id => board().nodes.find(n => n.board === id).id, created.sub.id);
  const beforeUIRename = await frame.evaluate(() => ({ view: { ...board().view }, positions: board().nodes.map(n => ({ id: n.id, x: n.x, y: n.y })) }));
  await frame.evaluate(id => select(id), restoredChildEntry);
  await frame.locator('#selection-bar [data-action="rename-selected"]').click();
  await frame.locator('#new-board-title').fill('Child renamed from UI');
  await frame.getByTestId('create-board').click();
  await frame.locator('#new-board-title').waitFor({ state: 'detached' });
  assert.equal(await frame.evaluate(id => state.boards[id].folderPath, created.sub.id), 'Archive/Renamed research/Child renamed from UI');
  assert.equal(await frame.evaluate(id => state.boards[id].title, created.sub.id), 'Child renamed from UI');
  assert.ok(files.has('Archive/Renamed research/Child renamed from UI'));
  assert.deepEqual(await frame.evaluate(() => ({ ...board().view })), beforeUIRename.view);
  assert.deepEqual(await frame.evaluate(() => board().nodes.map(n => ({ id: n.id, x: n.x, y: n.y }))), beforeUIRename.positions);
  await frame.locator('#selection-bar [data-action="move"]').click();
  await frame.locator('#move-target').selectOption(archiveParentId);
  await frame.getByTestId('move-folder-confirm').click();
  await frame.locator('#move-target').waitFor({ state: 'detached' });
  assert.equal(await frame.evaluate(id => state.boards[id].folderPath, created.sub.id), 'Archive/Child renamed from UI');
  assert.equal(await frame.evaluate(id => state.boards[id].parent, created.sub.id), archiveParentId);
  assert.ok(files.has('Archive/Child renamed from UI'));
  assert.equal(await frame.evaluate(id => board().nodes.some(n => n.board === id), created.sub.id), false);
  assert.deepEqual(await frame.evaluate(() => ({ ...board().view })), beforeUIRename.view);
  assert.deepEqual(await frame.evaluate(id => board().nodes.filter(n => n.board !== id).map(n => ({ id: n.id, x: n.x, y: n.y })), created.sub.id), beforeUIRename.positions.filter(n => n.id !== restoredChildEntry));
  checks.UIRenameAndMoveCallNativeDirectoryOperationsWithoutCameraJump = true;

  // A user may leave while the asynchronous host operation is still running.
  await frame.getByTestId('add-board').click();
  await frame.locator('#new-board-title').fill('Background child');
  await frame.getByTestId('create-board').click();
  await page.waitForFunction(() => window.folderHostCalls.some(call => call.method === 'create-folder' && call.payload.title === 'Background child'));
  await frame.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await frame.getByTestId('crumb-home').click();
  await frame.evaluate(() => { board().view = { x: 3450, y: -7100, zoom: .6 }; applyView(); });
  await frame.evaluate(() => save());
  const afterUserNavigation = await frame.evaluate(() => ({ current: state.currentBoard, view: { ...board().view } }));
  assert.equal(afterUserNavigation.current, 'home');
  releaseCreation();
  await frame.waitForFunction(() => Object.values(state.boards).some(b => b.folderPath === 'Archive/Renamed research/Background child'));
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await frame.evaluate(() => save());
  assert.deepEqual(await frame.evaluate(() => ({ current: state.currentBoard, view: { ...board().view } })), afterUserNavigation, 'a late creation response must honor the user navigation and current camera');
  assert.ok(files.has('Archive/Renamed research/Background child'));
  checks.asyncCreationHonorsUserNavigationAndNewCamera = true;

  // Removing a physical directory keeps its layout recoverable and marks it missing.
  await frame.evaluate(() => save());
  const archivedPositions = await frame.evaluate(id => state.boards[id].nodes.map(n => ({ id: n.id, x: n.x, y: n.y })), archiveId);
  for (const file of [...files.keys()]) if (file === 'Archive/Research' || file.startsWith('Archive/Research/')) files.delete(file);
  for (const [file, doc] of Object.entries(payload.docs)) if (file.startsWith('Archive/Research/')) payload.docs[file] = { ...doc, body: '', missing: true };
  const missing = synchronize();
  await page.evaluate(snapshot => window.sendFolderSnapshot(snapshot), missing);
  await frame.waitForFunction(id => !!state.boards[id].folderMissing, archiveId);
  assert.equal(await frame.evaluate(id => state.boards[id].folderPath, archiveId), 'Archive/Research');
  assert.deepEqual(await frame.evaluate(id => state.boards[id].nodes.map(n => ({ id: n.id, x: n.x, y: n.y })), archiveId), archivedPositions);
  await frame.evaluate(() => navigate('legacy-free'));
  assert.equal(await frame.evaluate(() => state.currentBoard), 'legacy-free');
  assert.match(await frame.locator('[data-node="legacy-note"]').textContent(), /自由空间保留/);
  checks.missingDirectoryPreservesLayoutAndLegacyBoardStillNavigates = true;

  assert.deepEqual(errors, []);
  await writeFile(new URL('folder-board-browser.json', evidence), JSON.stringify({ passed: true, checks, pageErrors: errors }, null, 2));
  console.log('Folder Board frame checks passed.');
} finally { await browser.close(); server.close(); await rm(temporary, { recursive: true, force: true }); }
