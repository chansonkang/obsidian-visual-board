import type { DataAdapter } from 'obsidian';

type Adapter = Pick<DataAdapter, 'exists' | 'read' | 'write' | 'rename' | 'remove' | 'mkdir'>;
type RecordValue = Record<string, unknown>;
export interface StoredBoardData extends RecordValue { layout: RecordValue; settings?: unknown; schema?: number }
export interface LayoutLoadResult {
  data: StoredBoardData | null;
  status: 'loaded' | 'new' | 'recovered' | 'blocked';
  source?: string;
  reason?: string;
}
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const key = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);

/** Validate before sanitizing: a damaged file must never silently become a new empty Board. */
export function validatedBoardData(raw: unknown): StoredBoardData | null {
  if (!record(raw)) return null;
  const envelope = Object.prototype.hasOwnProperty.call(raw, 'layout');
  if (envelope && raw.schema !== undefined && raw.schema !== 1) return null;
  const layout = envelope ? raw.layout : raw;
  if (!record(layout) || !record(layout.boards) || ![undefined, 1, 2].includes(layout.version as number | undefined)) return null;
  const entries = Object.entries(layout.boards);
  if (!entries.length || entries.length > 1024 || !key(layout.currentBoard) || !Object.prototype.hasOwnProperty.call(layout.boards, layout.currentBoard)) return null;
  for (const [id, board] of entries) {
    if (!key(id) || !record(board) || (board.id !== undefined && board.id !== id) || !Array.isArray(board.nodes) || board.nodes.length > 10000 || !Array.isArray(board.edges) || board.edges.length > 20000) return null;
    if (board.view !== undefined) {
      if (!record(board.view) || !finite(board.view.x) || !finite(board.view.y) || !finite(board.view.zoom) || board.view.zoom <= 0) return null;
    } else if (layout.version === 2) return null;
    const ids = new Set<string>();
    for (const node of board.nodes) {
      if (!record(node) || !key(node.id) || ids.has(node.id) || !['article', 'board', 'note', 'photo', 'pdf', 'audio'].includes(String(node.type)) || !finite(node.x) || !finite(node.y)) return null;
      ids.add(node.id);
      for (const dimension of ['w', 'h']) if (node[dimension] !== undefined && (!finite(node[dimension]) || (node[dimension] as number) <= 0)) return null;
      if (node.angle !== undefined && !finite(node.angle)) return null;
      if (node.type === 'article' && (typeof node.doc !== 'string' || !node.doc)) return null;
      if (node.type === 'board' && !key(node.board)) return null;
      if ((node.type === 'pdf' || node.type === 'audio') && (typeof node.filePath !== 'string' || !node.filePath)) return null;
    }
    for (const edge of board.edges) if (!record(edge) || !key(edge.from) || !key(edge.to) || (edge.width !== undefined && !finite(edge.width))) return null;
  }
  return envelope ? raw as StoredBoardData : { schema: 1, layout };
}

