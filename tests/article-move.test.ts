import test from 'node:test';
import assert from 'node:assert/strict';
import { Board, BoardNode, Layout, initialLayout } from '../src/model';
import { relocateArticle } from '../src/article-move';
import { findFolderBoard, syncFolderLayout } from '../src/folder-layout';

const makeBoard = (id: string, folderPath?: string): Board => ({ id, title: id, parent: 'home', theme: 'product', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], ...(folderPath === undefined ? {} : { folderPath }) });
const selectedArticle = (): BoardNode => ({ id: 'selected-reference', type: 'article', doc: 'Source/Note.md', x: -537, y: 243, w: 420, h: 520, angle: -2, date: '2026-10-12', large: true, folderManaged: true });
function fixture(): Layout {
  const layout = initialLayout(); layout.boards.source = makeBoard('source', 'Source'); layout.boards.target = makeBoard('target', 'Target'); layout.boards.free = makeBoard('free');
  layout.boards.source.nodes = [selectedArticle(), { id: 'source-note', type: 'note', title: 'Keep', text: '', x: 400, y: 0 }, { id: 'source-other', type: 'article', doc: 'Source/Other.md', x: 700, y: 0 }];
  layout.boards.source.edges = [{ from: 'selected-reference', to: 'source-note' }, { from: 'source-note', to: 'source-other' }];
  layout.boards.target.nodes = [{ id: 'target-note', type: 'note', title: 'Keep target', text: '', x: 100, y: 100, w: 220, h: 220 }];
  layout.boards.free.nodes = [{ ...selectedArticle(), id: 'independent-free-reference', folderManaged: false }];
  return layout;
}

test('relocate selected article preserves identity/dimensions/style, nearby grid position and other free references', () => {
  const layout = fixture(), original = { ...layout.boards.source.nodes[0] }, free = structuredClone(layout.boards.free), camera = { ...layout.boards.target.view };
  assert.equal(relocateArticle(layout, 'source', original.id, 'target', 'Target/Note.md'), true);
  const moved = layout.boards.target.nodes.find(n => n.id === original.id)!;
  const { x, y, ...properties } = moved, { x: _x, y: _y, ...originalProperties } = original;
  assert.deepEqual(properties, { ...originalProperties, doc: 'Target/Note.md' });
  assert.equal(Math.abs(x % 20), 0); assert.equal(Math.abs(y % 20), 0); assert.ok(x < 1200 && y < 650 && x >= 0 && y >= 0);
  const neighbor = layout.boards.target.nodes.find(n => n.id === 'target-note')!;
  assert.ok(x + moved.w! <= neighbor.x || neighbor.x + neighbor.w! <= x || y + moved.h! <= neighbor.y || neighbor.y + neighbor.h! <= y);
  assert.equal(layout.boards.source.nodes.some(n => n.id === original.id), false);
  assert.deepEqual(layout.boards.source.edges, [{ from: 'source-note', to: 'source-other' }]);
  assert.deepEqual(layout.boards.free, free); assert.deepEqual(layout.boards.target.view, camera);
});

test('replace target automatic copies with selected geometry, clear only destination hiding and clean affected edges', () => {
  const layout = fixture(); layout.boards.target.hiddenFolderDocs = ['Target/Note.md', 'Target/Hidden.md'];
  layout.boards.target.nodes.push({ id: 'auto-copy', type: 'article', doc: 'Target/Note.md', folderManaged: true, x: 600, y: 100 }, { id: 'manual-copy', type: 'article', doc: 'Target/Note.md', x: 850, y: 800 });
  layout.boards.target.edges = [{ from: 'auto-copy', to: 'target-note' }];
  const manual = { ...layout.boards.target.nodes.at(-1)! };
  assert.equal(relocateArticle(layout, 'source', 'selected-reference', 'target', 'Target/Note.md'), true);
  assert.equal(layout.boards.target.nodes.some(n => n.id === 'auto-copy'), false);
  assert.deepEqual(layout.boards.target.nodes.find(n => n.id === 'manual-copy'), manual);
  assert.equal(layout.boards.target.nodes.filter(n => n.doc === 'Target/Note.md' && n.folderManaged).length, 1);
  assert.equal(layout.boards.target.nodes.find(n => n.doc === 'Target/Note.md' && n.folderManaged)!.id, 'selected-reference');
  assert.deepEqual(layout.boards.target.hiddenFolderDocs, ['Target/Hidden.md']); assert.deepEqual(layout.boards.target.edges, []);
});

