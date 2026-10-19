import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { richHarness, selectRendered } from './rich-editor-harness.mjs';
const original = '# Rich\n\n## 标题\n\n需要强调的文字\n\n- 列表第一项\n- 列表第二项\n\n| 第一列 | 第二列 |\n| --- | --- |\n| 单元格甲 | 单元格乙 |\n\n末尾段落\n';
const checks = {};
let h = await richHarness(original);
try {
  const { editor, page } = h;
  await selectRendered(editor, '需要强调的文字'); await page.keyboard.press('Meta+b'); await h.flush();
  assert.match(await h.body(), /\*\*需要强调的文字\*\*/);
  assert.equal(await editor.locator('strong,b').textContent(), '需要强调的文字');
  await page.keyboard.press('Meta+i'); await h.flush();
  assert.equal(await editor.locator('em,i').textContent(), '需要强调的文字');
  await page.keyboard.press('Meta+z'); await h.flush();
  assert.equal(await editor.locator('em,i').count(), 0);
  assert.equal(await editor.locator('strong,b').count(), 1);
  checks.formatShortcutsAndNativeTextUndo = true;

  await selectRendered(editor, '单元格甲', true); await page.keyboard.press('Tab');
  assert.match(await editor.evaluate(() => (getSelection().anchorNode.nodeType === 1 ? getSelection().anchorNode : getSelection().anchorNode.parentElement).closest('td,th').textContent), /单元格乙/);
  await page.keyboard.press('Shift+Tab');
  assert.match(await editor.evaluate(() => (getSelection().anchorNode.nodeType === 1 ? getSelection().anchorNode : getSelection().anchorNode.parentElement).closest('td,th').textContent), /单元格甲/);
  await page.keyboard.insertText('新增'); await h.flush();
  assert.match(await h.body(), /单元格甲新增/);
  assert.equal(await editor.locator('table').count(), 1);
  checks.tableTabAndShiftTabStayWithinCells = true;

  await selectRendered(editor, '列表第二项'); await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter'); await page.keyboard.insertText('第三项'); await h.flush();
  assert.equal(await editor.locator('ul li').count(), 3);
  assert.match(await h.body(), /- +第三项/);
  checks.enterContinuesExistingList = true;

  await selectRendered(editor, '末尾段落'); await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+Enter'); await page.keyboard.insertText('同段换行'); await h.flush();
  assert.match(await h.body(), /末尾段落 {2,}\n同段换行/);
  await editor.blur();
  assert.equal(await editor.locator('p').filter({ hasText: '末尾段落' }).locator('br').count(), 1);
  checks.shiftEnterKeepsHardLineBreak = true;
  assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
} finally { await h.close(); }
h = await richHarness('# Rich\n\n');
try {
  await h.editor.click(); await h.page.keyboard.insertText('空白文章直接书写'); await h.flush();
  assert.match(await h.body(), /^# Rich\n\n空白文章直接书写/);
  await h.editor.blur(); assert.equal(await h.editor.innerText(), '空白文章直接书写');
  assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
  checks.emptyArticleRemainsEditableWithHiddenTitlePreserved = true;
  await writeFile(new URL('../evidence/rich-editor-keys-browser.json', import.meta.url), JSON.stringify({ passed: true, checks, count: Object.keys(checks).length, mode: 'actual frame and trusted keyboard input; isolated mocked Vault' }, null, 2));
  console.log(`Rich editor keyboard checks passed: ${Object.keys(checks).length} groups.`);
} finally { await h.close(); }
