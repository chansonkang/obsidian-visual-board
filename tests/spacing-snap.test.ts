import test from 'node:test';
import assert from 'node:assert/strict';
import { equalSpacingSnap, type SpacingRect } from '../src/spacing-snap';
const rect = (id: string, x: number, y = 0, w = 100, h = 100): SpacingRect => ({ id, x, y, w, h });

test('unequal-width horizontal cards continue the actual edge gap on either side', () => {
  const peers = [rect('a', 0, 0, 80), rect('b', 120, 0, 200)], moving = rect('c', 0, 0, 130);
  const right = equalSpacingSnap(moving, peers, { x: 359, y: 0 }, 8);
  assert.equal(right.x, 360); assert.equal(right.y, undefined);
  assert.deepEqual(right.guides.map(guide => [guide.axis, guide.x1, guide.x2, guide.gap]), [['x', 80, 120, 40], ['x', 320, 360, 40]]);
  const left = equalSpacingSnap(moving, peers, { x: -167, y: 0 }, 8);
  assert.equal(left.x, -170); assert.deepEqual(left.guides.map(guide => guide.gap), [40, 40]);
});

test('unequal-height vertical cards continue the edge gap above and below', () => {
  const peers = [rect('a', 0, 0, 100, 80), rect('b', 0, 120, 100, 200)], moving = rect('c', 0, 0, 100, 130);
  const down = equalSpacingSnap(moving, peers, { x: 0, y: 365 }, 8);
  assert.equal(down.y, 360); assert.equal(down.x, undefined);
  assert.deepEqual(down.guides.map(guide => [guide.axis, guide.y1, guide.y2, guide.gap]), [['y', 80, 120, 40], ['y', 320, 360, 40]]);
  assert.equal(equalSpacingSnap(moving, peers, { x: 0, y: -172 }, 8).y, -170);
});

test('a card placed between outer neighbors has equal free gaps on both sides', () => {
  const result = equalSpacingSnap(rect('c', 0, 0, 80), [rect('a', 0), rect('b', 500, 0, 200)], { x: 264, y: 0 }, 8);
  assert.equal(result.x, 260); assert.deepEqual(result.guides.map(guide => guide.gap), [160, 160]);
  const down = equalSpacingSnap(rect('c', 0, 0, 100, 80), [rect('a', 0), rect('b', 0, 500, 100, 200)], { x: 0, y: 263 }, 8);
  assert.equal(down.y, 260); assert.deepEqual(down.guides.map(guide => guide.gap), [160, 160]);
});

test('different rows, unrelated distant gaps, and occupied candidate slots do not attract a card', () => {
  assert.deepEqual(equalSpacingSnap(rect('c', 0, 0, 100, 600), [rect('a', 0), rect('b', 140, 300)], { x: 280, y: 0 }, 8), { guides: [] });
  assert.deepEqual(equalSpacingSnap(rect('c', 0), [rect('a', -5000), rect('b', -4000)], { x: -3000, y: 0 }, 8), { guides: [] });
  assert.deepEqual(equalSpacingSnap(rect('c', 0, 0, 130), [rect('a', 0, 0, 80), rect('b', 120, 0, 200), rect('blocker', 350, 0, 20)], { x: 359, y: 0 }, 8), { guides: [] });
});

test('zoom-adjusted tolerance accepts only the nearest valid delta and can match exact stationary geometry', () => {
  const peers = [rect('a', 0, 0, 80), rect('b', 120, 0, 200)], moving = rect('c', 360, 0, 130);
  assert.equal(equalSpacingSnap(moving, peers, { x: 368.1, y: 0 }, 8).x, undefined);
  assert.equal(equalSpacingSnap(moving, peers, { x: 368.1, y: 0 }, 8 / .5).x, 360);
  assert.equal(equalSpacingSnap(moving, peers, { x: 360, y: 0 }, 0).x, 360);
  const alternatives = [rect('a', 0, 0, 80), rect('b', 120, 0, 200), rect('other-a', 6, 200, 80), rect('other-b', 126, 200, 200)];
  assert.equal(equalSpacingSnap(rect('tall', 0, 0, 130, 300), alternatives, { x: 364, y: 0 }, 8).x, 366, 'two valid bands should choose the closer 2-unit delta over a 4-unit delta');
});

test('invalid rectangles, overlapping reference gaps and moving-ID copies are safely ignored', () => {
  const moving = rect('c', 0);
  assert.deepEqual(equalSpacingSnap(moving, [rect('a', 0), rect('b', 80)], { x: 260, y: 0 }, 8), { guides: [] });
  assert.deepEqual(equalSpacingSnap(moving, [rect('a', 0, 0, 0), rect('b', 140), rect('c', 0), rect('bad', Infinity)], { x: 280, y: 0 }, 8), { guides: [] });
  assert.deepEqual(equalSpacingSnap({ ...moving, h: NaN }, [], { x: 0, y: 0 }, 8), { guides: [] });
  assert.deepEqual(equalSpacingSnap(moving, [], { x: Infinity, y: 0 }, 8), { guides: [] });
  assert.deepEqual(equalSpacingSnap(moving, [], { x: 0, y: 0 }, -1), { guides: [] });
});

test('interleaved unrelated rows and thousands of distant nodes retain local matching without mutating source', () => {
  const moving = Object.freeze(rect('c', 0, 0, 100, 500)), desired = Object.freeze({ x: 283, y: 0 });
  const peers = [rect('a', 0), rect('unrelated', 120, 300), rect('b', 140), ...Array.from({ length: 5000 }, (_, i) => rect('far-' + i, 10000 + i * 200, 10000))].map(peer => Object.freeze(peer));
  const before = JSON.stringify({ moving, peers, desired });
  assert.equal(equalSpacingSnap(moving, peers, desired, 8).x, 280);
  assert.equal(JSON.stringify({ moving, peers, desired }), before);
});
