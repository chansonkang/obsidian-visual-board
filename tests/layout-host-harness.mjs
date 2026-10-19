import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

// Real main.ts lifecycle and RPCs, backed only by an isolated in-memory Vault adapter.
const compiled = await build({ entryPoints: [new URL('../src/main.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['obsidian'], loader: { '.html': 'text' }, write: false });
const source = compiled.outputFiles[0].text, plain = value => JSON.parse(JSON.stringify(value));
const dir = '.obsidian/plugins/obsidian-visual-board', primary = dir + '/data.json';
const body = '# Test title\r\n\r\nOriginal **Markdown** and [[Other]] remain unchanged.\r\n';
const board = (id, folderPath, parent, nodes) => ({ id, title: id === 'research' ? 'Research' : id === 'nested' ? 'Sub' : id, folderPath, folderMissing: false, parent, theme: 'research', iconMode: 'default', iconStatus: 'default', view: { x: -420, y: 760, zoom: .6 }, nodes, edges: [] });
function arrangement() {
  const home = board('home', '', null, [{ id: 'research-entry', type: 'board', board: 'research', x: 1840, y: -720, w: 340, h: 360, folderManaged: true }]);
  const research = board('research', 'Research', 'home', [
    { id: 'audio', type: 'audio', filePath: 'Research/Song.mp3', title: 'Song', x: 900, y: -180, w: 480, h: 180 },
    { id: 'article-b', type: 'article', doc: 'Research/B.md', x: -900, y: -760, w: 520, h: 380, folderManaged: true },
    { id: 'sticky', type: 'note', title: 'Keep', text: 'Stacking and colors', x: 340, y: 700, w: 380, h: 280, color: 'pink', angle: -3 },
    { id: 'nested-entry', type: 'board', board: 'nested', x: -600, y: 840, w: 300, h: 303, folderManaged: true },
    { id: 'article-a', type: 'article', doc: 'Research/A.md', x: 640, y: -820, w: 820, h: 440, folderManaged: true },
    { id: 'photo', type: 'photo', imagePath: 'Research/Picture.png', imageWidth: 800, imageHeight: 400, title: 'Picture', x: -1400, y: 460, w: 400, h: 200 },
    { id: 'pdf', type: 'pdf', filePath: 'Research/Paper.pdf', title: 'Paper', x: 1500, y: 540, w: 580, h: 720 },
  ]);
  research.edges = [{ from: 'article-a', to: 'sticky', lineStyle: 'dashed', width: 3 }, { from: 'photo', to: 'audio', width: 4 }];
  research.knowledgeEdgeStyles = [{ from: 'article-b', to: 'article-a', lineStyle: 'dashed', width: 5, hidden: true }];
  research.iconId = 'leaf'; research.folderColor = 'rose'; research.hiddenFolderDocs = ['Research/Hidden.md'];
  const nested = board('nested', 'Research/Sub', 'research', [{ id: 'nested-article', type: 'article', doc: 'Research/Sub/C.md', x: 1960, y: -1420, w: 620, h: 520, folderManaged: true }]);
  return { version: 2, articleSizingVersion: 1, currentBoard: 'research', showKnowledge: true, showSpace: false, boards: { home, research, nested }, audioPlayback: { 'Research/Song.mp3': { position: 42, duration: 120, lastPlayedAt: 1000 } }, visibleArticleHeadings: ['Research/A.md'] };
}
function diskFixture() {
  const files = new Map([[primary, JSON.stringify({ schema: 1, layout: arrangement(), settings: { language: 'zh', legacyFolderLinked: true, attachmentFolder: 'Assets', defaultIconMode: 'default' } })]]);
  for (const path of ['Research/A.md', 'Research/B.md', 'Research/Sub/C.md', 'Research/Hidden.md']) files.set(path, body);
  files.set('Research/Picture.png', 'image fixture'); files.set('Research/Song.mp3', 'audio fixture'); files.set('Research/Paper.pdf', '%PDF-1.7');
  return { files, directories: new Set(['', '.obsidian', '.obsidian/plugins', dir, 'Research', 'Research/Sub']), operations: [], articleWrites: [], loadCalls: 0, saveCalls: 0 };
}
async function lifecycle(disk, { markdownIndex = ['Research/A.md', 'Research/B.md', 'Research/Sub/C.md', 'Research/Hidden.md'], unindexedPaths = [] } = {}) {
  const indexed = new Map(), handlers = new Map(), notices = [], messages = [];
  const on = (type, fn) => { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); return { type, fn }; };
  class TFile { constructor(path) { this.path = path; this.name = path.split('/').pop(); this.basename = this.name.replace(/\.[^.]+$/, ''); this.extension = this.name.split('.').pop(); this.stat = { size: disk.files.get(path)?.length || 0, mtime: 100, ctime: 100 }; } }
  for (const path of disk.directories) if (!path.startsWith('.')) indexed.set(path, { path, name: path.split('/').pop(), children: [] });
  for (const path of disk.files.keys()) if (!path.startsWith('.') && !unindexedPaths.includes(path)) indexed.set(path, new TFile(path));
  const adapter = {
    exists: async path => disk.files.has(path) || disk.directories.has(path),
    read: async path => { if (!disk.files.has(path)) throw Error('Missing file: ' + path); return disk.files.get(path); },
    write: async (path, text) => { disk.operations.push(['write', path]); if (!path.startsWith('.')) disk.articleWrites.push(path); disk.files.set(path, text); },
    readBinary: async path => { if (!disk.files.has(path)) throw Error('Missing attachment'); return new TextEncoder().encode(disk.files.get(path)).buffer; },
    rename: async (from, to) => { if (!disk.files.has(from)) throw Error('Missing rename source'); if (disk.files.has(to)) throw Error('Destination exists'); disk.operations.push(['rename', from, to]); disk.files.set(to, disk.files.get(from)); disk.files.delete(from); },
    remove: async path => { disk.operations.push(['remove', path]); if (!disk.files.delete(path)) throw Error('Missing removal path'); },
    mkdir: async path => { disk.operations.push(['mkdir', path]); if (disk.directories.has(path)) throw Error('Directory exists'); disk.directories.add(path); },
    list: async path => ({ files: [...disk.files.keys()].filter(file => file.startsWith(path + '/') && !file.slice(path.length + 1).includes('/')), folders: [...disk.directories].filter(folder => folder.startsWith(path + '/') && !folder.slice(path.length + 1).includes('/')) }),
    getResourcePath: path => 'app://isolated/' + path,
  };
  let factory;
  const leaves = [], app = {
    vault: { adapter, configDir: '.obsidian', on, getName: () => 'Isolated Layout Vault', getAbstractFileByPath: path => indexed.get(path) || null, getAllLoadedFiles: () => [...indexed.values()], getRoot: () => indexed.get(''), getMarkdownFiles: () => markdownIndex.map(path => indexed.get(path)).filter(Boolean), cachedRead: async file => disk.files.get(file.path), read: async file => disk.files.get(file.path), getResourcePath: file => adapter.getResourcePath(file.path) },
    metadataCache: { on, resolvedLinks: {}, getFileCache: () => ({ embeds: [] }), getFirstLinkpathDest: () => null },
    workspace: { on, onLayoutReady: callback => callback(), getLeavesOfType: type => type === 'visual-board-desktop' ? leaves : [], getActiveFile: () => null },
  };
  class Plugin {
    constructor(app, manifest) { this.app = app; this.manifest = manifest; }
    async loadData() { disk.loadCalls++; return disk.files.has(primary) ? JSON.parse(disk.files.get(primary)) : null; }
    async saveData(value) { disk.saveCalls++; disk.operations.push(['legacy-save', primary]); disk.files.set(primary, JSON.stringify(value)); }
    registerView(_type, fn) { factory = fn; } registerEvent() {} registerObsidianProtocolHandler() {} addRibbonIcon() {} addCommand() {} addSettingTab() {}
  }
  class ItemView { constructor(leaf) { this.leaf = leaf; } }
  const obsidian = { Plugin, ItemView, WorkspaceLeaf: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, Notice: class { constructor(message) { notices.push(message); } }, normalizePath: value => value, requestUrl: async () => { throw Error('Unexpected network access'); } };
  const module = { exports: {} };
  runInNewContext(source, { module, exports: module.exports, require: name => { assert.equal(name, 'obsidian'); return obsidian; }, console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL, crypto: webcrypto, Uint8Array, btoa: value => Buffer.from(value, 'binary').toString('base64') });
  const plugin = new module.exports.default(app, { id: 'obsidian-visual-board', dir });
  let failure;
  try { await plugin.onload(); } catch (error) { failure = error; }
  let sequence = 0;
  function createFrame() {
    const leaf = {}, view = factory(leaf); leaf.view = view; leaves.push(leaf);
    view.frame = { contentWindow: { postMessage: value => messages.push(plain(value)) } };
    return { view, async rpc(method, payload) {
      const id = 'test-' + ++sequence; await view.handle({ id, method, payload });
      const response = messages.find(value => value.kind === 'vb-response' && value.id === id);
      assert.ok(response); assert.equal(response.error, undefined, response.error); return response.result;
    } };
  }
  const frame = !failure ? createFrame() : null;
  return { plugin, failure, notices, app, createFrame, setIndex: paths => { markdownIndex = paths; },
    rpc: (method, payload) => { assert.ok(frame); return frame.rpc(method, payload); },
    async nativeRename(from, to) {
      const file = indexed.get(from); assert.ok(file instanceof TFile);
      disk.files.set(to, disk.files.get(from)); disk.files.delete(from); indexed.delete(from);
      file.path = to; file.name = to.split('/').pop(); file.basename = file.name.replace(/\.[^.]+$/, ''); indexed.set(to, file);
      markdownIndex = markdownIndex.map(path => path === from ? to : path);
      for (const fn of handlers.get('rename') || []) await fn(file, from);
      await plugin.flushWrites();
    },
    close() { plugin.onunload(); } };
}


export { plain, dir, primary, body, arrangement, diskFixture, lifecycle };
