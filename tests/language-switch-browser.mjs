import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness, fixturePath, selectRendered } from './rich-editor-harness.mjs';

// Real compiled sandbox frame with an isolated, persistent settings broker.
const body = '# Rich\n\n保存设置，标题 1，新建 Board，中文正文保持原样。\n\nEditable selection marker.\n\n' +
  Array.from({ length: 70 }, (_, i) => `## 第 ${i + 1} 段\n\n本地中文文章 ${i + 1}，${'保留浏览位置。'.repeat(20)}`).join('\n\n') + '\n';
const checks = [];
const untranslated = new Set();
const h = await richHarness(body, { settings: { language: 'zh' } });
let frame = h.frame;
const cjk = /[\u3400-\u9fff]/u;
async function choose(language) {
  await frame.getByTestId('language-button').click();
  await frame.getByTestId('language-' + language).click();
  await frame.waitForFunction(language => window.VBI18n?.language === language, language);
  await h.page.waitForFunction(language => window.richHost.payload.settings.language === language, language);
}
async function english(locator, attribute) {
  await locator.waitFor({ state: 'attached' });
  const value = attribute ? await locator.getAttribute(attribute) : await locator.textContent();
  assert.ok(value?.trim(), 'Missing English UI label: ' + await locator.evaluate(el => el.outerHTML.slice(0, 200)));
  if (cjk.test(value)) untranslated.add(value);
}
async function closeDialog() {
  await frame.locator('#modal-root [data-action="close-modal"]').first().click();
  await frame.locator('#modal-root .modal').waitFor({ state: 'hidden' });
}
async function iconButtons(selector) {
  const buttons = frame.locator(selector);
  assert.ok(await buttons.count() > 0, selector);
  for (const button of await buttons.all()) {
    assert.ok(await button.locator('svg').count() > 0, 'Missing SVG: ' + await button.evaluate(el => el.outerHTML));
    assert.equal((await button.textContent()).trim(), '', 'Toolbar contains visible words');
    await english(button, 'aria-label');
    await english(button, 'title');
  }
}
try {
  await frame.getByTestId('language-button').waitFor();
  assert.equal(await frame.evaluate(() => VBI18n.language), 'zh');
  await frame.evaluate(path => {
    board().title = '搜索';
    state.docs[path].title = '插入表格';
    board().nodes.push({ id: 'sticky-language', type: 'note', title: '颜色', text: '保存修改', color: 'green', x: 1450, y: 0, w: 240, h: 280 });
    board().edges.push({ from: 'article', to: 'peer' });
    render();
    board().view = { x: -65, y: 35, zoom: 0.8 }; applyView();
    document.querySelector('[data-node="peer"] .vb-inline-editor').scrollTop = 410;
  }, fixturePath);
  await selectRendered(h.editor, 'Editable selection');
  const before = await frame.evaluate(() => ({
    view: { ...board().view }, nodes: board().nodes.map(n => ({ ...n })),
    selection: getSelection().toString(), active: document.activeElement.dataset.inlineNode,
    peerScroll: document.querySelector('[data-node="peer"] .vb-inline-editor').scrollTop,
    editorHTML: document.querySelector('[data-node="article"] .vb-inline-editor').innerHTML,
  }));
  await choose('en');
  assert.match(await frame.locator('html').getAttribute('lang'), /^en/);
  const after = await frame.evaluate(() => ({
    view: { ...board().view }, nodes: board().nodes.map(n => ({ ...n })),
    selection: getSelection().toString(), active: document.activeElement.dataset.inlineNode,
    peerScroll: document.querySelector('[data-node="peer"] .vb-inline-editor').scrollTop,
    editorHTML: document.querySelector('[data-node="article"] .vb-inline-editor').innerHTML,
  }));
  assert.deepEqual(after, before);
  assert.equal(await frame.locator('#board-title').textContent(), '搜索');
  assert.equal(await frame.locator('[data-node="article"] h2 .highlight').textContent(), '插入表格');
  assert.equal(await frame.locator('[data-node="sticky-language"] h2').textContent(), '颜色');
  assert.equal(await frame.locator('[data-node="sticky-language"] .excerpt').textContent(), '保存修改');
  assert.equal(await h.body(), body);
  assert.equal(await h.page.evaluate(() => window.richHost.calls.filter(c => c.method === 'update-note').length), 0);
  checks.push('Globe selector persists English without touching article HTML, user names, Markdown, selection, focus, component scroll, camera or layout');

  await english(frame.locator('[data-node="article"] .source'));
  assert.ok((await frame.locator('[data-node="article"] .source').textContent()).includes(fixturePath));
  await iconButtons('#vb-format-toolbar button');
  await iconButtons('header .controls button, header .header-right>button, .bottom-toolbar button');
  await frame.getByTestId('format-h1').hover();
  assert.match(await frame.getByTestId('format-h1').getAttribute('title'), /heading\s*1/i);
  checks.push('Every formatting and main toolbar action is an SVG icon with an English accessible label and hover title');

  await selectRendered(h.editor, 'Editable selection', true);
  await frame.getByTestId('format-table').click();
  const table = frame.getByTestId('table-panel');
  await table.waitFor({ state: 'visible' });
  await english(table, 'aria-label');
  await english(table.locator('.vb-table-panel-title'));
  await english(table.locator('.vb-table-fields'));
  await english(table.locator('p'));
  await english(frame.getByTestId('table-insert'));
  for (const button of await table.locator('[data-table-step]').all()) await english(button, 'aria-label');
  await h.page.keyboard.press('Escape');
  await frame.getByTestId('settings').click();
  await english(frame.locator('#modal-root .modal'), 'aria-label');
  for (const label of await frame.locator('#modal-root .setting-row span, #modal-root .modal-foot button').all()) await english(label);
  await closeDialog();
  checks.push('Newly opened table picker and Board settings render English labels, step controls and action buttons');

  await frame.getByTestId('search').click();
  await english(frame.locator('#modal-root .modal'), 'aria-label');
  await english(frame.getByTestId('search-input'), 'placeholder');
  await english(frame.locator('#search-v3-summary'));
  await frame.getByTestId('search-input').fill('中文正文');
  await frame.locator('.search-v3-result').waitFor();
  assert.equal(await frame.locator('.search-v3-result-heading h4').first().textContent(), '插入表格');
  assert.equal(await frame.locator('.search-v3-result-heading small').first().textContent(), fixturePath);
  assert.match(await frame.locator('.search-v3-snippet').first().textContent(), /中文正文保持原样/);
  await english(frame.locator('.search-v3-line-label').first());
  await english(frame.locator('.search-v3-add').first());
  await closeDialog();
  await frame.getByTestId('add-board').click();
  await english(frame.locator('#modal-root .modal'), 'aria-label');
  await english(frame.getByTestId('new-board-title'), 'placeholder');
  await frame.getByTestId('new-board-title').fill('新建 Board');
  await english(frame.getByTestId('mode-default'));
  await english(frame.getByTestId('mode-ai'));
  await english(frame.locator('#default-folder-style legend'));
  await english(frame.getByTestId('folder-color-mint'), 'aria-label');
  await english(frame.getByTestId('create-board'));
  assert.equal(await frame.getByTestId('new-board-title').inputValue(), '新建 Board');
  await closeDialog();
  checks.push('Dynamic search and new-Board dialogs use English while matched source text, filenames, paths and typed Board names remain exact');

  await frame.evaluate(() => select('sticky-language'));
  await english(frame.getByTestId('edit-sticky'), 'aria-label');
  await frame.getByTestId('selection-more').click();
  await english(frame.getByTestId('edit-sticky-style'));
  await frame.getByTestId('selection-more').click();
  const sticky = frame.getByTestId('sticky-style-panel');
  await sticky.waitFor({ state: 'visible' });
  await english(sticky, 'aria-label');
  await english(sticky);
  await english(sticky.locator('.vb-sticky-header strong'));
  await english(frame.getByTestId('sticky-order-front'));
  await english(frame.getByTestId('sticky-color-green'), 'aria-label');
  await frame.getByTestId('edge-hit-space-article-peer').dispatchEvent('click');
  await frame.getByTestId('edge-style-delete').waitFor({ state: 'visible' });
  await english(frame.getByTestId('edge-style-solid'));
  await english(frame.getByTestId('edge-style-dashed'));
  await english(frame.getByTestId('edge-style-delete'));
  checks.push('Fresh sticky and relationship style panels translate color, stacking, line style and delete controls');

  await choose('zh');
  assert.match(await frame.getByTestId('language-button').getAttribute('title'), /语言/);
  await selectRendered(h.editor, 'Editable selection');
  await frame.getByTestId('format-toolbar').waitFor({ state: 'visible' });
  assert.equal(await frame.getByTestId('format-h1').getAttribute('aria-label'), '标题 1');
  await h.page.keyboard.insertText('未保存的编辑');
  const draftBefore = await h.editor.innerHTML();
  await choose('en');
  assert.equal(await h.editor.innerHTML(), draftBefore);
  await h.flush();
  assert.equal(await h.body(), body.replace('Editable selection', '未保存的编辑'));
  checks.push('Switching back restores Chinese labels; switching with a live dirty draft preserves and saves only the deliberate Markdown edit');

  await h.page.evaluate(() => { window.richHost.failSettings = true; });
  await frame.getByTestId('language-button').click();
  await frame.getByTestId('language-zh').click();
  await frame.waitForFunction(() => VBI18n.language === 'en' && document.querySelector('#toast').textContent.includes('Fixture settings write unavailable'));
  assert.equal(await h.page.evaluate(() => window.richHost.payload.settings.language), 'en');
  await english(frame.getByTestId('language-button'), 'title');
  await h.page.evaluate(() => { window.richHost.failSettings = false; window.richReopen(); });
  await h.page.waitForFunction(() => window.richHost.ready);
  frame = h.page.frames().find(item => item.parentFrame());
  await frame.waitForFunction(() => window.VBI18n?.language === 'en');
  await english(frame.getByTestId('search'), 'aria-label');
  assert.equal(await h.body(), body.replace('Editable selection', '未保存的编辑'));
  checks.push('Failed setting persistence rolls back without reporting success; reopening uses the last saved English language and keeps exact source');

  assert.deepEqual([...untranslated], [], 'Untranslated English UI labels');
  assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
  await mkdir(new URL('../evidence/', import.meta.url), { recursive: true });
  await h.page.screenshot({ path: new URL('../evidence/language-switch-browser.png', import.meta.url).pathname });
  await writeFile(new URL('../evidence/language-switch-browser.json', import.meta.url), JSON.stringify({ passed: true, groups: checks.length, checks, errors: h.errors, externalRequests: h.requests }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, groups: checks.length, checks }));
} finally { await h.close(); }
