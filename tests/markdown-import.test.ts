import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { importMarkdownFiles, MARKDOWN_IMPORT_LIMIT, MARKDOWN_IMPORT_BATCH_LIMIT } from '../src/markdown-import';
import { Board, initialLayout } from '../src/model';
import { syncFolderLayout } from '../src/folder-layout';

const encode = (text: string) => Array.from(new TextEncoder().encode(text));
const board = (id: string, folderPath?: string): Board => ({ id, title: id, parent: 'home', theme: 'research', iconMode: 'default', view: { x: -376, y: 45, zoom: .7 }, nodes: [], edges: [], ...(folderPath === undefined ? {} : { folderPath }) });
function fixture() {
  let layout = initialLayout(); layout.boards.home.folderPath = ''; layout.boards.target = board('target', 'Notes/Deep');
  layout.boards.other = board('other', 'Other');
  const files = new Map<string, any>(), bytes = new Map<string, Uint8Array>(), created: string[] = [], unloaded = new Set<string>();
  for (const path of ['Notes', 'Notes/Deep', 'Other']) files.set(path, { path, children: [] });
  let beforeWrite: ((path: string) => void | Promise<void>) | undefined, afterWrite: ((path: string) => void | Promise<void>) | undefined, onExists: ((path: string) => void | Promise<void>) | undefined;
  function add(path: string, data = new Uint8Array()) { const name = path.split('/').pop()!, file = { path, name, extension: 'md', basename: name.replace(/\.md$/i, ''), stat: { size: data.length, mtime: 1 } }; files.set(path, file); bytes.set(path, data.slice()); return file; }
  const app = { vault: {
    getAbstractFileByPath: (path: string) => files.get(path) || null,
    adapter: { exists: async (path: string) => { await onExists?.(path); return files.has(path) || unloaded.has(path); } },
    createBinary: async (path: string, data: ArrayBuffer) => {
      await beforeWrite?.(path); if (files.has(path) || unloaded.has(path)) throw Error('already exists');
      const file = add(path, new Uint8Array(data)); created.push(path); await afterWrite?.(path); return file;
    },
  } } as unknown as Pick<App, 'vault'>;
  return { app, files, bytes, created, unloaded, add, get layout() { return layout; }, set layout(value) { layout = value; }, hooks: { set before(value: typeof beforeWrite) { beforeWrite = value; }, set after(value: typeof afterWrite) { afterWrite = value; }, set exists(value: typeof onExists) { onExists = value; } }, run: (inputs: unknown, id = 'target', position?: {x: number; y: number}) => importMarkdownFiles(app, () => layout, id, inputs, position) };
}

test('imports exact UTF-8 BOM/CRLF bytes into mapped nested folder and places actual-sized cards without moving camera', async () => {
  const f = fixture(), body = '\ufeff---\r\naliases: [示例]\r\n---\r\n# 中文\r\n\r\n[[Another]]\r\n**正文**\r\n', original = encode(body), camera = { ...f.layout.boards.target.view };
  const result = await f.run([{ name: '中文.MD', bytes: original }], 'target', { x: 213, y: -87 });
  assert.deepEqual(result.importedPaths, ['Notes/Deep/中文.md']); assert.deepEqual(result.failures, []);
  assert.deepEqual([...f.bytes.get(result.importedPaths[0])!], original);
  assert.deepEqual(f.layout.boards.target.view, camera);
  assert.equal(result.nodes[0].doc, result.importedPaths[0]); assert.equal(result.nodes[0].folderManaged, true);
  assert.equal(result.nodes[0].x, 220); assert.equal(result.nodes[0].y, -80); assert.ok(result.nodes[0].w! >= 280);
  assert.equal(result.imported[0].nodeId, result.nodes[0].id);
  syncFolderLayout(f.layout, ['Notes', 'Notes/Deep', 'Other'], result.importedPaths);
  assert.equal(f.layout.boards.target.nodes.filter(node => node.doc === result.importedPaths[0]).length, 1);
});