interface Backup { storageVersion: 1; sequence: number; savedAt: number; payload: StoredBoardData }
/** Browsing and playback still save to primary, but must not evict arrangement history. */
function arrangementSignature(layout: RecordValue): string {
  const { currentBoard: _current, audioPlayback: _audio, showKnowledge: _knowledge, showSpace: _space, ...arrangement } = layout;
  if (record(layout.boards)) arrangement.boards = Object.fromEntries(Object.entries(layout.boards).map(([id, board]) => {
    if (!record(board)) return [id, board];
    const { view: _view, ...content } = board;
    return [id, content];
  }));
  return JSON.stringify(arrangement);
}
export class LayoutStorage {
  private loaded = false;
  private blocked = false;
  private known: StoredBoardData | null = null;
  private sequence = 0;
  private chain: Promise<void> = Promise.resolve();
  readonly primary: string;
  private backupDir: string;
  private mirrorPath?: string;
  constructor(private adapter: Adapter, private dir: string, private slots = 10, backupDir?: string) {
    for (const path of [dir, backupDir ?? dir]) if (!path || path.split('/').some(part => !part || part === '.' || part === '..') || path.startsWith('/') || path.includes('\\')) throw Error('Invalid plugin storage directory.');
    this.slots = Math.max(2, Math.min(20, Math.floor(slots)));
    this.primary = `${dir}/data.json`;
    this.backupDir = backupDir ?? dir;
    if (backupDir !== undefined) this.mirrorPath = `${backupDir}/layout-latest.json`;
  }
  private slot(index: number, dir = this.backupDir) { return `${dir}/layout-backup-${String(index).padStart(2, '0')}.json`; }
  private async ensureDirectory(path: string) {
    let parent = '';
    for (const part of path.split('/')) {
      parent = parent ? parent + '/' + part : part;
      if (!await this.adapter.exists(parent)) await this.adapter.mkdir(parent);
    }
  }
  private async readValid(path: string): Promise<StoredBoardData | null> {
    return validatedBoardData(JSON.parse(await this.adapter.read(path)));
  }
  async load(fallbackLoadData?: () => Promise<unknown>): Promise<LayoutLoadResult> {
    if (this.loaded) throw Error('Layout storage has already been loaded.');
    let data: StoredBoardData | null = null, primaryExists = false, trouble = false;
    try { primaryExists = await this.adapter.exists(this.primary); if (primaryExists) { data = await this.readValid(this.primary); if (!data) trouble = true; } } catch { trouble = true; }
    const backups: { data: StoredBoardData; path: string; sequence: number }[] = [];
    // The previous file covers a Windows-safe rename interrupted between its two moves.
    try { const path = this.primary + '.previous'; if (await this.adapter.exists(path)) { const value = await this.readValid(path); if (value) backups.push({ data: value, path, sequence: Number.MAX_SAFE_INTEGER }); else trouble = true; } } catch { trouble = true; }
    const backupPaths = [...new Set([this.backupDir, this.dir])].flatMap(dir => Array.from({ length: this.slots }, (_, index) => ({ path: this.slot(index, dir), priority: 0 })));
    if (this.mirrorPath) backupPaths.unshift({ path: this.mirrorPath, priority: Number.MAX_SAFE_INTEGER - 1 }, { path: this.mirrorPath + '.previous', priority: Number.MAX_SAFE_INTEGER - 2 });
    for (const { path, priority } of backupPaths) {
      try {
        if (!await this.adapter.exists(path)) continue;
        const raw: unknown = JSON.parse(await this.adapter.read(path));
        if (!record(raw) || raw.storageVersion !== 1 || !Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 1) { trouble = true; continue; }
        const value = validatedBoardData(raw.payload);
        if (!value) { trouble = true; continue; }
        this.sequence = Math.max(this.sequence, raw.sequence as number);
        backups.push({ data: value, path, sequence: priority || raw.sequence as number });
      } catch { trouble = true; }
    }
    let result: LayoutLoadResult;
    if (data) result = { data, status: 'loaded', source: this.primary };
    else if (backups.length) {
      backups.sort((a, b) => b.sequence - a.sequence);
      data = backups[0].data;
      result = { data, status: 'recovered', source: backups[0].path, reason: primaryExists ? 'invalid-primary' : 'missing-primary' };
    } else {
      if (!trouble && !primaryExists && fallbackLoadData) {
        try { const fallback = await fallbackLoadData(); if (fallback != null) { data = validatedBoardData(fallback); if (!data) trouble = true; } } catch { trouble = true; }
      }
      result = data ? { data, status: 'loaded', source: 'legacy' } : trouble || primaryExists ? { data: null, status: 'blocked', reason: 'no-valid-layout' } : { data: null, status: 'new' };
    }
    // Keep an independent known-good snapshot; callers may freely mutate their loaded layout.
    this.known = data ? JSON.parse(JSON.stringify(data)) : null;
    this.loaded = true; this.blocked = result.status === 'blocked';
    return result;
  }
  write(payload: unknown): Promise<void> {
    const data = validatedBoardData(payload);
    if (!this.loaded || this.blocked) return Promise.reject(Error('Layout storage is unavailable; existing files have been preserved.'));
    if (!data) return Promise.reject(Error('Invalid Board layout; existing files have been preserved.'));
    const serialized = JSON.stringify(data);
    this.chain = this.chain.catch(() => {}).then(() => this.commit(serialized));
    return this.chain;
  }
  private async commit(serialized: string) {
    const next = JSON.parse(serialized) as StoredBoardData;
    if (this.known && JSON.stringify(this.known) === serialized) {
      // A recovered backup may equal memory while the primary is still missing or damaged.
      let unchanged = false;
      try { unchanged = await this.adapter.exists(this.primary) && await this.adapter.read(this.primary) === serialized; } catch { /* Restore below. */ }
      if (unchanged) { await this.mirror(next, serialized); return; }
    }
    await this.ensureDirectory(this.dir);
    await this.ensureDirectory(this.backupDir);
    const pending = this.primary + '.pending';
    await this.adapter.write(pending, serialized);
    if (await this.adapter.read(pending) !== serialized || !await this.readValid(pending)) throw Error('Board layout write verification failed.');
    if (!this.known || arrangementSignature(this.known.layout) !== arrangementSignature(next.layout) || this.sequence === 0) {
      const sequence = this.sequence + 1;
      const backup: Backup = { storageVersion: 1, sequence, savedAt: Date.now(), payload: this.known || next };
      const path = this.slot((sequence - 1) % this.slots), text = JSON.stringify(backup);
      await this.adapter.write(path + '.pending', text);
      if (await this.adapter.read(path + '.pending') !== text) throw Error('Board backup verification failed.');
      await this.replace(path + '.pending', path, text);
      this.sequence = sequence;
    }
    await this.replace(pending, this.primary, serialized);
    this.known = next;
    await this.mirror(next, serialized);
  }
  private async mirror(payload: StoredBoardData, serialized: string) {
    if (!this.mirrorPath) return;
    await this.ensureDirectory(this.backupDir);
    try {
      const raw = JSON.parse(await this.adapter.read(this.mirrorPath));
      if (raw.storageVersion === 1 && validatedBoardData(raw.payload) && JSON.stringify(raw.payload) === serialized) return;
    } catch { /* Missing or damaged mirrors are replaced only after primary commit. */ }
    const text = JSON.stringify({ storageVersion: 1, sequence: Math.max(1, this.sequence), savedAt: Date.now(), payload } satisfies Backup);
    await this.adapter.write(this.mirrorPath + '.pending', text);
    if (await this.adapter.read(this.mirrorPath + '.pending') !== text) throw Error('Board backup verification failed.');
    await this.replace(this.mirrorPath + '.pending', this.mirrorPath, text);
  }
  private async replace(pending: string, target: string, expected: string) {
    try { await this.adapter.rename(pending, target); }
    catch (firstError) {
      // Some adapters replace atomically; others reject an existing Windows destination.
      try { if (await this.adapter.read(target) === expected) return; } catch { /* Not committed. */ }
      if (!await this.adapter.exists(pending) || !await this.adapter.exists(target)) throw firstError;
      const previous = target + '.previous';
      if (await this.adapter.exists(previous)) await this.adapter.remove(previous);
      await this.adapter.rename(target, previous);
      try { await this.adapter.rename(pending, target); }
      catch (error) {
        try { if (!await this.adapter.exists(target)) await this.adapter.rename(previous, target); } catch { /* Retain previous + verified backup for the next load. */ }
        throw error;
      }
      if (await this.adapter.read(target) !== expected) {
        // Never remove the previous file when the new primary cannot be verified.
        throw Error('Board layout replacement verification failed.');
      }
      await this.adapter.remove(previous).catch(() => {});
    }
    if (await this.adapter.read(target) !== expected) throw Error('Board layout replacement verification failed.');
  }
}
