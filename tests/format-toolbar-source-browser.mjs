import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness } from './rich-editor-harness.mjs';

// Actual built sandbox frame and visible formatting controls. No personal Vault access.
const eol = '\r\n';
const paragraphs = ['苹果段 Alpha', '香蕉段 Beta', '樱桃段 Gamma'];
const prefix = ['\uFEFF---', 'aliases: ["稳定的文章"]', 'custom: "保留 : YAML"', '---', '', '# Rich', '', '未改前段：__原样粗体__、\\*原样星号\\*、[[Other#Section|双链别名]]。', '', ''].join(eol);
const suffix = ['', '', '未改尾段：[本地链接](Other.md#Section "原链接标题") 与 *原样斜体*。', '', '![[Assets/one.png|120]]', '', '```javascript', 'const keep = "original code";', '```', '', '[ref]: Other.md "原样引用定义"', ''].join(eol);
const original = prefix + paragraphs.join(eol + eol) + suffix;
const evidence = new URL('../evidence/', import.meta.url);
await mkdir(evidence, { recursive: true });
const checks = [];
const versions = [];

async function scenario(count, firstKind) {
  const h = await richHarness(original);
  let frame = h.frame, editor = h.editor;
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = await frame.evaluate(() => ({ view: { ...board().view }, nodes: board().nodes.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })) }));
  const outsideAfter = (count < paragraphs.length ? eol + eol + paragraphs.slice(count).join(eol + eol) : '') + suffix;
  const selectedSource = paragraphs.slice(0, count).join(eol + eol);
  try {
    async function selectParagraphs() {
      await editor.getByText(paragraphs[0], { exact: true }).click();
      await editor.evaluate((el, labels) => {
        const textNodes = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        const first = textNodes.find(node => node.nodeValue.includes(labels[0]));
        const last = textNodes.find(node => node.nodeValue.includes(labels.at(-1)));
        if (!first || !last) throw Error('The visible paragraph selection is unavailable');
        const range = document.createRange();
        range.setStart(first, first.nodeValue.indexOf(labels[0]));
        range.setEnd(last, last.nodeValue.indexOf(labels.at(-1)) + labels.at(-1).length);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      }, paragraphs.slice(0, count));
    }
    async function click(kind) {
      await frame.getByTestId('format-' + kind).click();
      assert.equal(await editor.getAttribute('data-markdown-mode'), 'edit');
      assert.equal(await editor.evaluate(el => document.activeElement === el), true, 'formatting keeps the actual editor focused');
    }
    async function save() {
      assert.equal(await frame.evaluate(() => VBInline.flushAll()), true);
      const value = await h.body();
      assert.ok(value.startsWith(prefix), 'YAML, hidden H1, CRLF, prior paragraph and wikilink must stay byte-identical');
      assert.ok(value.endsWith(outsideAfter), 'all following paragraphs, source image, link, code and reference definition must stay byte-identical');
      const middle = value.slice(prefix.length, value.length - outsideAfter.length);
      assert.equal(/^\r?\n|\r?\n$/.test(middle), false, 'a structure command must not multiply original paragraph gaps at its boundaries');
      for (const label of paragraphs) assert.equal(value.split(label).length - 1, 1, 'list transforms must not duplicate or lose ' + label);
      assert.equal(/(?<!\r)\n/.test(value), false, 'the complete source retains its CRLF convention');
      assert.deepEqual(await frame.evaluate(() => ({ view: { ...board().view }, nodes: board().nodes.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })) })), geometry);
      return { value, middle };
    }
    async function assertList(kind) {
      const tag = kind === 'ordered-list' ? 'ol' : 'ul';
      assert.deepEqual(await editor.locator(tag + ' > li').allTextContents(), paragraphs.slice(0, count));
      assert.equal(await editor.locator(tag === 'ol' ? 'ul' : 'ol').count(), 0);
      assert.equal(await editor.locator('h1').count(), 0);
      assert.equal((await editor.textContent()).includes('custom:'), false);
      assert.equal(await editor.locator('img[data-image-path="Assets/one.png"]').count(), 1);
      assert.match(await editor.locator('pre code.language-javascript').textContent(), /original code/);
    }
    await selectParagraphs();
    await click(firstKind); await assertList(firstKind);
    const first = await save(); versions.push({ count, command: firstKind, source: first.value });
    await h.page.keyboard.press('Meta+z');
    assert.equal((await save()).value, original, 'native text undo restores exact original paragraphs and gaps');
    await h.page.keyboard.press('Meta+Shift+z'); await assertList(firstKind);
    assert.equal((await save()).value, first.value, 'native redo restores the exact saved list source');
    checks.push(count + ' paragraphs -> ' + firstKind + '; native undo/redo is exact');

    const otherKind = firstKind === 'ordered-list' ? 'unordered-list' : 'ordered-list';
    await click(otherKind); await assertList(otherKind);
    const other = await save(); versions.push({ count, command: otherKind, source: other.value });
    await h.page.keyboard.press('Meta+z'); await assertList(firstKind); assert.equal((await save()).value, first.value);
    await h.page.keyboard.press('Meta+Shift+z'); await assertList(otherKind); assert.equal((await save()).value, other.value);
    checks.push(count + ' paragraphs UL/OL interchange keeps surrounding exact source and native history');

    await selectParagraphs(); await click(otherKind);
    assert.equal(await editor.locator('ul,ol').count(), 0);
    const cancelled = await save();
    assert.equal(cancelled.middle, selectedSource, 'turning a list off restores plain paragraph source without extra gaps or lost words');
    assert.equal(cancelled.value, original);
    await h.page.keyboard.press('Meta+z'); await assertList(otherKind); assert.equal((await save()).value, other.value);
    await h.page.keyboard.press('Meta+Shift+z'); assert.equal((await save()).value, original);
    await h.page.keyboard.press('Meta+z'); await assertList(otherKind); assert.equal((await save()).value, other.value);
    checks.push(count + ' paragraphs list cancellation and native undo/redo preserve original paragraphs');

    await editor.evaluate(el => { el.__formatIdentity = 'keep-active-editor'; window.__formatAnchor = getSelection().anchorNode; window.__formatOffset = getSelection().anchorOffset; });
    await h.page.evaluate(() => window.richSnapshot());
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await editor.evaluate(el => el.__formatIdentity === 'keep-active-editor' && document.activeElement === el && getSelection().anchorNode === window.__formatAnchor && getSelection().anchorOffset === window.__formatOffset), true);
    assert.equal((await save()).value, other.value);
    await h.page.screenshot({ path: new URL('format-toolbar-' + count + '-paragraphs.png', evidence).pathname });
    checks.push(count + ' paragraphs snapshot retains active list DOM, caret and exact saved Markdown');

    await h.page.evaluate(() => window.richReopen());
    await h.page.waitForFunction(() => window.richHost.ready);
    frame = h.page.frames().find(item => item.parentFrame());
    editor = frame.locator('[data-node="article"] .vb-inline-editor');
    await editor.waitFor(); await assertList(otherKind);
    assert.equal(await h.body(), other.value);
    if (count === 3) {
      // A caret in the middle item must cancel that item alone, preserving both list fragments.
      await editor.getByText(paragraphs[1], { exact: true }).click();
      await editor.evaluate((el, label) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
        while (node = walker.nextNode()) if (node.nodeValue === label) {
          const range = document.createRange(); range.setStart(node, 2); range.collapse(true);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return;
        }
        throw Error('The middle list item is unavailable');
      }, paragraphs[1]);
      await click(otherKind);
      const tag = otherKind === 'ordered-list' ? 'ol' : 'ul';
      const assertPartial = async () => {
        assert.deepEqual(await editor.locator(tag + '>li').allTextContents(), [paragraphs[0], paragraphs[2]]);
        assert.equal(await editor.locator(tag).count(), 2);
        assert.equal(await editor.getByText(paragraphs[1], { exact: true }).evaluate(el => !el.closest('li')), true);
        if (tag === 'ol') assert.equal(await editor.locator('ol').nth(1).evaluate(el => el.start), 3, 'numbered items after the cancelled middle item keep their numbering');
      };
      await assertPartial(); const partial = await save();
      await h.page.keyboard.press('Meta+z'); await assertList(otherKind); assert.equal((await save()).value, other.value);
      await h.page.keyboard.press('Meta+Shift+z'); await assertPartial(); assert.equal((await save()).value, partial.value);
      await h.page.evaluate(() => window.richReopen()); await h.page.waitForFunction(() => window.richHost.ready);
      frame = h.page.frames().find(item => item.parentFrame()); editor = frame.locator('[data-node="article"] .vb-inline-editor');
      await editor.waitFor(); await assertPartial(); assert.equal(await h.body(), partial.value);
      checks.push('partial middle-item cancellation preserves surrounding list items/numbering, protected source, native undo/redo and reopen');
    }
    assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
    assert.equal(await h.page.evaluate(() => JSON.stringify(window.richHost.payload.layout).includes('original code')), false, 'Markdown bodies never enter the layout document');
    checks.push(count + ' paragraphs saved list reopens with its rendered structure and original protected source');
  } catch (error) {
    await h.page.screenshot({ path: new URL('format-toolbar-source-failure.png', evidence).pathname }).catch(() => {});
    await writeFile(new URL('format-toolbar-source-failure.json', evidence), JSON.stringify({ error: String(error), count, firstKind, checks, source: await h.body().catch(() => null), dom: await editor.evaluate(el => el.innerHTML).catch(() => null), errors: h.errors }, null, 2));
    throw error;
  } finally { await h.close(); }
}

