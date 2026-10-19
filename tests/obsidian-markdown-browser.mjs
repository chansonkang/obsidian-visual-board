import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness, selectRendered } from './rich-editor-harness.mjs';

const original = '# Rich\n\nA ==focused **phrase**== with normal text.\n\n- [ ] Pending task\n- [x] Completed task\n- [X] Uppercase task\n\n> [!note]+ Custom **title**\n> Callout content.\n>\n> Another paragraph.\n\n> [!warning]\n> Warning body.\n\nLiteral \\=\\=escaped\\=\\= and == unmatched.\n\n`==code==` and `[!note]` and `[x]` remain literal.\n\n```md\n==fenced==\n- [x] code task\n> [!note] code callout\n```\n\nOrdinary [x] text and [!note] text.\n';
const h = await richHarness(original);
const checks = [];
try {
  assert.equal(await h.editor.locator('mark').count(), 1);
  assert.equal(await h.editor.locator('mark strong').textContent(), 'phrase');
  assert.deepEqual(await h.editor.locator('[data-vb-task-markup]').evaluateAll(nodes => nodes.map(el => el.dataset.vbTaskMarkup)), ['[ ]', '[x]', '[X]']);
  assert.deepEqual(await h.editor.locator('.vb-task-marker').evaluateAll(nodes => nodes.map(el => el.dataset.vbTaskChecked)), ['false', 'true', 'true']);
  assert.equal(await h.editor.locator('.vb-task-marker input').count(), 0);
  assert.equal(await h.editor.locator('.vb-callout').count(), 2);
  assert.equal(await h.editor.locator('.vb-callout-title strong').textContent(), 'title');
  assert.equal(await h.editor.locator('[data-vb-callout-type="warning"] .vb-callout-title').textContent(), 'Warning');
  assert.equal(await h.editor.locator('[data-vb-callout-type="note"] > p').count(), 2);
  assert.equal(await h.editor.locator('[data-vb-decoration]').evaluateAll(nodes => nodes.every(el => el.contentEditable === 'false')), true);
  assert.equal(await h.editor.locator('[data-vb-decoration] input,[data-vb-decoration] button').count(), 0);
  checks.push('Highlights, task markers and callouts render structurally without displaying source markers');

  await selectRendered(h.editor, 'focused');
  assert.equal(await h.editor.getAttribute('data-markdown-mode'), 'edit');
  assert.equal(await h.editor.locator('mark').count(), 1);
  await h.flush();
  assert.equal(await h.body(), original);
  checks.push('Entering direct edit keeps rendered structure and untouched Markdown exactly');

  await selectRendered(h.editor, 'cused', true);
  await h.page.keyboard.insertText('new');
  await h.flush();
  assert.match(await h.body(), /==fonewcused \*\*phrase\*\*==/);
  assert.ok((await h.body()).endsWith(original.slice(original.indexOf('Literal '))));
  checks.push('Editing highlighted content preserves highlight, emphasis and untouched literal blocks');
  const highlighted = await h.body();
  await h.page.keyboard.press('Meta+z'); await h.flush();
  assert.equal(await h.body(), original);
  await h.page.keyboard.press('Meta+Shift+z'); await h.flush();
  assert.equal(await h.body(), highlighted);
  checks.push('Highlight text edit supports Command+Z and redo with original Markdown restoration');

  await selectRendered(h.editor, 'Pending task', true);
  await h.page.keyboard.insertText('New ');
  await h.flush();
  assert.match(await h.body(), /- +\[ \] New Pending task/);
  assert.match(await h.body(), /- +\[x\] Completed task/);
  assert.match(await h.body(), /- +\[X\] Uppercase task/);
  assert.equal((await h.body()).includes('vb-task'), false);
  checks.push('Edited task lists retain unchecked, checked and uppercase source markers without generated decorations');
  const taskEdited = await h.body();
  await h.page.keyboard.press('Meta+z'); await h.flush();
  assert.equal(await h.body(), highlighted);
  await h.page.keyboard.press('Meta+Shift+z'); await h.flush();
  assert.equal(await h.body(), taskEdited);
  checks.push('Task text edit supports undo and redo without losing state markers or other paragraphs');

  await selectRendered(h.editor, 'Callout content.', true);
  await h.page.keyboard.insertText('Updated ');
  await h.flush();
  assert.match(await h.body(), /> \[!note\]\+ Custom \*\*title\*\*\n> Updated Callout content\./);
  assert.match(await h.body(), /> \[!warning\]\n> Warning body\./);
  assert.equal((await h.body()).includes('vb-callout'), false);
  checks.push('Editing callout body preserves original type, fold marker, custom title Markdown and sibling blocks');

  const persisted = await h.body();
  await h.page.evaluate(() => window.richReopen());
  await h.page.waitForFunction(() => window.richHost.ready);
  const reopened = h.page.frames().find(frame => frame.parentFrame());
  const reopenedEditor = reopened.locator('[data-node="article"] .vb-inline-editor');
  await reopenedEditor.waitFor();
  assert.equal(await reopenedEditor.locator('mark').textContent(), 'fonewcused phrase');
  assert.equal(await reopenedEditor.locator('.vb-task-marker').count(), 3);
  assert.equal(await reopenedEditor.locator('.vb-callout').count(), 2);
  assert.equal(await h.body(), persisted);
  checks.push('Closing and reopening uses saved Markdown to restore highlights, task markers and callouts');

  assert.equal(await reopenedEditor.locator('pre').textContent(), '==fenced==\n- [x] code task\n> [!note] code callout\n');
  assert.equal(await reopenedEditor.locator('code').first().textContent(), '==code==');
  assert.ok((await reopenedEditor.textContent()).includes('==escaped== and == unmatched.'));
  assert.ok((await reopenedEditor.textContent()).includes('Ordinary [x] text and [!note] text.'));
  checks.push('Escaped equals, unmatched highlights, inline/fenced code and ordinary brackets stay literal');

  const malicious = await reopened.evaluate(() => VBMarkdownView.fragmentHTML('> [!note] <img src="https://untrusted.invalid/x" onerror="alert(1)">\n> safe\n\n==<script>alert(1)</script>==', 'Notes/Rich.md'));
  assert.equal(/<script|<img/.test(malicious), false);
  assert.ok(malicious.includes('&lt;img'));
  assert.ok(malicious.includes('&lt;script&gt;'));
  assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
  checks.push('Extensions keep raw HTML escaped and issue no external requests');

  await mkdir(new URL('../evidence/', import.meta.url), { recursive: true });
  await writeFile(new URL('../evidence/obsidian-markdown-browser.json', import.meta.url), JSON.stringify({ passed: true, checks, errors: h.errors, externalRequests: h.requests }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, groups: checks.length, checks }));
} finally { await h.close(); }
