import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { App, Plugin, TFile } from 'obsidian';
import { VaultBridge, noteName, vaultPath } from '../src/vault';

function mockVault(initial: Record<string, string>, resolved: Record<string, Record<string, number>> = {}) {
  const entries = new Map<string, any>();
  const bodies = new Map<string, string>();
  const writes: string[] = [];
  const folders: string[] = [];
  const renames: Array<{ oldPath: string; newPath: string }> = [];
  let mtime = 100;
  function add(path: string, body: string) {
    const file = { path, name: path.split('/').pop(), basename: path.split('/').pop()!.replace(/\.md$/, ''), extension: 'md', stat: { mtime: mtime++ } };
    entries.set(path, file);
    bodies.set(path, body);
    return file;
  }
  for (const [path, body] of Object.entries(initial)) add(path, body);
  const opened: Array<{ path: string; state: unknown }> = [];
  const positions: Array<{ line: number; ch: number }> = [];
  const leaf: any = { view: { editor: { lineCount: () => 10, setCursor: (pos: any) => positions.push(pos), scrollIntoView: () => {} } }, openFile: async (file: TFile, state: unknown) => { opened.push({ path: file.path, state }); leaf.view.file = file; } };
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => entries.get(path) || null,
      getMarkdownFiles: () => [...entries.values()].filter(file => file.extension === 'md'),
      cachedRead: async (file: TFile) => bodies.get(file.path)!,
      read: async (file: TFile) => bodies.get(file.path)!,
      createFolder: async (path: string) => { entries.set(path, { path, children: [] }); folders.push(path); },
      create: async (path: string, body: string) => { if (entries.has(path)) throw new Error('Exists'); writes.push(path); return add(path, body); },
      process: async (file: TFile, fn: (data: string) => string) => { const next = fn(bodies.get(file.path)!); writes.push(file.path); bodies.set(file.path, next); file.stat.mtime = mtime++; return next; },
    },
    metadataCache: { resolvedLinks: resolved, getFileCache: () => ({ headings: [{ heading: 'Nested heading', position: { start: { line: 4 } } }], blocks: { fact: { position: { start: { line: 6 } } } } }) },
    fileManager: { renameFile: async (file: TFile, newPath: string) => {
      if (entries.has(newPath)) throw new Error('Exists');
      const oldPath = file.path, body = bodies.get(oldPath)!;
      renames.push({ oldPath, newPath });
      entries.delete(oldPath); bodies.delete(oldPath);
      file.path = newPath; file.name = newPath.split('/').pop()!; file.basename = file.name.replace(/\.md$/i, '');
      entries.set(newPath, file); bodies.set(newPath, body);
    } },
    workspace: { getLeavesOfType: () => opened.length ? [leaf] : [], getLeaf: (kind: string) => { assert.equal(kind, 'tab'); return leaf; }, setActiveLeaf: () => {} },
  } as unknown as App;
  return { app, bridge: new VaultBridge(app, {} as Plugin), bodies, entries, writes, folders, opened, positions, renames };
}

test('resolved vault paths disambiguate duplicate basenames, including aliases and heading links', async () => {
  const mock = mockVault({ 'Projects/A.md': '[[../Reference/A#Part|other A]]', 'Reference/A.md': '# Part', 'Index.md': '[A](Projects/A.md)' }, {
    'Projects/A.md': { 'Reference/A.md': 2, 'Assets/picture.png': 1 }, 'Index.md': { 'Projects/A.md': 1 },
  });
  const docs = await mock.bridge.snapshot();
  assert.deepEqual(docs['Projects/A.md'].outgoing, ['Reference/A.md']);
  assert.deepEqual(docs['Projects/A.md'].backlinks, ['Index.md']);
  assert.deepEqual(docs['Reference/A.md'].backlinks, ['Projects/A.md']);
  assert.equal(docs['Projects/A.md'].id, 'Projects/A.md');
  assert.equal(docs['Reference/A.md'].id, 'Reference/A.md');
});

test('a conflicting editor save leaves note content and mtime unchanged', async () => {
  const mock = mockVault({ 'Note.md': 'edited in native editor' });
  const originalMtime = mock.entries.get('Note.md').stat.mtime;
  const result = await mock.bridge.update('Note.md', 'stale board edit', 'old original');
  assert.deepEqual(result, { ok: false, reason: 'conflict', current: 'edited in native editor' });
  assert.equal(mock.bodies.get('Note.md'), 'edited in native editor');
  assert.equal(mock.entries.get('Note.md').stat.mtime, originalMtime);
  assert.deepEqual(mock.writes, []);
  const saved = await mock.bridge.update('Note.md', 'merged edit', 'edited in native editor');
  assert.equal(saved.ok, true);
  assert.equal(mock.bodies.get('Note.md'), 'merged edit');
});

