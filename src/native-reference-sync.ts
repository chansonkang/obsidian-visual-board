import type { App } from 'obsidian';
import { Layout, safeVaultPath, sanitizeLayout } from './model';
import { migrateFolderPaths } from './folder-layout';

export type NativeReferenceChange = { revision: number; type: 'rename'; path: string; newPath: string; folder: boolean } | { revision: number; type: 'delete'; path: string; folder: boolean; removedNodes?: { board: string; node: string }[]; onlyRemovedNodes?: boolean };
const matches = (value: string | undefined, path: string, folder: boolean) => !!value && (value === path || folder && value.startsWith(path + '/'));
const title = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

/** Native changes apply to every reference, without changing surviving geometry or cameras. */
export function applyNativeReferenceChange(layout: Layout, change: NativeReferenceChange): boolean {
  let changed = false;
  const { path, folder } = change;
  if (!safeVaultPath(path)) return false;
  if (change.type === 'rename') {
    if (!safeVaultPath(change.newPath) || change.newPath === path) return false;
    const migrate = (value: string) => matches(value, path, folder) ? change.newPath + value.slice(path.length) : value;
    if (folder) changed = migrateFolderPaths(layout, path, change.newPath) || changed;
    for (const board of Object.values(layout.boards)) {
      if (board.iconPath) { const next = migrate(board.iconPath); if (next !== board.iconPath) { board.iconPath = next; changed = true; } }
      for (const node of board.nodes) {
        for (const key of ['doc', 'imagePath', 'filePath'] as const) {
          const before = node[key]; if (!before) continue;
          const next = migrate(before);
          if (next !== before) { node[key] = next; if (key === 'filePath' || key === 'imagePath') node.title = title(next); changed = true; }
        }
      }
      if (board.hiddenFolderDocs) { const next = board.hiddenFolderDocs.map(migrate); if (next.some((p, i) => p !== board.hiddenFolderDocs![i])) { board.hiddenFolderDocs = [...new Set(next)]; changed = true; } }
    }
    if (layout.visibleArticleHeadings) layout.visibleArticleHeadings = [...new Set(layout.visibleArticleHeadings.map(migrate))];
    if (layout.audioPlayback) for (const key of Object.keys(layout.audioPlayback)) { const next = migrate(key); if (next !== key) { layout.audioPlayback[next] = layout.audioPlayback[key]; delete layout.audioPlayback[key]; changed = true; } }
  } else {
    const missingBoards = new Set(Object.values(layout.boards).filter(b => matches(b.folderPath, path, folder)).map(b => b.id));
    for (const board of Object.values(layout.boards)) {
      const before = board.nodes.length;
      const removed = change.onlyRemovedNodes ? new Set((change.removedNodes || []).filter(n => n.board === board.id).map(n => n.node)) : undefined;
      board.nodes = board.nodes.filter(node => removed ? !removed.has(node.id) : !matches(node.doc, path, folder) && !matches(node.imagePath, path, folder) && !matches(node.filePath, path, folder) && !(node.board && missingBoards.has(node.board)));
      if (board.nodes.length !== before) changed = true;
      const ids = new Set(board.nodes.map(n => n.id));
      const edges = board.edges.filter(e => ids.has(e.from) && ids.has(e.to));
      if (edges.length !== board.edges.length) { board.edges = edges; changed = true; }
      if (board.knowledgeEdgeStyles) { const styles = board.knowledgeEdgeStyles.filter(e => ids.has(e.from) && ids.has(e.to)); if (styles.length !== board.knowledgeEdgeStyles.length) { board.knowledgeEdgeStyles = styles; changed = true; } }
      if (!change.onlyRemovedNodes && board.iconPath && matches(board.iconPath, path, folder)) { delete board.iconPath; board.iconStatus = board.iconMode === 'ai' ? 'pending' : 'default'; changed = true; }
      if (!change.onlyRemovedNodes && missingBoards.has(board.id) && !board.folderMissing) { board.folderMissing = true; changed = true; }
    }
    if (!change.onlyRemovedNodes && layout.visibleArticleHeadings) layout.visibleArticleHeadings = layout.visibleArticleHeadings.filter(p => !matches(p, path, folder));
    if (!change.onlyRemovedNodes && layout.audioPlayback) for (const key of Object.keys(layout.audioPlayback)) if (matches(key, path, folder)) { delete layout.audioPlayback[key]; changed = true; }
  }
  return changed;
}

