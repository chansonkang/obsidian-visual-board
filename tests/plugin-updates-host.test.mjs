import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

// Exercise the real native lifecycle, settings persistence and iframe RPCs; no real Vault or network.
const compiled = await build({ entryPoints: [new URL('../src/main.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', external: ['obsidian'], loader: { '.html': 'text' }, write: false });
const plain = value => JSON.parse(JSON.stringify(value));
const dir = '.obsidian/plugins/obsidian-visual-board', primary = dir + '/data.json', cachePath = dir + '/update-state.json', draftPath = dir + '/draft-recovery.json';
const repo = 'Chanson/visual-board', tag = 'v0.1.27', releaseUrl = `https://github.com/${repo}/releases/tag/${tag}`, downloadUrl = `https://github.com/${repo}/releases/download/${tag}/Visual-Board-v0.1.27-Chanson.zip`;
function release() { return { tag_name: tag, html_url: releaseUrl, draft: false, prerelease: false, assets: ['main.js', 'manifest.json', 'styles.css', 'Visual-Board-v0.1.27-Chanson.zip'].map(name => ({ name, size: 200, browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${name}` })) }; }
const response = (data, status = 200) => ({ status, text: JSON.stringify(data), headers: {} });
function initial(repository, autoCheck) {
 const home = { id: 'home', title: 'My Board', parent: null, folderPath: '', theme: 'product', view: { x: -399.5, y: 811.25, zoom: .7 }, nodes: [{ id: 'article', type: 'article', doc: 'Notes/A.md', x: -400, y: 900, w: 720, h: 500 }, { id: 'sticky', type: 'note', text: 'Private note', x: 1333, y: -499, w: 300, h: 270, color: 'pink' }], edges: [{ from: 'article', to: 'sticky', lineStyle: 'dashed', width: 3 }] };
 return { schema: 1, layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: { home } }, settings: { language: 'en', noteFolder: 'Notes', attachmentFolder: 'Assets', legacyFolderLinked: true, updateRepository: repository, autoCheckUpdates: autoCheck } };
}
async function fixture({ repository = repo, autoCheck = true, network, minAppVersion = '1.5.0' } = {}) {
 const files = new Map([[primary, JSON.stringify(initial(repository, autoCheck))], ['Notes/A.md', '# Private original\n\n**Markdown** and [[links]].\n'], [draftPath, JSON.stringify({ 'Notes/A.md': { path: 'Notes/A.md', body: '# Unsaved draft', expectedBody: 'original', updatedAt: 1234 } })]]), directories = new Set(['', '.obsidian', '.obsidian/plugins', dir]);
 const operations = [], requests = [], messages = [], notices = [], opened = [], commands = [], timers = []; let failWrites = false, factory, sequence = 0;
 const adapter = {
  exists: async path => files.has(path) || directories.has(path),
  read: async path => { if (!files.has(path)) throw Error('missing'); return files.get(path); },
  write: async (path, value) => { if (failWrites) throw Error('simulated disk full'); operations.push(['write', path]); files.set(path, value); },
  rename: async (from, to) => { if (failWrites) throw Error('simulated disk full'); if (!files.has(from) || files.has(to)) throw Error('invalid rename'); operations.push(['rename', from, to]); files.set(to, files.get(from)); files.delete(from); },
  remove: async path => { operations.push(['remove', path]); files.delete(path); },
  mkdir: async path => { if (failWrites) throw Error('simulated disk full'); operations.push(['mkdir', path]); directories.add(path); },
 };
 const leaves = [], app = { vault: { configDir: '.obsidian', adapter, on: () => ({}), getAbstractFileByPath: () => null }, metadataCache: { on: () => ({}) }, workspace: { onLayoutReady: callback => callback(), getLeavesOfType: () => leaves, getActiveFile: () => null } };
 class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
  loadData() { throw Error('existing protected storage must not use legacy loader'); }
  saveData() { throw Error('existing protected storage must not use legacy writer'); }
  registerView(_, callback) { factory = callback; } registerEvent() {} registerObsidianProtocolHandler() {} addRibbonIcon() {} addSettingTab() {} addCommand(command) { commands.push(command); return command; }
 }
 class ItemView { constructor(leaf) { this.leaf = leaf; this.contentEl = { ownerDocument: { defaultView: { open: (...args) => opened.push(args) } } }; } }
 const obsidian = { Plugin, ItemView, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, Notice: class { constructor(message) { notices.push(message); } }, normalizePath: value => value, apiVersion: '1.5.0', requestUrl: async request => { requests.push(plain(request)); if (network) return network(request); if (request.url.startsWith('https://api.github.com/')) return response(release()); assert.equal(request.url, `https://github.com/${repo}/releases/download/${tag}/manifest.json`); return response({ id: 'obsidian-visual-board', version: '0.1.27', minAppVersion }); } };
 const module = { exports: {} };
 runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: name => { assert.equal(name, 'obsidian'); return obsidian; }, console, TextEncoder, TextDecoder, URL, crypto: webcrypto, Uint8Array, setTimeout: (callback, ms) => { timers.push(ms); return setTimeout(callback, ms); }, clearTimeout });
 const plugin = new module.exports.default(app, { id: 'obsidian-visual-board', dir, version: '0.1.26', minAppVersion: '1.5.0' }); await plugin.onload();
 const leaf = {}, view = factory(leaf); leaf.view = view; leaves.push(leaf); view.frame = { contentWindow: { postMessage: message => messages.push(plain(message)) } };
 return { plugin, view, files, operations, requests, messages, notices, opened, commands, timers, failWrites: value => failWrites = value, close: () => plugin.onunload(), async rpc(method, payload = {}) { const id = 'update-' + ++sequence; await view.handle({ id, method, payload }); const reply = messages.find(message => message.kind === 'vb-response' && message.id === id); assert.ok(reply); return reply; } };
}
const protectedFiles = f => [...f.files].filter(([path]) => path !== cachePath);

test('actual native startup with blank repository never contacts network and exposes manual entry', async () => {
 const f = await fixture({ repository: '' }); try {
  const before = [...f.files], result = await f.rpc('check-update');
  assert.equal(result.error, undefined); assert.equal(result.result.status, 'not-configured'); assert.equal(f.requests.length, 0); assert.deepEqual([...f.files], before);
  assert.equal(f.timers.includes(8000), false); assert.ok(f.commands.some(command => command.id === 'check-for-updates'));
  assert.equal((await f.rpc('update-info')).result.currentVersion, '0.1.26');
 } finally { f.close(); }
});
test('actual native metadata check writes only update cache and preserves notes, drafts, camera and layout', async () => {
 const f = await fixture(); try {
  const before = protectedFiles(f), layout = plain(f.plugin.layout), drafts = plain(f.plugin.drafts), result = await f.rpc('check-update');
  assert.equal(result.error, undefined); assert.equal(result.result.status, 'available'); assert.equal(result.result.latestVersion, '0.1.27'); assert.equal(result.result.minAppVersion, '1.5.0');
  assert.deepEqual(f.requests.map(request => request.url), [`https://api.github.com/repos/${repo}/releases/latest`, `https://github.com/${repo}/releases/download/${tag}/manifest.json`]);
  assert.deepEqual(f.operations, [['write', cachePath]]); assert.deepEqual(protectedFiles(f), before); assert.deepEqual(plain(f.plugin.layout), layout); assert.deepEqual(plain(f.plugin.drafts), drafts);
  for (const request of f.requests) { assert.equal(request.method, 'GET'); assert.equal(request.throw, false); assert.equal(request.body, undefined); assert.equal(Object.keys(request.headers).some(key => key.toLowerCase() === 'authorization'), false); }
 } finally { f.close(); }
});
test('actual settings RPC validates repository and rolls back failed persistence without changing arrangement', async () => {
 const f = await fixture(); try {
  const before = [...f.files], settings = plain(f.plugin.settings), layout = plain(f.plugin.layout);
  for (const repository of ['https://user:secret@github.com/a/b', 'https://evil.test/a/b', 'a/b/releases']) { const result = await f.rpc('configure-updates', { repository, autoCheck: false }); assert.ok(result.error); }
  assert.deepEqual([...f.files], before); assert.deepEqual(plain(f.plugin.settings), settings);
  f.failWrites(true); const failed = await f.rpc('configure-updates', { repository: 'Another/repo', autoCheck: false }); assert.ok(failed.error); assert.deepEqual(plain(f.plugin.settings), settings); assert.deepEqual([...f.files], before); assert.deepEqual(plain(f.plugin.layout), layout);
  f.failWrites(false); const result = await f.rpc('configure-updates', { repository: 'https://github.com/Another/repo', autoCheck: false }); assert.equal(result.error, undefined); assert.equal(result.result.repository, 'Another/repo'); assert.equal(result.result.autoCheck, false); assert.deepEqual(JSON.parse(f.files.get(primary)).layout, layout); assert.equal(f.requests.length, 0); assert.equal(f.files.get('Notes/A.md'), before.find(([path]) => path === 'Notes/A.md')[1]); assert.equal(f.files.get(draftPath), before.find(([path]) => path === draftPath)[1]);
 } finally { f.close(); }
});
test('actual open-update RPC accepts only checker-selected URLs and never a caller supplied destination', async () => {
 const f = await fixture(); try {
  assert.ok((await f.rpc('open-update', { kind: 'release', url: 'https://evil.test' })).error); assert.equal(f.opened.length, 0);
  await f.rpc('check-update');
  for (const [kind, expected] of [['release', releaseUrl], ['download', downloadUrl]]) { const result = await f.rpc('open-update', { kind, url: 'javascript:alert(1)' }); assert.equal(result.error, undefined); assert.deepEqual(f.opened.at(-1), [expected, '_blank', 'noopener,noreferrer']); }
  const count = f.opened.length; assert.ok((await f.rpc('open-update', { kind: 'https://evil.test' })).error); assert.equal(f.opened.length, count);
  f.plugin.updateResult = { ...f.plugin.updateResult, downloadUrl: 'https://evil.test/Visual-Board.zip' }; assert.ok((await f.rpc('open-update', { kind: 'download' })).error); assert.equal(f.opened.length, count);
 } finally { f.close(); }
});
test('actual check deduplicates concurrent requests, update notices and update events', async () => {
 const f = await fixture(); try {
  await Promise.all([f.plugin.checkForUpdates(false), f.plugin.checkForUpdates(false), f.plugin.checkForUpdates(false)]);
  assert.equal(f.requests.length, 2); assert.equal(f.notices.length, 1); assert.equal(f.messages.filter(message => message.type === 'update-available').length, 1);
  await f.plugin.checkForUpdates(false); assert.equal(f.notices.length, 1); assert.equal(f.requests.length, 2);
  await f.plugin.checkForUpdates(true); assert.equal(f.notices.length, 1); assert.equal(f.requests.length, 4);
  const ignored = await f.rpc('ignore-update', { version: '0.1.27' }); assert.equal(ignored.error, undefined); assert.equal(ignored.result.status, 'ignored'); assert.ok((await f.rpc('ignore-update', { version: '99.0.0' })).error);
 } finally { f.close(); }
});
test('disabled automatic checks stay offline while manual RPC works and incompatible releases cannot download', async () => {
 const f = await fixture({ autoCheck: false, minAppVersion: '1.6.0' }); try {
  assert.equal(f.timers.includes(8000), false); assert.equal((await f.plugin.checkForUpdates(false)).status, 'disabled'); assert.equal(f.requests.length, 0);
  const result = await f.rpc('check-update'); assert.equal(result.result.status, 'incompatible'); assert.equal(result.result.minAppVersion, '1.6.0'); assert.equal(f.requests.length, 2);
  assert.ok((await f.rpc('open-update', { kind: 'download' })).error); assert.equal(f.opened.length, 0); assert.equal((await f.rpc('open-update', { kind: 'release' })).error, undefined); assert.equal(f.opened[0][0], releaseUrl);
 } finally { f.close(); }
});
test('actual plugin unload suppresses late notifications, cache writes and release asset reads', async () => {
 let resolve; const f = await fixture({ network: () => new Promise(done => resolve = done) });
 const before = [...f.files], promise = f.plugin.checkForUpdates(false); await new Promise(done => setImmediate(done)); assert.equal(f.requests.length, 1);
 f.close(); resolve(response(release())); await promise;
 assert.equal(f.notices.length, 0); assert.equal(f.messages.some(message => message.type === 'update-available'), false); assert.equal(f.requests.length, 1); assert.deepEqual([...f.files], before); assert.equal(f.operations.length, 0);
});
test('actual repository reconfiguration suppresses the previous repository pending result', async () => {
 let resolve; const f = await fixture({ network: () => new Promise(done => resolve = done) }); try {
  const promise = f.plugin.checkForUpdates(false); await new Promise(done => setImmediate(done)); assert.equal(f.requests.length, 1);
  const configured = await f.rpc('configure-updates', { repository: 'Another/repo', autoCheck: false }); assert.equal(configured.error, undefined);
  const afterConfigure = [...f.files], operationCount = f.operations.length;
  resolve(response(release())); await promise;
  assert.equal(f.plugin.updateInfo().repository, 'Another/repo'); assert.equal(f.plugin.updateInfo().status, 'disabled'); assert.equal(f.notices.length, 0); assert.equal(f.messages.some(message => message.type === 'update-available'), false); assert.equal(f.requests.length, 1); assert.deepEqual([...f.files], afterConfigure); assert.equal(f.operations.length, operationCount);
 } finally { f.close(); }
});
