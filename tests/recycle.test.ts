import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { RecycleService } from '../src/recycle';
import { initialLayout, sanitizeLayout, Board, Layout } from '../src/model';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const board = (id: string, folderPath?: string, parent = 'home'): Board => ({ id, title: id, parent: id === 'home' ? null : parent, ...(folderPath === undefined ? {} : { folderPath }), theme: 'product', iconMode: 'default', view: { x: 70, y: -44, zoom: .8 }, nodes: [], edges: [] });
function fixture() {
  type Entry = { type: 'file' | 'folder'; data?: string | Uint8Array; size: number; mtime: number; ctime: number };
  const disk = new Map<string, Entry>(), index = new Map<string, any>(), renames: [string, string][] = [], reconciled: string[] = [], bodyReads: string[] = [];
  let current = initialLayout(), persisted = 0, failRename: ((from: string, to: string) => void) | undefined;
  const mkdir = (path: string) => { disk.set(path, { type: 'folder', size: 0, mtime: 10, ctime: 10 }); };
  function add(path: string, data: string | Uint8Array = new Uint8Array([1, 2, 3])) { const parts = path.split('/'); for (let i = 1; i < parts.length; i++) if (!disk.has(parts.slice(0, i).join('/'))) mkdir(parts.slice(0, i).join('/')); disk.set(path, { type: 'file', data, size: data.length, mtime: 100, ctime: 90 }); }
  function cache(path: string) { const entry = disk.get(path); if (!entry) return; index.set(path, entry.type === 'folder' ? { path, children: [] } : { path, name: path.split('/').pop(), basename: path.split('/').pop()!.replace(/\.[^.]+$/, ''), extension: path.split('.').pop(), stat: { size: entry.size, mtime: entry.mtime, ctime: entry.ctime } }); }
  const adapter = {
    exists: async (path: string) => disk.has(path),
    stat: async (path: string) => { const e = disk.get(path); return e ? { type: e.type, size: e.size, mtime: e.mtime, ctime: e.ctime } : null; },
    mkdir: async (path: string) => { if (disk.has(path)) throw Error('exists'); mkdir(path); },
    write: async (path: string, data: string) => { if (!path.endsWith('manifest.json')) throw Error('No original file writes'); add(path, data); },
    read: async (path: string) => { if (!path.endsWith('manifest.json')) { bodyReads.push(path); throw Error('Original bodies must not be read'); } return disk.get(path)!.data as string; },
    list: async (path: string) => ({ files: [...disk.keys()].filter(p => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/') && disk.get(p)!.type === 'file'), folders: [...disk.keys()].filter(p => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/') && disk.get(p)!.type === 'folder') }),
    rename: async (from: string, to: string) => { failRename?.(from, to); if (!disk.has(from)) throw Error('missing'); if (disk.has(to)) throw Error('collision'); const parent = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '';  if (parent && !disk.has(parent)) throw Error('parent missing');
      renames.push([from, to]); const keys = [...disk.keys()].filter(p => p === from || p.startsWith(from + '/'));
      for (const old of keys) { const next = to + old.slice(from.length), entry = disk.get(old)!; disk.delete(old); disk.set(next, entry); const file = index.get(old); if (file) { index.delete(old); file.path = next; index.set(next, file); } }
    },
    reconcileInternalFile: async (path: string) => { reconciled.push(path); if (path.split('/').some(p => p.startsWith('.')) || !disk.has(path)) { for (const key of [...index.keys()]) if (key === path || key.startsWith(path + '/')) index.delete(key); }
      else for (const key of disk.keys()) if (key === path || key.startsWith(path + '/')) cache(key);
    },
  };
  const app = { vault: { adapter, getAbstractFileByPath: (path: string) => index.get(path) || null, rename: async (file: any, to: string) => adapter.rename(file.path, to) }, fileManager: { renameFile: () => { throw Error('Recycle must not rewrite Wiki links via FileManager'); } } } as unknown as App;
  add('Source/Note.md', '# Original [[Other]] ![[Imgs/a.png]]'); add('Other.md', '# Other'); add('Imgs/a.png'); add('Media/music.mp3'); add('Media/page.pdf'); add('Group/Sub/Nested.md', '# Nested'); add('Group/other.bin');
  for (const path of disk.keys()) cache(path);
  current.boards.home = board('home', ''); current.boards.free = board('free'); current.boards.group = board('group', 'Group'); current.boards.sub = board('sub', 'Group/Sub', 'group');
  current.boards.home.nodes = [
    { id: 'a', type: 'article', doc: 'Source/Note.md', x: -400, y: 700, w: 500, h: 640 },
    { id: 's', type: 'note', title: '便签', text: '本地便签文字', x: 200, y: 100, w: 220, h: 180, color: 'blue' },
    { id: 'p', type: 'photo', imagePath: 'Imgs/a.png', x: 300, y: 100, w: 320, h: 240 },
    { id: 'au', type: 'audio', filePath: 'Media/music.mp3', title: 'music', x: 600, y: 100, w: 380, h: 340 },
    { id: 'pdf', type: 'pdf', filePath: 'Media/page.pdf', title: 'pdf', x: 900, y: 100, w: 360, h: 520 },
    { id: 'g', type: 'board', board: 'group', x: 1000, y: -70, folderManaged: true },
    { id: 'f', type: 'board', board: 'free', x: 1400, y: 700 },
  ];
  current.boards.free.nodes = [{ id: 'alias', type: 'article', doc: 'Source/Note.md', x: 777, y: 888 }, { id: 'alias-p', type: 'photo', imagePath: 'Imgs/a.png', x: 200, y: 400 }];
  current.boards.group.nodes = [{ id: 'sub-entry', type: 'board', board: 'sub', x: 56, y: 70 }, { id: 'group-note', type: 'note', title: 'folder note', text: 'virtual', x: 300, y: 100 }];
  current.boards.sub.nodes = [{ id: 'nested', type: 'article', doc: 'Group/Sub/Nested.md', x: 1080, y: -33, w: 600, h: 460, folderManaged: true }];
  current.boards.home.edges = [{ from: 'a', to: 's', width: 3.5 }, { from: 'p', to: 'pdf' }]; current = sanitizeLayout(current);
  const hooks = { getLayout: () => current, setLayout: (layout: Layout) => { current = layout; }, persist: async () => { persisted++; } };
  const service = new RecycleService(app, hooks);
  return { app, hooks, service, disk, index, renames, reconciled, bodyReads, add, layout: () => current, count: () => persisted, fail: (f?: typeof failRename) => { failRename = f; }, restart: () => new RecycleService(app, hooks) };
}