async function headingScenario(existingTitle) {
  const lead = ['\uFEFF---', 'custom: "标题切换仍保留"', '---', '', ...(existingTitle ? ['# Rich', ''] : []), ''].join(eol);
  const text = '首段正文 Visible block';
  const tail = ['', '', '未改后段 [[Other#Section|原双链]]。', '', '![[Assets/one.png|120]]', ''].join(eol);
  const h = await richHarness(lead + text + tail);
  let frame = h.frame, editor = h.editor;
  try {
    for (const level of [1, 2, 3]) {
      await editor.getByText(text, { exact: true }).click();
      await editor.evaluate((el, text) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
        while (node = walker.nextNode()) {
          if (node.nodeValue !== text) continue;
          const range = document.createRange(); range.selectNodeContents(node);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return;
        }
        throw Error('Visible heading target is unavailable');
      }, text);
      await frame.getByTestId('format-h' + level).click();
      assert.equal(await editor.locator(':scope > h' + level).textContent(), text);
      assert.equal(await frame.evaluate(() => VBInline.flushAll()), true);
      const expected = lead + '#'.repeat(level) + ' ' + text + tail;
      assert.equal(await h.body(), expected, 'heading formatting modifies only the selected first visible block');
      await h.page.evaluate(() => window.richReopen());
      await h.page.waitForFunction(() => window.richHost.ready);
      frame = h.page.frames().find(item => item.parentFrame());
      editor = frame.locator('[data-node="article"] .vb-inline-editor');
      await editor.waitFor();
      assert.equal(await editor.locator(':scope > h' + level).textContent(), text, 'a user-created leading heading must remain visible after reopening');
      assert.equal(await h.body(), expected);
      assert.equal(await editor.locator('img[data-image-path="Assets/one.png"]').count(), 1);
      if (existingTitle) assert.equal((await editor.locator(':scope > h1').allTextContents()).includes('Rich'), false, 'the existing document title prefix stays hidden');
      versions.push({ existingTitle, command: 'h' + level, source: expected });
      checks.push((existingTitle ? 'existing hidden title' : 'no original H1') + ': H' + level + ' preserves source and remains visible after reopen');
    }
    assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
    await h.page.screenshot({ path: new URL('format-toolbar-headings-' + (existingTitle ? 'existing-title' : 'no-title') + '.png', evidence).pathname });
  } catch (error) {
    await h.page.screenshot({ path: new URL('format-toolbar-heading-failure.png', evidence).pathname }).catch(() => {});
    await writeFile(new URL('format-toolbar-heading-failure.json', evidence), JSON.stringify({ error: String(error), existingTitle, checks, source: await h.body().catch(() => null), dom: await editor.evaluate(el => el.innerHTML).catch(() => null), errors: h.errors }, null, 2));
    throw error;
  } finally { await h.close(); }
}

await headingScenario(false);
await headingScenario(true);
await scenario(3, 'unordered-list');
await scenario(2, 'ordered-list');
await writeFile(new URL('format-toolbar-source-browser.json', evidence), JSON.stringify({ passed: true, checks, versions, exactProtectedSource: ['BOM', 'YAML', 'hidden H1', 'CRLF', 'unselected paragraphs', 'wiki link', 'image token', 'fenced code', 'reference definition'], nativeUndoRedo: true, snapshotAndReopen: true, userVaultAccessed: false }, null, 2));
console.log('Format toolbar source checks passed: ' + checks.length + ' groups with two/three paragraphs, lists, exact protected source and native undo/redo.');
