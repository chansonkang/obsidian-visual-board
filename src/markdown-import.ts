import type { App, TFile } from 'obsidian';
import { articleCardSize } from './article-sizing';
import { findFolderBoard } from './folder-layout';
import { Board, BoardNode, Layout, safeFolderPath, safeVaultPath } from './model';
import { visibleNodePosition } from './node-placement';

export const MARKDOWN_IMPORT_LIMIT = 10 * 1024 * 1024;
export const MARKDOWN_IMPORT_BATCH_LIMIT = 40 * 1024 * 1024;
export const MARKDOWN_IMPORT_COUNT_LIMIT = 32;
export interface MarkdownImportInput { name: string; bytes?: number[]; text?: string }
export interface MarkdownImportPlacement { x: number; y: number }
export interface MarkdownImportResult {
  /** Every successfully saved file, including a file whose Board changed during its write. */
  importedPaths: string[];
  imported: Array<{ index: number; name: string; path: string; nodeId?: string }>;
  failures: Array<{ index: number; name: string; error: string; path?: string }>;
  nodes: BoardNode[];
}

const own = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);
const snap = (value: number) => Math.max(-1e6, Math.min(1e6, Math.round(value / 20) * 20));
const isFolder = (file: unknown, path: string): boolean => !!file && typeof file === 'object' && (file as {path?: unknown}).path === path && Array.isArray((file as {children?: unknown}).children);
class MarkdownImportError extends Error {}
function failure(message: string): never { throw new MarkdownImportError(message); }
function decode(input: unknown): { name: string; stem: string; bytes: Uint8Array; body: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('请选择本地 Markdown 文件。');
  const value = input as Record<string, unknown>, name = value.name;
  if (typeof name !== 'string' || !/\.(md|markdown)$/i.test(name)) return failure('只支持 .md 或 .markdown 文件。');
  const stem = name.replace(/\.(md|markdown)$/i, '');
  if (!stem || stem !== stem.trim() || stem.startsWith('.') || /[\\/:*?"<>|\x00-\x1f\x7f]/.test(stem) || /[. ]$/.test(stem) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(stem) || new TextEncoder().encode(name).length > 220) return failure('文件名无效，不能包含目录路径、隐藏名称或系统保留名称。');
  let bytes: Uint8Array;
  if (Array.isArray(value.bytes) && value.text === undefined) {
    if (value.bytes.length > MARKDOWN_IMPORT_LIMIT) return failure('Markdown 文件超过 10 MiB，请选择较小的文件。');
    if (!value.bytes.every(byte => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255)) return failure('Markdown 文件字节无效。');
    bytes = Uint8Array.from(value.bytes);
  } else if (typeof value.text === 'string' && value.bytes === undefined) {
    if (value.text.length > MARKDOWN_IMPORT_LIMIT) return failure('Markdown 文件超过 10 MiB，请选择较小的文件。');
    // Reject malformed JS strings rather than silently replacing lone surrogates.
    bytes = new TextEncoder().encode(value.text);
    if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== value.text) return failure('Markdown 文件必须使用有效的 UTF-8 编码。');
  } else return failure('Markdown 文件字节无效。');
  if (bytes.length > MARKDOWN_IMPORT_LIMIT) return failure('Markdown 文件超过 10 MiB，请选择较小的文件。');
  let body: string;
  try { body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return failure('Markdown 文件必须使用有效的 UTF-8 编码。'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body)) return failure('文件包含二进制内容，不能作为 Markdown 导入。');
  return { name, stem, bytes, body };
}

function target(app: Pick<App, 'vault'>, layout: Layout, boardId: string, expectedFolder?: string): Board {
  const board = typeof boardId === 'string' && own(layout.boards, boardId) ? layout.boards[boardId] : undefined;
  const folder = board ? safeFolderPath(board.folderPath) : null;
  if (!board || board.folderMissing || folder === null || expectedFolder !== undefined && folder !== expectedFolder || findFolderBoard(layout, folder)?.id !== boardId) return failure('目标画板未关联有效的本地文件夹，或文件夹位置已改变，请重新定位。');
  if (folder !== '' && !isFolder(app.vault.getAbstractFileByPath(folder), folder)) return failure('目标文件夹不存在，或这个路径不是文件夹。');
  return board;
}

function position(board: Board, size: {w: number; h: number}, drop?: MarkdownImportPlacement): MarkdownImportPlacement {
  const rects = board.nodes.map(node => ({ x: node.x, y: node.y, w: node.w || (node.type === 'board' ? 300 : 480), h: node.h || (node.type === 'board' ? 303 : 640) }));
  const origin = drop && Number.isFinite(drop.x) && Number.isFinite(drop.y) ? { x: snap(drop.x), y: snap(drop.y) } : visibleNodePosition(rects, board.view, { w: 1200, h: 650 }, size);
  const free = (x: number, y: number) => rects.every(rect => x + size.w + 20 <= rect.x || x >= rect.x + rect.w + 20 || y + size.h + 20 <= rect.y || y >= rect.y + rect.h + 20);
  const stepX = Math.ceil((size.w + 40) / 20) * 20, stepY = Math.ceil((size.h + 40) / 20) * 20;
  // Nearby empty cells preserve the drop anchor without moving the Board camera.
  for (let ring = 0; ring < Math.ceil(Math.sqrt(rects.length + 1)) + 12; ring++) {
    for (let row = -ring; row <= ring; row++) for (let column = -ring; column <= ring; column++) {
      if (Math.max(Math.abs(row), Math.abs(column)) !== ring) continue;
      const x = snap(origin.x + column * stepX), y = snap(origin.y + row * stepY);
      if (free(x, y)) return { x, y };
    }
  }
  return origin;
}

/**
 * Copy external Markdown into the current mapped Vault directory; originals are never moved.
 * Batch semantics are partial success: failures never remove files already imported. A file
 * saved while its target Board changes remains listed in importedPaths and has a path-bearing
 * failure, so the caller can honestly report that it was saved without a positioned card.
 * Persist/sync/snapshot remain the caller's responsibility. Use a layout getter when the
 * host can replace its layout during native create/rename events.
 */
export async function importMarkdownFiles(app: Pick<App, 'vault'>, layoutOrGetter: Layout | (() => Layout), targetBoard: string, files: unknown, placement?: MarkdownImportPlacement): Promise<MarkdownImportResult> {
  const layout = typeof layoutOrGetter === 'function' ? layoutOrGetter : () => layoutOrGetter;
  if (!Array.isArray(files) || !files.length || files.length > MARKDOWN_IMPORT_COUNT_LIMIT) return failure('每次请选择 1 至 32 个 Markdown 文件。');
  const folder = target(app, layout(), targetBoard).folderPath!;
  const result: MarkdownImportResult = { importedPaths: [], imported: [], failures: [], nodes: [] };
  let total = 0;
  for (let index = 0; index < files.length; index++) {
    const raw = files[index], rawName = typeof raw?.name === 'string' ? raw.name.slice(0, 240) : '';
    let saved: { path: string; name: string } | undefined;
    try {
      const input = decode(raw);
      if (total + input.bytes.length > MARKDOWN_IMPORT_BATCH_LIMIT) failure('本次 Markdown 导入总量超过 40 MiB，请分批导入。');
      total += input.bytes.length;
      let created: TFile | undefined;
      for (let suffix = 1; suffix <= 10000; suffix++) {
        target(app, layout(), targetBoard, folder);
        const name = `${input.stem}${suffix === 1 ? '' : ` ${suffix}`}.md`, path = `${folder ? folder + '/' : ''}${name}`;
        if (!safeVaultPath(path)) failure('Markdown 保存路径无效。');
        if (app.vault.getAbstractFileByPath(path) || await app.vault.adapter.exists(path)) continue;
        target(app, layout(), targetBoard, folder);
        try { created = await app.vault.createBinary(path, input.bytes.slice().buffer as ArrayBuffer); break; }
        catch {
          // A concurrent creator owns its file; allocate another name, never overwrite it.
          if (app.vault.getAbstractFileByPath(path) || await app.vault.adapter.exists(path)) continue;
          failure('Markdown 文件无法保存，请检查本地文件夹权限或磁盘空间。');
        }
      }
      if (!created) failure('同名 Markdown 文件过多，请更换名称。');
      if (!safeVaultPath(created.path) || !/\.md$/i.test(created.path)) failure('文件保存后的位置无法确认，请检查本地文件夹。');
      saved = { path: created.path, name: input.name };
      const entry: MarkdownImportResult['imported'][number] = { index, name: input.name, path: created.path };
      result.importedPaths.push(created.path); result.imported.push(entry);
      const current = target(app, layout(), targetBoard, folder);
      const parent = created.path.slice(0, Math.max(0, created.path.lastIndexOf('/')));
      if (parent !== folder || app.vault.getAbstractFileByPath(created.path) !== created) failure('文件已保存，但位置同时发生变化，请在目录中重新定位。');
      const size = articleCardSize({ body: input.body, title: input.stem });
      const existing = current.nodes.find(node => node.type === 'article' && node.doc === created!.path);
      const node: BoardNode = existing || { id: 'card-' + crypto.randomUUID(), type: 'article', doc: created.path, x: 0, y: 0 };
      const peers = existing ? { ...current, nodes: current.nodes.filter(candidate => candidate !== existing) } : current;
      Object.assign(node, size, position(peers, size, placement), { folderManaged: true });
      if (!existing) current.nodes.push(node);
      if (current.hiddenFolderDocs) current.hiddenFolderDocs = current.hiddenFolderDocs.filter(path => path !== created!.path);
      entry.nodeId = node.id; result.nodes.push(node);
    } catch (error) {
      const message = error instanceof MarkdownImportError ? error.message : 'Markdown 文件导入失败，请检查本地文件夹。';
      result.failures.push({ index, name: rawName, error: message, ...(saved ? { path: saved.path } : {}) });
    }
  }
  return result;
}
