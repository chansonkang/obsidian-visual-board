/** Board data contains layout and references only; Vault files remain the source of truth. */
export interface BoardNode {
  id: string;
  type: 'article' | 'board' | 'note' | 'photo' | 'pdf' | 'audio';
  x: number;
  y: number;
  w?: number;
  h?: number;
  doc?: string;
  board?: string;
  title?: string;
  text?: string;
  color?: string;
  angle?: number;
  date?: string;
  large?: boolean;
  homeNote?: boolean;
  imagePath?: string;
  imageWidth?: number;
  imageHeight?: number;
  sourceUrl?: string;
  folderManaged?: boolean;
  filePath?: string;
}

export interface BoardEdge {
  from: string;
  to: string;
  lineStyle?: 'solid' | 'dashed';
  width?: number;
}

export interface KnowledgeEdgeStyle extends BoardEdge {
  /** Hide only this Board's rendered relation, keeping the underlying Markdown link. */
  hidden?: boolean;
}

export interface Board {
  id: string;
  title: string;
  parent: string | null;
  theme: string;
  view: { x: number; y: number; zoom: number };
  nodes: BoardNode[];
  edges: BoardEdge[];
  /** Appearance overrides only; real knowledge edges are derived from Vault-resolved links. */
  knowledgeEdgeStyles?: KnowledgeEdgeStyle[];
  iconMode: 'default' | 'ai';
  iconId?: string;
  folderColor?: string;
  iconManual?: boolean;
  iconPath?: string;
  iconStatus?: string;
  iconModel?: string;
  /** Empty string represents the Vault root. Unset means a freely arranged Board. */
  folderPath?: string;
  folderMissing?: boolean;
  hiddenFolderBoards?: string[];
  hiddenFolderDocs?: string[];
}

export interface AudioPlayback {
  position: number;
  duration?: number;
  lastPlayedAt?: number;
}

export interface Layout {
  version: 2;
  articleSizingVersion?: 1;
  currentBoard: string;
  showKnowledge: boolean;
  showSpace: boolean;
  boards: Record<string, Board>;
  audioPlayback?: Record<string, AudioPlayback>;
  /** Documents whose first H1 is editable body content rather than a hidden title prefix. */
  visibleArticleHeadings?: string[];
}

type Dict = Record<string, unknown>;
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const object = (value: unknown): Dict => value && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {};
const own = (record: Dict, key: string): unknown => Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
const id = (value: unknown): string | null => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value) && !forbiddenKeys.has(value) ? value : null;
const text = (value: unknown, fallback = '', limit = 1000): string => typeof value === 'string' ? value.slice(0, limit) : fallback;
const finite = (value: unknown, fallback: number, min: number, max: number): number => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const audioPath = (value: string): boolean => /\.(mp3|m4a|wav|ogg|flac|aac|opus|webm)$/i.test(value);
const nonnegative = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;

function edgeStyle(source: Dict, from: string, to: string): BoardEdge {
  const edge: BoardEdge = { from, to };
  if (source.lineStyle === 'solid' || source.lineStyle === 'dashed') edge.lineStyle = source.lineStyle;
  // Widths use half-pixel steps. Non-numbers and non-finite values keep the renderer default.
  if (typeof source.width === 'number' && Number.isFinite(source.width)) edge.width = Math.round(Math.max(1, Math.min(8, source.width)) * 2) / 2;
  return edge;
}

/** Accept only Vault-relative paths. Never turn a network or absolute URL into a file reference. */
export function safeVaultPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\\\x00-\x1f\x7f:]/.test(value) || value.startsWith('/')) return null;
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  return value;
}

/** Folder mappings may reference the root, but never hidden Vault internals. */
export function safeFolderPath(value: unknown): string | null {
  if (value === '') return '';
  const path = safeVaultPath(value);
  return path && !path.split('/').some(part => part.startsWith('.')) ? path : null;
}

/** Retain attribution URLs, without secrets embedded in the authority or executable schemes. */
function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

