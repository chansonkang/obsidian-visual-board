import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness, selectRendered } from './rich-editor-harness.mjs';

// Exercise the bundled editing surface and its actual clipboard event path.
// The parent broker is an isolated Vault fixture; no personal files or API calls.
const checks = {}, failures = [], evidence = new URL('../evidence/', import.meta.url);
await mkdir(evidence, { recursive: true });
async function pasteText(editor, text) {
  await editor.evaluate((el, text) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  }, text);
}
async function fixture(source, run) {
  const h = await richHarness(source);
  try { await run(h); assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []); }
  catch (error) { failures.push(error); console.error(error.message); await h.page.screenshot({ path: new URL('markdown-marker-failure-' + failures.length + '.png', evidence).pathname }); }
  finally { await h.close(); }
}

await fixture('# Rich\n\n## Visible heading\n\n**Bold** and _italic_ and ~~removed~~.\n\n- First item\n- Second item\n\n| Name | Value |\n| --- | --- |\n| Alpha | 12 |\n\nLiteral \\*stars\\* and `**code**`.\n\n```text\n## literal heading\n**literal bold**\n```\n', async h => {
  const before = await h.editor.evaluate(el => ({ structure: [...el.querySelectorAll('*')].map(n => n.tagName), text: el.innerText, height: el.scrollHeight }));
  const original = await h.body();
  await selectRendered(h.editor, 'Visible heading');
  assert.deepEqual(await h.editor.evaluate(el => ({ structure: [...el.querySelectorAll('*')].map(n => n.tagName), text: el.innerText, height: el.scrollHeight })), before, 'focus must not expose Markdown source or change rendered content');
  assert.equal(await h.editor.locator('h2').textContent(), 'Visible heading');
  assert.equal(await h.editor.locator('strong').textContent(), 'Bold');
  assert.equal(await h.editor.locator('em').textContent(), 'italic');
  assert.equal(await h.editor.locator('s,del').textContent(), 'removed');
  assert.equal(await h.editor.locator('ul li').count(), 2);
  assert.equal(await h.editor.locator('table tbody tr').count(), 1);
  await h.editor.blur(); await h.flush();
  assert.equal(await h.body(), original, 'focus alone must preserve original Markdown bytes');
  checks.existingStandardMarkdownDoesNotRevealSourceOnFocus = true;
  assert.match(await h.editor.innerText(), /Literal \*stars\* and \*\*code\*\*/);
  assert.equal(await h.editor.locator('pre code').textContent(), '## literal heading\n**literal bold**\n');
  checks.intentionalLiteralsAndCodeKeepTheirPunctuation = true;
});

