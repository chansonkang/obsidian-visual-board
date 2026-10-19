import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

// Run the actual plugin/BoardView RPC and registered events. Every Vault/explorer is synthetic.
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

test('actual move-article RPC survives rename layout cloning, keeps selected geometry and updates all free references', async () => {
  const f = await fixture();
  try {
    const beforeLayout = f.plugin.layout, selected = plain(beforeLayout.boards.source.nodes.find(n => n.id === moveRequest.node)), free = plain(beforeLayout.boards.free.nodes[0]);
    let cloneObserved = false; f.setAfterRename(() => { cloneObserved = f.plugin.layout !== beforeLayout; });
    const reply = await f.rpc('move-article', moveRequest);
    assert.equal(reply.error, undefined); assert.equal(reply.result.warning, undefined); assert.equal(cloneObserved, true);
    assert.deepEqual(f.nativeRenames, [['Source/Note.md', 'Destination/Note.md']]);
    assert.equal(reply.result.oldPath, 'Source/Note.md'); assert.equal(reply.result.newPath, 'Destination/Note.md'); assert.equal(reply.result.doc.body, originalBody);
    assert.equal(f.bodies.has('Source/Note.md'), false); assert.equal(f.bodies.get('Destination/Note.md'), originalBody);
    const layout = reply.result.layout, moved = layout.boards.target.nodes.filter(n => n.doc === 'Destination/Note.md');
    assert.equal(moved.length, 1); assert.equal(moved[0].id, selected.id);
    for (const field of ['w', 'h', 'angle', 'date', 'large']) assert.equal(moved[0][field], selected[field]);
    assert.equal(moved[0].folderManaged, true); assert.equal(Math.abs(moved[0].x % 20), 0); assert.equal(Math.abs(moved[0].y % 20), 0);
    assert.equal(layout.boards.source.nodes.some(n => n.id === selected.id), false); assert.deepEqual(layout.boards.source.edges, []);
    assert.deepEqual(layout.boards.target.hiddenFolderDocs, ['Destination/Keep hidden.md']);
    assert.deepEqual(layout.boards.free.nodes[0], { ...free, doc: 'Destination/Note.md' });
    assert.equal(f.messages.some(message => message.kind === 'vb-event' && message.type === 'rename' && message.payload.oldPath === 'Source/Note.md'), true);
    assert.deepEqual(f.articleWrites, []); assert.equal(f.view.movingArticles.size, 0);
  } finally { f.plugin.onunload(); }
});

test('actual snapshot during awaited native move replaces automatic target copy with captured selected card', async () => {
  const f = await fixture({ hidden: false });
  try {
    const captured = plain(f.plugin.layout.boards.source.nodes.find(n => n.id === moveRequest.node)); let automaticId;
    f.setAfterRename(async () => {
      await f.plugin.snapshot();
      assert.equal(f.plugin.layout.boards.source.nodes.some(n => n.id === captured.id), false, 'actual sync must remove the old managed source reference while native move is awaited');
      const automatic = f.plugin.layout.boards.target.nodes.find(n => n.doc === 'Destination/Note.md'); assert.ok(automatic); automaticId = automatic.id;
      assert.notEqual(automaticId, captured.id);
    });
    const reply = await f.rpc('move-article', moveRequest);
    assert.equal(reply.error, undefined); assert.equal(reply.result.warning, undefined);
    const cards = reply.result.layout.boards.target.nodes.filter(n => n.doc === 'Destination/Note.md');
    assert.equal(cards.length, 1); assert.equal(cards[0].id, captured.id); assert.equal(cards[0].w, 600); assert.equal(cards[0].h, 900);
    assert.equal(reply.result.layout.boards.target.nodes.some(n => n.id === automaticId), false);
    assert.equal(f.bodies.get('Destination/Note.md'), originalBody); assert.deepEqual(f.articleWrites, []);
    await f.plugin.snapshot();
    assert.equal(f.plugin.layout.boards.target.nodes.find(n => n.doc === 'Destination/Note.md').id, captured.id); assert.equal(f.view.movingArticles.size, 0);
  } finally { f.plugin.onunload(); }
});