const emptyBoard = (boardId: string, title: string, parent: string | null): Board => ({
  id: boardId, title, parent, theme: 'product', view: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], iconMode: 'default'
});

export function initialLayout(): Layout {
  const boards: Record<string, Board> = Object.create(null);
  boards.home = emptyBoard('home', '我的桌面', null);
  return { version: 2, currentBoard: 'home', showKnowledge: true, showSpace: true, boards };
}

function sanitizeNode(raw: unknown): BoardNode | null {
  const source = object(raw), nodeId = id(source.id);
  if (!nodeId || !['article', 'board', 'note', 'photo', 'pdf', 'audio'].includes(String(source.type))) return null;
  const type = source.type as BoardNode['type'];
  const node: BoardNode = { id: nodeId, type, x: finite(source.x, 0, -1e6, 1e6), y: finite(source.y, 0, -1e6, 1e6) };
  if (typeof source.folderManaged === 'boolean' && type !== 'pdf' && type !== 'audio') node.folderManaged = source.folderManaged;
  if (source.w !== undefined) node.w = finite(source.w, 200, type === 'photo' ? 1 : 160, type === 'photo' ? 100000 : 1200);
  if (source.h !== undefined) node.h = finite(source.h, 240, type === 'photo' ? 1 : 160, type === 'photo' ? 100000 : 1600);
  if (source.angle !== undefined) node.angle = finite(source.angle, 0, -360, 360);
  if (type === 'article') {
    // Discard the old natural-content height before sanitization loses its value.
    if (typeof source.h === 'number' && source.h > 1600) { delete node.w; delete node.h; }
    const path = safeVaultPath(source.doc);
    if (!path || !/\.md$/i.test(path)) return null;
    node.doc = path;
    if (typeof source.date === 'string') node.date = text(source.date, '', 100);
    if (typeof source.large === 'boolean') node.large = source.large;
    if (typeof source.homeNote === 'boolean') node.homeNote = source.homeNote;
  } else if (type === 'board') {
    const target = id(source.board);
    if (!target) return null;
    node.board = target;
  } else if (type === 'note') {
    node.title = text(source.title, '新的想法');
    node.text = text(source.text, '', 100000);
    if (['yellow', 'green', 'pink', 'blue', 'purple', 'peach', 'white', ''].includes(String(source.color))) node.color = String(source.color);
  } else if (type === 'pdf' || type === 'audio') {
    const path = safeVaultPath(source.filePath);
    if (!path || !(type === 'pdf' ? /\.pdf$/i.test(path) : audioPath(path))) return null;
    node.filePath = path;
    if (typeof source.title === 'string') node.title = text(source.title);
  } else {
    if (typeof source.title === 'string') node.title = text(source.title);
    const path = safeVaultPath(source.imagePath);
    if (path) node.imagePath = path;
    if (typeof source.imageWidth === 'number' && typeof source.imageHeight === 'number' && Number.isFinite(source.imageWidth) && Number.isFinite(source.imageHeight) && source.imageWidth > 0 && source.imageHeight > 0 && source.imageWidth <= 100000 && source.imageHeight <= 100000) { node.imageWidth = source.imageWidth; node.imageHeight = source.imageHeight; }
    const sourceUrl = safeSourceUrl(source.sourceUrl);
    if (sourceUrl) node.sourceUrl = sourceUrl;
  }
  return node;
}