const markdown = '## Pasted heading\n\n**Pasted bold** and _Pasted italic_\n\n- Pasted first\n- Pasted second\n\n| Column A | Column B |\n| --- | --- |\n| Alpha | Beta |\n\n> Pasted quote';
await fixture('# Rich\n\nReplace this paragraph\n\nUntouched **tail**\n', async h => {
  const original = await h.body();
  await selectRendered(h.editor, 'Replace this paragraph');
  await pasteText(h.editor, markdown); await h.flush();
  assert.equal(await h.editor.locator('h2').textContent(), 'Pasted heading');
  assert.equal(await h.editor.locator('strong').first().textContent(), 'Pasted bold');
  assert.equal(await h.editor.locator('em').textContent(), 'Pasted italic');
  assert.equal(await h.editor.locator('ul li').count(), 2);
  assert.equal(await h.editor.locator('table tbody tr').count(), 1);
  assert.equal((await h.editor.locator('blockquote').textContent()).trim(), 'Pasted quote');
  const saved = await h.body();
  assert.match(saved, /## Pasted heading/); assert.match(saved, /\*\*Pasted bold\*\*/);
  assert.match(saved, /\| Column A \| Column B \|/);
  assert.equal(saved.includes('Replace this paragraph'), false, 'the first pasted block must actually replace source, not just the DOM');
  assert.match(saved, /Untouched \*\*tail\*\*/);
  assert.equal(saved.includes('\\*\\*Pasted'), false, 'formatting must not save as escaped visible punctuation');
  checks.markdownPasteRendersBlocksAndSavesTheirRealSource = true;
  await h.page.keyboard.press('Meta+z'); await h.flush();
  assert.equal(await h.body(), original, 'one undo restores paste replacement and original source');
  await h.page.keyboard.press('Meta+Shift+z'); await h.flush();
  assert.equal(await h.body(), saved, 'redo restores the formatted Markdown paste');
  checks.markdownPasteSupportsUndoAndRedo = true;
  await h.editor.blur();
  await h.page.evaluate(() => richReopen()); await h.page.waitForFunction(() => richHost.ready);
  const frame = h.page.frames().find(f => f.parentFrame());
  const reopened = frame.locator('[data-node="article"] .vb-inline-editor');
  await reopened.locator('h2').waitFor();
  assert.equal(await reopened.locator('h2').textContent(), 'Pasted heading');
  assert.equal(await reopened.locator('table tbody tr').count(), 1);
  checks.reopenPreservesPastedRichFormatting = true;
});

for (const [marker, selector, content] of [
  ['# ', 'h1', 'Typed title one'], ['## ', 'h2', 'Typed title two'], ['### ', 'h3', 'Typed title three'],
  ['- ', 'ul li', 'Typed bullet'], ['1. ', 'ol li', 'Typed numbered'], ['> ', 'blockquote', 'Typed quote'],
]) await fixture('# Rich\n\n', async h => {
  await h.editor.click(); await h.page.keyboard.type(marker); await h.page.keyboard.insertText(content); await h.flush();
  assert.equal((await h.editor.locator(selector).textContent()).trim(), content, marker + ' converts to rich structure');
  assert.equal((await h.editor.innerText()).trim(), content, 'typing marker is hidden by structure');
  const saved = await h.body();
  assert.ok(saved.includes(content));
  await h.editor.blur();
  assert.equal((await h.editor.locator(selector).textContent()).trim(), content, 'rendered structure survives blur');
  checks['typedShortcut:' + marker.trim()] = true;
});

for (const [source, selector, visible] of [
  ['**Typed bold**', 'strong,b', 'Typed bold'], ['_Typed italic_', 'em,i', 'Typed italic'],
  ['~~Typed removed~~', 's,del,strike', 'Typed removed'], ['`**literal**`', 'code', '**literal**'],
]) await fixture('# Rich\n\n', async h => {
  await h.editor.click(); await h.page.keyboard.type(source); await h.flush();
  assert.equal(await h.editor.locator(selector).textContent(), visible);
  assert.equal((await h.editor.innerText()).trim(), visible);
  await h.page.keyboard.type(' ordinary'); await h.flush();
  assert.equal(await h.editor.locator(selector).textContent(), visible, 'following ordinary text leaves the closed mark');
  assert.equal((await h.editor.innerText()).trim(), visible + ' ordinary');
  await h.editor.blur();
  assert.equal(await h.editor.locator(selector).textContent(), visible);
  await h.page.evaluate(() => richReopen()); await h.page.waitForFunction(() => richHost.ready);
  const reopenedFrame = h.page.frames().find(f => f.parentFrame());
  const reopenedEditor = reopenedFrame.locator('[data-node="article"] .vb-inline-editor');
  await reopenedEditor.locator(selector).waitFor();
  assert.equal(await reopenedEditor.locator(selector).textContent(), visible);
  assert.equal((await reopenedEditor.innerText()).trim(), visible + ' ordinary');
  checks['typedInline:' + selector] = true;
});

await fixture('# Rich\n\nBefore TARGET after.\n\nUnchanged **tail**\n', async h => {
  await selectRendered(h.editor, 'TARGET');
  await pasteText(h.editor, '**Formatted insertion**'); await h.flush();
  assert.equal((await h.editor.locator('p').first().innerText()).replace(/\u00a0/g, ' ').trim(), 'Before Formatted insertion after.');
  assert.equal(await h.editor.locator('p').first().locator('strong').textContent(), 'Formatted insertion');
  assert.match(await h.body(), /Before \*\*Formatted insertion\*\* after\./);
  assert.match(await h.body(), /Unchanged \*\*tail\*\*/);
  checks.inlinePastePreservesSurroundingParagraphText = true;
});

await fixture('# Rich\n\nBefore **old TARGET strong** after.\n', async h => {
  await selectRendered(h.editor, 'TARGET'); await pasteText(h.editor, '_Inserted emphasis_'); await h.flush();
  assert.match((await h.editor.innerText()).replace(/\u00a0/g, ' '), /Before old Inserted emphasis strong after\./);
  assert.equal(await h.editor.locator('em,i').textContent(), 'Inserted emphasis');
  const source = await h.body(); assert.equal(source.includes('TARGET'), false); assert.ok(source.includes('Inserted emphasis'));
  await h.editor.blur();
  assert.match((await h.editor.innerText()).replace(/\u00a0/g, ' '), /Before old Inserted emphasis strong after\./);
  assert.equal(await h.editor.locator('em,i').textContent(), 'Inserted emphasis');
  checks.inlinePasteInsideExistingStrongKeepsItsContent = true;
});

await fixture('# Rich\n\nBefore After.\n\nUntouched **tail**\n', async h => {
  await selectRendered(h.editor, 'After.', true);
  await pasteText(h.editor, '**Caret bold** '); await h.flush();
  assert.match((await h.editor.innerText()).replace(/\u00a0/g, ' '), /Before Caret bold After\./);
  assert.equal(await h.editor.locator('p').first().locator('strong').textContent(), 'Caret bold');
  assert.match(await h.body(), /Before \*\*Caret bold\*\* After\./);
  assert.match(await h.body(), /Untouched \*\*tail\*\*/);
  checks.collapsedCaretPastePreservesBothSides = true;
});

await fixture('# Rich\n\nBefore **old After** tail.\n', async h => {
  await selectRendered(h.editor, 'After', true);
  await pasteText(h.editor, '_Caret italic_ '); await h.flush();
  assert.match((await h.editor.innerText()).replace(/\u00a0/g, ' '), /Before old Caret italic After tail\./);
  assert.equal(await h.editor.locator('strong em,strong i').textContent(), 'Caret italic');
  await h.editor.blur();
  assert.equal(await h.editor.locator('strong em,strong i').textContent(), 'Caret italic');
  checks.collapsedCaretPasteInsideStrongPreservesMarks = true;
});

await fixture('# Rich\n\nBefore **old TARGET strong** after.\n', async h => {
  await selectRendered(h.editor, 'TARGET'); await pasteText(h.editor, '**new bold**'); await h.flush();
  assert.match((await h.editor.innerText()).replace(/\u00a0/g, ' '), /Before old new bold strong after\./);
  assert.equal(await h.editor.locator('strong strong,strong b,b strong,b b').count(), 0, 'identical pasted marks must not nest');
  await h.editor.blur();
  assert.match((await h.editor.innerText()).replace(/\u00a0/g, ' '), /Before old new bold strong after\./);
  assert.equal((await h.editor.innerText()).includes('**'), false);
  await h.page.evaluate(() => richReopen()); await h.page.waitForFunction(() => richHost.ready);
  const frame = h.page.frames().find(f => f.parentFrame());
  const reopened = frame.locator('[data-node="article"] .vb-inline-editor'); await reopened.waitFor();
  assert.match((await reopened.innerText()).replace(/\u00a0/g, ' '), /Before old new bold strong after\./);
  assert.equal((await reopened.innerText()).includes('**'), false);
  checks.pastedSameMarkInsideStrongDoesNotProduceVisibleMarkers = true;
});

await fixture('# Rich\n\nBefore\u00a0TARGET\u00a0after.\n\nTail text.\n', async h => {
  await selectRendered(h.editor, 'TARGET'); await pasteText(h.editor, '**NBSP content**'); await h.flush();
  assert.match(await h.body(), /Before\u00a0\*\*NBSP content\*\*\u00a0after\./, 'genuine original NBSP must not be normalized away');
  checks.genuineNonbreakingSpacesSurviveRichPaste = true;
});

await fixture('# Rich\n\n', async h => {
  await h.editor.click();
  const literal = String.raw`a_b_c; 2 * 3; * spaced *; \**literal\**`;
  await h.page.keyboard.type(literal); await h.flush();
  assert.equal((await h.editor.innerText()).trim(), literal);
  assert.equal(await h.editor.locator('strong,em,b,i,s,del').count(), 0);
  checks.ordinarySymbolsAndTypedEscapesAreNotMisinterpreted = true;
});

await fixture('# Rich\n\n```txt\nPLACEHOLDER\n```\n\nLiteral placeholder\n', async h => {
  const original = await h.body();
  await selectRendered(h.editor, 'PLACEHOLDER');
  const literal = '## literal\n**literal**\n- literal';
  await pasteText(h.editor, literal); await h.flush();
  assert.equal(await h.editor.locator('pre code').textContent(), literal + '\n');
  assert.equal(await h.editor.locator('pre h2,pre strong,pre ul').count(), 0);
  assert.match(await h.body(), /## literal\n\*\*literal\*\*\n- literal/);
  const pastedSource = await h.body();
  await h.page.keyboard.press('Meta+z'); await h.flush(); assert.equal(await h.body(), original);
  await h.page.keyboard.press('Meta+Shift+z'); await h.flush(); assert.equal(await h.body(), pastedSource);
  await selectRendered(h.editor, 'Literal placeholder'); await pasteText(h.editor, 'price 2 * 3, \u0024total, C# and a | b'); await h.flush();
  assert.match(await h.editor.innerText(), /price 2 \* 3, \$total, C# and a \| b/);
  checks.codePasteAndOrdinarySymbolsRemainLiteral = true;
});

await fixture('# Rich\n\n```js\nab\n```\n', async h => {
  const original = await h.body();
  await selectRendered(h.editor, 'ab'); await h.page.keyboard.press('ArrowRight');
  await h.page.keyboard.press('Enter'); await h.flush();
  assert.equal(await h.editor.locator('pre code').textContent(), 'ab\n\n');
  const entered = await h.body();
  await h.page.keyboard.press('Meta+z'); await h.flush(); assert.equal(await h.body(), original);
  await h.page.keyboard.press('Meta+Shift+z'); await h.flush(); assert.equal(await h.body(), entered);
  await h.page.keyboard.insertText('cd'); await h.flush();
  await h.page.keyboard.press('Tab'); await h.flush();
  assert.equal((await h.editor.locator('pre code').textContent()).replace(/\n$/, ''), 'ab\ncd  ');
  const tabbed = await h.body();
  await h.page.keyboard.press('Meta+z'); await h.flush(); assert.equal(await h.body(), entered, 'adjacent code typing and Tab undo as one input group');
  await h.page.keyboard.press('Meta+Shift+z'); await h.flush(); assert.equal(await h.body(), tabbed);
  await h.editor.blur(); assert.equal(await h.editor.locator('pre code').textContent(), 'ab\ncd  \n');
  checks.codeEnterTabKeepNewlinesAndSupportUndoRedo = true;
});

await fixture('# Rich\n\nBefore `TARGET` after.\n', async h => {
  await selectRendered(h.editor, 'TARGET'); await pasteText(h.editor, '**literal**\nsecond line'); await h.flush();
  assert.equal(await h.editor.locator('code').textContent(), '**literal** second line');
  assert.equal(await h.editor.locator('pre,strong').count(), 0);
  await h.editor.blur();
  assert.equal(await h.editor.locator('code').textContent(), '**literal** second line');
  checks.multilineInlineCodePasteKeepsLiteralCodeSemantics = true;
});

await writeFile(new URL('markdown-marker-browser.json', evidence), JSON.stringify({ passed: failures.length === 0, failures: failures.map(e => e.stack), count: Object.keys(checks).length, checks, mode: 'actual bundled iframe; trusted typing and clipboard events; isolated mocked Vault' }, null, 2));
if (failures.length) throw new AggregateError(failures, 'Markdown marker editing regressions');
console.log('Markdown marker editing passed: ' + Object.keys(checks).length + ' groups.');
