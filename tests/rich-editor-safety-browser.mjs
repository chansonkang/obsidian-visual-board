import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness, fixturePath, selectRendered } from './rich-editor-harness.mjs';

// Uses the actual built frame, DOM selection and trusted keyboard input. Clipboard
// contents and IME lifecycle events are simulated because headless Chromium has no
// system clipboard/IME session. All providers and Vault writes are isolated mocks.
const evidence = { passed: false, groups: [], clipboard: 'Synthetic ClipboardEvent/DataTransfer; real editor paste handler', ime: 'Synthetic CompositionEvent lifecycle; trusted keyboard.insertText input' };
const output = new URL('../evidence/rich-editor-safety-verification.json', import.meta.url);
const base = '# Rich\n\nEditable paragraph.\n';
const readCalls = h => h.page.evaluate(() => window.richHost.calls);
const updates = async h => (await readCalls(h)).filter(c => c.method === 'update-note');
const group = async (name, body, options, test) => {
  const h = await richHarness(body, options);
  try {
    await test(h);
    assert.deepEqual(h.errors, [], 'No uncaught frame errors');
    assert.deepEqual(h.requests, [], 'No automatic remote resource requests');
    evidence.groups.push({ name, passed: true, externalRequests: h.requests, errors: h.errors });
  } finally { await h.close(); }
};
try {
  await group('Untrusted Markdown remains inert in reading and editing DOM', '# Rich\n\nEditable paragraph.\n\n<script>window.__richUnsafe=1</script>\n<img src="https://unsafe.invalid/raw.png" onerror="window.__richUnsafe=2">\n<iframe src="https://unsafe.invalid/frame"></iframe>\n\n![external](https://unsafe.invalid/md.png)\n\n[unsafe](javascript:window.__richUnsafe=3)\n\n[external link](https://unsafe.invalid/explicit)\n', {}, async h => {
    await h.page.waitForTimeout(100);
    assert.equal(await h.editor.locator('script,iframe,object,embed,img[src^="http"]').count(), 0);
    assert.equal(await h.frame.evaluate(() => window.__richUnsafe), undefined);
    assert.equal((await readCalls(h)).some(c => ['open-external', 'import-image', 'update-note'].includes(c.method)), false);
    await h.editor.getByText('Editable paragraph.', { exact: true }).click();
    assert.equal(await h.editor.locator('script,iframe,object,embed,img[src^="http"]').count(), 0);
    assert.equal(await h.flush(), true);
    assert.equal((await updates(h)).length, 0, 'Focus alone cannot rewrite source');
  });
  await group('HTML clipboard is handled as safe plain text without remote loads', base, {}, async h => {
    await h.editor.getByText('Editable paragraph.', { exact: true }).click();
    await selectRendered(h.editor, 'Editable', true);
    const plain = 'PASTED <img src="https://unsafe.invalid/pasted.png" onerror="window.__richUnsafe=4">';
    const prevented = await h.editor.evaluate((el, plain) => {
      const data = new DataTransfer();
      data.setData('text/plain', plain);
      data.setData('text/html', '<div><script>window.__richUnsafe=5</script><img src="https://unsafe.invalid/clipboard.png" onerror="window.__richUnsafe=6"><a href="javascript:window.__richUnsafe=7">PASTED</a></div>');
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
      el.dispatchEvent(event); return event.defaultPrevented;
    }, plain);
    assert.equal(prevented, true, 'Editor must explicitly handle clipboard data');
    assert.equal(await h.flush(), true);
    assert.ok((await h.editor.innerText()).includes(plain), 'Plain clipboard text preserved in editor');
    assert.ok((await h.body()).includes('https://unsafe.invalid/pasted.png'), 'Text is saved as Markdown, whose escaping may differ');
    assert.equal(await h.editor.locator('script,iframe,object,embed,img[src^="http"],a[href^="javascript:"]').count(), 0);
    assert.equal(await h.frame.evaluate(() => window.__richUnsafe), undefined);
    assert.equal((await readCalls(h)).some(c => ['open-external', 'import-image'].includes(c.method)), false);
  });
  await group('Missing articles stay read only and do not create writes or recovery drafts', base, { missing: true }, async h => {
    await h.editor.getByText('Editable paragraph.', { exact: true }).click();
    await h.page.keyboard.type('Must not be saved');
    await h.flush();
    assert.equal(await h.body(), base);
    assert.equal(await h.editor.getAttribute('contenteditable'), 'false');
    assert.deepEqual((await readCalls(h)).filter(c => ['update-note', 'save-draft', 'import-image'].includes(c.method)), []);
  });
  await group('HTML only clipboard strips active elements before extracting text', base, {}, async h => {
    await h.editor.getByText('Editable paragraph.', { exact: true }).click();
    await selectRendered(h.editor, 'Editable', true);
    const prevented = await h.editor.evaluate(el => {
      const data = new DataTransfer();
      data.setData('text/html', '<style>body{background:url(https://unsafe.invalid/style.png)}</style><script>window.__richUnsafe=8</script><iframe src="https://unsafe.invalid/html-only-frame"></iframe><img src="https://unsafe.invalid/html-only.png" onerror="window.__richUnsafe=9"><p>SAFE-HTML-TEXT</p><a href="javascript:window.__richUnsafe=10">visible label</a>');
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
      el.dispatchEvent(event); return event.defaultPrevented;
    });
    assert.equal(prevented, true);
    assert.equal(await h.flush(), true);
    assert.ok((await h.body()).includes('SAFE-HTML-TEXT'));
    assert.ok(!(await h.body()).includes('__richUnsafe'));
    assert.equal(await h.editor.locator('script,style,iframe,object,embed,img[src^="http"],a[href^="javascript:"]').count(), 0);
    assert.equal(await h.frame.evaluate(() => window.__richUnsafe), undefined);
    assert.equal((await readCalls(h)).some(c => ['open-external', 'import-image'].includes(c.method)), false);
  });
  await group('Native HTML drag into rich editor inserts only plain text', base, {}, async h => {
    await h.editor.getByText('Editable paragraph.', { exact: true }).click();
    await h.frame.evaluate(() => {
      const source = document.createElement('div'); source.id = 'unsafe-drag-source'; source.draggable = true;
      source.textContent = 'Isolated drag source'; source.style.cssText = 'position:fixed;left:1120px;top:880px;width:200px;height:48px;z-index:100000;background:white';
      source.addEventListener('dragstart', event => {
        window.__nativeSafetyDrag = true;
        event.dataTransfer.setData('text/plain', 'SAFE-NATIVE-DROP');
        event.dataTransfer.setData('text/html', '<img src="https://unsafe.invalid/drop.png" onerror="window.__richUnsafe=11"><b>SAFE-NATIVE-DROP</b>');
      });
      document.body.append(source);
    });
    const source = await h.frame.locator('#unsafe-drag-source').boundingBox(), target = await h.editor.boundingBox();
    await h.page.mouse.move(source.x + 70, source.y + 24); await h.page.mouse.down();
    await h.page.mouse.move(source.x + 80, source.y + 15, { steps: 5 });
    await h.page.mouse.move(target.x + 170, target.y + 15, { steps: 30 });
    await h.page.mouse.up();
    assert.equal(await h.frame.evaluate(() => window.__nativeSafetyDrag), true, 'Trusted dragstart occurred');
    await h.flush();
    assert.ok((await h.body()).includes('SAFE-NATIVE-DROP'), 'Native drop inserted plain text');
    assert.equal(await h.editor.locator('img[src^="http"],b').count(), 0, 'Foreign HTML formatting and remote image never enter DOM');
    assert.equal(await h.frame.evaluate(() => window.__richUnsafe), undefined);
  });
  const escapedSource = '# Rich\n\nEscaped \\*star\\* and target-one.\n\nEntity &amp; before target-two.\n';
  await group('Escaped Markdown and entities retain exact source insertion offsets', escapedSource, {}, async h => {
    await h.editor.getByText('Escaped *star* and target-one.', { exact: true }).click();
    for (const needle of ['target-one', 'target-two']) {
      await selectRendered(h.editor, needle, true);
      const insertion = await h.frame.evaluate(path => window.VBInline.imageInsertion(path), fixturePath);
      assert.equal(insertion.body, escapedSource, 'Source bytes remain authoritative before edits');
      assert.equal(insertion.start, escapedSource.indexOf(needle), needle + ' source start');
      assert.equal(insertion.end, escapedSource.indexOf(needle), needle + ' source end');
    }
    assert.equal(await h.flush(), true);
    assert.equal(await h.body(), escapedSource);
    assert.equal((await updates(h)).length, 0);
  });
  await group('External conflict preserves current file and local draft across snapshots', base, {}, async h => {
    await h.editor.getByText('Editable paragraph.', { exact: true }).click();
    await selectRendered(h.editor, 'Editable', true);
    await h.page.evaluate(path => { window.richHost.payload.docs[path].body = '# Rich\n\nExternal current file.\n'; }, fixturePath);
    await h.page.keyboard.insertText('LOCAL-DRAFT ');
    assert.equal(await h.flush(), false);
    assert.equal(await h.body(), '# Rich\n\nExternal current file.\n');
    assert.match(await h.editor.innerText(), /LOCAL-DRAFT/);
    await h.page.evaluate(() => window.richSnapshot());
    await h.page.waitForTimeout(50);
    assert.match(await h.editor.innerText(), /LOCAL-DRAFT/);
    const draft = await h.page.evaluate(path => window.richHost.recovery[path], fixturePath);
    assert.ok(draft.body.includes('LOCAL-DRAFT'));
    assert.equal(draft.expectedBody, base);
    assert.match(await h.frame.locator('[data-node="article"] .vb-inline-status').innerText(), /原文已在别处修改/);
    assert.equal((await updates(h)).length, 1, 'Blocked draft cannot retry over newer body automatically');
  });
  await group('Recovered drafts never overwrite local articles without confirmation', base, { drafts: [{ path: fixturePath, body: '# Rich\n\nRecovered unsaved draft.\n', expectedBody: base, updatedAt: 4 }] }, async h => {
    assert.match(await h.editor.innerText(), /Recovered unsaved draft/);
    assert.equal(await h.flush(), false);
    await h.page.evaluate(() => window.richSnapshot());
    await h.page.waitForTimeout(800);
    assert.match(await h.editor.innerText(), /Recovered unsaved draft/);
    assert.equal(await h.body(), base);
    assert.equal((await updates(h)).length, 0);
  });
  await group('Composition and snapshots retain live DOM and defer file writes', base, {}, async h => {
    await h.editor.getByText('Editable paragraph.', { exact: true }).click();
    await selectRendered(h.editor, 'Editable', true);
    await h.editor.evaluate(el => { el.__safetyMarker = 177; el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })); });
    await h.page.keyboard.insertText('输入中');
    await h.page.evaluate(() => window.richSnapshot());
    await h.page.waitForTimeout(800);
    assert.equal(await h.editor.evaluate(el => el.__safetyMarker), 177, 'Snapshot retains composition DOM');
    assert.match(await h.editor.innerText(), /输入中/);
    assert.equal(await h.editor.evaluate(el => document.activeElement === el || el.contains(document.activeElement)), true);
    assert.equal((await updates(h)).length, 0, 'No partial IME file update');
    assert.equal(await h.body(), base);
    await h.editor.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '输入中' })));
    assert.equal(await h.flush(), true);
    assert.ok((await h.body()).includes('输入中'));
    assert.equal((await updates(h)).length, 1);
  });
  evidence.passed = true;
  console.log('Rich editor safety: 9 groups passed (HTML/Markdown isolation, native drop, source offsets, read only, conflicts, recovery, IME snapshot).');
} catch (error) {
  evidence.error = String(error?.stack || error);
  throw error;
} finally {
  await mkdir(new URL('../evidence/', import.meta.url), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
}