/** Repair damaged input without deleting hidden Boards or missing Markdown references. */
export function sanitizeLayout(raw: unknown): Layout {
  const source = object(raw), inputBoards = object(source.boards);
  const layout = initialLayout();
  if(source.articleSizingVersion === 1) layout.articleSizingVersion = 1;
  layout.showKnowledge = source.showKnowledge !== false;
  layout.showSpace = source.showSpace !== false;
  if (Array.isArray(source.visibleArticleHeadings)) layout.visibleArticleHeadings = [...new Set(source.visibleArticleHeadings.slice(0, 10000).map(safeVaultPath).filter((path): path is string => path !== null && /\.md$/i.test(path)))];

  for (const key of Object.keys(inputBoards).slice(0, 1024)) {
    const boardId = id(key);
    if (!boardId) continue;
    const value = object(own(inputBoards, key));
    const board = emptyBoard(boardId, text(value.title, boardId === 'home' ? '我的桌面' : '新的 Board'), boardId === 'home' ? null : id(value.parent) || 'home');
    const folderPath = safeFolderPath(value.folderPath);
    if (folderPath !== null) {
      board.folderPath = folderPath;
      if (typeof value.folderMissing === 'boolean') board.folderMissing = value.folderMissing;
    }
    if (Array.isArray(value.hiddenFolderBoards)) board.hiddenFolderBoards = [...new Set(value.hiddenFolderBoards.slice(0, 10000).map(id).filter((value): value is string => value !== null))];
    if (Array.isArray(value.hiddenFolderDocs)) board.hiddenFolderDocs = [...new Set(value.hiddenFolderDocs.slice(0, 10000).map(safeVaultPath).filter((value): value is string => value !== null && /\.md$/i.test(value)))];
    board.theme = text(value.theme, 'product', 100);
    const view = object(value.view);
    board.view = { x: finite(view.x, 0, -1e6, 1e6), y: finite(view.y, 0, -1e6, 1e6), zoom: finite(view.zoom, 1, .3, 2) };
    board.iconMode = value.iconMode === 'ai' ? 'ai' : 'default';
    const iconId = id(value.iconId), iconPath = safeVaultPath(value.iconPath);
    if (iconId) board.iconId = iconId;
    if (typeof value.folderColor === 'string' && ['lavender', 'rose', 'peach', 'mint', 'sky', 'sand', 'slate'].includes(value.folderColor)) board.folderColor = value.folderColor;
    if (iconPath) board.iconPath = iconPath;
    if (typeof value.iconManual === 'boolean') board.iconManual = value.iconManual;
    // In-flight requests cannot survive reload. The existing attachment is still usable.
    board.iconStatus = iconPath ? 'generated' : board.iconMode === 'default' ? 'default' : value.iconStatus === 'failed' ? 'failed' : 'pending';
    if (typeof value.iconModel === 'string') board.iconModel = text(value.iconModel, '', 200);
    const seen = new Set<string>();
    for (const candidate of (Array.isArray(value.nodes) ? value.nodes : []).slice(0, 10000)) {
      const node = sanitizeNode(candidate);
      if (!node || seen.has(node.id)) continue;
      seen.add(node.id);
      board.nodes.push(node);
    }
    layout.boards[boardId] = board;
  }

  for (const board of Object.values(layout.boards)) {
    if (board.id !== 'home' && (!board.parent || !layout.boards[board.parent] || board.parent === board.id)) board.parent = 'home';
  }
  // Iterative detection avoids stack overflow for deep nesting; every member of a cycle is detached.
  const cycleIds = new Set<string>();
  for (const board of Object.values(layout.boards)) {
    const chain: string[] = [], positions = new Map<string, number>();
    let cursor: string | null = board.id;
    while (cursor && layout.boards[cursor]) {
      const repeated = positions.get(cursor);
      if (repeated !== undefined) { chain.slice(repeated).forEach(key => cycleIds.add(key)); break; }
      positions.set(cursor, chain.length);
      chain.push(cursor);
      cursor = layout.boards[cursor].parent;
    }
  }
  cycleIds.forEach(key => { layout.boards[key].parent = 'home'; });

  for (const board of Object.values(layout.boards)) {
    const childEntries = new Set<string>();
    board.nodes = board.nodes.filter(node => {
      if (node.type !== 'board') return true;
      const child = node.board && layout.boards[node.board];
      if (!child || child.id === 'home' || child.parent !== board.id || childEntries.has(child.id)) return false;
      childEntries.add(child.id);
      return true;
    });
    const nodeIds = new Set(board.nodes.map(node => node.id)), edgeKeys = new Set<string>();
    const input = object(own(inputBoards, board.id));
    for (const candidate of (Array.isArray(input.edges) ? input.edges : []).slice(0, 20000)) {
      const edge = object(candidate), from = id(edge.from), to = id(edge.to);
      if (!from || !to || from === to || !nodeIds.has(from) || !nodeIds.has(to)) continue;
      const key = JSON.stringify([from, to].sort());
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      board.edges.push(edgeStyle(edge, from, to));
    }
    if (Array.isArray(input.knowledgeEdgeStyles)) {
      board.knowledgeEdgeStyles = [];
      const articleIds = new Set(board.nodes.filter(node => node.type === 'article').map(node => node.id)), styleKeys = new Set<string>();
      for (const candidate of input.knowledgeEdgeStyles.slice(0, 20000)) {
        const style = object(candidate), from = id(style.from), to = id(style.to);
        if (!from || !to || from === to || !articleIds.has(from) || !articleIds.has(to)) continue;
        const key = JSON.stringify([from, to].sort());
        if (styleKeys.has(key)) continue;
        styleKeys.add(key);
        const override: KnowledgeEdgeStyle = edgeStyle(style, from, to);
        if (typeof style.hidden === 'boolean') override.hidden = style.hidden;
        board.knowledgeEdgeStyles.push(override);
      }
    }
  }
  const current = id(source.currentBoard);
  if (current && layout.boards[current]) layout.currentBoard = current;
  if (source.audioPlayback && typeof source.audioPlayback === 'object' && !Array.isArray(source.audioPlayback)) {
    layout.audioPlayback = Object.create(null);
    const audioPaths = new Set(Object.values(layout.boards).flatMap(board => board.nodes.filter(node => node.type === 'audio' && node.filePath).map(node => node.filePath!)));
    const playback = object(source.audioPlayback);
    for (const key of Object.keys(playback).slice(0, 10000)) {
      const path = safeVaultPath(key), value = object(own(playback, key));
      if (!path || forbiddenKeys.has(key) || !audioPath(path) || !audioPaths.has(path) || !nonnegative(value.position, 1e8)) continue;
      const progress: AudioPlayback = { position: value.position };
      if (nonnegative(value.duration, 1e8)) progress.duration = value.duration;
      if (nonnegative(value.lastPlayedAt, 1e15)) progress.lastPlayedAt = value.lastPlayedAt;
      layout.audioPlayback![path] = progress;
    }
  }
  return layout;
}

