import type { App, Plugin, TFile } from 'obsidian';
import { safeFolderPath, safeVaultPath } from './model';

export interface VaultDoc {
  id: string;
  path: string;
  title: string;
  body: string;
  mtime: number;
  outgoing: string[];
  backlinks: string[];
  missing?: boolean;
}

export type UpdateResult =
  | { ok: true; doc: VaultDoc }
  | { ok: false; reason: 'conflict'; current: string }
  | { ok: false; reason: 'missing' };

/** Normalize vault-relative paths, rejecting traversal and absolute file paths. */
export function vaultPath(value: string): string {
  const path = value.replace(/\\/g, '/').trim();
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path)) throw new Error('请选择仓库内的相对路径。');
  const parts = path.split('/').filter(part => part && part !== '.');
  if (parts.some(part => part === '..' || /[\u0000-\u001f]/.test(part))) throw new Error('路径不能包含上级目录或控制字符。');
  if (!parts.length) throw new Error('路径不能为空。');
  return parts.join('/');
}

/** A cross-platform filename; slash characters in a title never create folders. */
export function noteName(value: string): string {
  const name = value.replace(/\.md$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 180).trim();
  const safe = name || '未命名文章';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe) ? `${safe} 文章` : safe;
}

/** Renames must reject unsafe input rather than silently changing the requested title. */
export function renameTitle(value: string): string {
  const name = value.trim().replace(/\.md$/i, '');
  if (!name.trim()) throw new Error('文章标题不能为空。');
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) throw new Error('标题不能包含路径分隔符或非法文件名字符。');
  if (name === '.' || name === '..' || /[. ]$/.test(name)) throw new Error('标题不能是上级目录，也不能以点或空格结尾。');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) throw new Error('此标题是系统保留的文件名，请更换名称。');
  if (name.length > 180 || new TextEncoder().encode(name).length > 240) throw new Error('标题过长，请缩短后重试。');
  return name;
}

function markdownFile(file: unknown): file is TFile {
  return !!file && typeof file === 'object' && 'extension' in file && String((file as TFile).extension).toLowerCase() === 'md';
}

class BodyConflict extends Error {
  constructor(public readonly current: string) { super('The note changed while the editor was open.'); }
}

export class VaultBridge {
  constructor(private readonly app: App, _plugin: Plugin) {}

  private file(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(vaultPath(path));
    return markdownFile(file) ? file : null;
  }

  private links(path: string): Pick<VaultDoc, 'outgoing' | 'backlinks'> {
    // Obsidian resolves wikilinks, aliases, Markdown links, and heading fragments.
    // Use full resolved paths, never basename matching (two notes may share a name).
    const resolved = this.app.metadataCache.resolvedLinks;
    const outgoing = Object.keys(resolved[path] || {}).filter(target => /\.md$/i.test(target)).sort();
    const backlinks = Object.keys(resolved).filter(source => /\.md$/i.test(source) && !!resolved[source]?.[path]).sort();
    return { outgoing, backlinks };
  }

  private doc(file: TFile, body: string): VaultDoc {
    return { id: file.path, path: file.path, title: file.basename, body, mtime: file.stat.mtime, ...this.links(file.path) };
  }

