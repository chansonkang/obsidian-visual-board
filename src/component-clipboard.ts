import type { App, TAbstractFile, TFile, TFolder } from 'obsidian';
import { Board, BoardNode, Layout, safeFolderPath, safeVaultPath, sanitizeLayout } from './model';
import { folderName } from './folders';
import type { RecycleService } from './recycle';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const under = (p: string, root: string) => p === root || p.startsWith(root + '/');
const leaf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const join = (a: string, b: string) => a ? a + '/' + b : b;
const folder = (v: TAbstractFile | null): v is TFolder => !!v && 'children' in v && !('extension' in v);
const file = (v: TAbstractFile | null): v is TFile => !!v && 'extension' in v;
const safe = (p: string) => !!safeVaultPath(p) && !p.split('/').some(v => v.startsWith('.'));
const PREFIX = 'vb-components:v1:', MAX_FILES = 2000, MAX_BYTES = 250 * 1024 * 1024;
interface Capture { layout: Layout; board: string; ids: string[]; expires: number }
interface Insertion { board: string; ids: string[]; trash?: string; undone: boolean }
export interface ComponentClipboardHooks { getLayout(): Layout; setLayout(layout: Layout): void; persist(): Promise<void>; revision?(): number }
export interface ComponentInsertionResult { layout: Layout; createdIds: string[]; createdPaths: string[]; undoToken: string }

