import type { App, TFile } from 'obsidian';
import { safeVaultPath } from './model';

export type MediaKind = 'pdf' | 'audio';
export interface MediaImport { name?: string; base64?: string }
export interface MediaAsset { url: string; mime: string; kind: MediaKind; title: string }
export interface MediaResult { path: string; title: string; kind: MediaKind; mime: string; url?: string }
export interface AudioResult { base64: string; mime: string; kind: 'audio' }
export interface PdfResult { base64: string; mime: 'application/pdf'; kind: 'pdf' }
interface Format { extension: string; mime: string; kind: MediaKind }
const LIMIT = 100 * 1024 * 1024, PDF_LIMIT = 50 * 1024 * 1024, FALLBACK_LIMIT = 5 * 1024 * 1024;
class MediaError extends Error {}
function fail(message: string): never { throw new MediaError(message); }
const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
const types: Record<string, Format> = {
  pdf: { extension: 'pdf', mime: 'application/pdf', kind: 'pdf' },
  mp3: { extension: 'mp3', mime: 'audio/mpeg', kind: 'audio' },
  wav: { extension: 'wav', mime: 'audio/wav', kind: 'audio' },
  ogg: { extension: 'ogg', mime: 'audio/ogg', kind: 'audio' },
  flac: { extension: 'flac', mime: 'audio/flac', kind: 'audio' },
  m4a: { extension: 'm4a', mime: 'audio/mp4', kind: 'audio' },
  aac: { extension: 'aac', mime: 'audio/aac', kind: 'audio' },
  webm: { extension: 'webm', mime: 'audio/webm', kind: 'audio' },
};
function format(bytes: Uint8Array, name = ''): Format {
  if (ascii(bytes, 0, 5) === '%PDF-') return types.pdf;
  if (bytes.length >= 10 && ascii(bytes, 0, 3) === 'ID3' && bytes[3] >= 2 && bytes[3] <= 4 && [...bytes.subarray(6, 10)].every(value => value < 128)) return types.mp3;
  if (bytes.length >= 7 && bytes[0] === 255 && (bytes[1] & 246) === 240 && ((bytes[2] >> 2) & 15) < 13) {
    const length = ((bytes[3] & 3) << 11) | (bytes[4] << 3) | (bytes[5] >> 5);
    if (length >= 7 && length <= bytes.length) return types.aac;
  }
  if (bytes.length >= 4 && bytes[0] === 255 && (bytes[1] & 224) === 224 && ((bytes[1] >> 3) & 3) !== 1 && ((bytes[1] >> 1) & 3) !== 0 && (bytes[2] >> 4) > 0 && (bytes[2] >> 4) < 15 && ((bytes[2] >> 2) & 3) !== 3) return types.mp3;
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return types.wav;
  if (bytes.length >= 27 && ascii(bytes, 0, 4) === 'OggS' && bytes[4] === 0) return types.ogg;
  if (bytes.length >= 8 && ascii(bytes, 0, 4) === 'fLaC') return types.flac;
  if (bytes.length >= 16 && ascii(bytes, 4, 4) === 'ftyp') {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (size >= 16 && size <= bytes.length) {
      const brands = ascii(bytes, 8, 4) + ascii(bytes, 16, Math.min(4096, size - 16));
      if (/M4[ABP] /.test(brands) || /\.m4[ab]$/i.test(name) && /isom|iso2|mp41|mp42/.test(brands)) return types.m4a;
    }
  }
  if (bytes.length >= 8 && bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163 && ascii(bytes, 4, Math.min(4096, bytes.length - 4)).includes('webm')) return types.webm;
  return fail('文件内容不是支持的 PDF 或音频，请选择 PDF、MP3、WAV、OGG、FLAC、M4A、AAC 或 WebM 音频。');
}
function localPath(raw: string): string {
  const path = safeVaultPath(raw);
  if (!path || path.split('/').some(part => part.startsWith('.'))) fail('媒体位置必须是知识库内的普通文件或文件夹。');
  return path;
}
function fileFormat(path: string): Format {
  const extension = path.split('.').pop()!.toLowerCase();
  const info = types[extension === 'oga' || extension === 'opus' ? 'ogg' : extension === 'm4b' ? 'm4a' : extension];
  if (!info) fail('此文件不是支持的 PDF 或音频。');
  return info;
}
function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
function decode(input: MediaImport): { bytes: Uint8Array; info: Format } {
  if (typeof input.base64 !== 'string') fail('请选择本地 PDF 或音频文件。');
  let value = input.base64, declared = '';
  if (value.startsWith('data:')) {
    const match = /^data:([a-z0-9.+/-]+);base64,([\s\S]*)$/i.exec(value);
    if (!match) fail('媒体文件编码无效。');
    declared = match[1].toLowerCase(); value = match[2];
  }
  if (value.length > Math.ceil(LIMIT * 4 / 3) + 8) fail('媒体文件超过 100 MiB，请选择较小的文件。');
  value = value.replace(/\s/g, '');
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('媒体文件编码无效。');
  let raw: string;
  try { raw = atob(value); } catch { return fail('媒体文件编码无效。'); }
  if (raw.length > LIMIT) fail('媒体文件超过 100 MiB，请选择较小的文件。');
  const bytes = Uint8Array.from(raw, character => character.charCodeAt(0)), info = format(bytes, input.name);
  const aliases: Record<string, string> = { 'audio/mp3': 'audio/mpeg', 'audio/x-mpeg': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav', 'audio/x-flac': 'audio/flac', 'audio/x-m4a': 'audio/mp4', 'audio/x-aac': 'audio/aac', 'application/ogg': 'audio/ogg', 'application/x-pdf': 'application/pdf' };
  if (declared && declared !== 'application/octet-stream' && (aliases[declared] || declared) !== info.mime) fail('媒体类型声明与真实文件内容不匹配。');
  return { bytes, info };
}
async function hash(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(value => value.toString(16).padStart(2, '0')).join('');
}
function isFile(file: unknown): file is TFile { const candidate = file as TFile | null; return !!candidate && typeof candidate.path === 'string' && typeof candidate.extension === 'string' && !!candidate.stat && Number.isFinite(candidate.stat.size) && candidate.stat.size >= 0 && !('children' in candidate); }

/** Media remains a local Vault attachment. Snapshots stream native URLs, not audio bytes. */
export class MediaService {
  private importing = new Map<string, Promise<TFile>>();
  constructor(private readonly app: App, private readonly folderGetter: () => string) {}

  private file(path: string): { file: TFile; info: Format } {
    path = localPath(path); const info = fileFormat(path), file = this.app.vault.getAbstractFileByPath(path);
    if (!isFile(file) || file.path !== path) fail('媒体文件已被移动或删除。');
    if (file.stat.size > LIMIT) fail('媒体文件超过 100 MiB。');
    return { file, info };
  }
  private async read(file: TFile): Promise<Uint8Array> {
    const readBinary = this.app.vault.readBinary;
    const value = typeof readBinary === 'function' ? await readBinary.call(this.app.vault, file) : await this.app.vault.adapter.readBinary(file.path);
    return new Uint8Array(value);
  }
  private resource(file: TFile): string | undefined {
    if (typeof this.app.vault.getResourcePath !== 'function') return undefined;
    const url = this.app.vault.getResourcePath(file);
    return typeof url === 'string' && url.length ? url : undefined;
  }
  private async ensureFolder(path: string) {
    let directory = '';
    for (const segment of path.split('/')) {
      directory = directory ? `${directory}/${segment}` : segment;
      const present = this.app.vault.getAbstractFileByPath(directory);
      if (present) { if (isFile(present)) fail('媒体附件目录与现有文件重名。'); continue; }
      try { await this.app.vault.createFolder(directory); }
      catch { const concurrent = this.app.vault.getAbstractFileByPath(directory); if (!concurrent || isFile(concurrent)) fail('无法创建媒体附件目录。'); }
    }
  }
  async import(input: MediaImport): Promise<MediaResult> {
    const directory = localPath(this.folderGetter() || 'Visual Board Assets');
    const { bytes, info } = decode(input), digest = await hash(bytes), path = `${directory}/media-${digest}.${info.extension}`;
    let importing = this.importing.get(path);
    if (!importing) {
      importing = (async () => {
        await this.ensureFolder(directory);
        const present = this.app.vault.getAbstractFileByPath(path);
        if (present) {
          if (!isFile(present) || present.stat.size > LIMIT || typeof present.stat.size === 'number' && present.stat.size !== bytes.length || await hash(await this.read(present)) !== digest) fail('同名媒体附件内容不一致，未覆盖现有文件。');
          return present;
        }
        if (await this.app.vault.adapter.exists(path)) fail('媒体附件已存在但尚未载入，未覆盖原文件，请刷新后重试。');
        return this.app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      })();
      this.importing.set(path, importing);
    }
    let file: TFile;
    try { file = await importing; } catch (error) { if (error instanceof MediaError) throw error; return fail('媒体文件无法保存，请检查附件目录与本地文件。'); }
    finally { if (this.importing.get(path) === importing) this.importing.delete(path); }
    const title = String(input.name || (info.kind === 'pdf' ? 'PDF 文件' : '音频')).split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200) || (info.kind === 'pdf' ? 'PDF 文件' : '音频');
    const url = this.resource(file) || (bytes.length <= FALLBACK_LIMIT ? `data:${info.mime};base64,${encode(bytes)}` : undefined);
    return { path, title, kind: info.kind, mime: info.mime, ...(url ? { url } : {}) };
  }
  async mediaAssets(paths: string[]): Promise<Record<string, MediaAsset>> {
    const assets: Record<string, MediaAsset> = Object.create(null);
    for (const path of new Set(paths)) {
      try {
        const { file, info } = this.file(path); let url = this.resource(file);
        if (!url) {
          if (file.stat.size > FALLBACK_LIMIT) continue;
          const bytes = await this.read(file); if (bytes.length > FALLBACK_LIMIT) continue;
          const actual = format(bytes, file.name); if (actual.mime !== info.mime) continue;
          url = `data:${info.mime};base64,${encode(bytes)}`;
        }
        assets[path] = { url, mime: info.mime, kind: info.kind, title: file.basename };
      } catch { /* A missing/unusable attachment does not prevent opening other Boards. */ }
    }
    return assets;
  }
  async readAudio(path: string): Promise<AudioResult> {
    const { file, info } = this.file(path);
    if (info.kind !== 'audio') fail('此操作仅用于播放本地音频。');
    const bytes = await this.read(file);
    if (bytes.length > LIMIT) fail('媒体文件超过 100 MiB。');
    const actual = format(bytes, file.name);
    if (actual.kind !== 'audio' || actual.mime !== info.mime) fail('音频扩展名与真实文件内容不匹配。');
    return { base64: encode(bytes), mime: actual.mime, kind: 'audio' };
  }
  async readPdf(path: string): Promise<PdfResult> {
    const { file, info } = this.file(path);
    if (info.kind !== 'pdf') fail('此操作仅用于 PDF 预览，不读取完整音频。');
    if (file.stat.size > PDF_LIMIT) fail('PDF 预览上限为 50 MiB，请在 Obsidian 中打开此文件。');
    const bytes = await this.read(file);
    if (bytes.length > PDF_LIMIT) fail('PDF 预览上限为 50 MiB，请在 Obsidian 中打开此文件。');
    if (format(bytes).kind !== 'pdf') fail('此文件不是有效的 PDF 内容。');
    return { base64: encode(bytes), mime: 'application/pdf', kind: 'pdf' };
  }
  async open(path: string): Promise<void> {
    const { file } = this.file(path);
    await this.app.workspace.getLeaf('tab').openFile(file);
  }
}
