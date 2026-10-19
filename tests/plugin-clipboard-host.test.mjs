import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

// Exercise actual main.ts component clipboard/import/drop RPCs with synthetic Vault and disk only.
const compiled = await build({ entryPoints: [new URL('../src/main.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['obsidian'], loader: { '.html': 'text' }, write: false });
const source = compiled.outputFiles[0].text;
const plain = value => JSON.parse(JSON.stringify(value));
const originalBody = '# Original\r\n\r\n正文和 [[Other]]、![[Assets/local.png]] 保持原样。\r\n';
const makeBoard = (id, folderPath, nodes = []) => ({ id, title: id, parent: id === 'home' ? null : 'home', ...(folderPath === undefined ? {} : { folderPath }), theme: 'research', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] });
function layoutFixture(hidden = true) {
  const selected = { id: 'selected-reference', type: 'article', doc: 'Source/Note.md', x: 87, y: -42, w: 600, h: 900, angle: -3, date: '2026-10-12', large: true, folderManaged: true };
  const home = makeBoard('home', '', [
    { id: 'source-entry', type: 'board', board: 'source', x: 0, y: 0, folderManaged: true },
    { id: 'target-entry', type: 'board', board: 'target', x: 340, y: 0, folderManaged: true },
    { id: 'free-entry', type: 'board', board: 'free', x: 680, y: 0 },
  ]);
  const sourceBoard = makeBoard('source', 'Source', [selected, { id: 'source-note', type: 'note', title: 'Keep source', text: 'fixture', x: 800, y: 0 }]);
  sourceBoard.edges = [{ from: selected.id, to: 'source-note' }];
  const target = makeBoard('target', 'Destination', [{ id: 'target-note', type: 'note', title: 'Keep destination', text: '', x: 100, y: 80, w: 220, h: 220 }]);
  target.hiddenFolderDocs = hidden ? ['Destination/Note.md', 'Destination/Keep hidden.md'] : [];
  const free = makeBoard('free', undefined, [{ id: 'free-reference', type: 'article', doc: selected.doc, x: -1200, y: 780, w: 440, h: 420 }]);
  return { version: 2, articleSizingVersion: 1, currentBoard: 'source', showKnowledge: true, showSpace: true, boards: { home, source: sourceBoard, target, free } };
}
async function fixture({ hidden = true, skipSnapshot = false, deferReady = false, beforeSnapshot } = {}) {
  const files = new Map(), bodies = new Map(), nativeRenames = [], articleWrites = [], saved = [], messages = [], handlers = new Map(), explorerCalls = [];
  const root = { path: '', name: '', children: [] }; files.set('', root);
  class TFile {
    constructor(path, body) { this.path = path; this.name = path.split('/').pop(); this.basename = this.name.replace(/\.md$/i, ''); this.extension = 'md'; this.stat = { mtime: 100 }; bodies.set(path, body); }
  }
  const addFile = (path, body) => { const file = new TFile(path, body); files.set(path, file); return file; };
  for (const path of ['Source', 'Destination']) files.set(path, { path, name: path, children: [] });
  addFile('Source/Note.md', originalBody); addFile('Other.md', '# Other article');
  const on = (type, fn) => { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); return { type, fn }; };
  const emit = (type, ...args) => { for (const fn of handlers.get(type) || []) fn(...args); };
  let beforeNativeRename, afterNativeRename, viewFactory, plugin, boardLeaf, layoutReady;
  const explorerItems = { 'Source/Note.md': { selfEl: { classList: { add() {}, remove() {} } } } };
  const nextFrames = []; let frameQueued = false;
  function nextFrame(callback) {
    nextFrames.push(callback);
    if (frameQueued) return;
    frameQueued = true;
    setImmediate(() => { frameQueued = false; const current = nextFrames.splice(0); for (const fn of current) fn(); });
  }
  const explorerLeaf = { view: {
    containerEl: { isShown: () => true }, fileItems: explorerItems,
    revealInFolder(file) { explorerCalls.push(['reveal', file.path, plugin.explorerRevealDepth]); nextFrame(() => app.workspace.setActiveLeaf(explorerLeaf)); },
    tree: { clearSelectedDoms() { explorerCalls.push(['clear', plugin.explorerRevealDepth]); }, selectItem(item) { explorerCalls.push(['select', item === explorerItems['Source/Note.md'], plugin.explorerRevealDepth]); } },
  } };
  const app = {
    nextFrame,
    vault: {
      configDir: '.obsidian', on, getRoot: () => root, getAllLoadedFiles: () => [...files.values()], getAbstractFileByPath: path => files.get(path) || null,
      getMarkdownFiles: () => [...files.values()].filter(file => file instanceof TFile), getName: () => 'Mock move Vault', cachedRead: async file => bodies.get(file.path), read: async file => bodies.get(file.path),
      createFolder: async () => { throw Error('Unexpected folder creation'); },
      create: async (...args) => { articleWrites.push(['create', ...args]); throw Error('Unexpected article create'); },
      process: async (...args) => { articleWrites.push(['process', ...args]); throw Error('Unexpected article process'); },
      modify: async (...args) => { articleWrites.push(['modify', ...args]); throw Error('Unexpected article modify'); },
      adapter: { read: async () => '{}', write: async () => {}, readBinary: async () => { throw Error('Missing fixture attachment'); } },
    },
    metadataCache: { on, resolvedLinks: { 'Source/Note.md': { 'Other.md': 1 }, 'Other.md': { 'Source/Note.md': 1 } }, getFileCache: () => ({ embeds: [] }), getFirstLinkpathDest: () => null },
    workspace: {
      on, onLayoutReady: callback => { if(deferReady) layoutReady=callback; else callback(); }, activeLeaf: undefined, getLeavesOfType: type => type === 'visual-board-desktop' ? boardLeaf ? [boardLeaf] : [] : type === 'file-explorer' ? [explorerLeaf] : [], getActiveFile: () => null,
      revealLeaf: async leaf => { explorerCalls.push(['revealLeaf', leaf === explorerLeaf, plugin.explorerRevealDepth]); },
      setActiveLeaf(leaf) { this.activeLeaf = leaf; explorerCalls.push(['active', leaf === boardLeaf ? 'board' : 'explorer', plugin.explorerRevealDepth]); emit('active-leaf-change', leaf); },
    },
    fileManager: { renameFile: async (file, target) => {
      nativeRenames.push([file.path, target]);
      if (beforeNativeRename) await beforeNativeRename(file, target);
      if (files.has(target)) throw Error('Native destination collision');
      const oldPath = file.path, body = bodies.get(oldPath);
      files.delete(oldPath); bodies.delete(oldPath); file.path = target; file.name = target.split('/').pop(); file.basename = file.name.replace(/\.md$/i, ''); files.set(target, file); bodies.set(target, body);
      const resolved = app.metadataCache.resolvedLinks;
      if (resolved[oldPath]) { resolved[target] = resolved[oldPath]; delete resolved[oldPath]; }
      for (const links of Object.values(resolved)) if (links[oldPath]) { links[target] = links[oldPath]; delete links[oldPath]; }
      emit('rename', file, oldPath); // Actual onload callback clones plugin.layout via renameReferences.
      if (afterNativeRename) await afterNativeRename(file, oldPath, target);
    } },
  };
  const input = { schema: 1, layout: layoutFixture(hidden), settings: { legacyFolderLinked: true, defaultIconMode: 'default' } };
  class Plugin {
    constructor(app, manifest) { this.app = app; this.manifest = manifest; }
    loadData() { return Promise.resolve(plain(input)); } saveData(data) { saved.push(plain(data)); return Promise.resolve(); }
    registerView(_type, factory) { viewFactory = factory; } registerEvent() {} registerObsidianProtocolHandler() {} addRibbonIcon() {} addCommand() {} addSettingTab() {}
  }
  class ItemView { constructor(leaf) { this.leaf = leaf; } }
  class PluginSettingTab {}
  const obsidian = { Plugin, ItemView, WorkspaceLeaf: class {}, PluginSettingTab, Setting: class {}, Notice: class {}, TFile, normalizePath: path => path.replace(/\\/g, '/'), requestUrl: async () => { throw Error('Unexpected network request'); } };
  const module = { exports: {} };
  runInNewContext(source, { module, exports: module.exports, require: name => { if (name === 'obsidian') return obsidian; throw Error('Unexpected module'); }, console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, crypto: webcrypto, Uint8Array, btoa: value => Buffer.from(value, 'binary').toString('base64') });
  plugin = new module.exports.default(app, { id: 'visual-board', dir: '.obsidian/plugins/visual-board' });
  await plugin.onload();
  boardLeaf = {}; const view = viewFactory(boardLeaf); boardLeaf.view = view; app.workspace.activeLeaf = boardLeaf;
  view.frame = { contentWindow: { postMessage(message) { messages.push(plain(message)); } } };
  if(beforeSnapshot)await beforeSnapshot({plugin,app,files,bodies});
  if(!skipSnapshot)await plugin.snapshot();
  let sequence = 0;
  return { plugin, app, view, files, bodies, releaseReady:()=>layoutReady?.(), nativeRenames, articleWrites, saved, messages, explorerCalls, boardLeaf, explorerLeaf, addFile,
    setBeforeRename: hook => { beforeNativeRename = hook; }, setAfterRename: hook => { afterNativeRename = hook; }, emit,
    async rpc(method, payload) { const id = 'test-' + ++sequence; await view.handle({ id, method, payload }); const reply = messages.find(message => message.kind === 'vb-response' && message.id === id); assert.ok(reply, 'actual host must send an RPC response'); return reply; },
  };
}
const moveRequest = { sourceBoard: 'source', targetBoard: 'target', node: 'selected-reference' };

function installRecycleDisk(f) {
  const disk = new Map([...f.files].map(([path, file]) => [path, { file, body: f.bodies.get(path), type: 'children' in file ? 'folder' : 'file' }]));
  const manifest = new Map(), adapterMoves = [], reconcile = [], TFile = f.files.get('Source/Note.md').constructor;
  const adapter = f.app.vault.adapter;
  adapter.exists = async path => disk.has(path) || manifest.has(path);
  adapter.stat = async path => { const item = disk.get(path); if (manifest.has(path)) return { type: 'file', size: manifest.get(path).length, mtime: 100, ctime: 100 }; return item ? { type: item.type, size: item.type === 'folder' ? 0 : item.body?.length || 0, mtime: 100, ctime: 100 } : null; };
  adapter.mkdir = async path => { if (disk.has(path)) throw Error('exists'); const file = { path, children: [] }; disk.set(path, { file, type: 'folder' }); };
  adapter.write = async (path, value) => { manifest.set(path, value); };
  adapter.read = async path => manifest.get(path) || '{}';
  adapter.list = async path => ({ folders: [...disk.keys()].filter(p => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/') && disk.get(p).type === 'folder'), files: [...manifest.keys()].filter(p => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/')) });
  adapter.rename = async (from, to) => {
    if (!disk.has(from) || disk.has(to)) throw Error('missing/collision'); adapterMoves.push([from, to]);
    for (const path of [...disk.keys()].filter(path => path === from || path.startsWith(from + '/'))) {
      const next = to + path.slice(from.length), item = disk.get(path), native = f.files.get(path); disk.delete(path); disk.set(next, item);
      if (item.type === 'file') { f.bodies.delete(path); f.bodies.set(next, item.body); }
      if (native) { f.files.delete(path); native.path = next; native.name = next.split('/').pop(); if (item.type === 'file') native.basename = native.name.replace(/\.md$/, ''); f.files.set(next, native); f.emit('rename', native, path); }
    }
  };
  adapter.reconcileInternalFile = async path => {
    reconcile.push(path);
    if (!disk.has(path) || path.split('/').some(part => part.startsWith('.'))) {
      for (const key of [...f.files.keys()].filter(key => key === path || key.startsWith(path + '/'))) { const file = f.files.get(key); f.files.delete(key); f.emit('delete', file); }
    } else for (const key of [...disk.keys()].filter(key => key === path || key.startsWith(path + '/'))) {
      const item = disk.get(key); if (!f.files.has(key)) { const file = item.type === 'file' ? new TFile(key, item.body) : { path: key, name: key.split('/').pop(), children: [] }; f.files.set(key, file); f.emit('create', file); }
    }
  };
  f.app.vault.rename = async (file, to) => adapter.rename(file.path, to);
  return { disk, manifest, adapterMoves, reconcile };
}

const encode = text => [...new TextEncoder().encode(text)];
async function componentFixture() {
  const f = await fixture(), disk = installRecycleDisk(f), binary = new Map(), copies = [], externalWrites = [];
  let clipboard = '', createHook, copyHook;
  f.view.contentEl = { ownerDocument: { defaultView: { navigator: { clipboard: { writeText: async value => { clipboard = value; }, readText: async () => clipboard } } } } };
  const bytesFor = path => binary.get(path) || new TextEncoder().encode(f.bodies.get(path) || '');
  const add = (path, bytes) => {
    const data = Uint8Array.from(bytes), body = new TextDecoder('utf-8', { ignoreBOM: true }).decode(data), file = f.addFile(path, body);
    file.stat = { mtime: 100, ctime: 100, size: data.length }; binary.set(path, data);
    disk.disk.set(path, { file, body, type: 'file' }); return file;
  };
  for (const [path, entry] of f.files) if (entry.extension) entry.stat.size = bytesFor(path).length;
  f.app.vault.createBinary = async (path, data) => {
    await createHook?.(path, data); if (f.files.has(path) || disk.disk.has(path)) throw Error('existing destination');
    const file = add(path, new Uint8Array(data)); externalWrites.push(path); f.emit('create', file); return file;
  };
  f.app.vault.copy = async (source, target) => {
    await copyHook?.(source, target); if (f.files.has(target) || disk.disk.has(target)) throw Error('existing destination');
    const copy = add(target, bytesFor(source.path)); copies.push([source.path, target]); f.emit('create', copy); return copy;
  };
  f.app.vault.createFolder = async path => {
    if (f.files.has(path) || disk.disk.has(path)) throw Error('existing folder');
    const folder = { path, name: path.split('/').pop(), children: [] }; f.files.set(path, folder); disk.disk.set(path, { file: folder, type: 'folder' }); f.emit('create', folder); return folder;
  };
  f.app.vault.delete = async file => { f.files.delete(file.path); f.bodies.delete(file.path); binary.delete(file.path); disk.disk.delete(file.path); f.emit('delete', file); };
  const nativeRename = f.app.vault.adapter.rename;
  f.app.vault.adapter.rename = async (from, to) => {
    const changes = [...binary.entries()].filter(([path]) => path === from || path.startsWith(from + '/'));
    await nativeRename(from, to);
    for (const [path, bytes] of changes) { binary.delete(path); binary.set(to + path.slice(from.length), bytes); }
  };
  // Native indexed files exclude the plugin's hidden recycle storage.
  const indexed = f.app.vault.getMarkdownFiles;
  f.app.vault.getMarkdownFiles = () => indexed().filter(file => !file.path.split('/').some(segment => segment.startsWith('.')));
  return { ...f, disk, binary, copies, externalWrites, bytesFor, add,
    getClipboard: () => clipboard, setClipboard: value => { clipboard = value; },
    setCreateHook: value => { createHook = value; }, setCopyHook: value => { copyHook = value; },
  };
}

function success(reply) { assert.equal(reply.error, undefined, reply.error); assert.ok(reply.result); return reply.result; }

// Exact file bytes and true recycle replay are checked through the actual native RPC boundary.
test('import-markdown actual RPC saves root/nested files with exact bytes, returns docs/IDs, and preserves cameras', async () => {
  const f = await componentFixture();
  try {
    await f.app.vault.createFolder('Destination/Nested'); await f.plugin.snapshot();
    const nested = Object.values(f.plugin.layout.boards).find(b => b.folderPath === 'Destination/Nested'); assert.ok(nested);
    for (const [targetBoard, directory] of [['home', ''], [nested.id, 'Destination/Nested/']]) {
      const beforeView = plain(f.plugin.layout.boards[targetBoard].view), body = '\ufeff# Imported\r\n\r\n**粗体** 与 [[Other]]\r\n', bytes = encode(body);
      const result = success(await f.rpc('import-markdown', { targetBoard, files: [{ name: 'External.md', bytes }], position: { x: 114, y: 219 } }));
      const path = directory + 'External.md'; assert.deepEqual(result.importedPaths, [path]); assert.deepEqual(result.failures, []);
      assert.deepEqual([...f.bytesFor(path)], bytes); assert.equal(result.docs[path].body, body); assert.ok(result.undoToken);
      assert.equal(result.createdIds.length, 1); const node = result.layout.boards[targetBoard].nodes.find(n => n.id === result.createdIds[0]);
      assert.equal(node.doc, path); assert.equal(node.x % 20, 0); assert.equal(node.y % 20, 0); assert.ok(Math.hypot(node.x - 120, node.y - 220) < 1000); assert.equal(node.folderManaged, true);
      if (targetBoard === nested.id) { assert.equal(node.x, 120); assert.equal(node.y, 220); }
      assert.deepEqual(result.layout.boards[targetBoard].view, beforeView);
    }
    assert.deepEqual(f.nativeRenames, []); assert.equal(f.plugin.componentMutating, false);
  } finally { f.plugin.onunload(); }
});

test('import-markdown actual insertion undo/redo recycles real files and restores card identity and geometry', async () => {
  const f = await componentFixture();
  try {
    const imported = success(await f.rpc('import-markdown', { targetBoard: 'target', files: [{ name: 'Undo.md', bytes: encode('# Keep\n\nImported body.') }], position: { x: 480, y: 320 } }));
    const id = imported.createdIds[0], path = imported.importedPaths[0], before = plain(imported.layout.boards.target.nodes.find(n => n.id === id));
    const undo = success(await f.rpc('replay-component-insertion', { token: imported.undoToken, direction: 'undo' }));
    assert.equal(f.files.has(path), false); assert.equal(undo.layout.boards.target.nodes.some(n => n.id === id), false);
    assert.ok(f.disk.adapterMoves.some(([from, to]) => from === path && to.startsWith('.trash/visual-board/')));
    const redo = success(await f.rpc('replay-component-insertion', { token: imported.undoToken, direction: 'redo' }));
    assert.equal(f.bodies.get(path), '# Keep\n\nImported body.'); assert.deepEqual(redo.layout.boards.target.nodes.find(n => n.id === id), before);
    assert.deepEqual(redo.createdIds, [id]); assert.equal(redo.docs[path].body, '# Keep\n\nImported body.');
    assert.ok((await f.rpc('replay-component-insertion', { token: imported.undoToken, direction: 'redo' })).error);
  } finally { f.plugin.onunload(); }
});

test('drop-markdown actual explorer move changes real directory, all references, link resolution, and has native undo/redo token', async () => {
  const f = await componentFixture();
  try {
    const source = plain(f.plugin.layout.boards.source.nodes.find(n => n.doc === 'Source/Note.md')), views = plain(Object.fromEntries(Object.entries(f.plugin.layout.boards).map(([id, board]) => [id, board.view])));
    const moved = success(await f.rpc('drop-markdown', { paths: ['Source/Note.md'], targetBoard: 'target', position: { x: 615, y: 417 } }));
    assert.deepEqual(moved.failures, []); assert.deepEqual(moved.importedPaths, ['Destination/Note.md']); assert.equal(moved.moveTokens.length, 1);
    assert.equal(f.files.has('Source/Note.md'), false); assert.equal(f.bodies.get('Destination/Note.md'), originalBody);
    assert.equal(moved.layout.boards.free.nodes[0].doc, 'Destination/Note.md'); assert.ok(f.app.metadataCache.resolvedLinks['Other.md']['Destination/Note.md']);
    const targetNode = moved.layout.boards.target.nodes.find(n => n.id === source.id); assert.equal(targetNode.x, 620); assert.equal(targetNode.y, 420); assert.equal(targetNode.w, 600);
    assert.deepEqual(Object.fromEntries(Object.entries(moved.layout.boards).map(([id, board]) => [id, board.view])), views);
    const undo = success(await f.rpc('replay-article-move', { token: moved.moveTokens[0], direction: 'undo' }));
    assert.equal(f.files.has('Source/Note.md'), true); assert.equal(undo.layout.boards.source.nodes.find(n => n.id === source.id).x, source.x);
    const redo = success(await f.rpc('replay-article-move', { token: moved.moveTokens[0], direction: 'redo' }));
    assert.equal(redo.layout.boards.target.nodes.find(n => n.id === source.id).x, 620); assert.equal(f.bodies.get('Destination/Note.md'), originalBody);
    assert.deepEqual(f.copies, []); assert.deepEqual(f.externalWrites, []);
  } finally { f.plugin.onunload(); }
});

test('drop-markdown same-directory RPC preserves real file and identity, returns geometry history, and deduplicates paths', async () => {
  const f = await componentFixture();
  try {
    const before = plain(f.plugin.layout.boards.source.nodes.find(n => n.doc === 'Source/Note.md'));
    const result = success(await f.rpc('drop-markdown', { paths: ['Source/Note.md', 'Source/Note.md'], targetBoard: 'source', position: { x: -114, y: 329 } }));
    assert.deepEqual(result.importedPaths, ['Source/Note.md']); assert.deepEqual(result.createdIds, [before.id]); assert.deepEqual(result.moveTokens, []);
    assert.equal(result.geometryChanges.length, 1); assert.equal(result.geometryChanges[0].board, 'source'); assert.equal(result.geometryChanges[0].id, before.id);
    assert.deepEqual(result.geometryChanges[0].before, { x: before.x, y: before.y, w: before.w, h: before.h });
    assert.equal(result.geometryChanges[0].after.x, -120); assert.equal(result.geometryChanges[0].after.y, 320);
    assert.equal(result.layout.boards.source.nodes.find(n => n.id === before.id).x, -120); assert.equal(f.bodies.get('Source/Note.md'), originalBody);
    assert.deepEqual(f.nativeRenames, []); assert.deepEqual(f.copies, []); assert.deepEqual(f.externalWrites, []);
  } finally { f.plugin.onunload(); }
});

test('actual copy/paste RPC uses system clipboard capability and creates independent real file with remapped internal edges', async () => {
  const f = await componentFixture();
  try {
    const copied = success(await f.rpc('copy-components', { board: 'source', ids: ['selected-reference', 'source-note'] }));
    assert.equal(f.getClipboard(), copied.clipboard); assert.match(copied.clipboard, /^vb-components:v1:[0-9a-f-]+$/); assert.equal(copied.clipboard.includes(originalBody), false);
    const result = success(await f.rpc('paste-components', { targetBoard: 'target', position: { x: 120, y: 240 } }));
    assert.equal(result.createdIds.length, 2); assert.equal(result.createdPaths.length, 1); const path = result.createdPaths[0]; assert.equal(path, 'Destination/Note copy.md');
    assert.equal(f.bodies.get(path), originalBody); assert.equal(f.bodies.get('Source/Note.md'), originalBody); assert.notEqual(f.files.get(path), f.files.get('Source/Note.md'));
    const article = result.layout.boards.target.nodes.find(n => result.createdIds.includes(n.id) && n.type === 'article'), note = result.layout.boards.target.nodes.find(n => result.createdIds.includes(n.id) && n.type === 'note');
    assert.notEqual(article.id, 'selected-reference'); assert.equal(article.doc, path); assert.equal(article.w, 600); assert.equal(note.text, 'fixture');
    assert.ok(result.layout.boards.target.edges.some(edge => edge.from === article.id && edge.to === note.id));
    f.bodies.set(path, 'copy edited independently'); f.disk.disk.get(path).body = 'copy edited independently'; assert.equal(f.bodies.get('Source/Note.md'), originalBody);
    const undo = success(await f.rpc('replay-component-insertion', { token: result.undoToken, direction: 'undo' })); assert.equal(f.files.has(path), false); assert.equal(f.files.has('Source/Note.md'), true); assert.equal(undo.layout.boards.target.nodes.some(n => result.createdIds.includes(n.id)), false);
    const redo = success(await f.rpc('replay-component-insertion', { token: result.undoToken, direction: 'redo' })); assert.equal(f.bodies.get(path), 'copy edited independently'); assert.equal(f.bodies.get('Source/Note.md'), originalBody); assert.ok(redo.layout.boards.target.nodes.some(n => n.id === article.id));
    assert.ok(result.undoToken); assert.equal(f.plugin.componentMutating, false);
    const denied = await f.rpc('paste-components', { clipboard: 'vb-components:v1:not-this-vault', targetBoard: 'target', position: { x: 0, y: 0 } }); assert.ok(denied.error);
  } finally { f.plugin.onunload(); }
});

test('native component mutation barrier rejects stale layout writes and snapshot waits for committed Markdown import', async () => {
  const f = await componentFixture();
  try {
    let begin, release; const began = new Promise(resolve => { begin = resolve; }), gate = new Promise(resolve => { release = resolve; });
    f.setCreateHook(async () => { begin(); await gate; }); const stale = plain(f.plugin.layout);
    const importing = f.rpc('import-markdown', { targetBoard: 'target', files: [{ name: 'Slow.md', bytes: encode('# Slow') }], position: { x: 400, y: 500 } });
    await began; assert.equal(f.plugin.componentMutating, true);
    const rejected = await f.rpc('save-layout', { layout: stale, nativeRevision: f.plugin.nativeSync.revision }); assert.match(rejected.error, /组件正在处理/);
    let snapshotDone = false; const snapshot = f.rpc('snapshot', {}).then(reply => { snapshotDone = true; return reply; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(snapshotDone, false, 'native snapshot must await complete file+layout transaction');
    release(); const imported = success(await importing), after = success(await snapshot);
    assert.equal(f.plugin.componentMutating, false); assert.equal(after.docs['Destination/Slow.md'].body, '# Slow');
    assert.ok(after.layout.boards.target.nodes.some(n => n.id === imported.createdIds[0]));
  } finally { f.plugin.onunload(); }
});

test('native component mutation barrier also blocks stale layout while independent component copies await native disk', async () => {
  const f = await componentFixture();
  try {
    const capability = success(await f.rpc('copy-components', { board: 'source', ids: ['selected-reference'] })).clipboard;
    let begin, release; const began = new Promise(resolve => { begin = resolve; }), gate = new Promise(resolve => { release = resolve; });
    f.setCopyHook(async () => { begin(); await gate; }); const stale = plain(f.plugin.layout);
    const paste = f.rpc('paste-components', { clipboard: capability, targetBoard: 'target', position: { x: 10, y: 20 } });
    await began; assert.equal(f.plugin.componentMutating, true);
    assert.ok((await f.rpc('save-layout', { layout: stale, nativeRevision: f.plugin.nativeSync.revision })).error);
    let snapshotDone = false; const snapshot = f.rpc('snapshot', {}).then(reply => { snapshotDone = true; return reply; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(snapshotDone, false);
    release(); const pasted = success(await paste), after = success(await snapshot);
    assert.equal(f.plugin.componentMutating, false); assert.equal(after.docs[pasted.createdPaths[0]].body, originalBody); assert.ok(after.layout.boards.target.nodes.some(node => node.id === pasted.createdIds[0]));
  } finally { f.plugin.onunload(); }
});

test('a snapshot already reading before a mutation also waits until complete component commit', async () => {
  const f = await componentFixture(); let releaseRead, releaseWrite;
  try {
    let readStarted, writeStarted;
    const readBegan = new Promise(resolve => { readStarted = resolve; }), writeBegan = new Promise(resolve => { writeStarted = resolve; });
    const readGate = new Promise(resolve => { releaseRead = resolve; }), writeGate = new Promise(resolve => { releaseWrite = resolve; });
    const read = f.app.vault.cachedRead; let held = false;
    f.app.vault.cachedRead = async file => { if (!held) { held = true; readStarted(); await readGate; } return read(file); };
    let snapshotDone = false; const snapshot = f.rpc('snapshot', {}).then(reply => { snapshotDone = true; return reply; });
    await readBegan;
    f.setCreateHook(async () => { writeStarted(); await writeGate; });
    const importing = f.rpc('import-markdown', { targetBoard: 'target', files: [{ name: 'In-flight.md', bytes: encode('# In-flight') }], position: { x: 480, y: 400 } });
    await writeBegan; releaseRead();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(snapshotDone, false, 'a pre-existing snapshot cannot publish a mid-mutation layout');
    releaseWrite(); const imported = success(await importing), after = success(await snapshot);
    assert.equal(after.docs[imported.importedPaths[0]].body, '# In-flight'); assert.ok(after.layout.boards.target.nodes.some(node => node.id === imported.createdIds[0]));
  } finally { releaseRead?.(); releaseWrite?.(); f.plugin.onunload(); }
});

test('drop-markdown accepts existing Markdown extension case consistently with native note reader', async () => {
  const f = await componentFixture();
  try {
    const path = 'Source/UPPER.MD', file = f.add(path, encode('# Uppercase extension')); file.extension = 'MD';
    await f.plugin.snapshot();
    const result = success(await f.rpc('drop-markdown', { paths: [path], targetBoard: 'target', position: { x: 1000, y: 1000 } }));
    assert.deepEqual(result.failures, []); assert.deepEqual(result.importedPaths, ['Destination/UPPER.MD']); assert.equal(f.bodies.get('Destination/UPPER.MD'), '# Uppercase extension');
  } finally { f.plugin.onunload(); }
});
