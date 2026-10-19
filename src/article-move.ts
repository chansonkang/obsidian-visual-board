import { BoardNode, Layout, safeFolderPath, safeVaultPath } from './model';
import { visibleNodePosition } from './node-placement';

/** Relocate the selected reference after a native move. Other Boards follow the rename event. */
export function relocateArticle(layout: Layout, sourceBoard: string, nodeId: string, targetBoard: string, newPath: string, capturedNode?: BoardNode): boolean {
  const getBoard = (id: string) => Object.prototype.hasOwnProperty.call(layout.boards, id) ? layout.boards[id] : undefined;
  const source = getBoard(sourceBoard), target = getBoard(targetBoard), path = safeVaultPath(newPath);
  if (!source || !target || target.folderMissing || !path || !/\.md$/i.test(path)) return false;
  const parent = path.slice(0, Math.max(0, path.lastIndexOf('/')));
  if (target.folderPath !== undefined && (safeFolderPath(target.folderPath) === null || target.folderPath !== parent)) return false;
  const node = source.nodes.find(n => n.id === nodeId) || capturedNode;
  if (!node || node.id !== nodeId || node.type !== 'article' || !safeVaultPath(node.doc) || !/\.md$/i.test(node.doc!) || ![node.x, node.y].every(Number.isFinite)) return false;
  if ([node.w, node.h].some(value => value !== undefined && (!Number.isFinite(value) || value <= 0))) return false;
  // A colliding manual identity must not be overwritten. Managed automatic copies can be replaced.
  if (target.nodes.some(n => n.id === nodeId && n !== node && !(n.type === 'article' && n.doc === path && n.folderManaged))) return false;
  const sameBoard = source === target;
  const duplicates = target.nodes.filter(n => n !== node && n.type === 'article' && n.doc === path && n.folderManaged);
  const hidden = target.hiddenFolderDocs?.includes(path) || false;
  const managed = target.folderPath !== undefined;
  const managedChanged = managed ? node.folderManaged !== true : node.folderManaged === true;
  if (sameBoard && source.nodes.includes(node) && node.doc === path && !duplicates.length && !hidden && !managedChanged) return false;
  const moving = { ...node, doc: path };
  if (managed) moving.folderManaged = true;
  else delete moving.folderManaged;
  const removed = new Set(duplicates);
  target.nodes = target.nodes.filter(n => n !== node && !removed.has(n));
  if (!sameBoard) {
    source.nodes = source.nodes.filter(n => n.id !== nodeId);
    source.edges = source.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
  }
  if (!sameBoard) {
    const rects = target.nodes.map(n => ({ x: n.x, y: n.y, w: n.w || (n.type === 'board' ? 300 : 480), h: n.h || (n.type === 'board' ? 303 : 640) }));
    Object.assign(moving, visibleNodePosition(rects, target.view, { w: 1200, h: 650 }, { w: moving.w || 480, h: moving.h || 640 }));
  }
  target.nodes.push(moving);
  if (target.hiddenFolderDocs) target.hiddenFolderDocs = target.hiddenFolderDocs.filter(value => value !== path);
  const ids = new Set(target.nodes.map(n => n.id));
  target.edges = target.edges.filter(e => ids.has(e.from) && ids.has(e.to));
  return true;
}