test('selected file/media/sticky group recycles original bytes once, removes all references, and restores original order without overwriting later geometry', async () => {
  const f = fixture(), before = copy(f.layout()), bytes = f.disk.get('Imgs/a.png')!.data;
  const result = await f.service.trash('home', ['a', 'p', 'au', 'pdf', 's']);
  assert.equal(f.disk.has('Source/Note.md'), false); assert.equal(f.disk.has('Imgs/a.png'), false); assert.equal(f.disk.has('Media/music.mp3'), false); assert.equal(f.disk.has('Other.md'), true);
  assert.equal(f.renames.length, 4); assert.equal(f.disk.get(`.trash/visual-board/${result.trashToken}/files/Imgs/a.png`)!.data, bytes);
  assert.equal(f.index.has('Source/Note.md'), false); assert.equal([...f.index.keys()].some(p => p.startsWith('.trash/')), false);
  assert.deepEqual(f.layout().boards.free.nodes, []); assert.equal(f.layout().boards.home.nodes.some(n => n.id === 's'), false);
  f.layout().boards.home.nodes.find(n => n.id === 'g')!.x = -9000;
  f.layout().boards.home.nodes.push({ id: 'new', type: 'note', title: 'later', text: '', x: 9090, y: 0 });
  const restored = await f.restart().restore(result.trashToken);
  assert.deepEqual(restored.layout.boards.home.nodes.slice(0, 5), before.boards.home.nodes.slice(0, 5));
  assert.equal(restored.layout.boards.home.nodes.find(n => n.id === 'g')!.x, -9000); assert.equal(restored.layout.boards.home.nodes.find(n => n.id === 'new')!.x, 9090);
  assert.deepEqual(restored.layout.boards.free.nodes, before.boards.free.nodes); assert.deepEqual(restored.layout.boards.home.edges, before.boards.home.edges);
  assert.equal(f.disk.get('Imgs/a.png')!.data, bytes); assert.ok(f.index.has('Source/Note.md')); assert.deepEqual(f.bodyReads, []);
  const manifest = f.disk.get(`.trash/visual-board/${result.trashToken}/manifest.json`)!.data as string;
  assert.equal(manifest.includes('# Original'), false); assert.equal(manifest.includes('本地便签文字'), true);
  assert.equal((await f.restart().list())[0].status, 'restored');
  await f.restart().redo(result.trashToken); assert.equal(f.disk.has('Source/Note.md'), false); assert.equal(f.layout().boards.home.nodes.some(n => n.id === 'new'), true);
});

