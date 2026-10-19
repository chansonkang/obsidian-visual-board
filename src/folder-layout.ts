import { Board, BoardNode, Layout, safeFolderPath, safeVaultPath } from './model';

const parentPath = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const hash = (value: string): string => {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return (result >>> 0).toString(36);
};
const uniqueId = (base: string, exists: (id: string) => boolean): string => {
  let id = base, suffix = 2;
  while (exists(id)) id = base + '-' + suffix++;
  return id;
};

/** Find the canonical mapping; missing mappings retain their identity on restoration. */
export function findFolderBoard(layout: Layout, folderPath: string): Board | undefined {
  const path = safeFolderPath(folderPath);
  if (path === null) return undefined;
  if (path === '' && layout.boards.home) return layout.boards.home;
  const matches = Object.values(layout.boards).filter(b => b.id !== 'home' && b.folderPath === path);
  return matches.find(b => !b.folderMissing) || matches[0];
}

function nodeRect(node: BoardNode) {
  // New articles receive their actual size from Markdown later. Reserve its largest initial size.
  const fallback = node.type === 'article' ? { w: 480, h: 640 } : node.type === 'board' ? { w: 300, h: 303 } : { w: 320, h: 260 };
  return { x: node.x, y: node.y, w: node.w || fallback.w, h: node.h || fallback.h };
}
function nextPosition(board: Board, candidate: BoardNode): { x: number; y: number } {
  const zoom = board.view.zoom || 1;
  const origin = { x: (100 - board.view.x) / zoom, y: (60 - board.view.y) / zoom };
  const nearest = [...board.nodes].sort((a, b) => (a.x - origin.x) ** 2 + (a.y - origin.y) ** 2 - ((b.x - origin.x) ** 2 + (b.y - origin.y) ** 2))[0];
  const anchor = nearest ? { x: nearest.x, y: nearest.y } : origin;
  const ax = Math.ceil(anchor.x / 20) * 20, ay = Math.ceil(anchor.y / 20) * 20;
  const occupied = board.nodes.map(nodeRect), size = nodeRect(candidate);
  const free = (x: number, y: number) => occupied.every(n => x + size.w + 20 <= n.x || x >= n.x + n.w + 20 || y + size.h + 20 <= n.y || y >= n.y + n.h + 20);
  // Search adjacent grid cells in expanding rings, avoiding a fixed distant staging coordinate.
  for (let ring = 0; ring <= Math.ceil(Math.sqrt(occupied.length + 1)) + 12; ring++) {
    for (let row = -ring; row <= ring; row++) for (let col = -ring; col <= ring; col++) {
      if (Math.max(Math.abs(row), Math.abs(col)) !== ring) continue;
      const x = ax + col * 340, y = ay + row * 340;
      if (free(x, y)) return { x, y };
    }
  }
  const right = Math.max(ax, ...occupied.map(n => n.x + n.w));
  return { x: Math.ceil((right + 20) / 20) * 20, y: ay };
}

export interface FolderLayoutSyncOptions {
  /** Vault indexes can be incomplete during loading. Confirm deletion separately against disk/native events. */
  preserveUnconfirmedMissing?: boolean;
}

