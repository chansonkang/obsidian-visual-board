import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { revealVaultEntry } from '../src/explorer';

function fixture({ treeAPI = true, revealAPI = true, item = true } = {}) {
  const classes = new Set<string>(), previousClasses = new Set(['is-selected']);
  const element = (set: Set<string>) => ({ classList: { add: (value: string) => { set.add(value); }, remove: (value: string) => { set.delete(value); } } });
  const row = { selfEl: element(classes) }, previous = { selfEl: element(previousClasses) };
  const root = { path: '', parent: null }, parent = { path: 'Folder', parent: root }, child = { path: 'Folder/Child', parent }, file = { path: 'Folder/Child/Article.md', parent: child };
  const rows = item ? { [file.path]: row, [child.path]: row, previous } : {};
  const callbacks: Array<() => void> = [], calls: string[] = [], focused: unknown[] = [];
  const board = { name: 'board' }, another = { name: 'another-tab' };
  let explorer: any;
  const workspace = {
    activeLeaf: board,
    getLeavesOfType: (type: string) => { assert.equal(type, 'file-explorer'); return [explorer]; },
    revealLeaf: async (leaf: unknown) => { assert.equal(leaf, explorer); calls.push('reveal-existing-right-leaf'); },
    setActiveLeaf: (leaf: any, options?: unknown) => { workspace.activeLeaf = leaf; focused.push(options); calls.push('active:' + leaf.name); },
    getLeftLeaf: () => { throw new Error('Must not relocate sidebar'); },
    getLeaf: () => { throw new Error('Must not open any content leaf'); },
  };
  const view: any = { fileItems: rows };
  if (treeAPI) view.tree = {
    clearSelectedDoms: () => { calls.push('clear-selection'); previousClasses.delete('is-selected'); },
    selectItem: (selected: unknown) => { assert.equal(selected, row); calls.push('select-item'); classes.add('is-selected'); },
  };
  if (revealAPI) view.revealInFolder = (entry: any) => {
    calls.push('native-reveal:' + entry.path);
    let ancestor = entry.parent;
    while (ancestor?.path) { calls.push('expand:' + ancestor.path); ancestor = ancestor.parent; }
    callbacks.push(() => { calls.push('native-scroll'); workspace.setActiveLeaf(explorer); });
  };
  explorer = { name: 'right-explorer', view, sidebarPosition: 'right', openFile: () => { throw Error('Must not open an article'); }, setViewState: () => { throw Error('Must not replace view'); } };
  const entries: Record<string, unknown> = { [file.path]: file, [child.path]: child };
  const app = { workspace, vault: { getAbstractFileByPath: (path: string) => entries[path] || null }, nextFrame: (callback: () => void) => { callbacks.push(callback); } } as unknown as App;
  async function flush() { for (let i = 0; i < 4; i++) await Promise.resolve(); while (callbacks.length) callbacks.shift()!(); }
  return { app, workspace, board, another, explorer, view, callbacks, calls, classes, previousClasses, focused, flush, entries, file, child, row };
}

test('native article reveal expands ancestors, uses verified tree selection, restores Board and keeps right sidebar', async () => {
  const f = fixture(), locating = revealVaultEntry(f.app, 'Folder/Child/Article.md');
  await f.flush(); await locating;
  assert.ok(f.calls.includes('expand:Folder/Child')); assert.ok(f.calls.includes('expand:Folder'));
  assert.deepEqual(f.calls.slice(-3), ['active:board', 'clear-selection', 'select-item']);
  assert.equal(f.workspace.activeLeaf, f.board);
  assert.equal(f.explorer.sidebarPosition, 'right');
  assert.equal(f.classes.has('is-selected'), true); assert.equal(f.previousClasses.has('is-selected'), false);
  assert.deepEqual(f.focused.at(-1), { focus: false });
});

test('folders reveal by exact path using the same existing explorer and no article opening', async () => {
  const f = fixture(), locating = revealVaultEntry(f.app, 'Folder/Child');
  await f.flush(); await locating;
  assert.ok(f.calls.includes('native-reveal:Folder/Child')); assert.ok(f.calls.includes('expand:Folder'));
  assert.equal(f.workspace.activeLeaf, f.board);
});

test('a newly created file waits for its delayed explorer row, then reveals once without moving or focusing the sidebar', async () => {
  const f = fixture({ item: false }), locating = revealVaultEntry(f.app, f.file.path);
  await f.flush();
  assert.equal(f.calls.some(call => call.startsWith('native-reveal:')), false);
  setTimeout(() => { f.view.fileItems[f.file.path] = f.row; }, 15);
  await new Promise(resolve => setTimeout(resolve, 75));
  await f.flush(); await locating;
  assert.equal(f.calls.filter(call => call.startsWith('native-reveal:')).length, 1);
  assert.equal(f.classes.has('is-selected'), true);
  assert.equal(f.workspace.activeLeaf, f.board);
  assert.equal(f.explorer.sidebarPosition, 'right');
  assert.deepEqual(f.focused, [undefined, { focus: false }]);
});

test('a delayed row cannot reveal a deleted or replaced file at the same path', async () => {
  for (const replace of [false, true]) {
    const f = fixture({ item: false }), rejected = assert.rejects(revealVaultEntry(f.app, f.file.path), /移动或删除/);
    await f.flush();
    if (replace) f.entries[f.file.path] = { ...f.file };
    else delete f.entries[f.file.path];
    f.view.fileItems[f.file.path] = f.row;
    await rejected;
    assert.equal(f.calls.some(call => call.startsWith('native-reveal:')), false);
    assert.equal(f.workspace.activeLeaf, f.board);
  }
});

