import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness } from './rich-editor-harness.mjs';

// Narrow native-reported path: one collapsed paragraph, LF source, saved iframe reopen.
const original = '# 列表工具\n\n第一项。\n\n第二项。\n\n第三项。\n';
const prefix = '# 列表工具\n\n', tail = '\n\n第二项。\n\n第三项。\n';
const evidence = new URL('../evidence/', import.meta.url), cases = [];
await mkdir(evidence, { recursive: true });
async function scenario(offset, cancelKind) {
const h = await richHarness(original);
let frame = h.frame, editor = h.editor;
const stages = [];
try {
  async function collapsedFirst() {
    await editor.getByText('第一项。', { exact: true }).click();
    await editor.evaluate((el, offset) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
      while (node = walker.nextNode()) if (node.nodeValue === '第一项。') {
        const range = document.createRange(); range.setStart(node, offset); range.collapse(true);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return;
      }
      throw Error('First paragraph text unavailable');
    }, offset);
    assert.equal(await editor.evaluate(() => getSelection().isCollapsed), true);
  }
  async function save(stage, expected) {
    assert.equal(await frame.evaluate(() => VBInline.flushAll()), true);
    const source = await h.body(); stages.push({ stage, source });
    assert.equal(source, expected, stage + ': complete Markdown and LF gaps must be exact');
    for (const text of ['第一项。', '第二项。', '第三项。']) assert.equal(source.split(text).length - 1, 1);
    return source;
  }
  async function command(kind) {
    await frame.getByTestId('format-' + kind).click();
    assert.equal(await editor.evaluate(el => document.activeElement === el), true);
  }
  await collapsedFirst();
  await command('unordered-list');
  assert.deepEqual(await editor.locator('ul>li').allTextContents(), ['第一项。']); await save('collapsed first paragraph -> UL', prefix + '-   第一项。' + tail);
  if (cancelKind === 'ordered-list') {
    await command('ordered-list');
    assert.deepEqual(await editor.locator('ol>li').allTextContents(), ['第一项。']); await save('UL -> OL', prefix + '1.  第一项。' + tail);
  }
  await command(cancelKind);
  assert.equal(await editor.locator('ul,ol').count(), 0); await save(cancelKind + ' off before reopen', original);

  await h.page.evaluate(() => window.richReopen()); await h.page.waitForFunction(() => window.richHost.ready);
  frame = h.page.frames().find(item => item.parentFrame()); editor = frame.locator('[data-node="article"] .vb-inline-editor'); await editor.waitFor();
  assert.equal(await h.body(), original); assert.equal(await editor.locator('ul,ol').count(), 0);
  await collapsedFirst(); await command('ordered-list');
  assert.deepEqual(await editor.locator('ol>li').allTextContents(), ['第一项。']); const ordered = await save('reopen -> OL', prefix + '1.  第一项。' + tail);
  await h.page.keyboard.press('Meta+z');
  assert.equal(await editor.locator('ul,ol').count(), 0); await save('reopened OL -> native CmdZ', original);
  await h.page.keyboard.press('Meta+Shift+z');
  assert.deepEqual(await editor.locator('ol>li').allTextContents(), ['第一项。']); await save('native redo -> OL', ordered);
  assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
  if (offset === 0 && cancelKind === 'ordered-list') await h.page.screenshot({ path: new URL('format-toolbar-single-source.png', evidence).pathname });
  cases.push({ offset, cancelKind, stages });
} catch (error) {
  await h.page.screenshot({ path: new URL('format-toolbar-single-source-failure.png', evidence).pathname }).catch(() => {});
  await writeFile(new URL('format-toolbar-single-source-failure.json', evidence), JSON.stringify({ error: String(error), offset, cancelKind, stages, source: await h.body().catch(() => null), dom: await editor.evaluate(el => el.innerHTML).catch(() => null), errors: h.errors }, null, 2));
  throw error;
} finally { await h.close(); }
}

for (const offset of [0, 1, 2, '第一项。'.length]) for (const kind of ['unordered-list', 'ordered-list']) await scenario(offset, kind);
await writeFile(new URL('format-toolbar-single-source-browser.json', evidence), JSON.stringify({ passed: true, original, cases, userVaultAccessed: false, nativeOnlyInvestigation: 'The reported six-LF native history could not be reproduced in the isolated built-frame cases; no production changes inferred from this check.' }, null, 2));
console.log('Single collapsed paragraph format/source checks passed: ' + cases.length + ' offset/cancel paths; save/reopen -> OL -> native CmdZ/redo; exact full LF source.');