test('root Board goes into Vault root; .markdown normalizes extension without modifying content', async () => {
  const f = fixture(), result = await f.run([{ name: 'Root.markdown', text: '# Root\n\n' }], 'home');
  assert.deepEqual(result.importedPaths, ['Root.md']); assert.deepEqual([...f.bytes.get('Root.md')!], encode('# Root\n\n'));
  assert.equal(f.layout.boards.home.nodes[0].doc, 'Root.md'); assert.equal(f.layout.boards.other.nodes.length, 0);
});

test('existing, unindexed and concurrent name collisions allocate suffixes without overwriting', async () => {
  const f = fixture(); f.add('Notes/Deep/Note.md', new Uint8Array([11])); f.unloaded.add('Notes/Deep/Note 2.md');
  f.hooks.before = path => { if (path === 'Notes/Deep/Note 3.md') f.add(path, new Uint8Array([33])); };
  const result = await f.run([{ name: 'Note.md', text: 'first' }, { name: 'Note.md', text: 'second' }]);
  assert.deepEqual(result.importedPaths, ['Notes/Deep/Note 4.md', 'Notes/Deep/Note 5.md']);
  assert.deepEqual([...f.bytes.get('Notes/Deep/Note.md')!], [11]); assert.deepEqual([...f.bytes.get('Notes/Deep/Note 3.md')!], [33]);
  assert.deepEqual([...f.bytes.get('Notes/Deep/Note 4.md')!], encode('first')); assert.equal(result.nodes.length, 2);
  const [a, b] = result.nodes; assert.ok(a.x + a.w! <= b.x || b.x + b.w! <= a.x || a.y + a.h! <= b.y || b.y + b.h! <= a.y);
});

test('simultaneous batches cannot overwrite same name', async () => {
  const f = fixture(), [a, b] = await Promise.all([f.run([{ name: 'Same.md', text: 'A' }]), f.run([{ name: 'Same.md', text: 'B' }])]);
  assert.equal(a.importedPaths.length, 1); assert.equal(b.importedPaths.length, 1); assert.notEqual(a.importedPaths[0], b.importedPaths[0]);
  assert.deepEqual([...f.bytes.values()].map(bytes => new TextDecoder().decode(bytes)).sort(), ['A', 'B']);
});

test('rejects traversal, hidden names, reserved names, non-Markdown, malformed bytes and binary contents without writing', async () => {
  const f = fixture();
  const names = ['../Escape.md', 'Folder/Inside.md', 'C:\\file.md', '.hidden.md', 'CON.md', 'nul.any.md', ' trailing.md', 'bad?.md', 'image.png'];
  const bad = names.map(name => ({ name, bytes: encode('# no') }));
  bad.push(...[{ name: 'null.md', bytes: [97, 0, 98] }, { name: 'utf16.md', bytes: [255, 254, 97, 0] }, { name: 'utf8.md', bytes: [195, 40] }, { name: 'bad.md', bytes: [-1] }, { name: 'bad.md', bytes: [1.5] }] as typeof bad);
  const result = await f.run(bad);
  assert.equal(result.failures.length, bad.length); assert.deepEqual(result.importedPaths, []); assert.deepEqual(f.created, []);
  const invalidString = await f.run([{ name: 'invalid.md', text: '\ud800' }]); assert.equal(invalidString.failures.length, 1);
});

test('mixed batches honestly return saved paths and per-file failures; a disk error cannot erase prior imports', async () => {
  const f = fixture(); f.hooks.before = path => { if (path.endsWith('/Disk.md')) throw Error('/Users/private/secret/disk'); };
  const result = await f.run([{ name: 'Good.md', text: 'one' }, { name: 'Bad.md', bytes: [0] }, { name: 'Disk.md', text: 'disk' }, { name: 'Next.md', bytes: [] }]);
  assert.deepEqual(result.importedPaths, ['Notes/Deep/Good.md', 'Notes/Deep/Next.md']); assert.deepEqual(result.failures.map(f => f.index), [1, 2]);
  assert.equal(JSON.stringify(result).includes('/Users/'), false); assert.equal(f.bytes.get('Notes/Deep/Next.md')!.length, 0);
});

