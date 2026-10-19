import test from 'node:test';
import assert from 'node:assert/strict';
import { Board, BoardNode, initialLayout, sanitizeLayout, renameReferences } from '../src/model';
import { findFolderBoard, migrateFolderPaths, syncFolderLayout } from '../src/folder-layout';
import { NativeReferenceSync } from '../src/native-reference-sync';

const makeBoard = (id: string, parent = 'home', folderPath?: string): Board => ({ id, title: id, parent, ...(folderPath !== undefined ? { folderPath } : {}), theme: 'product', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] });
const article = (id: string, doc: string, managed = false): BoardNode => ({ id, type: 'article', doc, x: 73, y: -61, w: 480, h: 640, ...(managed ? { folderManaged: true } : {}) });

test('persist mapping metadata, reject hidden/traversal folder paths, and preserve root mapping', () => {
  const layout = initialLayout(); layout.boards.home.folderPath = '';
  layout.boards.valid = makeBoard('valid', 'home', '研究/访谈'); layout.boards.valid.folderMissing = true;
  layout.boards.valid.nodes.push(article('mapped-file', '研究/访谈/问题.md', true));
  for (const [id, path] of [['hidden', '.obsidian'], ['nested-hidden', '研究/.private'], ['traversal', '../outside'], ['absolute', '/Users/user']]) layout.boards[id] = makeBoard(id, 'home', path);
  const saved = sanitizeLayout(layout);
  assert.equal(saved.boards.home.folderPath, '');
  assert.equal(saved.boards.valid.folderPath, '研究/访谈'); assert.equal(saved.boards.valid.folderMissing, true);
  assert.equal(saved.boards.valid.nodes[0].folderManaged, true);
  for (const id of ['hidden', 'nested-hidden', 'traversal', 'absolute']) assert.equal(saved.boards[id].folderPath, undefined);
});

test('map actual hierarchy and only direct Markdown children, preserving freely arranged Boards', () => {
  const layout = initialLayout();
  layout.boards.free = makeBoard('free'); layout.boards.free.title = 'Research';
  layout.boards.free.nodes.push(article('cross-folder', 'Research/Topic/Deep.md'));
  const freeBefore = JSON.stringify(layout.boards.free);
  assert.equal(syncFolderLayout(layout, ['Research/Topic', 'Projects/Topic', 'Empty', '.obsidian', 'Research/.hidden'], ['Root.md', 'Research/Top.md', 'Research/Topic/Deep.md', 'Projects/Topic/Other.MD', '.obsidian/private.md', 'Research/.hidden/Secret.md', 'Research/photo.png']), true);
  assert.equal(layout.boards.home.folderPath, '');
  const research = findFolderBoard(layout, 'Research')!, topic = findFolderBoard(layout, 'Research/Topic')!, other = findFolderBoard(layout, 'Projects/Topic')!;
  assert.ok(research && topic && other && topic.id !== other.id);
  assert.equal(topic.parent, research.id); assert.equal(other.parent, findFolderBoard(layout, 'Projects')!.id);
  assert.deepEqual(research.nodes.filter(n => n.doc).map(n => n.doc), ['Research/Top.md']);
  assert.deepEqual(topic.nodes.filter(n => n.doc).map(n => n.doc), ['Research/Topic/Deep.md']);
  assert.deepEqual(layout.boards.home.nodes.filter(n => n.doc).map(n => n.doc), ['Root.md']);
  assert.ok(layout.boards.home.nodes.some(n => n.board === findFolderBoard(layout, 'Empty')!.id));
  assert.ok(Object.values(layout.boards).filter(b => b.folderPath !== undefined).every(b => b.nodes.every(n => n.folderManaged)));
  assert.equal(findFolderBoard(layout, '.obsidian'), undefined);
  assert.equal(JSON.stringify(layout.boards.free), freeBefore);
  assert.equal(Object.keys(layout).includes('docs'), false);
});