/** Clipboard contains only a random local capability. All references are validated again before writes. */
export class ComponentClipboardService {
  private captures = new Map<string, Capture>();
  private insertions = new Map<string, Insertion>();
  private busy = false;
  private idle: Promise<void> = Promise.resolve();
  private finish?: () => void;
  constructor(private app: App, private hooks: ComponentClipboardHooks, private recycle: Pick<RecycleService, 'trash' | 'restore' | 'redo'>) {}
  get active() { return this.busy; }
  whenIdle() { return this.idle; }
  private start() { if (this.busy) throw Error('组件正在复制，请稍候。'); this.busy = true; this.idle = new Promise(resolve => { this.finish = resolve; }); }
  private end() { this.busy = false; this.finish?.(); this.finish = undefined; }
  copy(board: string, ids: string[]) {
    const layout = sanitizeLayout(this.hooks.getLayout()), source = layout.boards[board];
    if (!source || !Array.isArray(ids) || !ids.length || ids.length > 500 || new Set(ids).size !== ids.length || ids.some(id => !source.nodes.some(n => n.id === id))) throw Error('请选择有效的组件。');
    const token = crypto.randomUUID();
    this.captures.set(token, { layout, board, ids: [...ids], expires: Date.now() + 30 * 60 * 1000 });
    while (this.captures.size > 10) this.captures.delete(this.captures.keys().next().value!);
    return { clipboard: PREFIX + token };
  }
  rememberInsertion(board: string, ids: string[]) {
    if (!ids.length || ids.some(id => !this.hooks.getLayout().boards[board]?.nodes.some(n => n.id === id))) throw Error('无法记录已插入的组件。');
    const token = crypto.randomUUID(); this.insertions.set(token, { board, ids: [...ids], undone: false });
    while (this.insertions.size > 200) this.insertions.delete(this.insertions.keys().next().value!);
    return token;
  }
  async replay(token: string, direction: 'undo' | 'redo') {
    this.start(); try {
      const entry = this.insertions.get(token);
      if (!entry || !['undo', 'redo'].includes(direction) || entry.undone === (direction === 'undo')) throw Error('此组件操作当前不能撤销或重做。');
      const result = direction === 'redo' ? await this.recycle.restore(entry.trash!) : entry.trash ? await this.recycle.redo(entry.trash) : await this.recycle.trash(entry.board, entry.ids);
      entry.trash = result.trashToken; entry.undone = direction === 'undo';
      return { layout: result.layout, createdIds: direction === 'redo' ? [...entry.ids] : [], createdPaths: result.paths, undoToken: token };
    } finally { this.end(); }
  }
  async paste(clipboard: string, targetBoard: string, position: { x: number; y: number }): Promise<ComponentInsertionResult> {
    this.start();
    const created: TAbstractFile[] = [];
    const identities = new Map<TAbstractFile, string>();
    const before = sanitizeLayout(this.hooks.getLayout()), revision = this.hooks.revision?.();
    let committed = false, assigned: Layout | undefined;
    try {
      const capture = typeof clipboard === 'string' && clipboard.startsWith(PREFIX) ? this.captures.get(clipboard.slice(PREFIX.length)) : undefined;
      if (!capture || capture.expires < Date.now()) throw Error('组件剪贴板已过期，或来自其他知识库，请重新复制。');
      const target = before.boards[targetBoard];
      if (!target || target.folderMissing || safeFolderPath(target.folderPath) === null || !position || ![position.x, position.y].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6)) throw Error('请选择已关联本地文件夹的目标画板。');
      const targetFolder = target.folderPath!, targetEntry = targetFolder ? this.app.vault.getAbstractFileByPath(targetFolder) : null;
      if (targetFolder && !folder(targetEntry)) throw Error('目标文件夹已被移动或删除。');
      const source = capture.layout.boards[capture.board], selected = source.nodes.filter(n => capture.ids.includes(n.id));
      const next = clone(before), nextTarget = next.boards[targetBoard];
      const reserved = new Set(this.app.vault.getAllLoadedFiles().map(f => f.path.toLocaleLowerCase()));
      const plannedFolders = new Set<string>(), plans: { source: TFile; sourcePath: string; target: string }[] = [];
      const sourceFolders = new Map<string, TAbstractFile>();
      let bytes = 0;
      const reserve = (directory: string, name: string, isFolder: boolean) => {
        const dot = !isFolder ? name.lastIndexOf('.') : -1, stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
        for (let i = 1; i <= 10000; i++) { const p = join(directory, stem + (i === 1 ? ' copy' : ' copy ' + i) + ext); if (!reserved.has(p.toLocaleLowerCase()) && !this.app.vault.getAbstractFileByPath(p)) { reserved.add(p.toLocaleLowerCase()); return p; } }
        throw Error('副本名称冲突过多，请更换目标文件夹。');
      };
      const planFolder = (path: string) => { if (!safe(path)) throw Error('复制目录路径无效。'); plannedFolders.add(path); reserved.add(path.toLocaleLowerCase()); };
      const planFile = (sourcePath: string, destination: string) => {
        if (!safe(sourcePath) || !safe(destination)) throw Error('此组件的文件路径无效。');
        const entry = this.app.vault.getAbstractFileByPath(sourcePath);
        if (!file(entry)) throw Error('组件对应的文件已被移动或删除。');
        if (plans.length >= MAX_FILES) throw Error('一次复制的文件过多，请分批复制。');
        bytes += entry.stat.size; if (!Number.isFinite(bytes) || bytes > MAX_BYTES) throw Error('一次复制的文件超过 250 MB，请分批复制。');
        plans.push({ source: entry, sourcePath, target: destination }); reserved.add(destination.toLocaleLowerCase());
      };
      const safeName = (title: string) => { let name = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/^[. ]+|[. ]+$/g, '').trim().slice(0, 100) || 'Board'; try { return folderName(name); } catch { return 'Board'; } };
      const newId = () => 'copy-' + crypto.randomUUID();
      const createdNodes: BoardNode[] = [];
      const topMap = new Map<string, string>();
      const looseResources = new Map<string, string>();
      const copyResources = (node: BoardNode, directory: string, paths: Map<string, string>) => {
        const resource = node.doc || node.imagePath || node.filePath;
        if (!resource) return;
        const key = directory + '\0' + resource;
        let destination = paths.get(resource) || looseResources.get(key);
        if (!destination) { destination = reserve(directory, leaf(resource), false); planFile(resource, destination); looseResources.set(key, destination); }
        if (node.doc) node.doc = destination;
        if (node.imagePath) node.imagePath = destination;
        if (node.filePath) node.filePath = destination;
      };
      const copyBoard = (rootId: string) => {
        const originalRoot = capture.layout.boards[rootId];
        if (!originalRoot || rootId === 'home') throw Error('不能复制整个知识库根目录。');
        const descendants: Board[] = [originalRoot];
        for (let i = 0; i < descendants.length; i++) { if (descendants.length > 256) throw Error('一次复制的画板层级过多。'); for (const b of Object.values(capture.layout.boards)) if (b.parent === descendants[i].id) descendants.push(b); }
        if (descendants.reduce((sum, b) => sum + b.nodes.length, 0) > 5000 || Object.keys(next.boards).length + descendants.length > 1024) throw Error('一次复制的组件过多，请分批复制。');
        const boardIds = new Map(descendants.map(b => [b.id, newId()])), boardDirs = new Map<string, string>(), paths = new Map<string, string>();
        const folderMappings: { from: string; to: string }[] = [];
        for (const b of descendants) {
          const parentDir = b.id === rootId ? targetFolder : boardDirs.get(b.parent!)!;
          const mapping = b.folderPath && folderMappings.filter(m => under(b.folderPath!, m.from)).sort((a, z) => z.from.length - a.from.length)[0];
          let directory: string;
          if (mapping) directory = mapping.to + b.folderPath!.slice(mapping.from.length);
          else {
            directory = reserve(parentDir, safeName(b.title), true); planFolder(directory);
            if (b.folderPath !== undefined) {
              if (!b.folderPath || !safe(b.folderPath) || !folder(this.app.vault.getAbstractFileByPath(b.folderPath))) throw Error('画板对应的文件夹已被移动或删除。');
              const from = b.folderPath; sourceFolders.set(from, this.app.vault.getAbstractFileByPath(from)!); folderMappings.push({ from, to: directory }); paths.set(from, directory);
              for (const entry of this.app.vault.getAllLoadedFiles().filter(f => under(f.path, from) && f.path !== from).sort((a, z) => a.path.length - z.path.length)) {
                if (!safe(entry.path)) continue;
                const destination = directory + entry.path.slice(from.length); paths.set(entry.path, destination);
                if (folder(entry)) { sourceFolders.set(entry.path, entry); planFolder(destination); } else if (file(entry)) planFile(entry.path, destination);
              }
            }
          }
          boardDirs.set(b.id, directory);
        }
        for (const b of descendants) {
          const copied = clone(b), nodeIds = new Map(b.nodes.map(n => [n.id, newId()]));
          copied.id = boardIds.get(b.id)!; copied.parent = b.id === rootId ? targetBoard : boardIds.get(b.parent!)!;
          copied.folderPath = boardDirs.get(b.id)!; copied.folderMissing = false; copied.title = leaf(copied.folderPath);
          copied.nodes = b.nodes.map(original => { const node = clone(original); node.id = nodeIds.get(original.id)!;
            if (node.board) node.board = boardIds.get(node.board)!;
            else copyResources(node, copied.folderPath!, paths);
            if (node.type === 'board' || node.doc && node.doc.slice(0, Math.max(0, node.doc.lastIndexOf('/'))) === copied.folderPath) node.folderManaged = true;
            else delete node.folderManaged;
            return node;
          });
          copied.edges = b.edges.map(e => ({ ...e, from: nodeIds.get(e.from)!, to: nodeIds.get(e.to)! }));
          if (b.knowledgeEdgeStyles) copied.knowledgeEdgeStyles = b.knowledgeEdgeStyles.map(e => ({ ...e, from: nodeIds.get(e.from)!, to: nodeIds.get(e.to)! }));
          if (b.hiddenFolderBoards) copied.hiddenFolderBoards = b.hiddenFolderBoards.map(id => boardIds.get(id)).filter((id): id is string => !!id);
          if (b.hiddenFolderDocs) copied.hiddenFolderDocs = b.hiddenFolderDocs.map(p => paths.get(p)).filter((p): p is string => !!p);
          if (copied.iconPath && paths.has(copied.iconPath)) copied.iconPath = paths.get(copied.iconPath);
          next.boards[copied.id] = copied;
        }
        return boardIds.get(rootId)!;
      };
      const resourcePaths = new Map<string, string>();
      const minX = Math.min(...selected.map(n => n.x)), minY = Math.min(...selected.map(n => n.y));
      for (const original of selected) {
        const node = clone(original); node.id = newId(); topMap.set(original.id, node.id);
        node.x = Math.round(position.x / 20) * 20 + original.x - minX; node.y = Math.round(position.y / 20) * 20 + original.y - minY;
        if (node.board) node.board = copyBoard(node.board); else copyResources(node, targetFolder, resourcePaths);
        if (node.type === 'article' || node.type === 'board') node.folderManaged = true;
        createdNodes.push(node);
      }
      for (const {source: original, target: path} of plans) {
        if (capture.layout.audioPlayback?.[original.path]) (next.audioPlayback ||= {})[path] = clone(capture.layout.audioPlayback[original.path]);
        if (capture.layout.visibleArticleHeadings?.includes(original.path)) (next.visibleArticleHeadings ||= []).push(path);
      }
      nextTarget.nodes.push(...createdNodes);
      nextTarget.edges.push(...source.edges.filter(e => topMap.has(e.from) && topMap.has(e.to)).map(e => ({ ...e, from: topMap.get(e.from)!, to: topMap.get(e.to)! })));
      if (source.knowledgeEdgeStyles) (nextTarget.knowledgeEdgeStyles ||= []).push(...source.knowledgeEdgeStyles.filter(e => topMap.has(e.from) && topMap.has(e.to)).map(e => ({ ...e, from: topMap.get(e.from)!, to: topMap.get(e.to)! })));
      // Complete validation/preflight precedes any write. Vault.copy never overwrites an existing file.
      for (const p of [...plannedFolders, ...plans.map(p => p.target)]) if (this.app.vault.getAbstractFileByPath(p) || await this.app.vault.adapter.exists(p)) throw Error('副本目标被其他操作占用，请重新粘贴。');
      for (const path of [...plannedFolders].sort((a, b) => a.split('/').length - b.split('/').length)) { await this.app.vault.createFolder(path); const entry = this.app.vault.getAbstractFileByPath(path); if (!entry) throw Error('新建文件夹未能加入知识库。'); created.push(entry); }
      for (const plan of plans) {
        if (plan.source.path !== plan.sourcePath || this.app.vault.getAbstractFileByPath(plan.sourcePath) !== plan.source) throw Error('源文件在复制过程中已被移动或替换。');
        const entry = await this.app.vault.copy(plan.source, plan.target); created.push(entry); identities.set(entry, JSON.stringify(entry.stat));
      }
      const currentTarget = this.hooks.getLayout().boards[targetBoard];
      if (this.hooks.revision?.() !== revision || !currentTarget || currentTarget.folderMissing || currentTarget.folderPath !== targetFolder
        || targetFolder && (this.app.vault.getAbstractFileByPath(targetFolder) !== targetEntry || targetEntry?.path !== targetFolder)
        || [...sourceFolders].some(([path, entry]) => entry.path !== path || this.app.vault.getAbstractFileByPath(path) !== entry)
        || plans.some(plan => plan.source.path !== plan.sourcePath || this.app.vault.getAbstractFileByPath(plan.sourcePath) !== plan.source)) throw Error('复制期间本地文件或画板已改变，请重新复制粘贴。');
      assigned = sanitizeLayout(next); this.hooks.setLayout(assigned); await this.hooks.persist(); committed = true;
      const ids = createdNodes.map(n => n.id), undoToken = this.rememberInsertion(targetBoard, ids);
      return { layout: this.hooks.getLayout(), createdIds: ids, createdPaths: [...plannedFolders, ...plans.map(p => p.target)], undoToken };
    } catch (error) {
      if (!committed) {
        // Preflight/native events may already have updated the live layout. Never replace those updates.
        if (assigned && this.hooks.getLayout() === assigned && this.hooks.revision?.() === revision) this.hooks.setLayout(before);
        for (const entry of created.reverse()) {
          try { if (this.app.vault.getAbstractFileByPath(entry.path) !== entry) continue; if (file(entry) && identities.get(entry) === JSON.stringify(entry.stat) || folder(entry) && !entry.children.length) await this.app.vault.delete(entry, true); } catch { /* Preserve any concurrently changed copy for manual recovery. */ }
        }
      }
      throw error;
    } finally { this.end(); }
  }
}
