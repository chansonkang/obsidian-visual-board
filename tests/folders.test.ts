import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { App, TAbstractFile } from 'obsidian';
import { FolderBridge, folderName } from '../src/folders';

function fixture(initialFolders: string[], initialFiles: string[] = []) {
  const entries = new Map<string, any>();
  const created: string[] = [], renamed: Array<{ path: string; target: string }> = [];
  const root = { path: '', name: '', children: [] };
  entries.set('', root);
  function addFolder(path: string) { const folder = { path, name: path.split('/').pop(), children: [] }; entries.set(path, folder); return folder; }
  initialFolders.forEach(addFolder);
  initialFiles.forEach(path => entries.set(path, { path, name: path.split('/').pop(), extension: 'md' }));
  const app = {
    vault: {
      getRoot: () => root,
      getAbstractFileByPath: (path: string) => entries.get(path) || null,
      getAllLoadedFiles: () => [...entries.values()],
      createFolder: async (path: string) => { if (entries.has(path)) throw Error('Exists'); created.push(path); return addFolder(path); },
    },
    fileManager: { renameFile: async (folder: TAbstractFile, target: string) => {
      if (entries.has(target)) throw Error('Exists');
      const source = folder.path; renamed.push({ path: source, target });
      const subtree = [...entries.entries()].filter(([path]) => path === source || path.startsWith(source + '/'));
      for (const [path, item] of subtree) { entries.delete(path); item.path = target + path.slice(source.length); item.name = item.path.split('/').pop(); entries.set(item.path, item); }
    } },
  } as unknown as App;
  return { bridge: new FolderBridge(app), entries, created, renamed };
}

test('listing uses loaded real folders and excludes files, root and all hidden-path segments', () => {
  const f = fixture(['Notes', 'Notes/Research', '.obsidian', '.obsidian/plugins', 'Notes/.hidden', 'Notes/.hidden/Child', '中文文件夹'], ['Notes/article.md']);
  assert.deepEqual(new Set(f.bridge.list()), new Set(['Notes', 'Notes/Research', '中文文件夹']));
});

test('create adds a direct child, reuses an existing folder and never creates missing parents', async () => {
  const f = fixture(['Parent', 'Parent/Existing'], ['Parent/Collision']);
  assert.equal(await f.bridge.create('Parent', '中文子目录.md'), 'Parent/中文子目录.md');
  assert.equal(await f.bridge.create('', 'Root folder'), 'Root folder');
  assert.equal(await f.bridge.create('Parent', 'Existing'), 'Parent/Existing');
  assert.deepEqual(f.created, ['Parent/中文子目录.md', 'Root folder']);
  await assert.rejects(f.bridge.create('Missing/Parent', 'Child'), /父文件夹不存在/);
  await assert.rejects(f.bridge.create('Parent', 'Collision'), /同名文件/);
  await assert.rejects(f.bridge.create('Parent/Collision', 'Child'), /父文件夹不存在/);
  assert.equal(f.entries.has('Missing'), false);
});

test('folder rename uses native FileManager, keeps the same parent and moves its descendants', async () => {
  const f = fixture(['Parent', 'Parent/Old', 'Parent/Old/Deep'], ['Parent/Old/Deep/article.md']);
  assert.equal(await f.bridge.rename('Parent/Old', '新的目录'), 'Parent/新的目录');
  assert.deepEqual(f.renamed, [{ path: 'Parent/Old', target: 'Parent/新的目录' }]);
  assert.equal(f.entries.has('Parent/新的目录/Deep/article.md'), true);
  assert.equal(f.entries.has('Parent/Old/Deep/article.md'), false);
  assert.equal(await f.bridge.rename('Parent/新的目录', '新的目录'), 'Parent/新的目录');
  assert.equal(f.renamed.length, 1);
});

test('move uses native rename to an existing parent or root and preserves descendants', async () => {
  const f = fixture(['A', 'A/Child', 'A/Child/Deep', 'B'], ['A/Child/note.md']);
  assert.equal(await f.bridge.move('A/Child', 'B'), 'B/Child');
  assert.equal(f.entries.has('B/Child/note.md'), true);
  assert.equal(f.entries.has('B/Child/Deep'), true);
  assert.equal(await f.bridge.move('B/Child', ''), 'Child');
  assert.equal(f.entries.has('Child/note.md'), true);
  assert.deepEqual(f.renamed, [{ path: 'A/Child', target: 'B/Child' }, { path: 'B/Child', target: 'Child' }]);
  assert.equal(await f.bridge.move('Child', ''), 'Child');
  assert.equal(f.renamed.length, 2);
});

test('root, self/subtree moves, duplicates, file collisions and missing parents are rejected without writes', async () => {
  const f = fixture(['A', 'A/Child', 'B', 'B/A', 'Sibling'], ['File']);
  await assert.rejects(f.bridge.move('', 'B'), /根目录/);
  await assert.rejects(f.bridge.rename('', 'NewRoot'), /根目录/);
  await assert.rejects(f.bridge.move('A', 'A'), /自己/);
  await assert.rejects(f.bridge.move('A', 'A/Child'), /子文件夹/);
  await assert.rejects(f.bridge.move('A', 'B'), /同名/);
  await assert.rejects(f.bridge.move('A', 'Missing'), /父文件夹不存在/);
  await assert.rejects(f.bridge.move('A', 'File'), /父文件夹不存在/);
  await assert.rejects(f.bridge.rename('A', 'Sibling'), /同名/);
  await assert.rejects(f.bridge.rename('A', 'File'), /同名/);
  assert.deepEqual(f.renamed, []);
  assert.deepEqual(f.created, []);
});

test('strict names and paths reject traversal, hidden segments and invalid filenames; .md folder names stay intact', async () => {
  const f = fixture(['Safe']);
  assert.equal(folderName('name.md'), 'name.md');
  for (const name of ['', ' ', '.', '..', '.hidden', '../outside', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\n b', 'trailing.', 'CON', 'nul.txt', 'x'.repeat(181), '长'.repeat(81)]) {
    await assert.rejects(f.bridge.create('Safe', name), Error, name);
  }
  for (const parent of ['../outside', '.obsidian', 'Safe/.hidden', '/Safe', 'Safe/', 'Safe//Child', 'Safe\\Child']) await assert.rejects(f.bridge.create(parent, 'Child'));
  assert.deepEqual(f.created, []);
  assert.deepEqual(f.renamed, []);
});