test('captured selected reference survives native sync-before-helper, replacing the automatic generated card', () => {
  const layout = initialLayout(); syncFolderLayout(layout, ['Source', 'Target'], ['Source/Note.md']);
  const source = findFolderBoard(layout, 'Source')!, target = findFolderBoard(layout, 'Target')!;
  const node = source.nodes.find(n => n.doc === 'Source/Note.md')!;
  Object.assign(node, { w: 600, h: 900, angle: 3, date: 'manual date' }); const captured = { ...node };
  layout.boards.free = makeBoard('free'); layout.boards.free.nodes = [{ ...captured, id: 'free-copy', folderManaged: false }];
  syncFolderLayout(layout, ['Source', 'Target'], ['Target/Note.md']);
  assert.equal(source.nodes.some(n => n.id === captured.id), false);
  const automaticallyCreated = target.nodes.find(n => n.doc === 'Target/Note.md')!.id;
  assert.equal(relocateArticle(layout, source.id, captured.id, target.id, 'Target/Note.md', captured), true);
  const moved = target.nodes.filter(n => n.doc === 'Target/Note.md'); assert.equal(moved.length, 1);
  assert.equal(moved[0].id, captured.id); assert.equal(moved[0].w, 600); assert.equal(moved[0].h, 900); assert.equal(moved[0].angle, 3); assert.equal(moved[0].date, 'manual date');
  assert.equal(target.nodes.some(n => n.id === automaticallyCreated), false);
  assert.equal(layout.boards.free.nodes[0].doc, 'Source/Note.md', 'other references are migrated by the native rename event, not this helper');
  assert.equal(syncFolderLayout(layout, ['Source', 'Target'], ['Target/Note.md']), false);
});

test('root target is managed, a free target clears managed ownership, and source current reference wins over stale capture', () => {
  const root = fixture(); root.boards.home.folderPath = '';
  assert.equal(relocateArticle(root, 'source', 'selected-reference', 'home', 'Note.md'), true);
  assert.equal(root.boards.home.nodes[0].folderManaged, true);
  const layout = fixture(), capture = { ...layout.boards.source.nodes[0] }; layout.boards.source.nodes[0].w = 580;
  assert.equal(relocateArticle(layout, 'source', 'selected-reference', 'free', 'Source/Note.md', capture), true);
  const moved = layout.boards.free.nodes.find(n => n.id === capture.id)!;
  assert.equal(moved.folderManaged, undefined); assert.equal(moved.w, 580);
  assert.equal(layout.boards.free.nodes.some(n => n.id === 'independent-free-reference'), true);
});

test('same Board/same path is a no-op without changing manual coordinates or existing edges', () => {
  const layout = fixture(), before = JSON.stringify(layout);
  assert.equal(relocateArticle(layout, 'source', 'selected-reference', 'source', 'Source/Note.md'), false);
  assert.equal(JSON.stringify(layout), before);
});

test('invalid destinations, references, path mismatches and manual ID collisions fail atomically', () => {
  const cases: Array<(layout: Layout) => boolean> = [
    layout => relocateArticle(layout, 'missing', 'selected-reference', 'target', 'Target/Note.md'),
    layout => relocateArticle(layout, 'source', 'selected-reference', '__proto__', 'Target/Note.md'),
    layout => relocateArticle(layout, 'source', 'missing-node', 'target', 'Target/Note.md'),
    layout => relocateArticle(layout, 'source', 'source-note', 'target', 'Target/Note.md'),
    layout => relocateArticle(layout, 'source', 'selected-reference', 'target', '../Note.md'),
    layout => relocateArticle(layout, 'source', 'selected-reference', 'target', 'Target/Photo.png'),
    layout => relocateArticle(layout, 'source', 'selected-reference', 'target', 'Wrong/Note.md'),
  ];
  for (const run of cases) { const layout = fixture(), before = JSON.stringify(layout); assert.equal(run(layout), false); assert.equal(JSON.stringify(layout), before); }
  const missing = fixture(); missing.boards.target.folderMissing = true;
  const beforeMissing = JSON.stringify(missing); assert.equal(relocateArticle(missing, 'source', 'selected-reference', 'target', 'Target/Note.md'), false); assert.equal(JSON.stringify(missing), beforeMissing);
  const collision = fixture(); collision.boards.target.nodes.push({ id: 'selected-reference', type: 'note', title: 'Cannot overwrite', text: '', x: 0, y: 0 });
  const beforeCollision = JSON.stringify(collision); assert.equal(relocateArticle(collision, 'source', 'selected-reference', 'target', 'Target/Note.md'), false); assert.equal(JSON.stringify(collision), beforeCollision);
});