/** Explicit alias for save boundaries: drops docs, API configuration, URLs, and unknown fields. */
export function stripEphemeral(raw: unknown): Layout { return sanitizeLayout(raw); }

/** Vault rename migration updates every reference while preserving layout, including hidden Boards. */
export function renameReferences(layout: Layout, oldPath: string, newPath: string): Layout {
  const result = sanitizeLayout(layout);
  if (!safeVaultPath(oldPath) || !safeVaultPath(newPath)) return result;
  const markdown = /\.md$/i.test(newPath), audio = audioPath(newPath), pdf = /\.pdf$/i.test(newPath);
  if (!markdown && !audio && !pdf) return result;
  if (markdown && result.visibleArticleHeadings) result.visibleArticleHeadings = [...new Set(result.visibleArticleHeadings.map(path => path === oldPath ? newPath : path))];
  for (const board of Object.values(result.boards)) {
    for (const node of board.nodes) {
      if (markdown && node.type === 'article' && node.doc === oldPath) node.doc = newPath;
      if (node.filePath === oldPath && (node.type === 'audio' && audio || node.type === 'pdf' && pdf)) node.filePath = newPath;
    }
    if (markdown && board.hiddenFolderDocs) board.hiddenFolderDocs = [...new Set(board.hiddenFolderDocs.map(path => path === oldPath ? newPath : path))];
  }
  if (audio && result.audioPlayback && Object.prototype.hasOwnProperty.call(result.audioPlayback, oldPath) && oldPath !== newPath) {
    result.audioPlayback[newPath] = result.audioPlayback[oldPath]; delete result.audioPlayback[oldPath];
  }
  return result;
}