test('actual move-article collision RPC reports error and preserves source layout and both bodies', async () => {
  for (const concurrent of [false, true]) {
    const f = await fixture();
    try {
      if (concurrent) f.setBeforeRename((_file, target) => { f.addFile(target, 'concurrent destination body'); });
      else f.addFile('Destination/Note.md', 'existing destination body');
      const before = plain(f.plugin.layout), sourceBody = f.bodies.get('Source/Note.md');
      const reply = await f.rpc('move-article', moveRequest);
      assert.ok(reply.error); assert.equal(reply.result, undefined); assert.deepEqual(plain(f.plugin.layout), before);
      assert.equal(f.bodies.get('Source/Note.md'), sourceBody); assert.equal(f.bodies.get('Destination/Note.md'), concurrent ? 'concurrent destination body' : 'existing destination body');
      assert.equal(f.view.movingArticles.size, 0); assert.deepEqual(f.articleWrites, []);
      assert.equal(f.messages.some(message => message.kind === 'vb-event' && message.type === 'rename'), false);
      if (!concurrent) assert.deepEqual(f.nativeRenames, []);
    } finally { f.plugin.onunload(); }
  }
});

test('actual reveal-entry uses FIFO nextFrame explorer restore without center-board and always clears its focus guard', async () => {
  const f = await fixture();
  try {
    f.messages.length = 0;
    const reply = await f.rpc('reveal-entry', { path: 'Source/Note.md' });
    assert.equal(reply.error, undefined); assert.equal(reply.result.ok, true); assert.equal(f.plugin.explorerRevealDepth, 0);
    assert.equal(f.app.workspace.activeLeaf, f.boardLeaf);
    assert.deepEqual(f.explorerCalls.filter(call => call[0] === 'active').map(call => call.slice(1)), [['explorer', 1], ['board', 1]]);
    assert.ok(f.explorerCalls.some(call => call[0] === 'select' && call[1] === true && call[2] === 1));
    assert.equal(f.messages.some(message => message.type === 'center-board'), false, 'temporary explorer focus/restore must not recenter the Board');
    const missing = await f.rpc('reveal-entry', { path: 'Missing.md' }); assert.ok(missing.error); assert.equal(f.plugin.explorerRevealDepth, 0);
    f.app.workspace.setActiveLeaf(f.boardLeaf);
    assert.equal(f.messages.filter(message => message.type === 'center-board').length, 0, 'Board activation preserves the current camera; explicit navigation recenters');
    assert.deepEqual(f.nativeRenames, []); assert.deepEqual(f.articleWrites, []);
  } finally { f.plugin.onunload(); }
});

test('native move undo/redo restores original card identity/geometry and incident edges while retaining later body edits', async () => {
  const f = await fixture();
  try {
    const before = plain(f.plugin.layout), original = before.boards.source.nodes.find(n => n.id === moveRequest.node);
    const move = await f.rpc('move-article', moveRequest); assert.equal(move.error, undefined);
    const token = move.result.moveToken, destination = plain(move.result.node);
    assert.match(token, /^[0-9a-f-]{36}$/); assert.equal(destination.id, original.id);
    const laterBody = originalBody + '\r\nLater native editor change, preserved by undo.';
    f.bodies.set(move.result.newPath, laterBody);
    const undo = await f.rpc('replay-article-move', { token, direction: 'undo' }); assert.equal(undo.error, undefined);
    assert.equal(undo.result.moveToken, token); assert.equal(undo.result.oldPath, 'Destination/Note.md'); assert.equal(undo.result.newPath, 'Source/Note.md');
    assert.equal(undo.result.doc.body, laterBody); assert.deepEqual(undo.result.node, original);
    assert.deepEqual(undo.result.layout.boards.source.edges, before.boards.source.edges);
    assert.equal(undo.result.layout.boards.target.nodes.some(n => n.id === original.id), false);
    assert.equal(undo.result.layout.boards.free.nodes[0].doc, 'Source/Note.md');
    assert.equal(f.bodies.has('Destination/Note.md'), false); assert.equal(f.bodies.get('Source/Note.md'), laterBody);
    const redo = await f.rpc('replay-article-move', { token, direction: 'redo' }); assert.equal(redo.error, undefined);
    assert.equal(redo.result.moveToken, token); assert.deepEqual(redo.result.node, destination); assert.equal(redo.result.doc.body, laterBody);
    assert.equal(redo.result.layout.boards.source.nodes.some(n => n.id === original.id), false);
    assert.deepEqual(redo.result.layout.boards.source.edges, []); assert.equal(redo.result.layout.boards.free.nodes[0].doc, 'Destination/Note.md');
    assert.deepEqual(redo.result.layout.boards.source.view, before.boards.source.view); assert.deepEqual(redo.result.layout.boards.target.view, before.boards.target.view);
    assert.deepEqual(f.nativeRenames, [['Source/Note.md', 'Destination/Note.md'], ['Destination/Note.md', 'Source/Note.md'], ['Source/Note.md', 'Destination/Note.md']]);
    assert.deepEqual(f.articleWrites, []); assert.equal(f.saved.some(saved => JSON.stringify(saved).includes(token)), false, 'opaque replay token is never persisted');
    assert.equal(JSON.stringify([...f.plugin.articleMoves.values()].map(({ file, ...record }) => record)).includes(laterBody), false, 'move history holds references, never article bodies');
  } finally { f.plugin.onunload(); }
});