test('idempotent sync reuses mapped identity, icons and hand-adjusted node coordinates', () => {
  const layout = initialLayout(); const preserved = makeBoard('preserved', 'home', 'Research');
  preserved.title = '自定义研究标题'; preserved.iconMode = 'ai'; preserved.iconPath = 'Assets/research.png'; preserved.iconManual = true;
  preserved.nodes.push(article('old-layout', 'Research/Note.md'));
  layout.boards.preserved = preserved;
  layout.boards.home.nodes.push({ id: 'old-entry', type: 'board', board: preserved.id, x: -420, y: 111, w: 380, h: 340 });
  const position = { ...preserved.nodes[0] }, entrance = { ...layout.boards.home.nodes[0] };
  assert.equal(syncFolderLayout(layout, ['Research'], ['Research/Note.md']), true);
  assert.equal(findFolderBoard(layout, 'Research')!.id, 'preserved');
  assert.equal(preserved.title, 'Research'); assert.equal(preserved.iconPath, 'Assets/research.png'); assert.equal(preserved.iconManual, true);
  assert.deepEqual(preserved.nodes[0], { ...position, folderManaged: true });
  assert.deepEqual(layout.boards.home.nodes[0], { ...entrance, folderManaged: true });
  const unchanged = JSON.stringify(layout);
  assert.equal(syncFolderLayout(layout, ['Research'], ['Research/Note.md']), false);
  assert.equal(JSON.stringify(layout), unchanged);
});

test('removed or moved files update only managed references and valid edges', () => {
  const layout = initialLayout(); syncFolderLayout(layout, ['A', 'B'], ['A/One.md', 'A/Two.md']);
  const a = findFolderBoard(layout, 'A')!, b = findFolderBoard(layout, 'B')!;
  const automatic = a.nodes.find(n => n.doc === 'A/One.md')!;
  a.nodes.push(article('manual-tombstone', 'A/One.md'));
  a.edges.push({ from: automatic.id, to: 'manual-tombstone' });
  const manual = { ...a.nodes.at(-1)! };
  assert.equal(syncFolderLayout(layout, ['A', 'B'], ['A/Two.md', 'B/One.md']), true);
  assert.equal(a.nodes.some(n => n.id === automatic.id), false);
  assert.deepEqual(a.nodes.find(n => n.id === 'manual-tombstone'), manual);
  assert.equal(a.edges.length, 0);
  assert.equal(b.nodes.filter(n => n.doc === 'B/One.md' && n.folderManaged).length, 1);
});

test('deleted directories retain mapping and complete layout; same-path restoration keeps identity', () => {
  const layout = initialLayout(); syncFolderLayout(layout, ['Archive', 'Archive/Sub'], ['Archive/Old.md', 'Archive/Sub/Deep.md']);
  const archive = findFolderBoard(layout, 'Archive')!, sub = findFolderBoard(layout, 'Archive/Sub')!;
  const entry = layout.boards.home.nodes.find(n => n.board === archive.id)!;
  entry.x = 787; entry.y = -340;
  archive.nodes[0].x = -271; archive.nodes[0].y = 963;
  const archiveNodes = structuredClone(archive.nodes), subNodes = structuredClone(sub.nodes), entryBefore = { ...entry };
  assert.equal(syncFolderLayout(layout, ['New folder'], []), true);
  assert.equal(archive.folderMissing, true); assert.equal(sub.folderMissing, true);
  assert.deepEqual(archive.nodes, archiveNodes); assert.deepEqual(sub.nodes, subNodes);
  assert.deepEqual(layout.boards.home.nodes.find(n => n.board === archive.id), entryBefore);
  assert.notEqual(findFolderBoard(layout, 'New folder')!.id, archive.id);
  assert.equal(syncFolderLayout(layout, ['New folder', 'Archive', 'Archive/Sub'], ['Archive/Old.md', 'Archive/Sub/Deep.md']), true);
  assert.equal(findFolderBoard(layout, 'Archive')!.id, archive.id); assert.equal(archive.folderMissing, false);
  assert.deepEqual(archive.nodes, archiveNodes); assert.deepEqual(sub.nodes, subNodes);
  assert.equal(syncFolderLayout(layout, ['New folder', 'Archive', 'Archive/Sub'], ['Archive/Old.md', 'Archive/Sub/Deep.md']), false);
});

