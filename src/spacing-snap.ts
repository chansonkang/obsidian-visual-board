export interface SpacingRect { id: string; x: number; y: number; w: number; h: number }
export interface SpacingGuide { axis: 'x' | 'y'; x1: number; y1: number; x2: number; y2: number; gap: number }
export interface SpacingSnap { x?: number; y?: number; guides: SpacingGuide[] }
type Axis = 'x' | 'y';
interface Candidate { axis: Axis; position: number; delta: number; distance: number; a: SpacingRect; b: SpacingRect; mode: 'before' | 'after' | 'between' }
const MAX_LOCAL = 96, LOOKAHEAD = 8, EPSILON = 1e-7;
const size = (rect: SpacingRect, axis: Axis) => axis === 'x' ? rect.w : rect.h;
const end = (rect: SpacingRect, axis: Axis) => rect[axis] + size(rect, axis);
const valid = (rect: SpacingRect) => !!rect && typeof rect.id === 'string' && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) && rect.w > 0 && rect.h > 0 && Number.isFinite(rect.x + rect.w) && Number.isFinite(rect.y + rect.h);
function overlap(a: SpacingRect, b: SpacingRect, axis: Axis) { return Math.min(end(a, axis), end(b, axis)) - Math.max(a[axis], b[axis]); }
function band(a: SpacingRect, b: SpacingRect, axis: Axis) {
  const orth: Axis = axis === 'x' ? 'y' : 'x';
  return overlap(a, b, orth) >= .35 * Math.min(size(a, orth), size(b, orth));
}
function distance(a: SpacingRect, b: SpacingRect, axis: Axis) { return Math.max(0, a[axis] - end(b, axis), b[axis] - end(a, axis)); }
function collision(rect: SpacingRect, peers: SpacingRect[]) { return peers.some(peer => overlap(rect, peer, 'x') > EPSILON && overlap(rect, peer, 'y') > EPSILON); }
function candidates(moving: SpacingRect, peers: SpacingRect[], axis: Axis, tolerance: number): Candidate[] {
  const radius = Math.max(1200, size(moving, axis) * 4), maxGap = Math.min(600, Math.max(160, size(moving, axis) * 2));
  const maxPairGap = size(moving, axis) + maxGap * 2;
  // Bounded local window: never enumerate all pairs in a large Board.
  const local = peers.filter(peer => band(peer, moving, axis) && distance(peer, moving, axis) <= radius)
    .sort((a, b) => distance(a, moving, axis) - distance(b, moving, axis)).slice(0, MAX_LOCAL)
    .sort((a, b) => a[axis] - b[axis] || end(a, axis) - end(b, axis));
  const result: Candidate[] = [];
  const add = (a: SpacingRect, b: SpacingRect, mode: Candidate['mode'], position: number) => {
    const delta = Math.abs(position - moving[axis]);
    if (Number.isFinite(position) && delta <= tolerance + EPSILON) result.push({ axis, position, delta, a, b, mode, distance: distance(a, moving, axis) + distance(b, moving, axis) });
  };
  for (let i = 0; i < local.length - 1; i++) {
    const a = local[i];
    // Skip a few interleaved rows, but only use the nearest neighbor in this band.
    for (let j = i + 1; j < Math.min(local.length, i + LOOKAHEAD + 1); j++) {
      const b = local[j], gap = b[axis] - end(a, axis);
      if (gap > maxPairGap) break;
      if (!band(a, b, axis)) continue;
      if (gap <= EPSILON) break;
      if (gap <= maxGap) {
        add(a, b, 'after', end(b, axis) + gap);
        add(a, b, 'before', a[axis] - gap - size(moving, axis));
      }
      const free = gap - size(moving, axis);
      if (free > EPSILON && free / 2 <= maxGap) add(a, b, 'between', end(a, axis) + free / 2);
      break;
    }
  }
  return result.sort((a, b) => a.delta - b.delta || a.distance - b.distance);
}
function choose(moving: SpacingRect, peers: SpacingRect[], axis: Axis, tolerance: number): Candidate | undefined {
  for (const candidate of candidates(moving, peers, axis, tolerance)) {
    if (!collision({ ...moving, [axis]: candidate.position }, peers)) return candidate;
  }
}
function line(a: SpacingRect, b: SpacingRect, axis: Axis): SpacingGuide {
  const orth: Axis = axis === 'x' ? 'y' : 'x';
  const low = Math.max(a[orth], b[orth]), high = Math.min(end(a, orth), end(b, orth));
  const anchor = low <= high ? (low + high) / 2 : (a[orth] + size(a, orth) / 2 + b[orth] + size(b, orth) / 2) / 2;
  const gap = b[axis] - end(a, axis);
  return axis === 'x' ? { axis, x1: end(a, axis), y1: anchor, x2: b[axis], y2: anchor, gap } : { axis, x1: anchor, y1: end(a, axis), x2: anchor, y2: b[axis], gap };
}
function guides(candidate: Candidate, moving: SpacingRect): SpacingGuide[] {
  const { a, b, axis, mode } = candidate;
  if (mode === 'between') return [line(a, moving, axis), line(moving, b, axis)];
  return mode === 'after' ? [line(a, b, axis), line(b, moving, axis)] : [line(a, b, axis), line(moving, a, axis)];
}

/** Match nearby, non-overlapping edge gaps. Inputs are never mutated. */
export function equalSpacingSnap(moving: SpacingRect, peers: SpacingRect[], desired: { x: number; y: number }, tolerance: number): SpacingSnap {
  if (!valid(moving) || !desired || !Number.isFinite(desired.x) || !Number.isFinite(desired.y) || !Number.isFinite(tolerance) || tolerance < 0 || !Array.isArray(peers)) return { guides: [] };
  const rect = { ...moving, x: desired.x, y: desired.y };
  if (!valid(rect)) return { guides: [] };
  const validPeers = peers.filter(peer => valid(peer) && peer.id !== moving.id);
  let horizontal = choose(rect, validPeers, 'x', tolerance), vertical = choose(rect, validPeers, 'y', tolerance);
  let target = { ...rect, x: horizontal?.position ?? rect.x, y: vertical?.position ?? rect.y };
  if (horizontal && vertical && collision(target, validPeers)) {
    if (horizontal.delta <= vertical.delta) vertical = undefined; else horizontal = undefined;
    target = { ...rect, x: horizontal?.position ?? rect.x, y: vertical?.position ?? rect.y };
  }
  return { ...(horizontal ? { x: horizontal.position } : {}), ...(vertical ? { y: vertical.position } : {}), guides: [...(horizontal ? guides(horizontal, target) : []), ...(vertical ? guides(vertical, target) : [])] };
}
