import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLayouts } from '../src/layout-merge';
import { initialLayout, type BoardNode, type Layout } from '../src/model';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const node = (id: string, text = id): BoardNode => ({ id, type: 'note', title: id, text, color: 'green', x: 20, y: 40, w: 240, h: 280 });
function fixture(): Layout { const value = initialLayout(); value.boards.home.nodes = [node('n'), { id: 'a', type: 'article', doc: 'A.md', x: 500, y: 40, w: 400, h: 600 }, node('z')]; return value; }
const n = (layout: Layout, id = 'n') => layout.boards.home.nodes.find(item => item.id === id)!;

test('stale full snapshot cannot omit restored/new sticky notes or reset current article arrangement', () => {
  const base = fixture(), local = clone(base), current = clone(base);
  current.boards.home.nodes.push(...Array.from({ length: 14 }, (_, i) => node(`restored-${i}`, `Recovered ${i}`)));
  n(current, 'a').x = 900; n(current, 'a').y = 1200; n(current, 'a').w = 720;
  local.boards.home.view.zoom = .5;
  const result = mergeLayouts(base, local, current);
  assert.equal(result.layout.boards.home.nodes.length, 17);
  assert.deepEqual(n(result.layout, 'a'), n(current, 'a'));
  assert.equal(result.layout.boards.home.view.zoom, .5);
  assert.equal(result.conflicts.length, 0);
});
test('independent content, appearance, position and size edits combine without conflict', () => {
  const base = fixture(), local = clone(base), current = clone(base);
  Object.assign(n(local), { text: 'edited locally', x: 300, y: 600 });
  Object.assign(n(current), { title: 'other window title', color: 'pink', w: 500, h: 700 });
  const result = mergeLayouts(base, local, current);
  assert.deepEqual(n(result.layout), { ...n(current), text: 'edited locally', x: 300, y: 600 });
  assert.equal(result.conflicts.length, 0);
});
test('concurrent text conflict keeps current and archives complete losing text', () => {
  const base = fixture(), local = clone(base), current = clone(base);
  n(local).text = 'local multiline\nsecond line'; n(current).text = 'other window writing';
  const result = mergeLayouts(base, local, current);
  assert.equal(n(result.layout).text, n(current).text);
  assert.deepEqual(result.conflicts, [{ path: '/boards/home/nodes/n/text', kind: 'field', baseExists: true, localExists: true, currentExists: true, base: 'n', local: n(local).text, current: n(current).text }]);
});
test('coordinate and dimension conflicts are atomic rather than mixing two gestures', () => {
  const base = fixture(), local = clone(base), current = clone(base);
  n(local).x = 800; n(local).w = 800;
  n(current).y = 600; n(current).h = 900;
  const result = mergeLayouts(base, local, current);
  assert.deepEqual([n(result.layout).x, n(result.layout).y, n(result.layout).w, n(result.layout).h], [20, 600, 240, 900]);
  assert.deepEqual(result.conflicts.map(item => item.path), ['/boards/home/nodes/n/x+y', '/boards/home/nodes/n/w+h']);
});
test('deletion removes an unchanged known node but preserves one edited in another window', () => {
  const base = fixture(), local = clone(base), current = clone(base);
  local.boards.home.nodes = []; n(current).text = 'keep newest';
  const result = mergeLayouts(base, local, current);
  assert.deepEqual(result.layout.boards.home.nodes, [n(current)]);
  assert.equal(result.conflicts[0].kind, 'delete-update');
  const stored = JSON.parse(JSON.stringify(result.conflicts[0]));
  assert.equal(stored.localExists, false); assert.equal(stored.current.text, 'keep newest');
});
test('an externally deleted node cannot be resurrected by a stale edit or save', () => {
  const base = fixture(), local = clone(base), current = clone(base);
  current.boards.home.nodes = current.boards.home.nodes.filter(item => item.id !== 'n');
  assert.equal(n(mergeLayouts(base, local, current).layout), undefined);
  n(local).text = 'unsaved edit worth archiving';
  const result = mergeLayouts(base, local, current);
  assert.equal(n(result.layout), undefined);
  assert.equal(result.conflicts[0].kind, 'update-delete');
  assert.equal((result.conflicts[0].local as BoardNode).text, 'unsaved edit worth archiving');
});
test('same-ID concurrent additions keep current and record the complete local node', () => {
  const base = fixture(), local = clone(base), current = clone(base);
  local.boards.home.nodes.push(node('new', 'local')); current.boards.home.nodes.push(node('new', 'current'));
  const result = mergeLayouts(base, local, current);
  assert.equal(n(result.layout, 'new').text, 'current');
  assert.equal(result.conflicts[0].kind, 'add-add');
  assert.equal(result.conflicts[0].baseExists, false);
});
test('local z-order is applied if current order is unchanged and retains concurrent new notes', () => {
  const base = fixture(), local = clone(base), current = clone(base);
  local.boards.home.nodes.reverse(); current.boards.home.nodes.push(node('new'));
  const result = mergeLayouts(base, local, current);
  const ids = result.layout.boards.home.nodes.map(item => item.id);
  assert.deepEqual(ids.filter(id => id !== 'new'), ['z', 'a', 'n']);
  assert.equal(ids.filter(id => id === 'new').length, 1);
});
test('current z-order wins concurrent conflicting reordering and preserves local additions', () => {
  const base = fixture(), local = clone(base), current = clone(base);
  local.boards.home.nodes.reverse(); local.boards.home.nodes.push(node('new'));
  current.boards.home.nodes = [n(current, 'a'), n(current), n(current, 'z')];
  const result = mergeLayouts(base, local, current);
  assert.deepEqual(result.layout.boards.home.nodes.filter(item => item.id !== 'new').map(item => item.id), ['a', 'n', 'z']);
  assert.equal(n(result.layout, 'new').text, 'new');
  assert.equal(result.conflicts.at(-1)?.kind, 'order');
});
test('undirected connections combine independent style edits even when endpoints are reversed', () => {
  const base = fixture(); base.boards.home.edges = [{ from: 'n', to: 'a', width: 2, lineStyle: 'solid' }];
  const local = clone(base), current = clone(base);
  local.boards.home.edges = [{ from: 'a', to: 'n', width: 4, lineStyle: 'solid' }];
  current.boards.home.edges[0].lineStyle = 'dashed';
  current.boards.home.edges.push({ from: 'z', to: 'n' });
  const result = mergeLayouts(base, local, current);
  assert.deepEqual(result.layout.boards.home.edges, [{ from: 'a', to: 'n', width: 4, lineStyle: 'dashed' }, { from: 'n', to: 'z' }]);
  assert.equal(result.conflicts.length, 0);
});
test('connections to legitimately deleted endpoints are removed', () => {
  const base = fixture(); base.boards.home.edges = [{ from: 'n', to: 'a' }];
  const local = clone(base), current = clone(base);
  local.boards.home.nodes = local.boards.home.nodes.filter(item => item.id !== 'n');
  assert.deepEqual(mergeLayouts(base, local, current).layout.boards.home.edges, []);
});
test('stale board removal preserves concurrently edited board, and stale old board cannot revive deletion', () => {
  const base = fixture(); base.boards.sub = { ...clone(base.boards.home), id: 'sub', parent: 'home' };
  const local = clone(base), current = clone(base); delete local.boards.sub; current.boards.sub.nodes[0].text = 'new';
  const result = mergeLayouts(base, local, current);
  assert.equal(result.layout.boards.sub.nodes[0].text, 'new');
  assert.equal(result.conflicts[0].kind, 'delete-update');
  const deleted = clone(base); delete deleted.boards.sub;
  const stale = clone(base); stale.boards.sub.nodes[0].text = 'stale';
  assert.equal(mergeLayouts(base, stale, deleted).layout.boards.sub, undefined);
});
test('set-valued flags and independent audio records retain concurrent changes', () => {
  const base = fixture(); base.visibleArticleHeadings = ['Old.md'];
  base.audioPlayback = { 'One.mp3': { position: 10 }, 'Two.mp3': { position: 20 } };
  const local = clone(base), current = clone(base);
  local.visibleArticleHeadings = ['Local.md']; current.visibleArticleHeadings!.push('Current.md');
  local.audioPlayback!['One.mp3'].position = 99; current.audioPlayback!['Two.mp3'].position = 88;
  const result = mergeLayouts(base, local, current);
  assert.deepEqual(new Set(result.layout.visibleArticleHeadings), new Set(['Local.md', 'Current.md']));
  assert.deepEqual({ ...result.layout.audioPlayback }, { 'One.mp3': { position: 99 }, 'Two.mp3': { position: 88 } });
});
test('conflict values and output are detached copies and merge does not mutate any input', () => {
  const base = fixture(), local = clone(base), current = clone(base);
  n(local).text = 'local'; n(current).text = 'current';
  const before = [clone(base), clone(local), clone(current)];
  const result = mergeLayouts(base, local, current);
  n(result.layout).color = 'blue'; result.layout.boards.home.nodes.push(node('other'));
  assert.deepEqual(clone([base, local, current]), before);
});

