import type { App, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { safeVaultPath } from './model';

type ItemElement = { classList: { add(value: string): void; remove(value: string): void } };
interface ExplorerItem { selfEl?: ItemElement }
interface ExplorerView {
  containerEl?: { isShown?(): boolean };
  revealInFolder?(file: TAbstractFile): void;
  fileItems?: Record<string, ExplorerItem>;
  tree?: { clearSelectedDoms?(): void; selectItem?(item: ExplorerItem): void };
}
type FrameApp = App & { nextFrame?: (callback: () => void) => void };
class ExplorerError extends Error {}
const revealRequests = new WeakMap<App, object>();

function selectableElement(item: ExplorerItem | undefined): item is ExplorerItem & { selfEl: ItemElement } {
  return typeof item?.selfEl?.classList?.add === 'function' && typeof item.selfEl.classList.remove === 'function';
}
function select(view: ExplorerView, item: ExplorerItem) {
  // Verified in installed Obsidian 1.13.7 app.js: selection belongs to view.tree.
  if (typeof view.tree?.clearSelectedDoms === 'function' && typeof view.tree.selectItem === 'function') {
    view.tree.clearSelectedDoms(); view.tree.selectItem(item); return;
  }
  // Older/internal API compatibility: touch classes only on a detected fileItems structure.
  if (!selectableElement(item)) throw new ExplorerError('已定位文件，但当前文件列表版本无法高亮条目，请更新 Obsidian。');
  for (const candidate of Object.values(view.fileItems || {})) if (selectableElement(candidate)) candidate.selfEl.classList.remove('is-selected');
  item.selfEl.classList.add('is-selected');
}

/** Reveal/highlight an existing Vault entry without opening it or relocating sidebars. */
export async function revealVaultEntry(app: App, path: string): Promise<void> {
  const normalized = safeVaultPath(path);
  if (!normalized || normalized.split('/').some(part => part.startsWith('.'))) throw new Error('请选择知识库内的普通文章或文件夹。');
  const file = app.vault.getAbstractFileByPath(normalized);
  if (!file) throw new Error('此文章或文件夹已移动或删除，请刷新画板后重试。');
  const request = {};
  revealRequests.set(app, request);
  const leaves = app.workspace.getLeavesOfType('file-explorer');
  if (!leaves.length) throw new Error('文件列表尚未打开，请先启用 Obsidian「文件列表」核心插件并打开侧栏。');
  const leaf = leaves.find(candidate => {
    const container = (candidate.view as unknown as ExplorerView).containerEl;
    return typeof container?.isShown === 'function' && container.isShown();
  }) || leaves[0];
  let restoreLeaf: WorkspaceLeaf | null = app.workspace.activeLeaf;
  const nextFrame = (callback: () => void) => {
    const frameApp = app as FrameApp;
    if (typeof frameApp.nextFrame === 'function') frameApp.nextFrame(callback);
    else if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(callback);
    else setTimeout(callback, 0);
  };
  const restore = () => {
    // Never steal focus back after the user has already selected a different leaf.
    if (restoreLeaf && restoreLeaf !== leaf && app.workspace.activeLeaf === leaf) app.workspace.setActiveLeaf(restoreLeaf, { focus: false });
  };
  try {
    // Public API loads deferred explorer views and expands the leaf's existing sidedock.
    await app.workspace.revealLeaf(leaf);
    if (app.workspace.activeLeaf && app.workspace.activeLeaf !== leaf) restoreLeaf = app.workspace.activeLeaf;
    const view = leaf.view as unknown as ExplorerView;
    if (typeof view.revealInFolder !== 'function') throw new ExplorerError('当前文件列表不支持定位，请更新 Obsidian 或启用原生文件列表。');
    const assertCurrentFile = () => {
      if (file.path !== normalized || app.vault.getAbstractFileByPath(normalized) !== file) throw new ExplorerError('此文章或文件夹已移动或删除，请刷新画板后重试。');
      if (!app.workspace.getLeavesOfType('file-explorer').includes(leaf) || leaf.view !== view) throw new ExplorerError('文件列表已关闭或切换，请重新打开侧栏后重试。');
    };
    const waitingLeaf = app.workspace.activeLeaf;
    let item: ExplorerItem | undefined;
    // Vault.create resolves before the explorer's create-event row is necessarily
    // rendered. Wait briefly for that existing view, without creating a new leaf
    // or focusing its tree. A newer selection/navigation cancels this request.
    for (let attempt = 0; attempt < 20; attempt++) {
      if (revealRequests.get(app) !== request || app.workspace.activeLeaf !== waitingLeaf) return;
      assertCurrentFile();
      const items = view.fileItems;
      const candidate = items && typeof items === 'object' && Object.prototype.hasOwnProperty.call(items, normalized) ? items[normalized] : undefined;
      if (candidate && typeof candidate === 'object') { item = candidate; break; }
      if (attempt < 19) await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
    if (!item) throw new ExplorerError('文件列表中暂未加载此条目，请检查是否被过滤或等待索引完成。');
    // Native revealInFolder queues explorer activation, not DOM focus: in 1.13.7
    // setActiveLeaf(leaf) calls focusLeaf only when an explicit focus argument is true.
    // Do not refocus an iframe here; its existing editor selection must remain intact.
    // Observe a user's later tab choice before that native callback, then restore only
    // if the callback actually left this explorer active. App.nextFrame is FIFO in 1.13.7.
    nextFrame(() => { const current = app.workspace.activeLeaf; if (current && current !== leaf) restoreLeaf = current; });
    view.revealInFolder(file);
    await new Promise<void>((resolve, reject) => nextFrame(() => {
      try {
        restore();
        if (revealRequests.get(app) === request) { assertCurrentFile(); select(view, item); }
        resolve();
      } catch (error) { reject(error); }
    }));
  } catch (error) {
    restore();
    throw error instanceof ExplorerError ? error : new Error('文件列表定位失败，请重新打开文件列表侧栏后重试。');
  }
}
