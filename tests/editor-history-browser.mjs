import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { richHarness, selectRendered, fixturePath, fixturePNG } from './rich-editor-harness.mjs';
const checks = {};
const source = '---\r\nkind: fixture\r\n---\r\n\r\n# Rich\r\n\r\n## 原始标题\r\n\r\n需要修改的段落。\r\n\r\n*原样星号* 与 [[Notes/Other|连接]]\r\n';
let h = await richHarness(source);
try {
  await selectRendered(h.editor, '需要修改的段落。');
  await h.page.keyboard.insertText('第一版正文。'); await h.flush();
  const changed = await h.body(); assert.match(changed, /第一版正文。/);
  await h.editor.blur(); await h.page.evaluate(() => window.richSnapshot());
  await h.page.waitForTimeout(120);
  await selectRendered(h.editor, '第一版正文。', true);
  await h.page.keyboard.press('Meta+z'); await h.flush(); assert.equal(await h.body(), source);
  await h.page.keyboard.press('Meta+Shift+z'); await h.flush(); assert.equal(await h.body(), changed);
  checks.savedTextUndoRedoAfterBlurAndSnapshot = true;
  assert.match(changed, /\*原样星号\* 与 \[\[Notes\/Other\|连接\]\]/);
  assert.equal(changed.replace(/\r\n/g, '').includes('\n'), false);
  checks.untouchedMarkdownAndCRLFPreservedExactly = true;

  // Duplicate cards share the same note history rather than Chromium's global stack.
  await selectRendered(h.peer, '第一版正文。', true); await h.page.keyboard.press('Meta+z'); await h.flush();
  assert.equal(await h.body(), source); assert.match(await h.editor.innerText(), /需要修改的段落。/);
  await h.page.keyboard.press('Control+y'); await h.flush(); assert.equal(await h.body(), changed);
  checks.duplicateCardsUseSameNoteTimeline = true;

  await h.frame.evaluate(() => { const n = board().nodes.find(n => n.id === 'peer'); n.doc = 'Notes/Other.md'; render(); });
  await selectRendered(h.peer, 'Target'); await h.page.keyboard.insertText('另一篇已改'); await h.flush();
  await selectRendered(h.editor, '第一版正文。', true); await h.page.keyboard.press('Meta+z'); await h.flush();
  assert.equal(await h.body(), source);
  assert.equal(await h.page.evaluate(() => richHost.payload.docs['Notes/Other.md'].body), '# Other\n\n另一篇已改');
  checks.differentNoteHistoriesNeverUndoEachOther = true;

  // A real external edit is compared against expectedBody; undo is retained as a
  // local recoverable draft and must never overwrite the external file.
  await h.page.keyboard.press('Meta+Shift+z'); await h.flush();
  await h.page.evaluate(path => { richHost.payload.docs[path].body = '# Rich\n\n外部编辑保留'; richSnapshot(); }, fixturePath);
  await h.page.waitForTimeout(100);
  await h.page.keyboard.press('Meta+z');
  assert.equal(await h.flush(), false);
  assert.equal(await h.body(), '# Rich\n\n外部编辑保留');
  assert.ok(await h.page.evaluate(path => !!richHost.recovery[path], fixturePath));
  checks.externalWriteConflictPreservesRemoteFileAndUndoDraft = true;
  assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
} finally { await h.close(); }

h = await richHarness('# Rich\n\n图片在这里插入\n\n另一段保持原样\n');
try {
  const original = await h.body();
  await selectRendered(h.editor, '这里', true);
  await h.editor.evaluate((el, png) => {
    const bytes = Uint8Array.from(atob(png.split(',')[1]), c => c.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'fixture.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, fixturePNG);
  await h.page.waitForFunction(path => richHost.payload.docs[path].body.includes('![[Assets/new-1.png]]'), fixturePath);
  await h.frame.waitForFunction(() => document.activeElement?.classList.contains('vb-inline-editor'));
  await h.flush(); const withImage = await h.body();
  assert.equal(await h.editor.locator('[data-image-markdown]').count(), 1);
  await h.page.keyboard.press('Meta+z'); await h.flush(); assert.equal(await h.body(), original);
  assert.equal(await h.editor.locator('[data-image-markdown]').count(), 0);
  await h.editor.blur(); await h.page.evaluate(() => richSnapshot()); await h.page.waitForTimeout(100);
  await selectRendered(h.editor, '图片在这里插入', true); await h.page.keyboard.press('Meta+Shift+z'); await h.flush();
  assert.equal(await h.body(), withImage); assert.equal(await h.editor.locator('[data-image-markdown]').count(), 1);
  assert.ok(await h.page.evaluate(() => richHost.payload.assets['Assets/new-1.png']));
  assert.equal(await h.page.evaluate(() => richHost.calls.filter(c => /delete|trash/.test(c.method)).length), 0);
  checks.pastedImageUndoRedoKeepsReusableLocalAttachment = true;

  const before = await h.body();
  const result = await h.frame.evaluate(path => VBInline.applyEdit(path, 'bad edit', { expectedBody: 'stale baseline' }), fixturePath);
  assert.equal(result.ok, false); assert.equal(await h.body(), before);
  checks.staleImageInsertionRefusesToReplaceNewerText = true;

  await selectRendered(h.editor, '另一段保持原样'); await h.page.keyboard.insertText('新的最后段落'); await h.flush();
  await h.editor.evaluate(el => el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyUndo' })));
  await h.flush(); assert.equal(await h.body(), before);
  await h.editor.evaluate(el => el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyRedo' })));
  await h.flush(); assert.match(await h.body(), /新的最后段落/);
  checks.editMenuHistoryEventsUseTheFocusedNoteTimeline = true;
  assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
} finally { await h.close(); }
h = await richHarness('# Rich\n\n' + Array.from({ length: 65 }, (_, i) => `第 ${i} 段：保留长文浏览位置。`).join('\n\n') + '\n');
try {
  const original = await h.body();
  await selectRendered(h.editor, '第 30 段', true);
  const top = await h.editor.evaluate(el => { el.scrollTop = 400; return el.scrollTop; });
  const next = original + '\n![[Assets/one.png]]\n';
  assert.equal((await h.frame.evaluate(({ path, original, next }) => VBInline.applyEdit(path, next, { expectedBody: original, node: 'article', start: original.length }), { path: fixturePath, original, next })).ok, true);
  await h.frame.evaluate(path => VBInline.focus(path, 'article'), fixturePath);
  await h.page.keyboard.press('Meta+z'); await h.flush(); assert.equal(await h.body(), original);
  assert.equal(await h.editor.evaluate(el => el.scrollTop), top);
  await h.page.keyboard.press('Meta+Shift+z'); await h.flush(); assert.equal(await h.body(), next);
  assert.equal(await h.editor.evaluate(el => el.scrollTop), top);
  checks.programmaticUndoRedoKeepsLongArticleScrollPosition = true;
  assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
} finally { await h.close(); }
await writeFile(new URL('../evidence/editor-history-browser.json', import.meta.url), JSON.stringify({ passed: true, checks, count: Object.keys(checks).length, mode: 'actual built sandbox frame with isolated mocked Vault; keyboard, paste, blur, snapshot and conflict checks' }, null, 2));
console.log(`Editor history browser checks passed: ${Object.keys(checks).length} groups.`);