test('undo and redo survive real registered rename/snapshot races without duplicate managed copies', async () => {
  const f = await fixture({ hidden: false });
  try {
    const move = await f.rpc('move-article', moveRequest); const token = move.result.moveToken;
    f.setAfterRename(async () => { await f.plugin.snapshot(); });
    for (const direction of ['undo', 'redo', 'undo']) {
      const reply = await f.rpc('replay-article-move', { token, direction }); assert.equal(reply.error, undefined);
      const target = direction === 'undo' ? 'source' : 'target', other = direction === 'undo' ? 'target' : 'source';
      const cards = reply.result.layout.boards[target].nodes.filter(n => n.type === 'article' && n.doc === reply.result.newPath);
      assert.equal(cards.length, 1); assert.equal(cards[0].id, moveRequest.node); assert.equal(cards[0].w, 600); assert.equal(cards[0].h, 900);
      assert.equal(reply.result.layout.boards[other].nodes.some(n => n.id === moveRequest.node), false);
      assert.equal(reply.result.layout.boards.free.nodes[0].doc, reply.result.newPath); assert.equal(f.bodies.get(reply.result.newPath), originalBody);
      await f.plugin.snapshot(); assert.equal(f.plugin.layout.boards[target].nodes.filter(n => n.doc === reply.result.newPath).length, 1);
    }
    assert.deepEqual(f.articleWrites, []);
  } finally { f.plugin.onunload(); }
});

test('a manual cross-folder reference on the mapped root Board returns to its original card while the file returns to its actual folder', async () => {
  const f = await fixture();
  try {
    const original = { id: 'root-reference', type: 'article', doc: 'Source/Note.md', x: -1220, y: 640, w: 420, h: 380, folderManaged: false };
    f.plugin.layout.boards.home.nodes.push(original);
    const move = await f.rpc('move-article', { sourceBoard: 'home', targetBoard: 'target', node: original.id }); assert.equal(move.error, undefined);
    const undo = await f.rpc('replay-article-move', { token: move.result.moveToken, direction: 'undo' }); assert.equal(undo.error, undefined);
    assert.deepEqual(undo.result.node, original); assert.equal(undo.result.layout.boards.home.folderPath, '');
    assert.equal(f.bodies.get('Source/Note.md'), originalBody); assert.equal(f.bodies.has('Destination/Note.md'), false);
    await f.plugin.snapshot(); assert.deepEqual(plain(f.plugin.layout.boards.home.nodes.find(n => n.id === original.id)), original);
    assert.equal((await f.rpc('replay-article-move', { token: move.result.moveToken, direction: 'redo' })).error, undefined);
    assert.deepEqual(f.articleWrites, []);
  } finally { f.plugin.onunload(); }
});