/** Synchronize Vault references without creating/moving files or rearranging surviving cards. */
export function syncFolderLayout(layout: Layout, folders: string[], markdownFiles: string[], options: FolderLayoutSyncOptions = {}): boolean {
  let changed = false;
  const set = <T extends object, K extends keyof T>(object: T, key: K, value: T[K]) => { if (object[key] !== value) { object[key] = value; changed = true; } };
  const live = new Set<string>(['']);
  for (const value of folders) {
    const path = safeFolderPath(value);
    if (path === null) continue;
    let cursor = path;
    while (cursor) { live.add(cursor); cursor = parentPath(cursor); }
  }
  const home = layout.boards.home;
  set(home, 'folderPath', ''); set(home, 'folderMissing', false); set(home, 'parent', null);
  // Bad imported metadata does not create aliases or revive unrelated deleted directories.
  for (const b of Object.values(layout.boards)) if (b.id !== 'home' && b.folderPath !== undefined) {
    if (safeFolderPath(b.folderPath) === null || b.folderPath === '' || findFolderBoard(layout, b.folderPath)?.id !== b.id) {
      delete b.folderPath; delete b.folderMissing; changed = true;
    }
  }
  const mapping = new Map<string, Board>([['', home]]);
  for (const path of [...live].filter(Boolean).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))) {
    let b = findFolderBoard(layout, path);
    if (!b) {
      const id = uniqueId('folder-' + hash(path), id => Object.prototype.hasOwnProperty.call(layout.boards, id));
      b = { id, title: basename(path), parent: 'home', folderPath: path, folderMissing: false, theme: 'research', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] };
      layout.boards[id] = b; changed = true;
    }
    mapping.set(path, b); set(b, 'folderMissing', false); set(b, 'title', basename(path)); set(b, 'parent', mapping.get(parentPath(path))!.id);
  }
  for (const b of Object.values(layout.boards)) if (b.folderPath !== undefined && !live.has(b.folderPath)) set(b, 'folderMissing', true);
  const files = new Map<string, Set<string>>();
  for (const value of markdownFiles) {
    const path = safeVaultPath(value);
    if (!path || !/\.md$/i.test(path) || path.split('/').some(part => part.startsWith('.')) || !live.has(parentPath(path))) continue;
    const folder = parentPath(path);
    if (!files.has(folder)) files.set(folder, new Set());
    files.get(folder)!.add(path);
  }
  for (const [folder, b] of mapping) {
    const hiddenBoards = new Set(b.hiddenFolderBoards || []), hiddenDocs = new Set(b.hiddenFolderDocs || []);
    const desiredBoards = new Set([...mapping.values()].filter(child => child.id !== b.id && child.parent === b.id && !hiddenBoards.has(child.id)).map(child => child.id));
    const desiredFiles = new Set([...(files.get(folder) || [])].filter(path => !hiddenDocs.has(path)));
    const seenBoards = new Set<string>(), seenFiles = new Set<string>();
    const original = b.nodes;
    b.nodes = b.nodes.filter(n => {
      let keep = true;
      if (n.folderManaged && n.type === 'article') {
        const path = safeVaultPath(n.doc);
        // A missing index entry is not deletion evidence. Preserve its original node, size,
        // stacking order and connected edges until NativeReferenceSync confirms deletion.
        // Same-folder validation still removes a known moved path from its previous Board.
        const retainUnindexed = options.preserveUnconfirmedMissing && path && /\.md$/i.test(path)
          && !path.split('/').some(part => part.startsWith('.')) && parentPath(path) === folder && !hiddenDocs.has(path);
        keep = !!path && (desiredFiles.has(path) || !!retainUnindexed) && !seenFiles.has(path);
      }
      if (n.folderManaged && n.type === 'board') {
        const child = n.board && layout.boards[n.board];
        keep = !!child && !hiddenBoards.has(child.id) && (desiredBoards.has(child.id) || child.folderMissing === true && child.parent === b.id) && !seenBoards.has(child.id);
      }
      if (keep && n.folderManaged && n.doc) seenFiles.add(n.doc);
      if (keep && n.folderManaged && n.board) seenBoards.add(n.board);
      return keep;
    });
    if (b.nodes.length !== original.length) changed = true;
    const ensure = (type: 'article' | 'board', target: string) => {
      const existing = b.nodes.find(n => n.type === type && (type === 'board' ? n.board === target : n.doc === target));
      if (existing) { set(existing, 'folderManaged', true); return; }
      const id = uniqueId('folder-ref-' + hash(b.id + ':' + type + ':' + target), id => b.nodes.some(n => n.id === id));
      const n: BoardNode = { id, type, x: 0, y: 0, folderManaged: true, ...(type === 'board' ? { board: target } : { doc: target }) };
      Object.assign(n, nextPosition(b, n)); b.nodes.push(n); changed = true;
    };
    [...desiredBoards].sort().forEach(id => ensure('board', id));
    [...desiredFiles].sort().forEach(path => ensure('article', path));
    const ids = new Set(b.nodes.map(n => n.id)), edges = b.edges.filter(e => ids.has(e.from) && ids.has(e.to));
    if (edges.length !== b.edges.length) { b.edges = edges; changed = true; }
  }
  return changed;
}

/** Apply a known native folder rename to metadata, keeping every Board/node identity and layout. */
export function migrateFolderPaths(layout: Layout, oldPath: string, newPath: string): boolean {
  const old = safeFolderPath(oldPath), next = safeFolderPath(newPath);
  if (!old || !next || old === next || next.startsWith(old + '/')) return false;
  let changed = false;
  const migrate = (path: string) => path === old || path.startsWith(old + '/') ? next + path.slice(old.length) : path;
  const movingIds = new Set(Object.values(layout.boards).filter(b => b.folderPath === old || b.folderPath?.startsWith(old + '/')).map(b => b.id));
  // A successful native rename wins over historical mappings at the destination, even before
  // a delayed Vault snapshot has marked them missing. Keep their complete layouts as free Boards.
  for (const b of movingIds.size ? Object.values(layout.boards) : []) {
    if (!movingIds.has(b.id) && (b.folderPath === next || b.folderPath?.startsWith(next + '/'))) {
      delete b.folderPath; delete b.folderMissing; changed = true;
    }
  }
  for (const b of Object.values(layout.boards)) {
    if (b.folderPath !== undefined) {
      const path = migrate(b.folderPath);
      if (path !== b.folderPath) {
        if (b.id !== 'home') b.title = basename(path);
        b.folderPath = path; changed = true;
      }
    }
    if (b.iconPath) { const path = migrate(b.iconPath); if (path !== b.iconPath) { b.iconPath = path; changed = true; } }
    if (b.hiddenFolderDocs) {
      const paths = [...new Set(b.hiddenFolderDocs.map(migrate))];
      if (paths.length !== b.hiddenFolderDocs.length || paths.some((path, index) => path !== b.hiddenFolderDocs![index])) { b.hiddenFolderDocs = paths; changed = true; }
    }
    for (const n of b.nodes) for (const key of ['doc', 'imagePath'] as const) {
      if (!n[key]) continue;
      const path = migrate(n[key]!); if (path !== n[key]) { n[key] = path; changed = true; }
    }
  }
  return changed;
}