function withDestination(): Layout {
  const value = fixture();
  value.boards.target = { ...clone(value.boards.home), id: 'target', parent: 'home', nodes: [], edges: [] };
  return value;
}
function move(layout: Layout, id: string, target: string): void {
  const item = n(layout, id); layout.boards.home.nodes = layout.boards.home.nodes.filter(node => node.id !== id);
  layout.boards[target].nodes.push(item);
}
test('current cross-board move plus stale source edit merges once at the current destination', () => {
  const base = withDestination(), local = clone(base), current = clone(base);
  move(current, 'n', 'target'); current.boards.target.nodes[0].x = 700;
  n(local).text = 'retain local draft';
  const result = mergeLayouts(base, local, current);
  assert.equal(n(result.layout), undefined);
  assert.deepEqual(result.layout.boards.target.nodes, [{ ...n(base), x: 700, text: 'retain local draft' }]);
  assert.equal(result.conflicts.length, 0);
});
test('local cross-board move carries concurrent text and retains latest notes in both boards', () => {
  const base = withDestination(), local = clone(base), current = clone(base);
  move(local, 'n', 'target'); local.boards.target.nodes[0].x = 800;
  n(current).text = 'current text'; current.boards.home.nodes.push(node('restored'));
  current.boards.target.nodes.push(node('other'));
  const result = mergeLayouts(base, local, current);
  assert.equal(n(result.layout), undefined);
  assert.equal(n(result.layout, 'restored').text, 'restored');
  assert.deepEqual(result.layout.boards.target.nodes.find(node => node.id === 'n'), { ...n(base), x: 800, text: 'current text' });
  assert.equal(result.layout.boards.target.nodes.length, 2);
  assert.equal(result.conflicts.length, 0);
});
test('conflicting moves choose the current board once and archive the local destination', () => {
  const base = withDestination(); base.boards.second = { ...clone(base.boards.target), id: 'second' };
  const local = clone(base), current = clone(base);
  move(local, 'n', 'target'); move(current, 'n', 'second');
  const result = mergeLayouts(base, local, current);
  assert.equal(n(result.layout), undefined); assert.equal(result.layout.boards.target.nodes.length, 0);
  assert.equal(result.layout.boards.second.nodes[0].id, 'n');
  assert.deepEqual(result.conflicts.map(item => [item.path, item.local, item.current]), [['/nodes/n/board', 'target', 'second']]);
});
test('a current deletion wins an old move without duplicating or resurrecting the node', () => {
  const base = withDestination(), local = clone(base), current = clone(base);
  move(local, 'n', 'target'); current.boards.home.nodes = current.boards.home.nodes.filter(item => item.id !== 'n');
  const result = mergeLayouts(base, local, current);
  assert.equal(n(result.layout), undefined); assert.equal(result.layout.boards.target.nodes.length, 0);
  assert.equal(result.conflicts[0].kind, 'update-delete');
});