test('undo rejects missing original folder, filename collisions and mismatched card/Board/token state without moving files', async () => {
  const cases = [
    { change: f => f.addFile('Source/Note.md', 'other source article'), payload: token => ({ token, direction: 'undo' }) },
    { change: f => f.files.delete('Source'), payload: token => ({ token, direction: 'undo' }) },
    { change: f => { f.plugin.layout.boards.target.nodes.find(n => n.id === moveRequest.node).doc = 'Other.md'; }, payload: token => ({ token, direction: 'undo' }) },
    { change: f => { f.plugin.layout.boards.source.folderPath = 'Other folder'; }, payload: token => ({ token, direction: 'undo' }) },
    { change() {}, payload: token => ({ token, direction: 'redo' }) },
    { change() {}, payload: () => ({ token: '__proto__', direction: 'undo' }) },
    { change() {}, payload: token => ({ token, direction: 'both' }) },
  ];
  for (const scenario of cases) {
    const f = await fixture();
    try {
      const move = await f.rpc('move-article', moveRequest); scenario.change(f);
      const before = plain(f.plugin.layout), count = f.nativeRenames.length, currentBody = f.bodies.get('Destination/Note.md');
      const reply = await f.rpc('replay-article-move', scenario.payload(move.result.moveToken));
      assert.ok(reply.error); assert.equal(reply.result, undefined); assert.deepEqual(plain(f.plugin.layout), before);
      assert.equal(f.nativeRenames.length, count); assert.equal(f.bodies.get('Destination/Note.md'), currentBody); assert.deepEqual(f.articleWrites, []);
    } finally { f.plugin.onunload(); }
  }
});

test('external native rename/delete invalidates replay even when the same path returns, but modifications remain allowed', async () => {
  for (const external of ['rename', 'delete']) {
    const f = await fixture();
    try {
      const move = await f.rpc('move-article', moveRequest), token = move.result.moveToken;
      const originalFile = f.files.get('Destination/Note.md');
      if (external === 'rename') { await f.app.fileManager.renameFile(originalFile, 'Destination/Renamed.md'); await f.app.fileManager.renameFile(originalFile, 'Destination/Note.md'); }
      else { f.files.delete(originalFile.path); f.bodies.delete(originalFile.path); f.emit('delete', originalFile); f.addFile('Destination/Note.md', 'new identity at same path'); }
      const count = f.nativeRenames.length, before = plain(f.plugin.layout), body = f.bodies.get('Destination/Note.md');
      const undo = await f.rpc('replay-article-move', { token, direction: 'undo' }); assert.ok(undo.error);
      assert.equal(f.nativeRenames.length, count); assert.deepEqual(plain(f.plugin.layout), before); assert.equal(f.bodies.get('Destination/Note.md'), body);
    } finally { f.plugin.onunload(); }
  }
});

test('concurrent replay is refused, then the completed undo can be redone and subsequently undone', async () => {
  const f = await fixture();
  try {
    const move = await f.rpc('move-article', moveRequest); let release, entered;
    const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    f.setBeforeRename(async () => { entered(); await gate; });
    const pending = f.rpc('replay-article-move', { token: move.result.moveToken, direction: 'undo' }); await started;
    const conflict = await f.rpc('replay-article-move', { token: move.result.moveToken, direction: 'undo' }); assert.ok(conflict.error); assert.equal(f.nativeRenames.length, 2);
    release(); const done = await pending; assert.equal(done.error, undefined); f.setBeforeRename(undefined);
    const repeated = await f.rpc('replay-article-move', { token: move.result.moveToken, direction: 'undo' }); assert.ok(repeated.error);
    assert.equal((await f.rpc('replay-article-move', { token: move.result.moveToken, direction: 'redo' })).error, undefined);
    assert.equal((await f.rpc('replay-article-move', { token: move.result.moveToken, direction: 'undo' })).error, undefined);
  } finally { f.plugin.onunload(); }
});

test('external rename during replay persistence is reported without undoing the external move or overwriting text', async () => {
  const f = await fixture();
  try {
    const move = await f.rpc('move-article', moveRequest), save = f.plugin.saveData.bind(f.plugin); let fired = false;
    f.plugin.saveData = async data => { await save(data); if (!fired && data.layout.boards.source.nodes.some(n => n.id === moveRequest.node)) { fired = true; await f.app.fileManager.renameFile(f.files.get('Source/Note.md'), 'Source/External.md'); } };
    const undo = await f.rpc('replay-article-move', { token: move.result.moveToken, direction: 'undo' });
    assert.ok(undo.error); assert.equal(undo.result, undefined); assert.equal(f.bodies.get('Source/External.md'), originalBody);
    assert.equal(f.bodies.has('Source/Note.md'), false); assert.equal(f.plugin.layout.boards.source.nodes.find(n => n.id === moveRequest.node).doc, 'Source/External.md');
    const count = f.nativeRenames.length;
    assert.ok((await f.rpc('replay-article-move', { token: move.result.moveToken, direction: 'redo' })).error); assert.equal(f.nativeRenames.length, count);
    assert.deepEqual(f.articleWrites, []);
  } finally { f.plugin.onunload(); }
});

