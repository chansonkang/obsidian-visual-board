import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

// Execute the actual bundled plugin host; only the external Obsidian API is mocked.
const compiled = await build({ entryPoints: [new URL('../src/main.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['obsidian'], loader: { '.html': 'text' }, write: false });
const source = compiled.outputFiles[0].text;
const plain = value => JSON.parse(JSON.stringify(value));
const makeBoard = (id, title, parent, nodes = []) => ({ id, title, parent, theme: 'research', iconMode: 'default', iconId: 'leaf', iconManual: true, iconStatus: 'default', view: { x: 714, y: -231, zoom: 1.3 }, nodes, edges: [] });
function legacyLayout() {
  const home = makeBoard('home', '旧桌面', null, [{ id: 'manual-existing', type: 'board', board: 'old-existing', x: -940, y: 182, w: 300, h: 303 }, { id: 'manual-new', type: 'board', board: 'old-new', x: 873, y: -346, w: 300, h: 303 }]);
  home.edges = [{ from: 'manual-existing', to: 'manual-new' }];
  const existing = makeBoard('old-existing', 'Existing', 'home', [{ id: 'manual-local', type: 'article', doc: 'Existing/Local.md', x: 483, y: -190, w: 540, h: 700 }]);
  Object.assign(existing, { iconMode: 'ai', iconPath: 'Assets/custom.png', iconModel: 'stored-model', iconStatus: 'generated' });
  const fresh = makeBoard('old-new', 'New', 'home', [{ id: 'manual-child', type: 'board', board: 'old-child', x: 236, y: 174, w: 300, h: 303 }]);
  const child = makeBoard('old-child', 'Child', 'old-new', [{ id: 'cross-folder-ref', type: 'article', doc: 'Elsewhere/Personal.md', x: -1850, y: 2580, w: 720, h: 560 }]);
  return { version: 2, articleSizingVersion: 1, currentBoard: 'old-child', showKnowledge: true, showSpace: true, boards: { home, 'old-existing': existing, 'old-new': fresh, 'old-child': child } };
}
function fixture(layout = legacyLayout()) {
  const files = new Map(), bodies = new Map(), created = [], renamed = [], articleWrites = [], saved = [], notices = [];
  const root = { path: '', name: '', children: [] }; files.set('', root);
  class TFile {
    constructor(path, body) { this.path = path; this.name = path.split('/').pop(); this.basename = this.name.replace(/\.md$/i, ''); this.extension = this.name.split('.').pop(); this.stat = { mtime: 1 }; bodies.set(path, body); }
  }
  function addFolder(path) { const folder = { path, name: path.split('/').pop(), children: [] }; files.set(path, folder); return folder; }
  function addFile(path, body) { const file = new TFile(path, body); files.set(path, file); return file; }
  ['Existing', 'Existing/LiveSub', 'Elsewhere'].forEach(addFolder);
  addFile('Existing/Local.md', '# Local\r\n\r\nOriginal bytes and [[Personal]].\r\n');
  addFile('Elsewhere/Personal.md', '---\nprivate: fixture-only\n---\n\nKeep this content byte for byte.');
  addFile('Root.md', '# Root article');
  const handlers = new Map();
  const on = (type, fn) => { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); return { type, fn }; };
  let createHook;
  const app = {
    vault: {
      configDir: '.obsidian', on,
      getRoot: () => root, getAllLoadedFiles: () => [...files.values()], getAbstractFileByPath: path => files.get(path) || null,
      getMarkdownFiles: () => [...files.values()].filter(file => file instanceof TFile && file.extension === 'md'),
      getName: () => 'Mock Vault', cachedRead: async file => bodies.get(file.path), read: async file => bodies.get(file.path),
      createFolder: async path => { await new Promise(resolve => setImmediate(resolve)); if (createHook) await createHook(path); if (files.has(path)) throw Error('Exists'); created.push(path); return addFolder(path); },
      create: async (...args) => { articleWrites.push(['create', ...args]); throw Error('Unexpected article write'); },
      process: async (...args) => { articleWrites.push(['process', ...args]); throw Error('Unexpected article write'); },
      modify: async (...args) => { articleWrites.push(['modify', ...args]); throw Error('Unexpected article write'); },
      adapter: { read: async () => '{}', write: async () => {}, readBinary: async () => { throw Error('Missing attachment'); } },
    },
    workspace: { on, getLeavesOfType: () => [], getActiveFile: () => null },
    metadataCache: { on, resolvedLinks: { 'Existing/Local.md': { 'Elsewhere/Personal.md': 1 } }, getFileCache: () => ({ embeds: [] }), getFirstLinkpathDest: () => null },
    fileManager: { renameFile: async (file, target) => { renamed.push([file.path, target]); throw Error('Unexpected native rename during migration'); } },
  };
  const input = { schema: 1, layout: plain(layout), settings: { legacyFolderLinked: false, defaultIconMode: 'default' } };
  class Plugin {
    constructor(app, manifest) { this.app = app; this.manifest = manifest; }
    loadData() { return Promise.resolve(plain(input)); }
    saveData(data) { saved.push(plain(data)); return Promise.resolve(); }
    registerView() {} registerEvent() {} registerObsidianProtocolHandler() {} addRibbonIcon() {} addCommand() {} addSettingTab() {}
  }
  class ItemView {}
  class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
  class Notice { constructor(message) { notices.push(message); } }
  const obsidian = { Plugin, ItemView, WorkspaceLeaf: class {}, PluginSettingTab, Setting: class {}, Notice, TFile, normalizePath: path => path.replace(/\\/g, '/'), requestUrl: async () => { throw Error('Unexpected network request'); } };
  const module = { exports: {} };
  runInNewContext(source, { module, exports: module.exports, require: name => { if (name === 'obsidian') return obsidian; throw Error('Unexpected module: ' + name); }, console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, crypto: webcrypto, Uint8Array, btoa: value => Buffer.from(value, 'binary').toString('base64') });
  const plugin = new module.exports.default(app, { id: 'visual-board', dir: '.obsidian/plugins/visual-board' });
  return { plugin, input, files, bodies, created, renamed, articleWrites, saved, notices, addFile, setCreateHook: hook => { createHook = hook; }, renameFolder(oldPath, newPath) {
    const folder = files.get(oldPath);
    for (const [path, file] of [...files]) if (path === oldPath || path.startsWith(oldPath + '/')) {
      const next = newPath + path.slice(oldPath.length); files.delete(path);
      file.path = next; file.name = next.split('/').pop();
      if (file instanceof TFile) { file.basename = file.name.replace(/\.md$/i, ''); const body = bodies.get(path); bodies.delete(path); bodies.set(next, body); }
      files.set(next, file);
    }
    for (const listener of handlers.get('rename') || []) listener(folder, oldPath);
  }, renameNote(oldPath, newPath) {
    const file = files.get(oldPath), body = bodies.get(oldPath); files.delete(oldPath); bodies.delete(oldPath);
    file.path = newPath; file.name = newPath.split('/').pop(); file.basename = file.name.replace(/\.md$/i, '');
    files.set(newPath, file); bodies.set(newPath, body);
    for (const listener of handlers.get('rename') || []) listener(file, oldPath);
  } };
}
function geometry(layout, nodeIds) {
  return Object.fromEntries(Object.values(layout.boards).flatMap(board => board.nodes.filter(node => nodeIds.has(node.id)).map(node => [node.id, { x: node.x, y: node.y, w: node.w, h: node.h }])));
}

test('actual host migration links Existing and creates New/Child once without changing legacy layout or note bytes', async () => {
  const f = fixture(), expected = legacyLayout();
  const originalNodes = new Set(Object.values(expected.boards).flatMap(board => board.nodes.map(node => node.id)));
  const expectedGeometry = geometry(expected, originalNodes), originalBodies = [...f.bodies.entries()];
  try {
    await f.plugin.onload();
    assert.deepEqual(f.created, [], 'onload must not create folders before migration snapshot');
    const snapshot = await f.plugin.snapshot();
    const layout = plain(snapshot.layout);
    assert.equal(layout.boards.home.folderPath, '');
    assert.equal(layout.boards['old-existing'].folderPath, 'Existing');
    assert.equal(layout.boards['old-new'].folderPath, 'New');
    assert.equal(layout.boards['old-child'].folderPath, 'New/Child');
    assert.equal(layout.boards['old-child'].parent, 'old-new');
    assert.equal(layout.currentBoard, 'old-child');
    assert.deepEqual([...f.created].sort(), ['New', 'New/Child']);
    assert.deepEqual(geometry(layout, originalNodes), expectedGeometry);
    for (const [id, old] of Object.entries(expected.boards)) {
      assert.deepEqual(layout.boards[id].view, old.view);
      for (const field of ['iconMode', 'iconId', 'iconManual', 'iconPath', 'iconModel']) assert.equal(layout.boards[id][field], old[field], id + '.' + field);
    }
    assert.deepEqual(layout.boards.home.edges, expected.boards.home.edges);
    assert.equal(layout.boards.home.nodes.find(node => node.id === 'manual-existing').folderManaged, true);
    assert.equal(layout.boards['old-new'].nodes.find(node => node.id === 'manual-child').folderManaged, true);
    assert.equal(layout.boards['old-existing'].nodes.find(node => node.id === 'manual-local').folderManaged, true);
    assert.ok(layout.boards['old-existing'].nodes.some(node => node.type === 'board' && layout.boards[node.board].folderPath === 'Existing/LiveSub' && node.folderManaged));
    assert.deepEqual([...f.bodies.entries()], originalBodies);
    assert.deepEqual(f.articleWrites, []); assert.deepEqual(f.renamed, []);
    assert.equal(f.plugin.settings.legacyFolderLinked, true);
    assert.equal(f.saved.at(-1).settings.legacyFolderLinked, true);
    assert.equal(f.saved.some(data => JSON.stringify(data).includes('Keep this content byte for byte')), false, 'layout persistence must never copy article bodies');
    const firstJSON = JSON.stringify(plain(f.plugin.layout)), firstCreated = [...f.created];
    await f.plugin.snapshot();
    assert.deepEqual(f.created, firstCreated); assert.equal(JSON.stringify(plain(f.plugin.layout)), firstJSON);
    Object.assign(f.input, f.saved.at(-1));
    const reloaded = new f.plugin.constructor(f.plugin.app, f.plugin.manifest);
    try {
      await reloaded.onload(); await reloaded.snapshot();
      assert.deepEqual(f.created, firstCreated, 'persisted migration flag must prevent new folders on plugin reload');
      assert.equal(reloaded.layout.boards['old-existing'].folderPath, 'Existing');
      assert.equal(reloaded.layout.boards['old-child'].folderPath, 'New/Child');
      assert.deepEqual(geometry(plain(reloaded.layout), originalNodes), expectedGeometry);
    } finally { reloaded.onunload(); }
    // A later native file appears as a managed reference in the already-linked child.
    f.addFile('New/Child/Deep.md', '# New mock article');
    await f.plugin.snapshot();
    assert.ok(f.plugin.layout.boards['old-child'].nodes.some(node => node.doc === 'New/Child/Deep.md' && node.folderManaged));
    assert.deepEqual(geometry(plain(f.plugin.layout), originalNodes), expectedGeometry);
    assert.deepEqual([...f.bodies.entries()].slice(0, originalBodies.length), originalBodies);
  } finally { f.plugin.onunload(); }
});

test('two overlapping actual host snapshots share the one-time legacy-folder migration', async () => {
  const f = fixture();
  try {
    await f.plugin.onload();
    await Promise.all([f.plugin.snapshot(), f.plugin.snapshot()]);
    assert.deepEqual([...f.created].sort(), ['New', 'New/Child']);
    assert.equal(new Set(Object.values(f.plugin.layout.boards).filter(board => board.folderPath !== undefined).map(board => board.folderPath)).size, Object.values(f.plugin.layout.boards).filter(board => board.folderPath !== undefined).length);
    assert.deepEqual(f.articleWrites, []);
    assert.equal(f.plugin.layout.boards['old-child'].parent, 'old-new');
  } finally { f.plugin.onunload(); }
});

test('a failed parent-folder association keeps its descendants in their original Board hierarchy', async () => {
  const layout = legacyLayout(); layout.boards['old-new'].title = 'invalid/name';
  const f = fixture(layout);
  try {
    await f.plugin.onload(); await f.plugin.snapshot();
    assert.equal(f.plugin.layout.boards['old-new'].folderPath, undefined);
    assert.equal(f.plugin.layout.boards['old-child'].folderPath, undefined, 'failed-parent descendants must not create unintended root folders');
    assert.equal(f.plugin.layout.boards['old-child'].parent, 'old-new', 'failed-parent descendants must not be reparented to home');
    assert.equal(f.files.has('Child'), false);
    assert.ok(f.notices.some(message => message.includes('invalid/name')));
    assert.deepEqual(f.articleWrites, []);
  } finally { f.plugin.onunload(); }
});

test('native note rename during awaited folder creation does not detach migrated Board identity', async () => {
  const layout = legacyLayout(); layout.visibleArticleHeadings = ['Existing/Local.md', 'Existing/Local.md-copy.md', 'Elsewhere/Personal.md'];
  const f = fixture(layout); let once = false;
  f.setCreateHook(path => { if (!once && path === 'New') { once = true; f.renameNote('Existing/Local.md', 'Existing/Renamed.md'); } });
  try {
    await f.plugin.onload(); await f.plugin.snapshot();
    assert.equal(once, true, 'test must dispatch the actual registered native rename callback during migration');
    assert.equal(f.plugin.layout.boards['old-new'].folderPath, 'New');
    assert.equal(f.plugin.layout.boards['old-child'].folderPath, 'New/Child');
    assert.equal(f.plugin.layout.boards['old-child'].parent, 'old-new');
    assert.equal(f.plugin.layout.boards['old-existing'].nodes.find(node => node.id === 'manual-local').doc, 'Existing/Renamed.md');
    assert.deepEqual(plain(f.plugin.layout.visibleArticleHeadings), ['Existing/Renamed.md', 'Existing/Local.md-copy.md', 'Elsewhere/Personal.md']);
    assert.equal(f.bodies.get('Existing/Renamed.md'), '# Local\r\n\r\nOriginal bytes and [[Personal]].\r\n');
    assert.deepEqual([...f.created].sort(), ['New', 'New/Child']);
    assert.deepEqual(f.articleWrites, []);
  } finally { f.plugin.onunload(); }
});

test('native folder rename preserves visible H1 preferences for its descendants without touching note bytes or similar prefixes', async () => {
  const layout = legacyLayout(); layout.visibleArticleHeadings = ['Existing/Local.md', 'Existing/LiveSub/Missing.md', 'Existing-other/Keep.md', 'Elsewhere/Personal.md'];
  const f = fixture(layout);
  try {
    await f.plugin.onload(); const before = [...f.bodies.values()].sort();
    f.renameFolder('Existing', 'Renamed');
    assert.deepEqual(plain(f.plugin.layout.visibleArticleHeadings), ['Renamed/Local.md', 'Renamed/LiveSub/Missing.md', 'Existing-other/Keep.md', 'Elsewhere/Personal.md']);
    assert.equal(f.plugin.layout.boards['old-existing'].nodes.find(node => node.id === 'manual-local').doc, 'Renamed/Local.md');
    await f.plugin.persist();
    assert.deepEqual(f.saved.at(-1).layout.visibleArticleHeadings, plain(f.plugin.layout.visibleArticleHeadings));
    assert.deepEqual([...f.bodies.values()].sort(), before); assert.deepEqual(f.articleWrites, []);
  } finally { f.plugin.onunload(); }
});