test('duplicate explicit mappings become preserved free Boards rather than aliases', () => {
  const layout = initialLayout(); layout.boards.a = makeBoard('a', 'home', 'Same'); layout.boards.b = makeBoard('b', 'home', 'Same');
  layout.boards.b.iconId = 'leaf'; layout.boards.b.nodes.push(article('preserved', 'Elsewhere.md'));
  const contents = structuredClone(layout.boards.b.nodes);
  syncFolderLayout(layout, ['Same'], ['Same/Live.md']);
  assert.equal(findFolderBoard(layout, 'Same')!.id, 'a');
  assert.equal(layout.boards.b.folderPath, undefined); assert.equal(layout.boards.b.folderMissing, undefined);
  assert.equal(layout.boards.b.iconId, 'leaf'); assert.deepEqual(layout.boards.b.nodes, contents);
  assert.equal(syncFolderLayout(layout, ['Same'], ['Same/Live.md']), false);
});

test('native folder rename migrates descendant metadata and references without touching similar names or layout', () => {
  const layout = initialLayout(); syncFolderLayout(layout, ['研究', '研究/访谈', '研究旧'], ['研究/文章.md', '研究/访谈/记录.md', '研究旧/其他.md']);
  const research = findFolderBoard(layout, '研究')!, nested = findFolderBoard(layout, '研究/访谈')!;
  research.iconPath = '研究/附件/icon.png'; nested.title = '手动标题';
  nested.nodes.push({ id: 'photo', type: 'photo', imagePath: '研究/访谈/附件/a.png', sourceUrl: 'https://example.com/photo.png', x: 512, y: -16, w: 320, h: 240 });
  const identities = Object.fromEntries(Object.values(layout.boards).map(b => [b.id, b.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }))]));
  assert.equal(migrateFolderPaths(layout, '研究', '项目/新研究'), true);
  assert.equal(findFolderBoard(layout, '项目/新研究')!.id, research.id); assert.equal(findFolderBoard(layout, '项目/新研究/访谈')!.id, nested.id);
  assert.equal(research.title, '新研究'); assert.equal(nested.title, '访谈');
  assert.equal(research.iconPath, '项目/新研究/附件/icon.png');
  assert.equal(nested.nodes.find(n => n.id === 'photo')!.imagePath, '项目/新研究/访谈/附件/a.png');
  assert.equal(research.nodes.find(n => n.doc)!.doc, '项目/新研究/文章.md');
  assert.equal(findFolderBoard(layout, '研究旧')!.folderPath, '研究旧');
  assert.deepEqual(Object.fromEntries(Object.values(layout.boards).map(b => [b.id, b.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }))])), identities);
  assert.equal(migrateFolderPaths(layout, '研究', '项目/新研究'), false);
  syncFolderLayout(layout, ['项目', '项目/新研究', '项目/新研究/访谈', '研究旧'], ['项目/新研究/文章.md', '项目/新研究/访谈/记录.md', '研究旧/其他.md']);
  assert.equal(research.parent, findFolderBoard(layout, '项目')!.id); assert.equal(nested.parent, research.id);
});

