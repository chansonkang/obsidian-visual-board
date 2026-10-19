import type { App, TAbstractFile } from 'obsidian';
import { AudioPlayback, Board, BoardNode, BoardEdge, KnowledgeEdgeStyle, Layout, sanitizeLayout, safeVaultPath, safeFolderPath } from './model';

const ROOT = '.trash/visual-board', LIMIT = 20 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const below = (path: string, root: string) => path === root || path.startsWith(root + '/');
const safe = (path: unknown): path is string => typeof path === 'string' && !!safeVaultPath(path) && !path.split('/').some(part => part.startsWith('.'));
type Identity = { type: 'file' | 'folder'; size: number; mtime: number; ctime: number };
interface Item { original: string; stored: string; identity: Identity }
interface Capture { board: string; index: number; previous?: string; next?: string; node: BoardNode }
interface Relations { board: string; edges: BoardEdge[]; knowledge: KnowledgeEdgeStyle[]; endpoints: { id: string; type: BoardNode['type'] }[] }
interface SavedBoard { id: string; board: Board; virtual: boolean }
interface Manifest { schema: 1; token: string; createdAt: number; label: string; status: 'trashed' | 'restored'; selection: { board: string; ids: string[] }; items: Item[]; captures: Capture[]; relations: Relations[]; boards: SavedBoard[]; playback?: Record<string, AudioPlayback>; dependencies?: { id: string; parent: string | null }[] }
export interface RecycleHooks { getLayout(): Layout; setLayout(layout: Layout): void; persist(): Promise<void> }
export interface RecycleResult { trashToken: string; layout: Layout; summary: string; paths: string[]; restoredPaths?: string[] }