test('missing references become recoverable placeholders and never create notes', async () => {
  const mock = mockVault({ 'Present.md': 'Hello' });
  const docs = await mock.bridge.snapshot(['Missing.md', './Present.md', '../outside.md']);
  assert.equal(docs['Missing.md'].missing, true);
  assert.equal(docs['Missing.md'].path, 'Missing.md');
  assert.equal(docs['Present.md'].missing, undefined);
  assert.equal(docs['../outside.md'], undefined);
  assert.equal(await mock.bridge.read('Missing.md'), null);
  assert.deepEqual(await mock.bridge.update('Missing.md', 'x', 'y'), { ok: false, reason: 'missing' });
  assert.deepEqual(mock.writes, []);
});

test('new note paths are valid, use configured folders, and avoid overwriting duplicates', async () => {
  const mock = mockVault({ 'Notes/Research/Plants ideas.md': 'original' });
  const doc = await mock.bridge.create('Plants / ideas.md', 'Notes/Research');
  assert.equal(doc.path, 'Notes/Research/Plants ideas 2.md');
  assert.equal(mock.bodies.get('Notes/Research/Plants ideas.md'), 'original');
  assert.deepEqual(mock.folders, ['Notes', 'Notes/Research']);
  assert.equal(noteName('CON.md'), 'CON 文章');
  assert.equal(noteName('...'), '未命名文章');
  assert.equal(vaultPath('Notes\\Research//Plants.md'), 'Notes/Research/Plants.md');
  for (const path of ['../outside', '/absolute', 'C:\\outside', 'Notes/../../bad']) assert.throws(() => vaultPath(path));
  await assert.rejects(mock.bridge.create('Good', '../outside'));
});

test('native navigation keeps full path and focuses the actual matching line or link fragment', async () => {
  const mock = mockVault({ 'One/A.md': 'one', 'Two/A.md': 'two' });
  await mock.bridge.open('Two/A.md', 7);
  assert.equal(mock.opened[0].path, 'Two/A.md');
  assert.deepEqual(mock.positions[0], { line: 7, ch: 0 });
  await mock.bridge.open('Two/A.md', undefined, 'A#Nested heading');
  assert.deepEqual(mock.positions[1], { line: 4, ch: 0 });
  await mock.bridge.open('One/A.md', undefined, 'A#^fact');
  assert.deepEqual(mock.positions[2], { line: 6, ch: 0 });
  await mock.bridge.open('One/A.md', 1000);
  assert.deepEqual(mock.positions[3], { line: 9, ch: 0 });
});

test('card title rename stays in its directory, preserves Markdown, and calls native FileManager', async () => {
  const body = '# Original heading\n\n[[Other]]\n\n文章正文保持原样。';
  const mock = mockVault({ '研究/访谈/原名称.md': body });
  const doc = await mock.bridge.rename('研究/访谈/原名称.md', '新的中文标题');
  assert.equal(doc.id, '研究/访谈/新的中文标题.md');
  assert.equal(doc.path, '研究/访谈/新的中文标题.md');
  assert.equal(doc.title, '新的中文标题');
  assert.equal(doc.body, body);
  assert.equal(mock.bodies.get('研究/访谈/新的中文标题.md'), body);
  assert.equal(mock.bodies.has('研究/访谈/原名称.md'), false);
  assert.deepEqual(mock.renames, [{ oldPath: '研究/访谈/原名称.md', newPath: '研究/访谈/新的中文标题.md' }]);
  assert.deepEqual(mock.writes, []);
  assert.deepEqual(mock.folders, []);
});

test('rename refuses duplicates without touching either article and unchanged basename is a no-op', async () => {
  const mock = mockVault({ 'Folder/A.md': 'source body', 'Folder/B.md': 'destination body', 'Another/B.md': 'another directory' });
  await assert.rejects(mock.bridge.rename('Folder/A.md', 'B'), /同名/);
  assert.equal(mock.bodies.get('Folder/A.md'), 'source body');
  assert.equal(mock.bodies.get('Folder/B.md'), 'destination body');
  assert.equal(mock.bodies.get('Another/B.md'), 'another directory');
  assert.deepEqual(mock.renames, []);
  const unchanged = await mock.bridge.rename('Folder/A.md', ' A.md ');
  assert.equal(unchanged.path, 'Folder/A.md');
  assert.equal(unchanged.body, 'source body');
  assert.deepEqual(mock.renames, []);
  const renamed = await mock.bridge.rename('Folder/A.md', 'B in this folder');
  assert.equal(renamed.path, 'Folder/B in this folder.md');
});

