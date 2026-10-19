import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { MediaService } from '../src/media';

const pdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
const mp3 = Uint8Array.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0, 255, 251, 144, 0]);
const frame = Uint8Array.from([255, 251, 144, 0, 1, 2, 3, 4]);
const wav = Uint8Array.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 65, 86, 69]);
const ogg = Uint8Array.from([79, 103, 103, 83, 0, ...Array(24).fill(0)]);
const flac = Uint8Array.from([102, 76, 97, 67, 128, 0, 0, 0]);
const m4a = Uint8Array.from([0, 0, 0, 20, 102, 116, 121, 112, 77, 52, 65, 32, 0, 0, 0, 0, 77, 52, 65, 32]);
const aac = Uint8Array.from([255, 241, 80, 128, 0, 255, 252]);
const webm = Uint8Array.from([26, 69, 223, 163, 135, 66, 130, 132, 119, 101, 98, 109]);
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
function fixture(native = true) {
  const entries = new Map<string, any>(), bytes = new Map<string, Uint8Array>(), created: string[] = [], read: string[] = [], opened: string[] = [];
  const folder = { path: '', name: '', children: [] }; entries.set('', folder);
  function add(path: string, data: Uint8Array, size = data.length) {
    const name = path.split('/').pop()!, file = { path, name, basename: name.replace(/\.[^.]*$/, ''), extension: name.split('.').pop(), stat: { size, mtime: 1 } };
    entries.set(path, file); bytes.set(path, data.slice()); return file;
  }
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => entries.get(path) || null,
      createFolder: async (path: string) => { if (entries.has(path)) throw Error('exists'); entries.set(path, { path, children: [] }); },
      createBinary: async (path: string, data: ArrayBuffer) => { if (entries.has(path)) throw Error('exists'); created.push(path); return add(path, new Uint8Array(data)); },
      readBinary: async (file: { path: string }) => { read.push(file.path); return bytes.get(file.path)!.slice().buffer; },
      ...(native ? { getResourcePath: (file: { path: string }) => 'app://vault/' + encodeURIComponent(file.path) } : {}),
      adapter: { exists: async (path: string) => entries.has(path) },
    },
    workspace: { getLeaf: (type: string) => { assert.equal(type, 'tab'); return { openFile: async (file: { path: string }) => { opened.push(file.path); } }; } },
  } as unknown as App;
  const config = { folder: 'Attachments/Media' };
  return { service: new MediaService(app, () => config.folder), config, entries, bytes, created, read, opened, add };
}