test('missing, stale, duplicate or unsafe Board mappings fail before any file is created', async () => {
  for (const id of ['unknown', '__proto__', 'free', 'missing', 'unsafe', 'file', 'alias']) {
    const f = fixture(); f.layout.boards.free = board('free'); f.layout.boards.missing = { ...board('missing', 'Gone'), folderMissing: true };
    f.layout.boards.unsafe = board('unsafe', '.obsidian'); f.layout.boards.file = board('file', 'file.md'); f.add('file.md'); f.layout.boards.alias = board('alias', 'Notes/Deep');
    await assert.rejects(f.run([{ name: 'No.md', text: 'never' }], id)); assert.deepEqual(f.created, []);
  }
});

test('rechecks latest mapping after async disk collision check and refuses stale folder writes', async () => {
  const f = fixture(); f.hooks.exists = () => { f.layout = structuredClone(f.layout); f.layout.boards.target.folderPath = 'Other'; };
  const result = await f.run([{ name: 'No.md', text: 'never' }]);
  assert.equal(result.failures.length, 1); assert.deepEqual(f.created, []); assert.deepEqual(result.importedPaths, []);
});

test('a Board change during write retains saved file and returns path-bearing failure rather than hiding partial success', async () => {
  const f = fixture(); f.hooks.after = () => { f.layout = structuredClone(f.layout); f.layout.boards.target.folderMissing = true; };
  const result = await f.run([{ name: 'Saved.md', text: 'keep me' }]);
  assert.deepEqual(result.importedPaths, ['Notes/Deep/Saved.md']); assert.equal(result.imported[0].nodeId, undefined);
  assert.equal(result.failures[0].path, 'Notes/Deep/Saved.md'); assert.deepEqual(result.nodes, []); assert.ok(f.files.has('Notes/Deep/Saved.md'));
});

test('reuses automatic card inserted by a synchronous native create refresh and keeps it at the drop position', async () => {
  const f = fixture(); f.hooks.after = path => { f.layout = structuredClone(f.layout); f.layout.boards.target.nodes.push({ id: 'automatic', type: 'article', doc: path, x: 9000, y: 9000, folderManaged: true }); };
  const result = await f.run([{ name: 'Auto.md', text: '# Auto' }], 'target', { x: 140, y: 280 });
  assert.equal(result.imported[0].nodeId, 'automatic'); assert.equal(f.layout.boards.target.nodes.length, 1);
  assert.equal(result.nodes[0].x, 140); assert.equal(result.nodes[0].y, 280);
});

test('enforces count, per-file and total batch limits with explicit partial-success outcomes', async () => {
  const f = fixture(); await assert.rejects(f.run([]), /1 至 32/); await assert.rejects(f.run(Array(33).fill({ name: 'N.md', text: 'n' })), /1 至 32/);
  const tooBig = await f.run([{ name: 'Huge.md', bytes: new Array(MARKDOWN_IMPORT_LIMIT + 1).fill(97) }]); assert.equal(tooBig.failures.length, 1); assert.equal(f.created.length, 0);
  const payload = 'x'.repeat(MARKDOWN_IMPORT_LIMIT), count = MARKDOWN_IMPORT_BATCH_LIMIT / MARKDOWN_IMPORT_LIMIT;
  const batch = await f.run(Array.from({ length: count + 1 }, (_, index) => ({ name: `Big${index}.md`, text: payload })));
  assert.equal(batch.importedPaths.length, count); assert.equal(batch.failures.length, 1); assert.match(batch.failures[0].error, /40 MiB/);
});
