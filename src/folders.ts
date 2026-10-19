import type { App, TFolder } from 'obsidian';

/** Keep the requested directory name; unlike note titles, .md is not stripped. */
export function folderName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error('文件夹名称不能为空。');
  if (name.startsWith('.')) throw new Error('不能使用隐藏文件夹或上级目录名称。');
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) throw new Error('文件夹名称不能包含路径分隔符或非法字符。');
  if (/[. ]$/.test(name)) throw new Error('文件夹名称不能以点或空格结尾。');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) throw new Error('此文件夹名称是系统保留名称。');
  if (name.length > 180 || new TextEncoder().encode(name).length > 240) throw new Error('文件夹名称过长，请缩短后重试。');
  return name;
}

function folderPath(value: string, allowRoot = false): string {
  const path = value.trim();
  if (!path) { if (allowRoot) return ''; throw new Error('不能移动或重命名知识库根目录。'); }
  if (path.startsWith('/') || path.endsWith('/') || path.includes('\\')) throw new Error('请选择知识库内的文件夹路径。');
  for (const part of path.split('/')) if (folderName(part) !== part) throw new Error('文件夹路径不规范，请重新选择。');
  return path;
}

function isFolder(value: unknown): value is TFolder {
  return !!value && typeof value === 'object' && 'children' in value && Array.isArray((value as TFolder).children) && !('extension' in value);
}

/** Directory operations only through Obsidian; no filesystem discovery or writes. */
export class FolderBridge {
  constructor(private readonly app: App) {}

  private parent(path: string): TFolder {
    const normalized = folderPath(path, true);
    const folder = normalized ? this.app.vault.getAbstractFileByPath(normalized) : this.app.vault.getRoot();
    if (!isFolder(folder)) throw new Error('目标父文件夹不存在，请先创建或重新选择。');
    return folder;
  }

  private existing(path: string): TFolder {
    const normalized = folderPath(path);
    const folder = this.app.vault.getAbstractFileByPath(normalized);
    if (!isFolder(folder)) throw new Error('此文件夹已被移动或删除。');
    return folder;
  }

  list(): string[] {
    return this.app.vault.getAllLoadedFiles()
      .filter(isFolder)
      .map(folder => folder.path)
      .filter(path => path && path !== '/' && path.split('/').every(part => part && !part.startsWith('.')))
      .sort((a, b) => a.localeCompare(b));
  }

  async create(parentPath: string, title: string): Promise<string> {
    const name = folderName(title), directory = folderPath(parentPath, true);
    this.parent(directory);
    const target = directory ? `${directory}/${name}` : name;
    const present = this.app.vault.getAbstractFileByPath(target);
    if (present) {
      if (isFolder(present)) return present.path;
      throw new Error('同名文件已存在，无法创建文件夹。');
    }
    try {
      await this.app.vault.createFolder(target);
    } catch (error) {
      // A concurrently created folder is safe to associate; a file is never replaced.
      const concurrent = this.app.vault.getAbstractFileByPath(target);
      if (isFolder(concurrent)) return concurrent.path;
      if (concurrent) throw new Error('同名文件已存在，无法创建文件夹。');
      throw error;
    }
    return this.existing(target).path;
  }

  async rename(path: string, title: string): Promise<string> {
    const name = folderName(title), folder = this.existing(path);
    const directory = folder.path.slice(0, folder.path.lastIndexOf('/') + 1);
    const target = `${directory}${name}`;
    if (target === folder.path) return folder.path;
    if (this.app.vault.getAbstractFileByPath(target)) throw new Error('此目录中已有同名文件或文件夹，请更换名称。');
    await this.app.fileManager.renameFile(folder, target);
    return this.existing(target).path;
  }

  async move(path: string, parentPath: string): Promise<string> {
    const folder = this.existing(path), directory = folderPath(parentPath, true);
    if (directory === folder.path || directory.startsWith(folder.path + '/')) throw new Error('不能将文件夹移到自己或自己的子文件夹。');
    this.parent(directory);
    const name = folder.path.split('/').pop()!;
    const target = directory ? `${directory}/${name}` : name;
    if (target === folder.path) return folder.path;
    if (this.app.vault.getAbstractFileByPath(target)) throw new Error('目标目录中已有同名文件或文件夹，无法覆盖。');
    await this.app.fileManager.renameFile(folder, target);
    return this.existing(target).path;
  }
}