  async snapshot(referencedPaths: string[] = []): Promise<Record<string, VaultDoc>> {
    const docs: Record<string, VaultDoc> = Object.create(null);
    const files = this.app.vault.getMarkdownFiles();
    const outgoing: Record<string, string[]> = Object.create(null);
    const backlinks: Record<string, string[]> = Object.create(null);
    for (const [source, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      if (!/\.md$/i.test(source)) continue;
      outgoing[source] = Object.keys(targets).filter(target => /\.md$/i.test(target)).sort();
      for (const target of outgoing[source]) (backlinks[target] ||= []).push(source);
    }
    for (const sources of Object.values(backlinks)) sources.sort();
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(12, files.length) }, async () => {
      while (cursor < files.length) {
        const file = files[cursor++];
        try {
          docs[file.path] = { id: file.path, path: file.path, title: file.basename, body: await this.app.vault.cachedRead(file), mtime: file.stat.mtime, outgoing: outgoing[file.path] || [], backlinks: backlinks[file.path] || [] };
        } catch (error) {
          // A concurrently deleted file is represented below if a board references it.
          if (this.app.vault.getAbstractFileByPath(file.path)) throw error;
        }
      }
    }));
    for (const reference of referencedPaths) {
      let path: string;
      try { path = vaultPath(reference); } catch { continue; }
      if (!docs[path]) {
        docs[path] = { id: path, path, title: path.split('/').pop()!.replace(/\.md$/i, ''), body: '', mtime: 0, ...this.links(path), missing: true };
      }
    }
    return docs;
  }

  async read(path: string): Promise<VaultDoc | null> {
    const file = this.file(path);
    return file ? this.doc(file, await this.app.vault.read(file)) : null;
  }

  async rename(path: string, title: string): Promise<VaultDoc> {
    const name = renameTitle(title);
    const file = this.file(path);
    if (!file) throw new Error('这篇文章已被移动或删除。');
    if (name === file.basename) return this.doc(file, await this.app.vault.read(file));
    const directory = file.path.slice(0, file.path.lastIndexOf('/') + 1);
    const target = `${directory}${name}.md`;
    if (this.app.vault.getAbstractFileByPath(target)) throw new Error('此目录中已有同名文件，请更换标题。');
    // FileManager preserves Obsidian's native link-update behavior and rejects
    // concurrent destination collisions; never overwrite or modify note content here.
    await this.app.fileManager.renameFile(file, target);
    const renamed = await this.read(target);
    if (!renamed) throw new Error('文章在改名后再次被移动，请重新定位原文。');
    return renamed;
  }

  /** Move the original Markdown file, retaining native link updates and its complete body. */
  async move(path: string, parentFolderPath: string): Promise<VaultDoc> {
    const source = safeVaultPath(path), parent = safeFolderPath(parentFolderPath);
    if (!source || source.split('/').some(part => part.startsWith('.'))) throw new Error('请选择知识库内的文章，不能移动隐藏目录或上级目录中的文件。');
    if (parent === null) throw new Error('目标文件夹路径无效，不能包含隐藏目录或上级目录。');
    if (parent !== '') {
      const folder = this.app.vault.getAbstractFileByPath(parent);
      if (!folder || !('children' in folder) || !Array.isArray(folder.children)) throw new Error('目标文件夹不存在，或这个路径不是文件夹。');
    }
    const file = this.file(source);
    if (!file) throw new Error('这篇文章已被移动或删除。');
    const target = parent ? `${parent}/${file.name}` : file.name;
    if (target === file.path) return this.doc(file, await this.app.vault.read(file));
    if (this.app.vault.getAbstractFileByPath(target)) throw new Error('目标文件夹已有同名文件，不能覆盖原文。');
    await this.app.fileManager.renameFile(file, target);
    const moved = await this.read(target);
    if (!moved) throw new Error('文章在移动后再次被移动，请重新定位原文。');
    return moved;
  }

  async create(title: string, folder = ''): Promise<VaultDoc> {
    const directory = folder.trim() ? vaultPath(folder) : '';
    let parent = '';
    for (const part of directory.split('/').filter(Boolean)) {
      parent = parent ? `${parent}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(parent);
      if (existing && 'extension' in existing) throw new Error('文章保存目录与现有文件重名。');
      if (!existing) {
        try { await this.app.vault.createFolder(parent); }
        catch (error) { if (!this.app.vault.getAbstractFileByPath(parent)) throw error; }
      }
    }
    const name = noteName(title);
    for (let suffix = 1; suffix <= 10000; suffix++) {
      const path = `${directory ? `${directory}/` : ''}${name}${suffix === 1 ? '' : ` ${suffix}`}.md`;
      if (this.app.vault.getAbstractFileByPath(path)) continue;
      try {
        const file = await this.app.vault.create(path, `# ${name}\n\n`);
        return this.doc(file, await this.app.vault.read(file));
      } catch (error) {
        // Another plugin may create the same name between the check and create.
        if (!this.app.vault.getAbstractFileByPath(path)) throw error;
      }
    }
    throw new Error('同名文章过多，请更换名称。');
  }

  async update(path: string, body: string, expectedBody: string): Promise<UpdateResult> {
    const file = this.file(path);
    if (!file) return { ok: false, reason: 'missing' };
    try {
      // process reads and modifies atomically: it protects edits made in another pane.
      const committed = await this.app.vault.process(file, current => {
        if (current !== expectedBody) throw new BodyConflict(current);
        return body;
      });
      return { ok: true, doc: this.doc(file, committed) };
    } catch (error) {
      if (error instanceof BodyConflict) return { ok: false, reason: 'conflict', current: error.current };
      if (!this.file(path)) return { ok: false, reason: 'missing' };
      throw error;
    }
  }

  async open(path: string, line?: number, linktext?: string): Promise<void> {
    const file = this.file(path);
    if (!file) throw new Error('这篇文章已被移动或删除。');
    const cache = this.app.metadataCache.getFileCache(file);
    if (line === undefined && linktext?.includes('#')) {
      const fragment = linktext.slice(linktext.indexOf('#') + 1).replace(/\]\].*$/, '');
      if (fragment.startsWith('^')) line = cache?.blocks?.[fragment.slice(1)]?.position.start.line;
      else line = cache?.headings?.find(heading => heading.heading.toLowerCase() === fragment.toLowerCase())?.position.start.line;
    }
    const safeLine = line === undefined ? undefined : Math.max(0, Math.floor(line));
    // Keep the board tab available; reuse a note tab if it is already open.
    const existing = this.app.workspace.getLeavesOfType('markdown').find(leaf => (leaf.view as unknown as { file?: TFile }).file?.path === file.path);
    const leaf = existing || this.app.workspace.getLeaf('tab');
    await leaf.openFile(file, safeLine === undefined ? undefined : { eState: { line: safeLine } });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view as unknown as { editor?: { lineCount(): number; setCursor(pos: { line: number; ch: number }): void; scrollIntoView(range: { from: { line: number; ch: number }; to: { line: number; ch: number } }, center?: boolean): void } };
    if (safeLine !== undefined && view.editor) {
      const target = { line: Math.min(safeLine, Math.max(0, view.editor.lineCount() - 1)), ch: 0 };
      view.editor.setCursor(target);
      view.editor.scrollIntoView({ from: target, to: target }, true);
    }
  }
}
