import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { initialLayout, Layout } from '../src/model';
import { NativeReferenceSync } from '../src/native-reference-sync';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function fixture() {
  const layout = initialLayout(), sync = new NativeReferenceSync();
  layout.boards.home.view = { x: 730, y: -880, zoom: .7 };
  layout.boards.home.nodes = [
    { id: 'article', type: 'article', doc: 'Folder/A.md', x: -700, y: 88, w: 620, h: 480 },
    { id: 'photo', type: 'photo', imagePath: 'Folder/Pic.png', title: 'Pic', x: 24, y: 600, w: 320, h: 200 },
    { id: 'audio', type: 'audio', filePath: 'Folder/Song.mp3', title: 'Song', x: 450, y: -270 },
    { id: 'pdf', type: 'pdf', filePath: 'Folder/Doc.pdf', title: 'Doc', x: 750, y: 33 },
    { id: 'sticky', type: 'note', title: 'Keep', text: 'fixture', x: 2000, y: 900, color: 'green' },
  ];
  layout.boards.home.edges = [{ from: 'article', to: 'sticky', width: 4 }, { from: 'photo', to: 'audio' }];
  layout.boards.home.knowledgeEdgeStyles = [{ from: 'article', to: 'article2', hidden: true }];
  layout.boards.free = { ...clone(layout.boards.home), id: 'free', parent: 'home', nodes: [ { id: 'alias', type: 'article', doc: 'Folder/A.md', x: 64, y: 12 } ], edges: [] };
  layout.audioPlayback = { 'Folder/Song.mp3': { position: 42, duration: 100 } };
  layout.visibleArticleHeadings = ['Folder/A.md'];
  return { layout, sync };
}
test('native deletion removes all aliases and their edges while retaining unrelated layout and cameras', () => {
  const f = fixture(), original = clone(f.layout), sticky = original.boards.home.nodes.at(-1);
  f.sync.record(f.layout, { type: 'delete', path: 'Folder/A.md', folder: false });
  assert.equal(f.layout.boards.home.nodes.some(n => n.id === 'article'), false);
  assert.deepEqual(f.layout.boards.free.nodes, []);
  assert.deepEqual(f.layout.boards.home.edges, [{ from: 'photo', to: 'audio' }]);
  assert.deepEqual(f.layout.boards.home.knowledgeEdgeStyles, []);
  assert.deepEqual(f.layout.boards.home.nodes.at(-1), sticky);
  assert.deepEqual(f.layout.boards.home.view, original.boards.home.view);
  assert.deepEqual(f.layout.visibleArticleHeadings, []);
});
test('native rename migrates every article/media/icon/heading/progress reference and media display titles', () => {
  const { layout, sync } = fixture(), positions = layout.boards.home.nodes.map(n => [n.id, n.x, n.y]);
  layout.boards.home.iconPath = 'Folder/Pic.png';
  layout.boards.home.hiddenFolderDocs = ['Folder/A.md'];
  for (const [path, newPath] of [['Folder/A.md', 'Folder/Renamed.md'], ['Folder/Pic.png', 'Folder/New.png'], ['Folder/Song.mp3', 'Folder/NewSong.mp3'], ['Folder/Doc.pdf', 'Folder/NewDoc.pdf']]) sync.record(layout, { type: 'rename', path, newPath, folder: false });
  assert.equal(layout.boards.home.nodes[0].doc, 'Folder/Renamed.md');
  assert.equal(layout.boards.free.nodes[0].doc, 'Folder/Renamed.md');
  assert.equal(layout.boards.home.nodes[1].title, 'New'); assert.equal(layout.boards.home.iconPath, 'Folder/New.png');
  assert.equal(layout.boards.home.nodes[2].title, 'NewSong'); assert.equal(layout.boards.home.nodes[3].title, 'NewDoc');
  assert.deepEqual(layout.visibleArticleHeadings, ['Folder/Renamed.md']); assert.deepEqual(layout.boards.home.hiddenFolderDocs, ['Folder/Renamed.md']);
  assert.deepEqual(layout.audioPlayback, { 'Folder/NewSong.mp3': { position: 42, duration: 100 } });
  assert.deepEqual(layout.boards.home.nodes.map(n => [n.id, n.x, n.y]), positions);
});
test('folder rename migrates descendants on free Boards as well as folder mappings and playback', () => {
  const { layout, sync } = fixture();
  layout.boards.free.folderPath = 'Folder'; layout.boards.free.title = 'Folder';
  sync.record(layout, { type: 'rename', path: 'Folder', newPath: 'Moved', folder: true });
  assert.equal(layout.boards.free.folderPath, 'Moved'); assert.equal(layout.boards.free.title, 'Moved');
  assert.equal(layout.boards.home.nodes[0].doc, 'Moved/A.md'); assert.equal(layout.boards.home.nodes[2].filePath, 'Moved/Song.mp3');
  assert.equal(layout.audioPlayback!['Moved/Song.mp3'].position, 42);
});
test('queued old and legacy flat saves cannot resurrect renamed paths or deleted aliases, while current revisions permit a new same-path file', () => {
  const { layout, sync } = fixture(), stale = clone(layout);
  sync.record(layout, { type: 'rename', path: 'Folder/A.md', newPath: 'Folder/B.md', folder: false });
  const intermediate = clone(layout), revision = sync.revision;
  sync.record(layout, { type: 'delete', path: 'Folder/B.md', folder: false });
  for (const from of [0, undefined]) { const accepted = sync.accept(stale, from); assert.equal(accepted.boards.home.nodes.some(n => n.type === 'article'), false); assert.deepEqual(accepted.boards.free.nodes, []); assert.deepEqual(accepted.boards.home.view, stale.boards.home.view); }
  assert.equal(sync.accept(intermediate, revision).boards.home.nodes.some(n => n.type === 'article'), false);
  layout.boards.home.nodes.push({ id: 'new-file', type: 'article', doc: 'Folder/B.md', x: 10, y: 20 });
  assert.equal(sync.accept(layout, sync.revision).boards.home.nodes.find(n => n.id === 'new-file')?.doc, 'Folder/B.md');
});
test('startup cleanup checks disk after loading, preserves unindexed or uncertain files, and never reads/writes article bodies', async () => {
  const { layout, sync } = fixture(), disk = new Set(['Folder/A.md', 'Folder/Pic.png']), checked: string[] = [];
  const app = { vault: { getAbstractFileByPath: (p: string) => p === 'Folder/Doc.pdf' ? { path: p } : null, adapter: { exists: async (p: string) => { checked.push(p); return disk.has(p); } } } } as unknown as App;
  assert.equal(await sync.pruneMissing(layout, app), true);
  assert.ok(layout.boards.home.nodes.some(n => n.doc === 'Folder/A.md'));
  assert.ok(layout.boards.home.nodes.some(n => n.imagePath === 'Folder/Pic.png'));
  assert.ok(layout.boards.home.nodes.some(n => n.filePath === 'Folder/Doc.pdf'));
  assert.equal(layout.boards.home.nodes.some(n => n.filePath === 'Folder/Song.mp3'), false);
  assert.equal(checked.includes('Folder/Doc.pdf'), false);
  const before = clone(layout); (app.vault.adapter.exists as any) = async () => { throw Error('unavailable'); };
  assert.equal(await sync.pruneMissing(layout, app), false); assert.deepEqual(clone(layout), before);
});
test('folder deletion removes mapped icons and descendant resource cards but retains free sticky content for recovery', () => {
  const { layout, sync } = fixture(); layout.boards.free.folderPath = 'Folder';
  layout.boards.home.nodes.push({ id: 'folder', type: 'board', board: 'free', x: 99, y: 100 });
  sync.record(layout, { type: 'delete', path: 'Folder', folder: true });
  assert.equal(layout.boards.home.nodes.length, 1); assert.equal(layout.boards.home.nodes[0].id, 'sticky');
  assert.equal(layout.boards.free.folderMissing, true); assert.ok(layout.boards.free); assert.deepEqual(layout.audioPlayback, {});
});

test('a stale save removes known deleted card IDs without deleting later same-path IDs or explicitly restored current cards', () => {
  const { layout, sync } = fixture(), before = clone(layout);
  sync.record(layout, { type: 'delete', path: 'Folder/A.md', folder: false });
  const incoming = clone(before); incoming.boards.home.nodes.push({ id: 'new-same-path', type: 'article', doc: 'Folder/A.md', x: 5, y: 8 });
  const accepted = sync.accept(incoming, 0, layout, () => true);
  assert.equal(accepted.boards.home.nodes.some(n => n.id === 'article'), false);
  assert.equal(accepted.boards.home.nodes.some(n => n.id === 'new-same-path'), true);
  layout.boards.home.nodes.push(clone(before.boards.home.nodes[0]));
  assert.equal(sync.accept(incoming, 0, layout, () => true).boards.home.nodes.some(n => n.id === 'article'), true);
});