test('imports supported PDF/audio headers with true MIME, identical-byte SHA256 dedup and no overwrite', async () => {
  const f = fixture();
  const formats: Array<[Uint8Array, string, string, string]> = [[pdf, 'guide.pdf', 'pdf', 'application/pdf'], [mp3, '录音.mp3', 'audio', 'audio/mpeg'], [frame, 'frames.mp3', 'audio', 'audio/mpeg'], [wav, 'voice.wav', 'audio', 'audio/wav'], [ogg, 'voice.ogg', 'audio', 'audio/ogg'], [flac, 'voice.flac', 'audio', 'audio/flac'], [m4a, 'voice.m4a', 'audio', 'audio/mp4'], [aac, 'voice.aac', 'audio', 'audio/aac'], [webm, 'voice.webm', 'audio', 'audio/webm']];
  for (const [data, name, kind, mime] of formats) {
    const result = await f.service.import({ name, base64: base64(data) });
    assert.equal(result.kind, kind); assert.equal(result.mime, mime);
    assert.match(result.path, /^Attachments\/Media\/media-[a-f0-9]{64}\./);
    assert.deepEqual(f.bytes.get(result.path), data);
    assert.match(result.url!, /^app:\/\/vault\//);
  }
  const count = f.created.length;
  const first = await f.service.import({ name: 'new name.mp3', base64: base64(mp3) });
  const second = await f.service.import({ name: 'another name.mp3', base64: `data:audio/mpeg;base64,${base64(mp3)}` });
  assert.equal(first.path, second.path); assert.equal(first.title, 'new name'); assert.equal(f.created.length, count);
  f.bytes.set(first.path, Uint8Array.from(mp3, () => 7));
  await assert.rejects(f.service.import({ name: 'same.mp3', base64: base64(mp3) }), /未覆盖/);
  assert.deepEqual(f.bytes.get(first.path), Uint8Array.from(mp3, () => 7));
});

test('simultaneous identical media imports write one original-byte attachment', async () => {
  const f = fixture();
  const result = await Promise.all([f.service.import({ name: 'one.wav', base64: base64(wav) }), f.service.import({ name: 'two.wav', base64: base64(wav) })]);
  assert.equal(result[0].path, result[1].path); assert.equal(f.created.length, 1);
});

test('asset snapshots use native resource URLs and never read full audio or PDF bytes', async () => {
  const f = fixture(); f.add('Records/中文 #1.MP3', mp3); f.add('Files/guide.pdf', pdf);
  f.add('Records/large.mp3', mp3, 101 * 1024 * 1024);
  const assets = await f.service.mediaAssets(['Records/中文 #1.MP3', 'Records/中文 #1.MP3', 'Files/guide.pdf', 'missing.wav', '.obsidian/private.mp3', '../outside.mp3', 'note.md', 'Records/large.mp3']);
  assert.deepEqual(Object.keys(assets), ['Records/中文 #1.MP3', 'Files/guide.pdf']);
  assert.equal(assets['Records/中文 #1.MP3'].mime, 'audio/mpeg');
  assert.equal(assets['Records/中文 #1.MP3'].title, '中文 #1');
  assert.equal(assets['Files/guide.pdf'].kind, 'pdf');
  assert.deepEqual(f.read, []);
});

test('readPdf is PDF-only, keeps exact bytes, rejects oversize before reading and exposes no credentials', async () => {
  const f = fixture(); f.add('guide.pdf', pdf); f.add('sound.mp3', mp3); f.add('too-big.pdf', pdf, 51 * 1024 * 1024); f.add('false.pdf', wav);
  const result = await f.service.readPdf('guide.pdf');
  assert.deepEqual(result, { base64: base64(pdf), mime: 'application/pdf', kind: 'pdf' });
  await assert.rejects(f.service.readPdf('sound.mp3'), /仅用于 PDF/);
  await assert.rejects(f.service.readPdf('too-big.pdf'), /50 MiB/);
  await assert.rejects(f.service.readPdf('false.pdf'), /有效的 PDF/);
  assert.deepEqual(f.read, ['guide.pdf', 'false.pdf']);
  assert.deepEqual(Object.keys(result), ['base64', 'mime', 'kind']);
});

test('unsafe directories, HTML/SVG, inconsistent MIME and invalid media headers never save a file', async () => {
  const f = fixture();
  for (const value of [base64(new TextEncoder().encode('<html>unsafe</html>')), base64(new TextEncoder().encode('<svg/>')), 'not-base64&', `data:text/html;base64,${base64(pdf)}`, `data:application/pdf;base64,${base64(mp3)}`, base64(Uint8Array.from([255, 255, 255, 0])), base64(new TextEncoder().encode('RIFFxxxxAVI '))]) await assert.rejects(f.service.import({ name: 'bad', base64: value }));
  for (const path of ['../outside', '/outside', '.obsidian', 'Folder/.hidden', 'Folder\\Other', 'Folder//Other']) { f.config.folder = path; await assert.rejects(f.service.import({ name: 'good.pdf', base64: base64(pdf) }), /知识库内/); }
  assert.deepEqual(f.created, []);
});

test('small-byte data URL fallback works without resource API; native open only accepts existing local media', async () => {
  const f = fixture(false), imported = await f.service.import({ name: 'guide.pdf', base64: base64(pdf) });
  assert.equal(imported.url, `data:application/pdf;base64,${base64(pdf)}`);
  const assets = await f.service.mediaAssets([imported.path]); assert.equal(assets[imported.path].url, imported.url);
  await f.service.open(imported.path); assert.deepEqual(f.opened, [imported.path]);
  await assert.rejects(f.service.open('missing.pdf'), /移动或删除/);
  await assert.rejects(f.service.open('../secret.pdf'), /知识库内/);
  await assert.rejects(f.service.open('article.md'), /支持的 PDF 或音频/);
});


test('readAudio returns exact local bytes with native MIME and rejects unsafe/mismatched references', async () => {
  const f = fixture();
  for (const [name, data, mime] of [['voice.mp3', mp3, 'audio/mpeg'], ['voice.wav', wav, 'audio/wav'], ['voice.opus', ogg, 'audio/ogg'], ['voice.flac', flac, 'audio/flac'], ['voice.m4a', m4a, 'audio/mp4'], ['voice.aac', aac, 'audio/aac'], ['voice.webm', webm, 'audio/webm']] as const) {
    f.add(name, data);
    assert.deepEqual(await f.service.readAudio(name), { base64: base64(data), mime, kind: 'audio' });
  }
  f.add('guide.pdf', pdf); f.add('false.wav', mp3); f.add('false.mp3', pdf);
  const beforeRead = f.read.length;
  for (const path of ['guide.pdf', '../voice.mp3', '/voice.mp3', '.obsidian/private.wav', 'Folder/.hidden.wav', 'Folder//voice.wav', 'missing.wav']) await assert.rejects(f.service.readAudio(path));
  assert.equal(f.read.length, beforeRead);
  await assert.rejects(f.service.readAudio('false.wav'), /扩展名/);
  await assert.rejects(f.service.readAudio('false.mp3'), /扩展名/);
  assert.deepEqual(f.created, []);
});

test('readAudio enforces 100MiB before and after native read and rejects non-file metadata', async () => {
  const f = fixture(); f.add('large.wav', wav, 100 * 1024 * 1024 + 1);
  await assert.rejects(f.service.readAudio('large.wav'), /100 MiB/); assert.deepEqual(f.read, []);
  f.entries.set('folder.wav', { path: 'folder.wav', extension: 'wav', stat: { size: 12 }, children: [] });
  f.entries.set('bad-stat.wav', { path: 'bad-stat.wav', extension: 'wav', stat: { size: NaN } });
  f.entries.set('alias.wav', { path: 'other.wav', extension: 'wav', stat: { size: 12 } });
  for (const path of ['folder.wav', 'bad-stat.wav', 'alias.wav']) await assert.rejects(f.service.readAudio(path), /移动或删除/);
  f.add('race.wav', wav, wav.length); f.bytes.set('race.wav', new Uint8Array(100 * 1024 * 1024 + 1));
  await assert.rejects(f.service.readAudio('race.wav'), /100 MiB/);
  assert.deepEqual(f.read, ['race.wav']); assert.deepEqual(f.created, []);
});