test('new references are adjacent to existing layout, grid aligned, and reserve enough space for long articles', () => {
  const layout = initialLayout(); layout.boards.home.nodes.push({ id: 'manual-note', type: 'note', title: 'Keep me', text: '', x: 5000, y: -4200, w: 420, h: 500 });
  const untouched = { ...layout.boards.home.nodes[0] };
  syncFolderLayout(layout, ['Folder'], ['One.md', 'Two.md', 'Three.md']);
  assert.deepEqual(layout.boards.home.nodes[0], untouched);
  const rect = (n: BoardNode) => ({ ...n, w: n.w || (n.type === 'article' ? 480 : 300), h: n.h || (n.type === 'article' ? 640 : 303) });
  const nodes = layout.boards.home.nodes.map(rect);
  for (const n of nodes.slice(1)) { assert.equal(n.x % 20, 0); assert.equal(Math.abs(n.y % 20), 0); assert.ok(Math.abs(n.x - untouched.x) <= 2000 && Math.abs(n.y - untouched.y) <= 2000); }
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} overlaps ${b.id}`);
  }
});

test('untrusted paths, non-Markdown files, and rename into own descendants cannot establish mappings', () => {
  const layout = initialLayout();
  syncFolderLayout(layout, ['../Outside', '/Absolute', 'A/.hidden', 'https://example.com', 'Safe'], ['../Outside/Private.md', 'Safe/readme.txt', 'Missing/File.md', 'Safe/.private.md']);
  assert.deepEqual(Object.values(layout.boards).filter(b => b.folderPath !== undefined).map(b => b.folderPath).sort(), ['', 'Safe']);
  assert.equal(findFolderBoard(layout, 'Safe')!.nodes.length, 0);
  const before = JSON.stringify(layout);
  for (const [old, next] of [['', 'A'], ['Safe', '../unsafe'], ['Safe', 'Safe/child'], ['Safe', '.obsidian']]) assert.equal(migrateFolderPaths(layout, old, next), false);
  assert.equal(JSON.stringify(layout), before);
});

test('live mapped titles follow actual folder names while root and freely arranged titles remain unchanged', () => {
  const layout = initialLayout(); layout.boards.home.title = '我的知识库';
  layout.boards.live = makeBoard('live', 'home', 'Projects/Current'); layout.boards.live.title = 'Old display label';
  layout.boards.free = makeBoard('free'); layout.boards.free.title = 'Old display label';
  syncFolderLayout(layout, ['Projects/Current'], []);
  assert.equal(layout.boards.live.title, 'Current'); assert.equal(layout.boards.home.title, '我的知识库'); assert.equal(layout.boards.free.title, 'Old display label');
  assert.equal(migrateFolderPaths(layout, 'Projects/Current', 'Projects/Renamed'), true);
  assert.equal(layout.boards.live.title, 'Renamed');
  assert.equal(syncFolderLayout(layout, ['Projects/Renamed'], []), false);
});

test('removing a mapped entrance or article stays hidden across saves and repeated native syncs', () => {
  let layout = initialLayout(); syncFolderLayout(layout, ['A', 'A/Sub'], ['A/One.md', 'A/Two.md']);
  const child = findFolderBoard(layout, 'A/Sub')!, parent = findFolderBoard(layout, 'A')!;
  parent.hiddenFolderBoards = [child.id]; parent.hiddenFolderDocs = ['A/One.md'];
  parent.nodes = parent.nodes.filter(n => n.board !== child.id && n.doc !== 'A/One.md');
  const visible = structuredClone(parent.nodes);
  assert.equal(syncFolderLayout(layout, ['A', 'A/Sub'], ['A/One.md', 'A/Two.md']), false);
  layout = sanitizeLayout(layout);
  for (let round = 0; round < 3; round++) assert.equal(syncFolderLayout(layout, ['A', 'A/Sub'], ['A/One.md', 'A/Two.md']), false);
  const savedParent = findFolderBoard(layout, 'A')!;
  assert.deepEqual(savedParent.nodes, visible); assert.equal(findFolderBoard(layout, 'A/Sub')!.id, child.id);
  assert.deepEqual(savedParent.hiddenFolderDocs, ['A/One.md']); assert.deepEqual(savedParent.hiddenFolderBoards, [child.id]);
  // Explicit restore clears the persisted hide list; only then may sync create the entrance again.
  savedParent.hiddenFolderBoards = []; savedParent.hiddenFolderDocs = [];
  assert.equal(syncFolderLayout(layout, ['A', 'A/Sub'], ['A/One.md', 'A/Two.md']), true);
  assert.equal(savedParent.nodes.filter(n => n.board === child.id).length, 1);
  assert.equal(savedParent.nodes.filter(n => n.doc === 'A/One.md').length, 1);
  assert.deepEqual(savedParent.nodes.find(n => n.doc === 'A/Two.md'), visible.find(n => n.doc === 'A/Two.md'));
});

test('hidden article paths migrate on folder and exact Markdown renames without restoring hidden entries', () => {
  let layout = initialLayout(); syncFolderLayout(layout, ['A', 'A/Sub'], ['A/Sub/Hidden.md']);
  const child = findFolderBoard(layout, 'A/Sub')!, parent = findFolderBoard(layout, 'A')!;
  child.hiddenFolderDocs = ['A/Sub/Hidden.md', 'A old/Sub/Hidden.md']; child.nodes = [];
  parent.hiddenFolderBoards = [child.id]; parent.nodes = parent.nodes.filter(n => n.board !== child.id);
  migrateFolderPaths(layout, 'A', 'Renamed');
  assert.deepEqual(child.hiddenFolderDocs, ['Renamed/Sub/Hidden.md', 'A old/Sub/Hidden.md']);
  assert.deepEqual(parent.hiddenFolderBoards, [child.id]);
  assert.equal(syncFolderLayout(layout, ['Renamed', 'Renamed/Sub'], ['Renamed/Sub/Hidden.md']), false);
  layout = renameReferences(layout, 'Renamed/Sub/Hidden.md', 'Renamed/Sub/New title.md');
  assert.deepEqual(layout.boards[child.id].hiddenFolderDocs, ['Renamed/Sub/New title.md', 'A old/Sub/Hidden.md']);
  assert.equal(syncFolderLayout(layout, ['Renamed', 'Renamed/Sub'], ['Renamed/Sub/New title.md']), false);
  assert.equal(layout.boards[child.id].nodes.length, 0);
  assert.equal(layout.boards[parent.id].nodes.some(n => n.board === child.id), false);
});

test('hide metadata is deduplicated and rejects unsafe identities or non-Markdown paths', () => {
  const layout = initialLayout();
  Object.assign(layout.boards.home, { hiddenFolderBoards: ['valid-id', 'valid-id', '__proto__', 'constructor', '../escape', 2], hiddenFolderDocs: ['A/Hidden.md', 'A/Hidden.md', '../outside.md', '/private.md', 'https://example.md', 'Assets/file.png', 3] });
  const saved = sanitizeLayout(layout);
  assert.deepEqual(saved.boards.home.hiddenFolderBoards, ['valid-id']);
  assert.deepEqual(saved.boards.home.hiddenFolderDocs, ['A/Hidden.md']);
});

test('native rename to a historically deleted subtree keeps source IDs even when destination missing flags are stale', () => {
  for (const staleMissing of [true, false]) {
    const layout = initialLayout();
    // Historical destination comes first, so insertion order alone would choose the wrong identity.
    syncFolderLayout(layout, ['Destination', 'Destination/Child', 'Destination/Old-only'], ['Destination/Old.md', 'Destination/Child/Old child.md']);
    const oldDestination = findFolderBoard(layout, 'Destination')!, oldChild = findFolderBoard(layout, 'Destination/Child')!, oldOnly = findFolderBoard(layout, 'Destination/Old-only')!;
    oldDestination.iconId = 'leaf'; oldDestination.folderMissing = staleMissing; oldChild.folderMissing = staleMissing;
    syncFolderLayout(layout, ['Destination', 'Destination/Child', 'Destination/Old-only', 'Source', 'Source/Child'], ['Destination/Old.md', 'Destination/Child/Old child.md', 'Source/New.md', 'Source/Child/New child.md']);
    // Model a delete event whose missing metadata may not have arrived before the rename.
    oldDestination.folderMissing = staleMissing; oldChild.folderMissing = staleMissing; oldOnly.folderMissing = staleMissing;
    const source = findFolderBoard(layout, 'Source')!, sourceChild = findFolderBoard(layout, 'Source/Child')!;
    const oldLayouts = [oldDestination, oldChild, oldOnly].map(b => ({ id: b.id, title: b.title, parent: b.parent, nodes: structuredClone(b.nodes), edges: structuredClone(b.edges), iconId: b.iconId }));
    assert.equal(migrateFolderPaths(layout, 'Source', 'Destination'), true);
    assert.equal(findFolderBoard(layout, 'Destination')!.id, source.id);
    assert.equal(findFolderBoard(layout, 'Destination/Child')!.id, sourceChild.id);
    for (const saved of oldLayouts) {
      const b = layout.boards[saved.id];
      assert.equal(b.folderPath, undefined); assert.equal(b.folderMissing, undefined);
      assert.deepEqual({ id: b.id, title: b.title, parent: b.parent, nodes: b.nodes, edges: b.edges, iconId: b.iconId }, saved, 'historical destination becomes free without losing any layout');
    }
    syncFolderLayout(layout, ['Destination', 'Destination/Child'], ['Destination/New.md', 'Destination/Child/New child.md']);
    assert.equal(findFolderBoard(layout, 'Destination')!.id, source.id);
    assert.equal(findFolderBoard(layout, 'Destination/Child')!.id, sourceChild.id);
    for (const saved of oldLayouts) assert.deepEqual(layout.boards[saved.id].nodes, saved.nodes);
  }
});

test('incomplete startup inventories retain managed card geometry, stacking order, camera and connections after save/reopen', () => {
  let layout = initialLayout();
  syncFolderLayout(layout, ['Research'], ['Research/A.md', 'Research/B.md']);
  const board = findFolderBoard(layout, 'Research')!;
  const a = board.nodes.find(n => n.doc === 'Research/A.md')!, b = board.nodes.find(n => n.doc === 'Research/B.md')!;
  Object.assign(a, { x: -1340, y: 860, w: 820, h: 440 });
  Object.assign(b, { x: 280, y: -560, w: 560, h: 720 });
  board.nodes.reverse();
  board.nodes.splice(1, 0, { id: 'sticky', type: 'note', title: 'Keep', text: 'Retained', x: 720, y: 80, color: 'pink' });
  board.edges = [{ from: a.id, to: b.id, width: 3, lineStyle: 'dashed' }];
  board.knowledgeEdgeStyles = [{ from: b.id, to: a.id, width: 5, hidden: true }];
  board.view = { x: 430, y: -220, zoom: .6 };
  board.iconId = 'book-open'; board.folderColor = 'pink';
  layout.currentBoard = board.id;
  const before = sanitizeLayout(layout);
  for (const inventory of [[], ['Research/A.md'], []]) {
    assert.equal(syncFolderLayout(layout, ['Research'], inventory, { preserveUnconfirmedMissing: true }), false);
    layout = sanitizeLayout(JSON.parse(JSON.stringify(layout)));
    assert.deepEqual(layout, before, 'an incomplete index must never be persisted as a different layout');
  }
  assert.equal(syncFolderLayout(layout, ['Research'], ['Research/A.md', 'Research/B.md'], { preserveUnconfirmedMissing: true }), false);
  assert.deepEqual(layout, before);
});

test('retention still prunes hidden, duplicate, unsafe and wrong-folder managed references', () => {
  const layout = initialLayout(); syncFolderLayout(layout, ['A', 'B'], ['A/Visible.md', 'A/Hidden.md']);
  const a = findFolderBoard(layout, 'A')!, b = findFolderBoard(layout, 'B')!;
  const original = a.nodes.find(n => n.doc === 'A/Visible.md')!;
  a.nodes.push({ ...original, id: 'duplicate', x: 5000 });
  a.hiddenFolderDocs = ['A/Hidden.md'];
  a.nodes.push(article('wrong-folder', 'B/Moved.md', true), article('unsafe', 'A/.private.md', true), article('not-markdown', 'A/Photo.png', true));
  assert.equal(syncFolderLayout(layout, ['A', 'B'], ['B/Moved.md'], { preserveUnconfirmedMissing: true }), true);
  assert.deepEqual(a.nodes, [original]);
  assert.equal(b.nodes.filter(n => n.doc === 'B/Moved.md').length, 1);
  assert.equal(syncFolderLayout(layout, ['A', 'B'], [], { preserveUnconfirmedMissing: true }), false);
});

test('confirmed native deletion and disk pruning remove retained cards without later ghost restoration', async () => {
  const layout = initialLayout(); syncFolderLayout(layout, ['A'], ['A/Removed.md', 'A/Unindexed.md']);
  const a = findFolderBoard(layout, 'A')!, sync = new NativeReferenceSync();
  const kept = a.nodes.find(n => n.doc === 'A/Unindexed.md')!;
  sync.record(layout, { type: 'delete', path: 'A/Removed.md', folder: false });
  assert.equal(syncFolderLayout(layout, ['A'], [], { preserveUnconfirmedMissing: true }), false);
  assert.deepEqual(a.nodes, [kept]);
  const app = { vault: { getAbstractFileByPath: () => null, adapter: { exists: async (path: string) => path === 'A' || path === 'A/Unindexed.md' } } } as any;
  assert.equal(await sync.pruneMissing(layout, app), false);
  assert.equal(syncFolderLayout(layout, ['A'], [], { preserveUnconfirmedMissing: true }), false);
  assert.deepEqual(a.nodes, [kept]);
  app.vault.adapter.exists = async (path: string) => path === 'A';
  assert.equal(await sync.pruneMissing(layout, app), true);
  assert.equal(syncFolderLayout(layout, ['A'], [], { preserveUnconfirmedMissing: true }), false);
  assert.deepEqual(a.nodes, []);
});

test('native file move retains same-folder rename geometry but relocates cross-folder references canonically', () => {
  const layout = initialLayout(); syncFolderLayout(layout, ['A', 'B'], ['A/Old.md']);
  const a = findFolderBoard(layout, 'A')!, b = findFolderBoard(layout, 'B')!, sync = new NativeReferenceSync();
  Object.assign(a.nodes[0], { x: 1840, y: -720, w: 680, h: 420 });
  const original = { ...a.nodes[0] };
  sync.record(layout, { type: 'rename', path: 'A/Old.md', newPath: 'A/New.md', folder: false });
  syncFolderLayout(layout, ['A', 'B'], [], { preserveUnconfirmedMissing: true });
  assert.deepEqual(a.nodes, [{ ...original, doc: 'A/New.md' }]);
  sync.record(layout, { type: 'rename', path: 'A/New.md', newPath: 'B/New.md', folder: false });
  syncFolderLayout(layout, ['A', 'B'], ['B/New.md'], { preserveUnconfirmedMissing: true });
  assert.equal(a.nodes.length, 0);
  assert.equal(b.nodes.filter(n => n.doc === 'B/New.md').length, 1);
});

test('a temporarily missing folder inventory keeps its complete nested layouts until inventory returns', () => {
  const layout = initialLayout(); syncFolderLayout(layout, ['A', 'A/Sub'], ['A/One.md', 'A/Sub/Two.md']);
  const a = findFolderBoard(layout, 'A')!, sub = findFolderBoard(layout, 'A/Sub')!;
  a.nodes[0].x = 1800; sub.nodes[0].y = -1600;
  const nodes = structuredClone([a.nodes, sub.nodes]);
  syncFolderLayout(layout, [], [], { preserveUnconfirmedMissing: true });
  assert.deepEqual([a.nodes, sub.nodes], nodes);
  syncFolderLayout(layout, ['A', 'A/Sub'], ['A/One.md', 'A/Sub/Two.md'], { preserveUnconfirmedMissing: true });
  assert.deepEqual([a.nodes, sub.nodes], nodes);
});