test('multiple sequential moves of one file undo in reverse order, tokens are bounded and cleared on unload', async () => {
  const f = await fixture();
  try {
    const first = await f.rpc('move-article', moveRequest);
    f.files.set('Third', { path: 'Third', name: 'Third', children: [] });
    f.plugin.layout.boards.third = makeBoard('third', 'Third');
    const second = await f.rpc('move-article', { sourceBoard: 'target', targetBoard: 'third', node: moveRequest.node }); assert.equal(second.error, undefined);
    assert.equal((await f.rpc('replay-article-move', { token: second.result.moveToken, direction: 'undo' })).error, undefined);
    assert.equal((await f.rpc('replay-article-move', { token: first.result.moveToken, direction: 'undo' })).error, undefined);
    assert.equal(f.bodies.get('Source/Note.md'), originalBody);
    const sample = f.plugin.articleMoves.get(first.result.moveToken);
    for (let i = 0; i < 200; i++) { const { token, phase, invalid, busy, ...record } = sample; f.plugin.rememberArticleMove(record); }
    assert.equal(f.plugin.articleMoves.size, 200); assert.equal(f.plugin.articleMoves.has(first.result.moveToken), false);
    const evicted = await f.rpc('replay-article-move', { token: first.result.moveToken, direction: 'redo' }); assert.ok(evicted.error);
    assert.equal(f.saved.some(saved => Object.keys(saved).includes('articleMoves')), false);
  } finally { f.plugin.onunload(); assert.equal(f.plugin.articleMoves.size, 0); }
});

test('actual recycle RPC suppresses hidden rename migrations, restores docs and original identity through a restarted service, never calls FileManager or rewrites links', async () => {
  const f = await fixture();
  try {
    const d = installRecycleDisk(f), before = plain(f.plugin.layout), original = before.boards.source.nodes.find(n => n.id === moveRequest.node);
    const trash = await f.rpc('trash-components', { board: 'source', ids: [moveRequest.node, 'source-note'] }); assert.equal(trash.error, undefined);
    assert.equal(f.files.has('Source/Note.md'), false); assert.equal(f.plugin.layout.boards.free.nodes.some(n => n.doc === 'Source/Note.md'), false);
    assert.equal(trash.result.docs['Source/Note.md'], undefined); assert.equal(f.nativeRenames.length, 0);
    assert.equal(f.plugin.layout.boards.source.folderPath, 'Source'); assert.equal(f.messages.some(m => m.kind === 'vb-event' && m.type === 'rename' && m.payload.newPath.startsWith('.trash/')), false);
    const record = (await f.rpc('list-trash', {})).result[0]; assert.equal(record.token, trash.result.trashToken); assert.equal(record.status, 'trashed');
    f.plugin.layout.boards.target.nodes.find(n => n.id === 'target-note').x = 54321;
    const restore = await f.rpc('restore-components', { token: record.token }); assert.equal(restore.error, undefined);
    assert.deepEqual(restore.result.layout.boards.source.nodes.find(n => n.id === original.id), original);
    assert.deepEqual(restore.result.layout.boards.source.edges, before.boards.source.edges); assert.equal(restore.result.layout.boards.target.nodes.find(n => n.id === 'target-note').x, 54321);
    assert.equal(restore.result.docs['Source/Note.md'].body, originalBody); assert.deepEqual(restore.result.restoredPaths, ['Source/Note.md']);
    assert.equal(d.disk.get('Source/Note.md').body, originalBody); assert.equal(f.nativeRenames.length, 0); assert.deepEqual(f.articleWrites, []);
    const redo = await f.rpc('redo-trash', { token: record.token }); assert.equal(redo.error, undefined); assert.equal(f.files.has('Source/Note.md'), false);
    assert.equal(f.plugin.layout.boards.target.nodes.find(n => n.id === 'target-note').x, 54321); assert.equal((await f.rpc('list-trash', {})).result[0].status, 'trashed');
  } finally { f.plugin.onunload(); }
});