/** Moves original bytes, not copies. Manifests contain only sanitized references and local sticky text. */
export class RecycleService {
  private cache = new Map<string, { token: string; label: string; count: number; createdAt: number; status: string }>();
  private busy = false;
  private idle: Promise<void> = Promise.resolve();
  private finish?: () => void;
  private eventMoves: { from: string; to: string }[] = [];
  constructor(private app: App, private hooks: RecycleHooks) {}
  get active() { return this.busy; }
  whenIdle() { return this.idle; }
  ownsEvent(path: string, next?: string) { if (!this.busy) return false; if (below(path, ROOT) && next === undefined) return true; return this.eventMoves.some(pair => next === undefined ? below(path, pair.from) || below(path, pair.to) : below(path, pair.from) && next === pair.to + path.slice(pair.from.length)); }
  private adapter() { return this.app.vault.adapter as App['vault']['adapter'] & { reconcileInternalFile?(path: string): Promise<void> }; }
  private start() {
    if (this.busy) throw Error('回收站正在处理文件，请稍候。');
    // Desktop adapters reconcile hidden-path removal and restored regular-path creation.
    if (typeof this.adapter().reconcileInternalFile !== 'function') throw Error('当前桌面文件适配器不支持安全恢复索引，文件尚未移动。');
    this.busy = true; this.idle = new Promise(resolve => { this.finish = resolve; });
  }
  private end() { this.busy = false; this.eventMoves = []; this.finish?.(); this.finish = undefined; }
  private path(token: string) { if (!UUID.test(token)) throw Error('回收记录无效。'); return `${ROOT}/${token}/manifest.json`; }
  private async mkdir(path: string) {
    if (!path) return;
    let current = '';
    for (const part of path.split('/')) { current = current ? current + '/' + part : part; if (!await this.adapter().exists(current)) { try { await this.adapter().mkdir(current); } catch { if (!await this.adapter().exists(current)) throw Error('无法创建回收或恢复目录。'); } } }
  }
  private async identity(path: string): Promise<Identity> {
    const stat = await this.adapter().stat(path);
    if (!stat || !['file', 'folder'].includes(stat.type)) throw Error('文件或文件夹已被移动或删除。');
    return { type: stat.type, size: stat.size, mtime: stat.mtime, ctime: stat.ctime };
  }
  private same(a: Identity, b: Identity) { return a.type === b.type && a.ctime === b.ctime && (a.type === 'folder' || a.size === b.size && a.mtime === b.mtime); }
  private remember(m: Manifest) { this.cache.delete(m.token); this.cache.set(m.token, { token: m.token, label: m.label, count: m.selection.ids.length, createdAt: m.createdAt, status: m.status }); while (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!); }
  private async write(m: Manifest) { const text = JSON.stringify(m); if (new TextEncoder().encode(text).length > LIMIT) throw Error('回收布局记录过大，文件尚未移动。'); await this.mkdir(`${ROOT}/${m.token}`); await this.adapter().write(this.path(m.token), text); this.remember(m); }
  private validate(raw: unknown, token: string): Manifest {
    const m = raw as Manifest;
    if (!m || m.schema !== 1 || m.token !== token || !UUID.test(token) || !['trashed', 'restored'].includes(m.status) || !Array.isArray(m.items) || !Array.isArray(m.captures) || !Array.isArray(m.boards) || !Array.isArray(m.relations) || !m.selection || !Array.isArray(m.selection.ids) || m.items.length > 10000 || m.captures.length > 10000 || m.boards.length > 1024) throw Error('回收记录格式无效。');
    const storedRoots = new Set<string>();
    for (const item of m.items) {
      if (!safe(item.original) || item.stored !== `${ROOT}/${token}/files/${item.original}` || storedRoots.has(item.original) || !item.identity || !['file', 'folder'].includes(item.identity.type) || ![item.identity.size, item.identity.mtime, item.identity.ctime].every(n => typeof n === 'number' && Number.isFinite(n))) throw Error('回收路径记录无效。');
      storedRoots.add(item.original);
      if (!m.captures.some(c => [c.node?.doc, c.node?.imagePath, c.node?.filePath].some(p => p === item.original)) && !m.boards.some(b => b.board?.folderPath === item.original)) throw Error('回收文件缺少对应组件记录。');
    }
    // Re-sanitize persisted local metadata. Never trust injected bodies, settings or provider keys.
    const boardMap: Record<string, Board> = Object.create(null);
    for (const b of m.boards) boardMap[b.id] = { ...clone(b.board), nodes: [], edges: [], knowledgeEdgeStyles: [] };
    for (const c of m.captures) (boardMap[c.board] ||= { id: c.board, title: '', parent: c.board === 'home' ? null : 'home', theme: 'product', view: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], iconMode: 'default' }).nodes.push(c.node);
    for (const dep of m.dependencies || []) if (!boardMap[dep.id]) boardMap[dep.id] = { id: dep.id, title: '', parent: dep.parent, theme: 'product', view: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], iconMode: 'default' };
    const cleaned = sanitizeLayout({ version: 2, currentBoard: 'home', boards: boardMap });
    for (const c of m.captures) { const node = cleaned.boards[c.board]?.nodes.find(n => n.id === c.node?.id); if (!node || !Number.isInteger(c.index) || c.index < 0) throw Error('回收组件记录无效。'); c.node = node; }
    const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(id) && !['__proto__', 'prototype', 'constructor'].includes(id);
    for (const b of m.boards) { if (!cleaned.boards[b.id] || typeof b.virtual !== 'boolean' || b.board.parent !== null && !validId(b.board.parent)) throw Error('回收画板记录无效。'); const parent = b.board.parent, hadKnowledge = b.board.knowledgeEdgeStyles !== undefined; b.board = { ...cleaned.boards[b.id], nodes: [], edges: [] }; if (!hadKnowledge) delete b.board.knowledgeEdgeStyles; b.board.parent = parent; }
    for (const r of m.relations) {
      if (!cleaned.boards[r.board] || !Array.isArray(r.endpoints)) throw Error('回收关系记录无效。');
      const ids = new Map(r.endpoints.filter(e => validId(e.id) && ['article', 'board', 'note', 'photo', 'pdf', 'audio'].includes(e.type)).map(e => [e.id, e.type]));
      const cleanEdges = (edges: BoardEdge[], knowledge: boolean) => { const seen = new Set<string>(), result: KnowledgeEdgeStyle[] = [];
        for (const e of Array.isArray(edges) ? edges.slice(0, 20000) : []) { if (!validId(e.from) || !validId(e.to) || e.from === e.to || !ids.has(e.from) || !ids.has(e.to) || knowledge && (ids.get(e.from) !== 'article' || ids.get(e.to) !== 'article')) continue; const key = JSON.stringify([e.from, e.to].sort()); if (seen.has(key)) continue; seen.add(key); const edge: KnowledgeEdgeStyle = { from: e.from, to: e.to }; if (e.lineStyle === 'solid' || e.lineStyle === 'dashed') edge.lineStyle = e.lineStyle; if (typeof e.width === 'number' && Number.isFinite(e.width)) edge.width = Math.round(Math.max(1, Math.min(8, e.width)) * 2) / 2; if (knowledge && typeof (e as KnowledgeEdgeStyle).hidden === 'boolean') edge.hidden = (e as KnowledgeEdgeStyle).hidden; result.push(edge); } return result; };
      r.edges = cleanEdges(r.edges, false); r.knowledge = cleanEdges(r.knowledge, true);
    }
    if (m.playback) m.playback = sanitizeLayout({ ...cleaned, audioPlayback: m.playback }).audioPlayback;
    if (!m.selection.ids.length || !m.selection.ids.every(id => m.captures.some(c => c.board === m.selection.board && c.node.id === id))) throw Error('回收选择记录无效。');
    return m;
  }
  private async load(token: string) {
    this.path(token);
    const stat = await this.adapter().stat(this.path(token)); if (!stat || stat.size > LIMIT) throw Error('找不到可恢复的回收记录。');
    const m = this.validate(JSON.parse(await this.adapter().read(this.path(token))), token); this.remember(m); return clone(m);
  }
  async list() {
    if (!await this.adapter().exists(ROOT)) return [];
    const dirs = (await this.adapter().list(ROOT)).folders.filter(path => UUID.test(path.split('/').pop() || ''));
    const rows: { token: string; label: string; count: number; createdAt: number; status: string }[] = [];
    for (const dir of dirs) { try { const m = await this.load(dir.split('/').pop()!); rows.push({ token: m.token, label: m.label, count: m.selection.ids.length, createdAt: m.createdAt, status: m.status }); } catch {} }
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
  }
  private capture(layout: Layout, selected: { board: string; ids: string[] }, items: Item[]) {
    const selectedBoard = layout.boards[selected.board]; if (!selectedBoard || !selected.ids.length || selected.ids.length > 10000) throw Error('请选择有效的组件。');
    const selectedNodes = selected.ids.map(id => selectedBoard.nodes.find(n => n.id === id)); if (selectedNodes.some(n => !n)) throw Error('所选组件已发生变化，请重新选择。');
    const virtualBoards = new Set<string>();
    for (const node of selectedNodes) if (node?.board && layout.boards[node.board]?.folderPath === undefined) virtualBoards.add(node.board);
    let changed = true; while (changed) { changed = false; for (const b of Object.values(layout.boards)) if (b.parent && virtualBoards.has(b.parent) && !virtualBoards.has(b.id)) { virtualBoards.add(b.id); changed = true; } }
    const affectedBoards = new Set(Object.values(layout.boards).filter(b => b.folderPath && items.some(item => item.identity.type === 'folder' && below(b.folderPath!, item.original))).map(b => b.id));
    const ownedBoards = new Set([...virtualBoards, ...affectedBoards]); changed = true; while (changed) { changed = false; for (const b of Object.values(layout.boards)) if (b.parent && ownedBoards.has(b.parent) && !ownedBoards.has(b.id)) { ownedBoards.add(b.id); changed = true; } }
    const selectedIds = new Set(selected.ids), captures: Capture[] = [], relations: Relations[] = [];
    for (const b of Object.values(layout.boards)) {
      const removed = new Set<string>();
      b.nodes.forEach((n, index) => {
        const resource = n.doc || n.imagePath || n.filePath;
        if (b.id === selected.board && selectedIds.has(n.id) || ownedBoards.has(b.id) || n.board && ownedBoards.has(n.board) || resource && items.some(item => below(resource, item.original))) { removed.add(n.id); captures.push({ board: b.id, index, previous: b.nodes[index - 1]?.id, next: b.nodes[index + 1]?.id, node: clone(n) }); }
      });
      if (removed.size) relations.push({ board: b.id, edges: b.edges.filter(e => removed.has(e.from) || removed.has(e.to)).map(clone), knowledge: (b.knowledgeEdgeStyles || []).filter(e => removed.has(e.from) || removed.has(e.to)).map(clone), endpoints: b.nodes.map(n => ({ id: n.id, type: n.type })) });
    }
    const audio = new Set(captures.filter(c => c.node.type === 'audio').map(c => c.node.filePath)), playback: Record<string, AudioPlayback> = Object.create(null); for (const [path, progress] of Object.entries(layout.audioPlayback || {})) if (audio.has(path)) playback[path] = clone(progress);
    const dependencies = [...new Set(captures.flatMap(c => c.node.board ? [c.node.board] : []))].filter(id => !ownedBoards.has(id)).map(id => ({ id, parent: layout.boards[id].parent }));
    return { captures, relations, playback, dependencies, boards: [...ownedBoards].map(id => ({ id, board: clone(layout.boards[id]), virtual: layout.boards[id].folderPath === undefined })) };
  }
  private remove(layout: Layout, m: Manifest) {
    for (const b of Object.values(layout.boards)) { const ids = new Set(m.captures.filter(c => c.board === b.id).map(c => c.node.id)); b.nodes = b.nodes.filter(n => !ids.has(n.id)); b.edges = b.edges.filter(e => !ids.has(e.from) && !ids.has(e.to)); if (b.knowledgeEdgeStyles) b.knowledgeEdgeStyles = b.knowledgeEdgeStyles.filter(e => !ids.has(e.from) && !ids.has(e.to)); }
    for (const saved of m.boards) delete layout.boards[saved.id];
    if (!layout.boards[layout.currentBoard]) layout.currentBoard = 'home';
  }
  private restored(layout: Layout, m: Manifest) {
    for (const saved of m.boards) if (saved.board.parent && !layout.boards[saved.board.parent] && !m.boards.some(b => b.id === saved.board.parent)) throw Error('原父画板不存在，请先恢复父画板。');
    for (const saved of m.boards) {
      if (saved.virtual) { const current = layout.boards[saved.id]; if (current && !m.captures.filter(c => c.board === saved.id).every(c => current.nodes.some(n => n.id === c.node.id && n.type === c.node.type && n.doc === c.node.doc && n.imagePath === c.node.imagePath && n.filePath === c.node.filePath && n.board === c.node.board))) throw Error('原画板身份已被占用，不能覆盖当前画板。'); if (!current) layout.boards[saved.id] = { ...clone(saved.board), nodes: [], edges: [], ...(saved.board.knowledgeEdgeStyles ? { knowledgeEdgeStyles: [] } : {}) }; }
      else { const b = layout.boards[saved.id]; if (b && b.folderPath !== saved.board.folderPath) throw Error('原画板关联目录已改变，不能覆盖当前画板。'); if (!b) layout.boards[saved.id] = { ...clone(saved.board), nodes: [], edges: [], ...(saved.board.knowledgeEdgeStyles ? { knowledgeEdgeStyles: [] } : {}) }; if (saved.board.folderMissing === undefined) delete layout.boards[saved.id].folderMissing; else layout.boards[saved.id].folderMissing = saved.board.folderMissing; }
    }
    for (const c of m.captures.slice().sort((a, b) => a.index - b.index)) {
      const b = layout.boards[c.board]; if (!b) throw Error('原所在画板已删除，不能恢复组件布局。');
      const current = b.nodes.find(n => n.id === c.node.id); if (current) { if (current.type !== c.node.type || current.doc !== c.node.doc || current.imagePath !== c.node.imagePath || current.filePath !== c.node.filePath || current.board !== c.node.board) throw Error('组件身份已被占用，不能覆盖。'); continue; }
      if (c.node.doc) b.nodes = b.nodes.filter(n => !(n.folderManaged && n.type === 'article' && n.doc === c.node.doc));
      if (c.node.board) b.nodes = b.nodes.filter(n => !(n.folderManaged && n.board === c.node.board));
      const previous = b.nodes.findIndex(n => n.id === c.previous), next = b.nodes.findIndex(n => n.id === c.next);
      const index = previous >= 0 ? previous + 1 : next >= 0 ? next : Math.min(c.index, b.nodes.length);
      b.nodes.splice(index, 0, clone(c.node));
      if (c.node.doc && b.hiddenFolderDocs) b.hiddenFolderDocs = b.hiddenFolderDocs.filter(p => p !== c.node.doc);
      if (c.node.board && b.hiddenFolderBoards) b.hiddenFolderBoards = b.hiddenFolderBoards.filter(id => id !== c.node.board);
    }
    for (const r of m.relations) {
      const b = layout.boards[r.board]; if (!b) continue; const ids = new Set(b.nodes.map(n => n.id)), pair = (a: BoardEdge, z: BoardEdge) => a.from === z.from && a.to === z.to || a.from === z.to && a.to === z.from;
      for (const e of r.edges) if (ids.has(e.from) && ids.has(e.to) && !b.edges.some(other => pair(e, other))) b.edges.push(clone(e));
      for (const e of r.knowledge) if (ids.has(e.from) && ids.has(e.to) && !(b.knowledgeEdgeStyles || []).some(other => pair(e, other))) (b.knowledgeEdgeStyles ||= []).push(clone(e));
    }
    for (const [path, progress] of Object.entries(m.playback || {})) if (!layout.audioPlayback?.[path]) (layout.audioPlayback ||= Object.create(null))[path] = clone(progress);
    return layout;
  }
  private async move(from: string, to: string) {
    if (await this.adapter().exists(to)) throw Error('目标已有同名文件或文件夹，不能覆盖。');
    await this.mkdir(to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '');
    const file: TAbstractFile | null = this.app.vault.getAbstractFileByPath(from);
    const pair = { from, to }; this.eventMoves.push(pair);
    try { if (file) await this.app.vault.rename(file, to); else await this.adapter().rename(from, to);
      await this.adapter().reconcileInternalFile!(from); await this.adapter().reconcileInternalFile!(to);
    } finally { this.eventMoves = this.eventMoves.filter(e => e !== pair); }
  }
  private async runMoves(pairs: { from: string; to: string }[]) {
    const done: { from: string; to: string }[] = [];
    try { for (const pair of pairs) { try { await this.move(pair.from, pair.to); done.push(pair); } catch (error) { if (await this.adapter().exists(pair.to) && !await this.adapter().exists(pair.from)) done.push(pair); throw error; } } }
    catch (error) { for (const pair of done.reverse()) { try { if (!await this.adapter().exists(pair.from)) await this.move(pair.to, pair.from); } catch {} } throw error; }
  }
  async trash(board: string, ids: string[]): Promise<RecycleResult> {
    this.start(); try {
      const layout = sanitizeLayout(this.hooks.getLayout()), selected = layout.boards[board]; if (!selected || !Array.isArray(ids)) throw Error('请选择组件。');
      ids = [...new Set(ids)]; const nodes = ids.map(id => selected.nodes.find(n => n.id === id)); if (nodes.some(n => !n) || !ids.length) throw Error('所选组件已不存在。');
      const token = crypto.randomUUID(), roots: string[] = [], expected = new Map<string, 'file' | 'folder'>();
      for (const n of nodes) { const path = n!.doc || n!.imagePath || n!.filePath || (n!.board ? layout.boards[n!.board]?.folderPath : undefined); if (path === '') throw Error('不能回收整个知识库根目录。'); if (path !== undefined) { if (!safe(path) || safeFolderPath(path) === null) throw Error('此组件的文件路径无效。'); const type = n!.board ? 'folder' : 'file'; if (expected.has(path) && expected.get(path) !== type) throw Error('组件对应的文件类型已改变。'); expected.set(path, type); roots.push(path); } }
      const minimal = [...new Set(roots)].filter(p => !roots.some(other => other !== p && below(p, other)));
      const items: Item[] = []; for (const original of minimal) { const identity = await this.identity(original); if (identity.type !== expected.get(original)) throw Error('组件对应的文件类型已改变，文件尚未移动。'); items.push({ original, stored: `${ROOT}/${token}/files/${original}`, identity }); }
      const selectedRefs = { board, ids }, captured = this.capture(layout, selectedRefs, items);
      const m: Manifest = { schema: 1, token, createdAt: Date.now(), label: nodes.map(n => n!.title || n!.doc?.split('/').pop() || n!.imagePath?.split('/').pop() || n!.filePath?.split('/').pop() || layout.boards[n!.board || '']?.title || '组件').join('、').slice(0, 300), status: 'trashed', selection: selectedRefs, items, ...captured };
      await this.write(m); await this.runMoves(items.map(i => ({ from: i.original, to: i.stored })));
      const current = sanitizeLayout(this.hooks.getLayout()); this.remove(current, m); this.hooks.setLayout(current); await this.hooks.persist();
      return { trashToken: token, layout: current, summary: `已将 ${ids.length} 个组件移入本地回收站`, paths: minimal };
    } finally { this.end(); }
  }
  async restore(token: string): Promise<RecycleResult> {
    this.start(); try {
      const m = await this.load(token); if (m.status !== 'trashed') throw Error('此记录已恢复，不能重复恢复。');
      const current = sanitizeLayout(this.hooks.getLayout()); this.restored(clone(current), m); // Validate identities before moving files.
      const pairs: { from: string; to: string }[] = [];
      for (const item of m.items) { const stored = await this.adapter().exists(item.stored), original = await this.adapter().exists(item.original); if (stored && original) throw Error('原目录已有同名文件或文件夹，不能覆盖。'); if (!stored && (!original || !this.same(await this.identity(item.original), item.identity))) throw Error('回收文件已被删除或替换，无法恢复。'); if (stored) pairs.push({ from: item.stored, to: item.original }); }
      await this.runMoves(pairs);
      for (const c of m.captures) for (const path of [c.node.doc, c.node.imagePath, c.node.filePath]) if (path && await this.adapter().exists(path)) await this.adapter().reconcileInternalFile!(path);
      const layout = this.restored(sanitizeLayout(this.hooks.getLayout()), m); this.hooks.setLayout(layout); await this.hooks.persist(); m.status = 'restored'; await this.write(m);
      return { trashToken: token, layout, summary: '已恢复文件和原有排列', paths: m.items.map(i => i.original), restoredPaths: m.items.map(i => i.original) };
    } finally { this.end(); }
  }
  async redo(token: string): Promise<RecycleResult> {
    this.start(); try {
      const m = await this.load(token); if (m.status !== 'restored') throw Error('此记录当前不能重做删除。');
      const layout = sanitizeLayout(this.hooks.getLayout());
      for (const item of m.items) { if (await this.adapter().exists(item.stored) || !await this.adapter().exists(item.original) || !this.same(await this.identity(item.original), item.identity)) throw Error('原文件已被替换或移动，不能重做删除。'); }
      for (const c of m.captures) { const n = layout.boards[c.board]?.nodes.find(n => n.id === c.node.id); if (!n || n.type !== c.node.type || n.doc !== c.node.doc || n.imagePath !== c.node.imagePath || n.filePath !== c.node.filePath || n.board !== c.node.board) throw Error('原组件状态已改变，不能重做删除。'); }
      const captured = this.capture(layout, m.selection, m.items); Object.assign(m, captured); m.status = 'trashed'; await this.write(m);
      await this.runMoves(m.items.map(i => ({ from: i.original, to: i.stored })));
      const current = sanitizeLayout(this.hooks.getLayout()); this.remove(current, m); this.hooks.setLayout(current); await this.hooks.persist();
      return { trashToken: token, layout: current, summary: '已再次移入本地回收站', paths: m.items.map(i => i.original) };
    } finally { this.end(); }
  }
}
