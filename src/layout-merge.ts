import type { Board, BoardEdge, BoardNode, Layout } from './model';

/** A durable description of the losing edit. Missing values use explicit presence flags. */
export interface LayoutMergeConflict {
  path: string;
  kind: 'field' | 'add-add' | 'delete-update' | 'update-delete' | 'order';
  baseExists: boolean;
  localExists: boolean;
  currentExists: boolean;
  base?: unknown;
  local?: unknown;
  current?: unknown;
}
export interface LayoutMergeResult { layout: Layout; conflicts: LayoutMergeConflict[] }
type RecordValue = Record<string, unknown>;
const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
/** Object key order is not an edit; array order is. Layout data is plain JSON. */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => equal(item, b[i]));
  const left = a as RecordValue, right = b as RecordValue, keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => own(right, key) && equal(left[key], right[key]));
}
const pathKey = (path: string, key: string): string => `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;

/**
 * Apply only changes relative to the exact snapshot acknowledged to this writer.
 * The host must serialize this with other layout mutations and archive conflicts
 * before acknowledging a save. Never synthesize a base from the latest layout.
 */
export function mergeLayouts(base: Layout, proposed: Layout, current: Layout): LayoutMergeResult {
  const conflicts: LayoutMergeConflict[] = [];
  function conflict(path: string, kind: LayoutMergeConflict['kind'], b: unknown, l: unknown, c: unknown): void {
    conflicts.push({ path, kind, baseExists: b !== undefined, localExists: l !== undefined, currentExists: c !== undefined,
      ...(b !== undefined ? { base: copy(b) } : {}), ...(l !== undefined ? { local: copy(l) } : {}), ...(c !== undefined ? { current: copy(c) } : {}) });
  }
  function scalar(b: unknown, l: unknown, c: unknown, path: string, kind: LayoutMergeConflict['kind'] = 'field'): unknown {
    if (equal(l, b)) return copy(c);
    if (equal(c, b) || equal(l, c)) return copy(l);
    conflict(path, kind, b, l, c);
    return copy(c);
  }
  /** Absence only deletes an entity this writer previously saw and nobody changed. */
  function entity<T>(b: T | undefined, l: T | undefined, c: T | undefined, path: string, merge: (b: T, l: T, c: T, path: string) => T): T | undefined {
    if (equal(l, b)) return copy(c);
    if (equal(l, c)) return copy(c);
    if (b === undefined) {
      if (c === undefined) return copy(l);
      conflict(path, 'add-add', b, l, c); return copy(c);
    }
    if (c === undefined) { conflict(path, 'update-delete', b, l, c); return undefined; }
    if (l === undefined) {
      if (equal(c, b)) return undefined;
      conflict(path, 'delete-update', b, l, c); return copy(c);
    }
    return merge(b, l, c, path);
  }
  function fields<T extends object>(b: T, l: T, c: T, path: string, excluded: string[] = [], groups: string[][] = []): T {
    const result: RecordValue = {}, br = b as RecordValue, lr = l as RecordValue, cr = c as RecordValue;
    const blocked = new Set([...excluded, ...groups.flat()]);
    for (const key of new Set([...Object.keys(br), ...Object.keys(lr), ...Object.keys(cr)])) {
      if (blocked.has(key)) continue;
      const value = scalar(br[key], lr[key], cr[key], pathKey(path, key));
      if (value !== undefined) result[key] = value;
    }
    for (const keys of groups) {
      const pick = (input: RecordValue) => Object.fromEntries(keys.filter(key => own(input, key)).map(key => [key, input[key]]));
      Object.assign(result, scalar(pick(br), pick(lr), pick(cr), pathKey(path, keys.join('+'))));
    }
    return result as T;
  }
  function strings(b: string[] = [], l: string[] = [], c: string[] = []): string[] {
    const bs = new Set(b), ls = new Set(l), cs = new Set(c);
    // Membership has only two states: independent additions and removals commute.
    return [...new Set([...c, ...l])].filter(key => ls.has(key) === bs.has(key) ? cs.has(key) : ls.has(key));
  }
  function map<T>(b: Record<string, T>, l: Record<string, T>, c: Record<string, T>, path: string, merge: (b: T, l: T, c: T, path: string) => T): Record<string, T> {
    const result: Record<string, T> = Object.create(null);
    for (const key of new Set([...Object.keys(c), ...Object.keys(l), ...Object.keys(b)])) {
      const value = entity(own(b, key) ? b[key] : undefined, own(l, key) ? l[key] : undefined, own(c, key) ? c[key] : undefined, pathKey(path, key), merge);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  function ordered<T>(b: T[], l: T[], c: T[], path: string, key: (item: T) => string, merge: (b: T, l: T, c: T, path: string) => T): T[] {
    const index = (items: T[]) => Object.fromEntries(items.map(item => [key(item), item]));
    const merged = map(index(b), index(l), index(c), path, merge);
    // Compare relative order of surviving base entries, excluding additions/deletions.
    const localIds = new Set(l.map(key)), currentIds = new Set(c.map(key));
    const shared = new Set(b.map(key).filter(id => localIds.has(id) && currentIds.has(id) && own(merged, id)));
    const order = (items: T[]) => items.map(key).filter(id => shared.has(id));
    const bo = order(b), lo = order(l), co = order(c), changedLocal = !equal(bo, lo), changedCurrent = !equal(bo, co);
    if (changedLocal && changedCurrent && !equal(lo, co)) conflict(pathKey(path, '$order'), 'order', bo, lo, co);
    const primary = changedLocal && !changedCurrent ? l : c;
    const secondary = primary === l ? c : l;
    const ids = primary.map(key).filter(id => own(merged, id));
    // Insert additions beside their nearest surviving neighbour, without discarding
    // current-only entries when a local z-order operation wins.
    const presentIds = new Set(ids);
    const secondaryIds = secondary.map(key);
    for (let i = 0; i < secondaryIds.length; i++) {
      const id = secondaryIds[i];
      if (!own(merged, id) || presentIds.has(id)) continue;
      let previous = i - 1;
      while (previous >= 0 && !presentIds.has(secondaryIds[previous])) previous--;
      if (previous >= 0) ids.splice(ids.indexOf(secondaryIds[previous]) + 1, 0, id);
      else {
        let next = i + 1;
        while (next < secondaryIds.length && !presentIds.has(secondaryIds[next])) next++;
        ids.splice(next < secondaryIds.length ? ids.indexOf(secondaryIds[next]) : ids.length, 0, id);
      }
      presentIds.add(id);
    }
    return ids.map(id => merged[id]);
  }
  function edges<T extends BoardEdge>(b: T[] = [], l: T[] = [], c: T[] = [], path: string, nodes: BoardNode[]): T[] {
    const key = (edge: T) => JSON.stringify([edge.from, edge.to].sort());
    // Canonical endpoints make reversing an undirected connection a no-op.
    const canonical = (items: T[]) => items.map(item => { const [from, to] = [item.from, item.to].sort(); return { ...item, from, to }; });
    const ids = new Set(nodes.map(node => node.id));
    return ordered(canonical(b), canonical(l), canonical(c), path, key, (bb, ll, cc, p) => fields(bb, ll, cc, p))
      .filter(edge => ids.has(edge.from) && ids.has(edge.to));
  }
  function board(b: Board, l: Board, c: Board, path: string): Board {
    const result = fields(b, l, c, path, ['nodes', 'edges', 'knowledgeEdgeStyles', 'hiddenFolderBoards', 'hiddenFolderDocs']);
    result.nodes = ordered(b.nodes, l.nodes, c.nodes, pathKey(path, 'nodes'), node => node.id,
      (bb, ll, cc, p) => fields(bb, ll, cc, p, [], [['x', 'y'], ['w', 'h'], ['imageWidth', 'imageHeight']]));
    result.edges = edges(b.edges, l.edges, c.edges, pathKey(path, 'edges'), result.nodes);
    for (const key of ['hiddenFolderBoards', 'hiddenFolderDocs'] as const) {
      if (b[key] !== undefined || l[key] !== undefined || c[key] !== undefined) result[key] = strings(b[key], l[key], c[key]);
    }
    if (b.knowledgeEdgeStyles !== undefined || l.knowledgeEdgeStyles !== undefined || c.knowledgeEdgeStyles !== undefined)
      result.knowledgeEdgeStyles = edges(b.knowledgeEdgeStyles, l.knowledgeEdgeStyles, c.knowledgeEdgeStyles, pathKey(path, 'knowledgeEdgeStyles'), result.nodes);
    return result;
  }
  const layout = fields(base, proposed, current, '', ['boards', 'audioPlayback', 'visibleArticleHeadings']);
  layout.boards = map(base.boards, proposed.boards, current.boards, '/boards', board);
  // Node ownership is global. A stale source-board snapshot must not resurrect a
  // card that another window already moved, and moving a card must carry any
  // concurrent field edits along. Pre-existing duplicate IDs are left alone.
  const locations = (input: Layout) => {
    const result = new Map<string, { board: string; node: BoardNode }[]>();
    for (const item of Object.values(input.boards)) for (const node of item.nodes) {
      const entries = result.get(node.id) || [];
      entries.push({ board: item.id, node }); result.set(node.id, entries);
    }
    return result;
  };
  const bm = locations(base), lm = locations(proposed), cm = locations(current);
  for (const id of new Set([...bm.keys(), ...lm.keys(), ...cm.keys()])) {
    const bs = bm.get(id) || [], ls = lm.get(id) || [], cs = cm.get(id) || [];
    if (bs.length > 1 || ls.length > 1 || cs.length > 1) continue;
    const b = bs[0], l = ls[0], c = cs[0];
    if (new Set([b?.board, l?.board, c?.board].filter(Boolean)).size < 2) continue;
    // Replace per-board membership conflicts with one meaningful global conflict.
    const encodedId = pathKey('', id);
    for (let i = conflicts.length - 1; i >= 0; i--) {
      const parts = conflicts[i].path.split('/');
      if (parts[1] === 'boards' && parts[3] === 'nodes' && `/${parts[4]}` === encodedId) conflicts.splice(i, 1);
    }
    const merged = entity(b, l, c, pathKey('/nodes', id), (bb, ll, cc, path) => ({
      board: scalar(bb.board, ll.board, cc.board, pathKey(path, 'board')) as string,
      node: fields(bb.node, ll.node, cc.node, pathKey(path, 'node'), [], [['x', 'y'], ['w', 'h'], ['imageWidth', 'imageHeight']])
    }));
    for (const item of Object.values(layout.boards)) {
      if (item.id !== merged?.board) item.nodes = item.nodes.filter(node => node.id !== id);
    }
    if (merged) {
      const destination = layout.boards[merged.board];
      if (destination) {
        const index = destination.nodes.findIndex(node => node.id === id);
        if (index < 0) destination.nodes.push(merged.node); else destination.nodes[index] = merged.node;
      } else {
        // The destination itself was removed concurrently. Archive the entire
        // proposal; never silently manufacture a deleted board.
        conflict(pathKey('/nodes', id), 'update-delete', b, l, c);
      }
    }
  }
  // Ownership resolution can remove endpoints retained by per-board merging.
  for (const item of Object.values(layout.boards)) {
    const ids = new Set(item.nodes.map(node => node.id));
    item.edges = item.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
    if (item.knowledgeEdgeStyles) item.knowledgeEdgeStyles = item.knowledgeEdgeStyles.filter(edge => ids.has(edge.from) && ids.has(edge.to));
  }
  // A board removal may leave navigation pointing at a deleted board.
  if (!layout.boards[layout.currentBoard]) layout.currentBoard = layout.boards[current.currentBoard] ? current.currentBoard : 'home';
  if (base.audioPlayback !== undefined || proposed.audioPlayback !== undefined || current.audioPlayback !== undefined)
    layout.audioPlayback = map(base.audioPlayback || {}, proposed.audioPlayback || {}, current.audioPlayback || {}, '/audioPlayback', (b, l, c, path) => scalar(b, l, c, path) as typeof b);
  if (base.visibleArticleHeadings !== undefined || proposed.visibleArticleHeadings !== undefined || current.visibleArticleHeadings !== undefined)
    layout.visibleArticleHeadings = strings(base.visibleArticleHeadings, proposed.visibleArticleHeadings, current.visibleArticleHeadings);
  return { layout, conflicts };
}