test('actual recursive folder recycle retains nested Board IDs, latest document restore and local arrangement across RPC snapshots', async () => {
  const f = await fixture();
  try {
    installRecycleDisk(f); const before = plain(f.plugin.layout), trash = await f.rpc('trash-components', { board: 'home', ids: ['source-entry'] }); assert.equal(trash.error, undefined);
    assert.equal(f.files.has('Source'), false); assert.equal(f.files.has('Source/Note.md'), false); assert.equal(f.plugin.layout.boards.source, undefined);
    assert.equal(f.plugin.layout.boards.home.nodes.some(n => n.board === 'source'), false);
    const restore = await f.rpc('restore-components', { token: trash.result.trashToken }); assert.equal(restore.error, undefined);
    assert.equal(f.plugin.layout.boards.source.folderPath, 'Source'); assert.notEqual(f.plugin.layout.boards.source.folderMissing, true);
    assert.deepEqual(plain(f.plugin.layout.boards.source.nodes), before.boards.source.nodes); assert.deepEqual(plain(f.plugin.layout.boards.source.edges), before.boards.source.edges);
    assert.equal(restore.result.docs['Source/Note.md'].body, originalBody); assert.deepEqual(f.articleWrites, []); assert.deepEqual(f.nativeRenames, []);
  } finally { f.plugin.onunload(); }
});

test('recycle success broadcasts current layout to other open views with camera preservation, never recenters them', async () => {
  const f = await fixture();
  try {
    installRecycleDisk(f); const messages = [], otherLeaf = {}, other = new f.view.constructor(otherLeaf, f.plugin); otherLeaf.view = other;
    other.frame = { contentWindow: { postMessage(m) { messages.push(plain(m)); } } };
    const get = f.app.workspace.getLeavesOfType; f.app.workspace.getLeavesOfType = type => type === 'visual-board-desktop' ? [f.boardLeaf, otherLeaf] : get(type);
    const trash = await f.rpc('trash-components', { board: 'source', ids: [moveRequest.node] }); assert.equal(trash.error, undefined);
    const first = messages.find(m => m.type === 'snapshot'); assert.ok(first); assert.equal(first.payload.preserveView, true); assert.equal(first.payload.layout.boards.source.nodes.some(n => n.id === moveRequest.node), false);
    messages.length = 0; const restore = await f.rpc('restore-components', { token: trash.result.trashToken }); assert.equal(restore.error, undefined);
    assert.ok(messages.find(m => m.type === 'snapshot').payload.layout.boards.source.nodes.some(n => n.id === moveRequest.node));
    messages.length = 0; assert.equal((await f.rpc('redo-trash', { token: trash.result.trashToken })).error, undefined);
    assert.equal(messages.find(m => m.type === 'snapshot').payload.layout.boards.source.nodes.some(n => n.id === moveRequest.node), false);
    assert.equal(messages.some(m => m.type === 'center-board'), false);
  } finally { f.plugin.onunload(); }
});

