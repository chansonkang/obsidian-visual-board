import { App, normalizePath, requestUrl } from 'obsidian';

export interface ImageImport {
  name: string;
  base64?: string;
  url?: string;
}
export interface ImageResult { path: string; url: string; sourceUrl?: string }
const LIMIT = 20 * 1024 * 1024;
const EXTENSIONS = /\.(png|jpe?g|webp|gif)$/i;
class ImageError extends Error {}
function fail(message: string): never { throw new ImageError(message); }

function format(bytes: Uint8Array): { extension: string; mime: string } {
  if (bytes.length < 12) fail('图片内容无效。');
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return { extension: 'png', mime: 'image/png' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { extension: 'jpg', mime: 'image/jpeg' };
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return { extension: 'webp', mime: 'image/webp' };
  if (['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.subarray(0, 6)))) return { extension: 'gif', mime: 'image/gif' };
  return fail('请选择 PNG、JPEG、WebP 或 GIF 图片。');
}
function checkSize(bytes: Uint8Array): void { if (bytes.byteLength > LIMIT) fail('图片超过 20 MiB，请选择较小的图片。'); }
function encode(bytes: Uint8Array): string {
  const type = format(bytes);
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${type.mime};base64,${btoa(text)}`;
}
function decode(value: string): Uint8Array {
  let base64 = value;
  if (value.startsWith('data:')) {
    const match = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,([\s\S]*)$/i.exec(value);
    if (!match) fail('图片编码格式不受支持。');
    base64 = match[1];
  }
  base64 = base64.replace(/\s/g, '');
  if (base64.length > Math.ceil(LIMIT * 4 / 3) + 8) fail('图片超过 20 MiB，请选择较小的图片。');
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) fail('图片编码无效。');
  let decoded: string;
  try { decoded = atob(base64); } catch { return fail('图片编码无效。'); }
  const bytes = Uint8Array.from(decoded, value => value.charCodeAt(0));
  checkSize(bytes); format(bytes);
  return bytes;
}
function localPath(value: string, isFolder = false): string {
  if (typeof value !== 'string') fail('图片位置须在仓库的普通文件夹内。');
  value = value.trim();
  if (!value || /^[\/\\]|[:\x00-\x1f]/.test(value) || value.split(/[\/\\]/).some(part => part === '.' || part === '..' || part.startsWith('.'))) fail('图片位置须在仓库的普通文件夹内。');
  const path = normalizePath(value);
  if (!isFolder && !EXTENSIONS.test(path)) fail('此文件不是支持的图片。');
  return path;
}
function imageUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { return fail('请输入有效的图片地址。'); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') || /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host) || host.includes(':');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || local) fail('图片地址须使用公开 HTTPS 地址，不能包含登录信息。');
  return url.toString();
}
async function download(url: string): Promise<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      requestUrl({ url, method: 'GET', headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' }, throw: false }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ImageError('下载图片超时，请稍后重试。')), 60000); }),
    ]);
    if (response.status !== 200) fail('无法下载此图片，请检查图片地址。');
    const bytes = new Uint8Array(response.arrayBuffer);
    checkSize(bytes); format(bytes);
    return bytes;
  } finally { if (timer) clearTimeout(timer); }
}

export function obsidianUrl(vaultName: string, path: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(path)}`;
}

/** Local attachments are copied into the vault; display URLs never depend on a server. */
export class ImageService {
  constructor(private app: App, private folderGetter: () => string) {}

  async import(input: ImageImport): Promise<ImageResult> {
    try {
      if (typeof input.base64 !== 'string' && typeof input.url !== 'string') fail('请选择图片或输入图片地址。');
      const folder = localPath(this.folderGetter() || 'Visual Board Assets', true);
      const sourceUrl = typeof input.base64 === 'string' ? undefined : imageUrl(input.url!);
      const bytes = typeof input.base64 === 'string' ? decode(input.base64) : await download(sourceUrl!);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), value => value.toString(16).padStart(2, '0')).join('');
      const path = `${folder}/image-${hash}.${format(bytes).extension}`;
      const segments = folder.split('/');
      for (let i = 1; i <= segments.length; i++) {
        const dir = segments.slice(0, i).join('/');
        if (!await this.app.vault.adapter.exists(dir)) {
          try { await this.app.vault.adapter.mkdir(dir); }
          catch { if (!await this.app.vault.adapter.exists(dir)) fail('无法创建图片附件目录。'); }
        }
      }
      if (!await this.app.vault.adapter.exists(path)) await this.app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      return { path, url: encode(bytes), ...(sourceUrl ? { sourceUrl } : {}) };
    } catch (error) {
      if (error instanceof ImageError) throw error;
      throw new ImageError('无法读取或保存图片，请检查图片内容和附件目录。');
    }
  }

  async imageAssets(paths: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = Object.create(null);
    for (const raw of new Set(paths)) {
      try {
        const path = localPath(raw);
        const bytes = new Uint8Array(await this.app.vault.adapter.readBinary(path));
        checkSize(bytes);
        result[path] = encode(bytes);
      } catch { /* A deleted or unsupported attachment should not prevent opening the board. */ }
    }
    return result;
  }
}