test('recursive directory recycle keeps Board identities and restores all original nested geometry across a fresh service', async () => {
  const f = fixture(), before = copy(f.layout());
  const result = await f.service.trash('home', ['g']);
  assert.equal(f.renames.length, 1); assert.equal(f.disk.has('Group/Sub/Nested.md'), false); assert.ok(f.disk.has(`.trash/visual-board/${result.trashToken}/files/Group/other.bin`));
  assert.equal(f.layout().boards.group, undefined);
  assert.equal(f.layout().boards.sub, undefined); assert.equal(f.layout().boards.home.nodes.some(n => n.board === 'group'), false);
  const restored = await f.restart().restore(result.trashToken);
  for (const id of ['group', 'sub']) assert.deepEqual(restored.layout.boards[id], before.boards[id]);
  assert.deepEqual(restored.layout.boards.home.nodes, before.boards.home.nodes); assert.ok(f.index.has('Group/Sub/Nested.md')); assert.deepEqual(f.bodyReads, []);
});

test('virtual Board/sticky records persist and restore without moving their independently referenced files', async () => {
  const f = fixture(), before = copy(f.layout()); const result = await f.service.trash('home', ['f']);
  assert.equal(f.renames.length, 0); assert.equal(f.layout().boards.free, undefined); assert.equal(f.disk.has('Source/Note.md'), true);
  const restored = await f.restart().restore(result.trashToken); assert.deepEqual(restored.layout.boards.free, before.boards.free);
  assert.deepEqual(restored.layout.boards.home.nodes, before.boards.home.nodes);
  const sticky = await f.service.trash('home', ['s']); assert.equal(f.renames.length, 0); await f.restart().restore(sticky.trashToken); assert.deepEqual(f.layout().boards.home.nodes, before.boards.home.nodes);
});

test('restore collisions and invalid token or root/hidden selections never overwrite or move unrelated files', async () => {
  const f = fixture(); const result = await f.service.trash('home', ['a']); f.add('Source/Note.md', 'new different original');
  const count = f.renames.length, current = copy(f.layout()); await assert.rejects(f.restart().restore(result.trashToken), /同名/);
  assert.equal(f.disk.get('Source/Note.md')!.data, 'new different original'); assert.equal(f.renames.length, count); assert.deepEqual(copy(f.layout()), current);
  for (const token of ['../evil', '__proto__', 'https://outside', 'not-a-uuid']) await assert.rejects(f.service.restore(token));
  f.layout().boards.home.nodes.push({ id: 'root', type: 'board', board: 'home', x: 0, y: 0 }); await assert.rejects(f.service.trash('home', ['root']));
  await assert.rejects(f.service.trash('home', ['missing'])); assert.equal(f.renames.length, count);
});

test('a later batch failure rolls completed moves back, leaving recoverable durable metadata and untouched layout', async () => {
  const f = fixture(), before = copy(f.layout()); f.fail((_from, to) => { if (to.includes('/files/Imgs/a.png')) throw Error('simulated failure'); });
  await assert.rejects(f.service.trash('home', ['a', 'p']), /simulated/);
  assert.ok(f.disk.has('Source/Note.md')); assert.ok(f.disk.has('Imgs/a.png')); assert.deepEqual(copy(f.layout()), before); assert.deepEqual(f.bodyReads, []);
  f.fail(undefined); const rows = await f.restart().list(); assert.equal(rows.length, 1); await f.restart().restore(rows[0].token); assert.deepEqual(copy(f.layout()), before);
});

test('missing parent directories are recreated on restore, redo guards replaced file identity, unsupported native adapter fails before touching files', async () => {
  const f = fixture(), result = await f.service.trash('home', ['a']); f.disk.delete('Source'); f.index.delete('Source');
  await f.restart().restore(result.trashToken); assert.ok(f.disk.has('Source')); assert.ok(f.index.has('Source/Note.md'));
  f.disk.get('Source/Note.md')!.mtime++; await assert.rejects(f.service.redo(result.trashToken), /替换/); assert.ok(f.disk.has('Source/Note.md'));
  delete (f.app.vault.adapter as any).reconcileInternalFile;
  const count = f.renames.length; await assert.rejects(f.service.trash('home', ['p']), /适配器/); assert.equal(f.renames.length, count);
});