test('native file-list delete clears every reference immediately, retains recovery drafts, and publishes a camera-preserving layout snapshot', async () => {
  const f=await fixture();
  try {
    const stamp=f.plugin.layoutStamp(),original=plain(stamp.layout),file=f.files.get('Source/Note.md');
    f.plugin.drafts[file.path]={path:file.path,body:'unsaved fixture',expectedBody:originalBody,updatedAt:10};
    f.files.delete(file.path);f.bodies.delete(file.path);f.emit('delete',file);
    for(const b of Object.values(f.plugin.layout.boards))assert.equal(b.nodes.some(n=>n.doc==='Source/Note.md'),false);
    assert.deepEqual(plain(f.plugin.layout.boards.source.edges),[]);
    assert.deepEqual(plain(f.plugin.layout.boards.source.view),original.boards.source.view);
    assert.equal(f.plugin.drafts['Source/Note.md'].body,'unsaved fixture');
    const event=f.messages.find(m=>m.type==='delete');assert.equal(event.payload.nativeRevision,1);assert.equal(event.payload.path,'Source/Note.md');
    f.view.ready=true;await f.view.refresh();
    const snapshot=f.messages.filter(m=>m.type==='snapshot').at(-1).payload;
    assert.equal(snapshot.nativeRevision,1);assert.ok(snapshot.layout);assert.equal(snapshot.preserveView,true);
    const saved=await f.rpc('save-layout',{...original,layoutSession:stamp.layoutSession,layoutRevision:stamp.layoutRevision,nativeRevision:0});assert.equal(saved.error,undefined);
    assert.equal(Object.values(f.plugin.layout.boards).some(b=>b.nodes.some(n=>n.doc==='Source/Note.md')),false);
    assert.deepEqual(f.articleWrites,[]);
  }finally{f.plugin.onunload();}
});
test('native file rename survives a queued old layout save and migrates recovery drafts to the new exact path', async () => {
  const f=await fixture();
  try {
    const stamp=f.plugin.layoutStamp(),stale=plain(stamp.layout),oldPath='Source/Note.md',newPath='Source/Renamed.md';
    f.plugin.drafts[oldPath]={path:oldPath,body:'unsaved rename fixture',expectedBody:originalBody,updatedAt:10};
    await f.app.fileManager.renameFile(f.files.get(oldPath),newPath);
    assert.equal(f.plugin.drafts[newPath].body,'unsaved rename fixture');assert.equal(f.plugin.drafts[oldPath],undefined);
    const event=f.messages.find(m=>m.type==='rename');assert.equal(event.payload.nativeRevision,1);
    const saved=await f.rpc('save-layout',{...stale,layoutSession:stamp.layoutSession,layoutRevision:stamp.layoutRevision,nativeRevision:0});assert.equal(saved.error,undefined);
    assert.equal(f.plugin.layout.boards.free.nodes[0].doc,newPath);
    assert.equal(f.plugin.layout.boards.source.nodes.find(n=>n.id==='selected-reference').doc,newPath);
    assert.deepEqual(plain(f.plugin.layout.boards.free.view),stale.boards.free.view);
    assert.equal(f.bodies.get(newPath),originalBody);assert.deepEqual(f.articleWrites,[]);
  }finally{f.plugin.onunload();}
});
test('startup cleanup waits for native layout readiness, prunes old ghosts and keeps unindexed files known to disk', async () => {
  const f=await fixture({skipSnapshot:true,deferReady:true});
  try {
    f.plugin.layout.boards.free.nodes.push({id:'ghost',type:'article',doc:'Gone.md',x:100,y:0},{id:'unindexed',type:'article',doc:'Unindexed.md',x:800,y:0});
    f.plugin.drafts['Gone.md']={path:'Gone.md',body:'recover me',expectedBody:'fixture',updatedAt:10};
    f.app.vault.adapter.exists=async path=>f.files.has(path)||path==='Unindexed.md';
    let completed=false;const pending=f.plugin.snapshot().then(v=>{completed=true;return v;});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,false);
    assert.ok(f.plugin.layout.boards.free.nodes.some(n=>n.id==='ghost'));
    f.releaseReady();const snapshot=await pending;
    assert.equal(snapshot.layout.boards.free.nodes.some(n=>n.id==='ghost'),false);
    assert.ok(snapshot.layout.boards.free.nodes.some(n=>n.id==='unindexed'));
    assert.equal(f.plugin.drafts['Gone.md'].body,'recover me');assert.deepEqual(f.articleWrites,[]);
  }finally{f.plugin.onunload();}
});
test('a native rename during asynchronous article reads restarts the snapshot instead of publishing old-path docs under a new revision', async () => {
  const f=await fixture();
  try {
    let release,started;const waiting=new Promise(resolve=>{started=resolve;});let first=true;
    f.app.vault.cachedRead=async file=>{if(first&&file.path==='Source/Note.md'){first=false;started();await new Promise(resolve=>{release=resolve;});}return f.bodies.get(file.path);};
    const pending=f.plugin.snapshot();await waiting;
    await f.app.fileManager.renameFile(f.files.get('Source/Note.md'),'Source/Renamed.md');release();
    const snapshot=await pending;
    assert.equal(snapshot.nativeRevision,1);assert.equal(snapshot.docs['Source/Note.md'],undefined);
    assert.equal(snapshot.docs['Source/Renamed.md'].body,originalBody);
    assert.equal(snapshot.layout.boards.free.nodes[0].doc,'Source/Renamed.md');
  }finally{f.plugin.onunload();}
});