/** Replay only native operations newer than a frame's captured layout, so queued saves cannot revive old paths. */
export class NativeReferenceSync {
  revision = 0;
  private changes: NativeReferenceChange[] = [];
  record(layout: Layout, change: Omit<Extract<NativeReferenceChange, {type: 'rename'}>, 'revision'> | Omit<Extract<NativeReferenceChange, {type: 'delete'}>, 'revision'>): NativeReferenceChange {
    const event = { ...change, revision: ++this.revision } as NativeReferenceChange;
    if(event.type==='delete')event.removedNodes=Object.values(layout.boards).flatMap(board=>board.nodes.filter(node=>matches(node.doc,event.path,event.folder)||matches(node.imagePath,event.path,event.folder)||matches(node.filePath,event.path,event.folder)||!!node.board&&matches(layout.boards[node.board]?.folderPath,event.path,event.folder)).map(node=>({board:board.id,node:node.id})));
    this.changes.push(event); applyNativeReferenceChange(layout, event); return event;
  }
  accept(raw: unknown, revision: unknown, liveLayout?: Layout, exists?: (path: string) => boolean): Layout {
    const layout = sanitizeLayout(raw), from = typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 && revision <= this.revision ? revision : 0;
    for (const change of this.changes) if (change.revision > from) {
      if(change.type==='delete'&&exists?.(change.path)){
        const removedNodes=(change.removedNodes||[]).filter(entry=>!liveLayout?.boards[entry.board]?.nodes.some(node=>node.id===entry.node&&(matches(node.doc,change.path,change.folder)||matches(node.imagePath,change.path,change.folder)||matches(node.filePath,change.path,change.folder)||!!node.board&&matches(liveLayout.boards[node.board]?.folderPath,change.path,change.folder))));
        applyNativeReferenceChange(layout,{...change,removedNodes,onlyRemovedNodes:true});
      }else applyNativeReferenceChange(layout, change);
    }
    return layout;
  }
  /** Run only after Vault loading. Adapter fallback protects present but not-yet-indexed files. */
  async pruneMissing(layout: Layout, app: App): Promise<boolean> {
    const paths = new Map<string, boolean>();
    for (const board of Object.values(layout.boards)) {
      if (board.folderPath) paths.set(board.folderPath, true);
      if (board.iconPath) paths.set(board.iconPath, false);
      for (const node of board.nodes) for (const key of ['doc', 'imagePath', 'filePath'] as const) if (node[key]) paths.set(node[key]!, false);
    }
    let changed = false;
    for (const [path, folder] of paths) {
      if (app.vault.getAbstractFileByPath(path)) continue;
      // An unindexed existing resource or a failed disk check is never evidence of deletion.
      try { if (typeof app.vault.adapter.exists !== 'function' || await app.vault.adapter.exists(path)) continue; } catch { continue; }
      if (app.vault.getAbstractFileByPath(path)) continue;
      const event:Extract<NativeReferenceChange,{type:'delete'}> = { type: 'delete', path, folder, revision: this.revision + 1, removedNodes:Object.values(layout.boards).flatMap(board=>board.nodes.filter(node=>matches(node.doc,path,folder)||matches(node.imagePath,path,folder)||matches(node.filePath,path,folder)||!!node.board&&matches(layout.boards[node.board]?.folderPath,path,folder)).map(node=>({board:board.id,node:node.id}))) };
      if (applyNativeReferenceChange(layout, event)) { this.revision++; this.changes.push(event); changed = true; }
    }
    return changed;
  }
}