test('restart validation preserves relations to surviving nodes and audio playback without resetting unrelated audio state', async () => {
  const f = fixture();
  f.layout().boards.home.nodes.push({ id: 'other', type: 'article', doc: 'Other.md', x: 1234, y: -120 });
  f.layout().boards.home.knowledgeEdgeStyles = [{ from: 'a', to: 'other', width: 4.5, lineStyle: 'solid', hidden: true }];
  f.layout().audioPlayback = { 'Media/music.mp3': { position: 17.5, duration: 90, lastPlayedAt: 12345 } };
  const result = await f.service.trash('home', ['a', 'au']);
  f.hooks.setLayout(sanitizeLayout(f.layout())); assert.equal(f.layout().audioPlayback?.['Media/music.mp3'], undefined);
  f.add('Media/new.wav'); f.layout().boards.home.nodes.push({ id: 'other-audio', type: 'audio', filePath: 'Media/new.wav', x: 22, y: 0 });
  f.layout().audioPlayback = { 'Media/new.wav': { position: 88, duration: 120, lastPlayedAt: 100000 } };
  await f.restart().restore(result.trashToken);
  assert.deepEqual(f.layout().boards.home.edges.find(e => e.from === 'a'), { from: 'a', to: 's', width: 3.5 });
  assert.deepEqual(f.layout().boards.home.knowledgeEdgeStyles, [{ from: 'a', to: 'other', width: 4.5, lineStyle: 'solid', hidden: true }]);
  assert.deepEqual(f.layout().audioPlayback?.['Media/music.mp3'], { position: 17.5, duration: 90, lastPlayedAt: 12345 });
  assert.deepEqual(f.layout().audioPlayback?.['Media/new.wav'], { position: 88, duration: 120, lastPlayedAt: 100000 });
});

test('a reconciliation failure after a physical rename includes that file in rollback and keeps a recoverable record', async () => {
  const f = fixture(), before = copy(f.layout()), native = (f.app.vault.adapter as any).reconcileInternalFile; let once = true;
  (f.app.vault.adapter as any).reconcileInternalFile = async (path: string) => { if (once && path === 'Source/Note.md' && !f.disk.has(path)) { once = false; throw Error('reconcile interrupted'); } return native(path); };
  await assert.rejects(f.service.trash('home', ['a']), /interrupted/); assert.ok(f.disk.has('Source/Note.md')); assert.deepEqual(copy(f.layout()), before);
  const records = await f.restart().list(); assert.equal(records.length, 1); await f.restart().restore(records[0].token); assert.deepEqual(copy(f.layout()), before);
});

test('manifest remains usable after layout persistence or final restored-status writing fails', async () => {
  const f = fixture(); let once = true;
  const service = new RecycleService(f.app, { ...f.hooks, persist: async () => { if (once) { once = false; throw Error('persist unavailable'); } } });
  await assert.rejects(service.trash('home', ['a']), /unavailable/); assert.equal(f.disk.has('Source/Note.md'), false);
  const token = (await f.restart().list())[0].token, write = f.app.vault.adapter.write.bind(f.app.vault.adapter); let failed = false;
  f.app.vault.adapter.write = async (path, data) => { if (!failed && JSON.parse(data).status === 'restored') { failed = true; throw Error('manifest interrupted'); } return write(path, data); };
  await assert.rejects(f.restart().restore(token), /interrupted/); assert.ok(f.disk.has('Source/Note.md'));
  assert.equal((await f.restart().list())[0].status, 'trashed');
  await f.restart().restore(token); assert.equal((await f.restart().list())[0].status, 'restored');
  assert.equal(f.layout().boards.home.nodes.filter(n => n.id === 'a').length, 1); assert.deepEqual(f.bodyReads, []);
});

test('a concurrent unrelated rename is not owned by recycle and its layout delta survives restore', async () => {
  const f = fixture(), native = (f.app.vault.adapter as any).reconcileInternalFile; let once = true;
  f.layout().boards.home.nodes.push({ id: 'other', type: 'article', doc: 'Other.md', x: 7000, y: 55 });
  (f.app.vault.adapter as any).reconcileInternalFile = async (path: string) => { if (once && path === 'Source/Note.md') { once = false; assert.equal(f.service.ownsEvent('Other.md', 'Renamed.md'), false); await f.app.vault.adapter.rename('Other.md', 'Renamed.md'); f.layout().boards.home.nodes.find(n => n.id === 'other')!.doc = 'Renamed.md'; } return native(path); };
  const result = await f.service.trash('home', ['a']); assert.equal(f.layout().boards.home.nodes.find(n => n.id === 'other')!.doc, 'Renamed.md');
  await f.restart().restore(result.trashToken); assert.equal(f.layout().boards.home.nodes.find(n => n.id === 'other')!.doc, 'Renamed.md'); assert.equal(f.layout().boards.home.nodes.find(n => n.id === 'other')!.x, 7000);
});

test('an article path replaced by a directory is not treated as permission to recycle its new contents', async () => {
  const f = fixture(); f.disk.set('Source/Note.md', { type: 'folder', size: 0, mtime: 200, ctime: 200 });
  f.add('Source/Note.md/new.txt', 'unrelated new data');
  await assert.rejects(f.service.trash('home', ['a']), /类型/); assert.equal(f.renames.length, 0); assert.ok(f.disk.has('Source/Note.md/new.txt'));
});
