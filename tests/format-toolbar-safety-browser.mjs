import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness, fixturePath, selectRendered } from './rich-editor-harness.mjs';

// Actual built sandbox iframe and DOM buttons/keyboard/pointer gestures. IME
// lifecycle and queued stale-button click are explicit synthetic race fixtures.
// Native file move is paused at the mock RPC; no user's Vault is accessed.
const original = '# Rich\n\nEditable paragraph.\n';
const evidence = { passed: false, groups: [], fixtures: ['Real DOM/keyboard/pointer toolbar interaction', 'Synthetic CompositionEvent lifecycle with trusted insertText', 'Mock-host deferred move RPC; no physical Vault writes', 'Synthetic stale queued click after owner invalidation'] };
const calls = h => h.page.evaluate(() => window.richHost.calls);
const writes = async h => (await calls(h)).filter(c => c.method === 'update-note');
const toolbar = h => h.frame.getByTestId('format-toolbar');
const hidden = h => toolbar(h).waitFor({ state: 'hidden' });
const focus = async h => {
  await h.editor.getByText('Editable paragraph.', { exact: true }).click();
  await selectRendered(h.editor, 'Editable');
  await toolbar(h).waitFor({ state: 'visible' });
};
const group = async (name, body, options, run) => {
  const h = await richHarness(body, options);
  try {
    await run(h);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.requests, []);
    evidence.groups.push({ name, passed: true, errors: h.errors, externalRequests: h.requests });
  } finally { await h.close(); }
};
try {
  await group('Missing article has no toolbar or formatting writes', original, { missing: true }, async h => {
    await h.editor.getByText('Editable paragraph.', { exact: true }).click();
    await hidden(h);
    assert.equal(await h.editor.evaluate(el => window.VBRichEditor.runCommand(el, 'bold')), false);
    await h.page.keyboard.type('Forbidden'); await h.flush();
    assert.equal(await h.body(), original);
    assert.deepEqual((await calls(h)).filter(c => ['update-note', 'save-draft'].includes(c.method)), []);
  });
  await group('Focused article becoming missing invalidates toolbar owner', original, {}, async h => {
    await focus(h);
    await h.page.evaluate(path => { window.richHost.payload.docs[path].missing = true; window.richSnapshot(); }, fixturePath);
    await hidden(h);
    assert.equal(await h.editor.evaluate(el => window.VBRichEditor.runCommand(el, 'bold')), false);
    await h.flush();
    assert.equal(await h.body(), original);
    assert.equal((await writes(h)).length, 0);
  });
  await group('IME disables commands until composition commits', original, {}, async h => {
    await focus(h); await selectRendered(h.editor, 'Editable', true);
    await h.editor.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })));
    await h.page.keyboard.insertText('输入中');
    await h.frame.waitForFunction(() => document.querySelector('[data-testid="format-bold"]')?.disabled);
    assert.equal(await h.frame.getByTestId('format-done').isDisabled(), true, 'Done cannot blur a composing editor');
    assert.equal(await h.editor.evaluate(el => window.VBRichEditor.runCommand(el, 'bold')), false);
    await h.page.evaluate(() => window.richSnapshot());
    await h.page.waitForTimeout(800);
    assert.equal((await writes(h)).length, 0);
    assert.equal(await h.body(), original);
    await h.editor.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '输入中' })));
    await selectRendered(h.editor, 'Editable');
    await h.frame.waitForFunction(() => !document.querySelector('[data-testid="format-bold"]')?.disabled);
    await h.frame.getByTestId('format-bold').click();
    await h.flush();
    assert.match(await h.body(), /输入中\*\*Editable\*\*/);
    assert.equal(await h.editor.evaluate(el => document.activeElement === el), true);
  });
  await group('Switching documents or focusing outside never applies stale selection', original, {}, async h => {
    const otherPath = 'Notes/Other.md', otherBody = '# Other\n\nSecond paragraph.\n';
    await h.page.evaluate(({ otherPath, otherBody }) => { window.richHost.payload.docs[otherPath].body = otherBody; window.richHost.payload.layout.boards.home.nodes.find(n => n.id === 'peer').doc = otherPath; }, { otherPath, otherBody });
    await h.frame.evaluate(({ otherPath, otherBody }) => { state.docs[otherPath].body = otherBody; state.boards.home.nodes.find(n => n.id === 'peer').doc = otherPath; render(); }, { otherPath, otherBody });
    await focus(h);
    await h.peer.getByText('Second paragraph.', { exact: true }).click();
    await selectRendered(h.peer, 'Second');
    await h.frame.getByTestId('format-bold').click(); await h.flush();
    assert.equal(await h.body(), original);
    assert.equal(await h.page.evaluate(path => window.richHost.payload.docs[path].body, otherPath), '# Other\n\n**Second** paragraph.\n');
    const beforeOutsideRange = (await writes(h)).length;
    await h.frame.evaluate(() => {
      const range = document.createRange(); range.selectNodeContents(document.getElementById('board-title'));
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      // Invoke the queued button before the next animation frame can disable it.
      document.querySelector('[data-testid="format-italic"]').click();
    });
    await h.flush();
    assert.equal((await writes(h)).length, beforeOutsideRange, 'Out-of-editor Range cannot reuse the old bookmark');
    await selectRendered(h.peer, 'Second');
    await toolbar(h).waitFor({ state: 'visible' });
    await h.frame.evaluate(() => {
      window.__staleSafetyButton = document.querySelector('[data-testid="format-italic"]');
      const input = document.createElement('input'); input.id = 'safety-outside-editor'; input.style.cssText = 'position:fixed;top:10px;left:750px;z-index:100000'; document.body.append(input);
    });
    await h.frame.locator('#safety-outside-editor').click();
    await h.page.keyboard.type('Outside input'); await hidden(h);
    const before = (await writes(h)).length;
    await h.frame.evaluate(() => window.__staleSafetyButton.click()); await h.flush();
    assert.equal((await writes(h)).length, before);
    assert.equal(await h.frame.locator('#safety-outside-editor').inputValue(), 'Outside input');
  });
  await group('Navigation and removed card invalidate stale editor and button ranges', original, {}, async h => {
    await focus(h);
    await h.frame.evaluate(() => { window.__removedSafetyEditor = document.querySelector('[data-inline-node="article"]'); window.__staleSafetyButton = document.querySelector('[data-testid="format-bold"]'); navigate('child'); });
    await hidden(h);
    assert.equal(await h.frame.evaluate(() => window.VBRichEditor.runCommand(window.__removedSafetyEditor, 'bold')), false);
    await h.frame.evaluate(() => window.__staleSafetyButton.click());
    await h.frame.evaluate(() => navigate('home'));
    await focus(h);
    await h.frame.evaluate(() => { window.__removedSafetyEditor = document.querySelector('[data-inline-node="article"]'); state.boards.home.nodes = state.boards.home.nodes.filter(n => n.id !== 'article'); render(); });
    await hidden(h);
    assert.equal(await h.frame.evaluate(() => window.VBRichEditor.runCommand(window.__removedSafetyEditor, 'bold')), false);
    await h.frame.evaluate(() => window.__staleSafetyButton.click()); await h.flush();
    assert.equal(await h.body(), original);
    assert.equal((await writes(h)).length, 0);
  });
  await group('Real circular connection drag hides and blocks formatting', original, {}, async h => {
    await focus(h);
    const rect = await h.frame.getByTestId('connect-handle-article').boundingBox();
    await h.page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await h.page.mouse.down();
    await h.page.mouse.move(rect.x + rect.width + 65, rect.y + rect.height / 2, { steps: 8 });
    assert.equal(await h.frame.evaluate(() => window.VBConnections.dragging), true);
    await hidden(h);
    assert.equal(await h.editor.evaluate(el => window.VBRichEditor.runCommand(el, 'bold')), false);
    await h.page.mouse.up(); await h.flush();
    assert.equal(await h.body(), original);
    assert.equal((await writes(h)).length, 0);
  });
  await group('Pending physical article move hides and blocks formatting', original, {}, async h => {
    await focus(h);
    await h.frame.evaluate(() => {
      const rpc = window.VBHost.rpc;
      window.VBHost.rpc = (method, payload) => method === 'move-article' ? new Promise(resolve => {
        window.__releaseSafetyMove = () => { const { docs, ...layout } = state; resolve({ oldPath: payload.node === 'article' ? 'Notes/Rich.md' : '', newPath: 'Notes/Rich.md', doc: docs['Notes/Rich.md'], layout: structuredClone(layout) }); };
      }) : rpc(method, payload);
      state.boards.child.folderPath = 'Archive'; moveNode(board().nodes.find(n => n.id === 'article'), 'child');
    });
    await h.frame.waitForFunction(() => !!window.__releaseSafetyMove);
    await hidden(h);
    assert.equal(await h.frame.evaluate(() => window.VBFolderInteraction.moving), true);
    assert.equal(await h.editor.evaluate(el => window.VBRichEditor.runCommand(el, 'bold')), false);
    await h.frame.evaluate(() => window.__releaseSafetyMove());
    await h.frame.waitForFunction(() => !window.VBFolderInteraction.moving);
    await h.flush(); assert.equal(await h.body(), original); assert.equal((await writes(h)).length, 0);
  });
  const images = '# Rich\n\nEditable paragraph.\n\n![[Assets/one.png|120]]\n\n![[Assets/one.png|80x60]]\n\nUntouched ending.\n';
  await group('Formatting one paragraph preserves both image tokens and local images', images, {}, async h => {
    assert.equal(await h.editor.locator('.vb-article-image img').count(), 2);
    await focus(h); await h.frame.getByTestId('format-bold').click(); await h.flush();
    const body = await h.body();
    assert.equal(body.slice(body.indexOf('![[')), images.slice(images.indexOf('![[')));
    assert.equal(await h.editor.locator('.vb-article-image img').count(), 2);
    assert.equal(await h.peer.locator('.vb-article-image img').count(), 2);
    assert.equal((await calls(h)).some(c => c.method === 'import-image'), false);
    assert.match(body, /\*\*Editable\*\*/);
  });
  const inlineImage = '# Rich\n\nAlpha  \n![[Assets/one.png|120]]\n\nBeta\n';
  await group('Image structure guards preserve hard break and token while other paragraphs remain editable', inlineImage, {}, async h => {
    await h.editor.locator('p').filter({ hasText: 'Alpha' }).click();
    await h.editor.evaluate(el => {
      const paragraphs = [...el.querySelectorAll('p')], range = document.createRange();
      range.setStart(paragraphs[0].firstChild, 0); range.setEnd(paragraphs.at(-1).firstChild, paragraphs.at(-1).firstChild.length);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await toolbar(h).waitFor({ state: 'visible' });
    await h.frame.waitForFunction(() => document.querySelector('[data-testid="format-unordered-list"]')?.disabled);
    const structure = ['paragraph', 'h1', 'h2', 'h3', 'unordered-list', 'ordered-list', 'quote'];
    for (const kind of [...structure, 'bold', 'italic']) {
      assert.equal(await h.frame.getByTestId('format-' + kind).isDisabled(), true, 'Across-image button ' + kind);
      assert.equal(await h.editor.evaluate((el, kind) => window.VBRichEditor.runCommand(el, kind), kind), false, 'Across-image runtime ' + kind);
    }
    await h.flush(); assert.equal(await h.body(), inlineImage); assert.equal((await writes(h)).length, 0);
    await selectRendered(h.editor, 'Alpha', true);
    await h.frame.waitForFunction(() => !document.querySelector('[data-testid="format-bold"]')?.disabled);
    for (const kind of structure) {
      assert.equal(await h.frame.getByTestId('format-' + kind).isDisabled(), true, 'Collapsed same-image-paragraph button ' + kind);
      assert.equal(await h.editor.evaluate((el, kind) => window.VBRichEditor.runCommand(el, kind), kind), false, 'Collapsed same-image-paragraph runtime ' + kind);
    }
    assert.equal(await h.frame.getByTestId('format-bold').isDisabled(), false, 'Text-only inline style remains available');
    await h.flush(); assert.equal(await h.body(), inlineImage); assert.equal((await writes(h)).length, 0);
    await selectRendered(h.editor, 'Beta');
    await h.frame.waitForFunction(() => !document.querySelector('[data-testid="format-unordered-list"]')?.disabled);
    await h.frame.getByTestId('format-unordered-list').click(); await h.flush();
    const protectedPrefix = inlineImage.slice(0, inlineImage.indexOf('Beta'));
    assert.ok((await h.body()).startsWith(protectedPrefix), 'Image token and original two-space hard break remain byte exact');
    assert.equal(await h.editor.locator('li').filter({ hasText: 'Beta' }).count(), 1, 'Pure text paragraph can become a list');
    assert.equal(await h.editor.locator('.vb-article-image img').count(), 1);
    assert.equal(await h.editor.locator('p').filter({ hasText: 'Alpha' }).locator('br').count(), 1);
    await h.frame.getByTestId('format-paragraph').click(); await h.flush();
    assert.equal(await h.body(), inlineImage, 'List cancellation restores full source without touching image or hard break');
  });
  evidence.passed = true;
  console.log('Format toolbar safety: 9 groups passed (missing, IME, document ownership, stale ranges, connection/move busy, image/hard-break guards).');
} catch (error) { evidence.error = String(error?.stack || error); throw error; }
finally { await mkdir(new URL('../evidence/', import.meta.url), { recursive: true }); await writeFile(new URL('../evidence/format-toolbar-safety-verification.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n'); }