test('rename rejects empty, invalid, traversal, reserved and excessive titles without a native write', async () => {
  const mock = mockVault({ 'Safe.md': 'body' });
  for (const title of ['', '   ', '.md', '.', '..', '../outside', 'folder/new', 'folder\\new', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0000b', 'a\nb', 'trailing.', 'CON', 'nul.txt', 'x'.repeat(181), '长'.repeat(81)]) {
    await assert.rejects(mock.bridge.rename('Safe.md', title), Error, title);
  }
  await assert.rejects(mock.bridge.rename('Missing.md', 'new'), /移动或删除/);
  assert.equal(mock.bodies.get('Safe.md'), 'body');
  assert.deepEqual(mock.renames, []);
  assert.deepEqual(mock.writes, []);
});

test('move uses native FileManager, preserves the complete file name/body and supports the Vault root', async () => {
  const body = '# Original title\n\n正文，[[双向链接]]与![[附件.png]]全部保持。';
  const mock = mockVault({ '源目录/中文 原文.md': body });
  mock.entries.set('目标/子目录', { path: '目标/子目录', children: [] });
  const moved = await mock.bridge.move('源目录/中文 原文.md', '目标/子目录');
  assert.equal(moved.path, '目标/子目录/中文 原文.md'); assert.equal(moved.title, '中文 原文'); assert.equal(moved.body, body);
  assert.equal(mock.bodies.has('源目录/中文 原文.md'), false);
  const root = await mock.bridge.move(moved.path, '');
  assert.equal(root.path, '中文 原文.md'); assert.equal(root.body, body);
  assert.deepEqual(mock.renames, [{ oldPath: '源目录/中文 原文.md', newPath: '目标/子目录/中文 原文.md' }, { oldPath: '目标/子目录/中文 原文.md', newPath: '中文 原文.md' }]);
  assert.deepEqual(mock.writes, []); assert.deepEqual(mock.folders, []);
});

test('move within the current folder and within root is a no-op, retaining mtime and basename', async () => {
  const mock = mockVault({ 'Folder/Note.md': 'body', 'Root.md': 'root' });
  mock.entries.set('Folder', { path: 'Folder', children: [] });
  const mtime = mock.entries.get('Folder/Note.md').stat.mtime;
  assert.equal((await mock.bridge.move('Folder/Note.md', 'Folder')).mtime, mtime);
  assert.equal((await mock.bridge.move('Root.md', '')).body, 'root');
  assert.deepEqual(mock.renames, []); assert.deepEqual(mock.writes, []);
});

test('move refuses missing, non-folder, hidden and unsafe destinations without creating folders or modifying content', async () => {
  const mock = mockVault({ 'Source.md': 'source', 'Target.md': 'not a folder' });
  mock.entries.set('.obsidian', { path: '.obsidian', children: [] });
  for (const target of ['Missing', 'Target.md', '.obsidian', 'A/.private', '../outside', 'A/../outside', '/absolute', 'https://example.com', 'A\\Target', 'A//Target', '.']) await assert.rejects(mock.bridge.move('Source.md', target), Error, target);
  for (const source of ['../Source.md', '/Source.md', '.private/Source.md']) await assert.rejects(mock.bridge.move(source, ''), Error, source);
  await assert.rejects(mock.bridge.move('Missing.md', ''), /移动或删除/);
  assert.equal(mock.bodies.get('Source.md'), 'source'); assert.equal(mock.bodies.get('Target.md'), 'not a folder');
  assert.deepEqual(mock.renames, []); assert.deepEqual(mock.writes, []); assert.deepEqual(mock.folders, []);
});

test('move refuses destination collisions and keeps both original articles intact', async () => {
  const mock = mockVault({ 'A/Note.md': 'source body', 'B/Note.md': 'destination body' });
  mock.entries.set('B', { path: 'B', children: [] });
  await assert.rejects(mock.bridge.move('A/Note.md', 'B'), /同名/);
  assert.equal(mock.bodies.get('A/Note.md'), 'source body'); assert.equal(mock.bodies.get('B/Note.md'), 'destination body');
  assert.deepEqual(mock.renames, []); assert.deepEqual(mock.writes, []);
});

test('a concurrent FileManager destination collision propagates without overwriting either body', async () => {
  const mock = mockVault({ 'A/Note.md': 'source body' }); mock.entries.set('B', { path: 'B', children: [] });
  const nativeRename = mock.app.fileManager.renameFile.bind(mock.app.fileManager);
  mock.app.fileManager.renameFile = async (file, target) => {
    mock.entries.set(target, { path: target, extension: 'md', name: 'Note.md', basename: 'Note', stat: { mtime: 200 } });
    mock.bodies.set(target, 'concurrently created body');
    await nativeRename(file, target);
  };
  await assert.rejects(mock.bridge.move('A/Note.md', 'B'), /Exists/);
  assert.equal(mock.bodies.get('A/Note.md'), 'source body'); assert.equal(mock.bodies.get('B/Note.md'), 'concurrently created body');
  assert.deepEqual(mock.renames, []); assert.deepEqual(mock.writes, []);
});