test('user navigation during row loading cancels the stale reveal without stealing leaf or editor focus', async () => {
  const f = fixture({ item: false }), locating = revealVaultEntry(f.app, f.file.path);
  await f.flush();
  f.workspace.activeLeaf = f.another;
  f.view.fileItems[f.file.path] = f.row;
  await locating;
  assert.equal(f.workspace.activeLeaf, f.another);
  assert.equal(f.calls.some(call => call.startsWith('native-reveal:')), false);
  assert.equal(f.classes.has('is-selected'), false);
  assert.deepEqual(f.focused, []);
});

test('a newer reveal supersedes an older request still waiting for its new-file row', async () => {
  const f = fixture({ item: false }), first = revealVaultEntry(f.app, f.file.path);
  await f.flush();
  f.view.fileItems[f.child.path] = f.row;
  const second = revealVaultEntry(f.app, f.child.path);
  await f.flush(); await second;
  f.view.fileItems[f.file.path] = f.row;
  await first;
  assert.deepEqual(f.calls.filter(call => call.startsWith('native-reveal:')), ['native-reveal:' + f.child.path]);
  assert.equal(f.workspace.activeLeaf, f.board);
});

test('a later user tab choice is retained after native reveal callback instead of returning to old Board', async () => {
  const f = fixture(), locating = revealVaultEntry(f.app, 'Folder/Child/Article.md');
  for (let i = 0; i < 4; i++) await Promise.resolve();
  f.workspace.activeLeaf = f.another;
  await f.flush(); await locating;
  assert.equal(f.workspace.activeLeaf, f.another);
  assert.equal(f.calls.includes('active:board'), false);
});

test('verified native activation without a focus argument retains iframe, editor and caret without refocusing', async () => {
  const f = fixture(); let refocusCount = 0;
  const caret = { anchorOffset: 17, focusOffset: 17 }, editor = { name: 'inline-editor' };
  const iframe = { isConnected: true, focus: () => { refocusCount++; }, contentDocument: { activeElement: editor, selection: caret } };
  const document = { activeElement: iframe };
  Object.assign(f.board, { view: { contentEl: { ownerDocument: document } } });
  const locating = revealVaultEntry(f.app, 'Folder/Child/Article.md');
  await f.flush(); await locating;
  assert.equal(document.activeElement, iframe);
  assert.equal(iframe.contentDocument.activeElement, editor);
  assert.deepEqual(iframe.contentDocument.selection, { anchorOffset: 17, focusOffset: 17 });
  assert.equal(refocusCount, 0, 'bridge must not unnecessarily focus an iframe and reset child editor selection');
  assert.equal(f.workspace.activeLeaf, f.board);
});

test('later user tab and DOM focus choices are retained and the old iframe is never refocused', async () => {
  const f = fixture(); let refocusCount = 0;
  const iframe = { isConnected: true, focus: () => { refocusCount++; } }, otherEditor = { name: 'other-editor' };
  const document: { activeElement: unknown } = { activeElement: iframe };
  Object.assign(f.board, { view: { contentEl: { ownerDocument: document } } });
  const locating = revealVaultEntry(f.app, 'Folder/Child/Article.md');
  for (let i = 0; i < 4; i++) await Promise.resolve();
  f.workspace.activeLeaf = f.another; document.activeElement = otherEditor;
  await f.flush(); await locating;
  assert.equal(f.workspace.activeLeaf, f.another);
  assert.equal(document.activeElement, otherEditor);
  assert.equal(refocusCount, 0);
});

test('missing tree selection API has a detected fileItems class fallback', async () => {
  const f = fixture({ treeAPI: false }), locating = revealVaultEntry(f.app, 'Folder/Child/Article.md');
  await f.flush(); await locating;
  assert.equal(f.classes.has('is-selected'), true); assert.equal(f.previousClasses.has('is-selected'), false);
  assert.equal(f.workspace.activeLeaf, f.board);
});

test('invalid paths, missing entries, unavailable explorer and unsupported view produce clear failures', async () => {
  const f = fixture();
  for (const path of ['', '/outside', '../outside', 'Folder/../Article.md', 'Folder\\Article.md', '.obsidian/data.json', 'Folder/.hidden/note.md']) await assert.rejects(revealVaultEntry(f.app, path), /普通文章或文件夹/);
  await assert.rejects(revealVaultEntry(f.app, 'Missing.md'), /移动或删除/);
  assert.deepEqual(f.calls, []);
  f.workspace.getLeavesOfType = () => [];
  await assert.rejects(revealVaultEntry(f.app, 'Folder/Child'), /文件列表尚未打开/);
  const unsupported = fixture({ revealAPI: false });
  await assert.rejects(revealVaultEntry(unsupported.app, 'Folder/Child'), /不支持定位/);
  const absentRow = fixture({ item: false });
  await assert.rejects(revealVaultEntry(absentRow.app, 'Folder/Child'), /未加载此条目/);
  const broken = fixture(); broken.view.revealInFolder = () => { throw new TypeError('Internal implementation changed'); };
  await assert.rejects(revealVaultEntry(broken.app, 'Folder/Child'), /重新打开文件列表侧栏/);
});
