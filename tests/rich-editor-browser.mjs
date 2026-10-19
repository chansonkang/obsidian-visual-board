import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness, fixturePath, selectRendered } from './rich-editor-harness.mjs';

const prefix = '\uFEFF---\r\ntags: [draft, local]\r\naliases: ["原名"]\r\ncustom: "不要重排"\r\n---\r\n\r\n# Rich\r\n\r\n';
const source = prefix + [
  '## 保持原样的标题', '',
  '原段落包含 **重点文字**、_斜体文字_ 和 `token(x)`。', '',
  '| 名称   | 数量 |', '| :----- | ---: |', '| 原始单元格 | 12 |', '| 另一行 | 3 |', '',
  '- 第一条列表', '- 第二条列表', '',
  '3. 有序条目', '4. 后续条目', '',
  '> 引用段落原样', '> 第二行引用', '',
  '~~~javascript', 'const literal = "**keep** | [[Other]]";', 'console.log(literal);', '~~~', '',
  '链接前 [[Other#Section|目标文章]] 链接后。', '',
  '图片前', '![[Assets/one.png|120x80]]', '图片后', '',
  '保留引用式 [文档][ref] 和未修改的  双空格。', '',
  '[ref]: Other.md#Section "精确保留定义"', '',
  '结尾段落', '',
].join('\r\n');
const evidence = new URL('../evidence/', import.meta.url);
await mkdir(evidence, { recursive: true });
const h = await richHarness(source), { page, frame, editor, peer } = h;
const checks = {};
async function stableSource(needle, replacement) {
  const before = await h.body();
  await selectRendered(editor, needle); await page.keyboard.insertText(replacement); await h.flush();
  const after = await h.body();
  return { before, after };
}
try {
  await editor.locator('h2').waitFor();
  assert.equal(await editor.locator('h1').count(), 0, 'hidden article title stays hidden');
  assert.equal((await editor.innerText()).includes('custom:'), false, 'frontmatter stays opaque');
  const geometry = await frame.evaluate(() => ({ node: { ...board().nodes.find(n => n.id === 'article') }, camera: { ...board().view } }));
  const measure = () => editor.evaluate(el => ({
    height: el.scrollHeight, width: el.clientWidth,
    heading: [...el.querySelectorAll('h2')].map(n => ({ text: n.textContent, size: getComputedStyle(n).fontSize, weight: getComputedStyle(n).fontWeight, height: n.getBoundingClientRect().height })),
    table: !!el.querySelector('table'), strong: !!el.querySelector('strong'), code: !!el.querySelector('pre code'),
  }));
  const beforeClick = await measure();
  await editor.locator('h2').click();
  assert.deepEqual(await measure(), beforeClick, 'focus must preserve typography, DOM semantics and card scroll size');
  await editor.blur(); await h.flush();
  assert.equal(await h.body(), source, 'focus/blur preserves BOM, YAML, hidden title, CRLF and original block bytes');
  assert.equal(await page.evaluate(() => richHost.calls.filter(c => c.method === 'update-note').length), 0);
  checks.focusDoesNotChangeFormattingOrSource = true;
  await page.screenshot({ path: new URL('rich-editor-before-edit.png', evidence).pathname });

  const headingEdit = await stableSource('保持原样的标题', '就地修改的标题');
  if (headingEdit.after !== source.replace('保持原样的标题', '就地修改的标题')) {
    await writeFile(new URL('rich-editor-failure.json', evidence), JSON.stringify(await editor.evaluate(el => ({ current: el.innerHTML, records: el.__vbRich?.records.map(r => ({ raw: r.raw, baseline: r.html, current: r.node.outerHTML })) })), null, 2));
  }
  assert.equal(headingEdit.after, source.replace('保持原样的标题', '就地修改的标题'), 'editing one heading must leave every other byte untouched');
  assert.equal(await editor.locator('h2').textContent(), '就地修改的标题');
  assert.equal(await peer.locator('h2').textContent(), '就地修改的标题');
  checks.headingEditsOnlyItsSourceBlock = true;

  const strongEdit = await stableSource('重点文字', '新的重点');
  assert.equal(await editor.locator('strong').first().textContent(), '新的重点');
  assert.equal(await editor.locator('em').first().textContent(), '斜体文字');
  assert.equal(await editor.locator('code').first().textContent(), 'token(x)');
  assert.ok(strongEdit.after.startsWith(prefix));
  assert.ok(strongEdit.after.includes(source.slice(source.indexOf('| 名称'))), 'unrelated table/lists/code/wiki/images/reference tail exact');
  checks.inlineMarksRemainVisibleAndSaveAsMarkdown = true;

  const tableBefore = await editor.locator('tbody tr').count();
  await selectRendered(editor, '原始单元格'); await page.keyboard.insertText('修改后的单元格');
  await h.flush();
  assert.equal(await editor.locator('tbody tr').count(), tableBefore);
  assert.match(await peer.locator('tbody').innerText(), /修改后的单元格/);
  assert.equal(await editor.locator('thead th').nth(1).evaluate(el => getComputedStyle(el).textAlign), 'right', 'numeric column alignment stays right');
  assert.ok((await h.body()).includes('~~~javascript\r\nconst literal = "**keep** | [[Other]]";\r\nconsole.log(literal);\r\n~~~'));
  checks.tableCellsRemainEditableWithoutSourceSwitch = true;

  await selectRendered(editor, '第二条列表'); await page.keyboard.insertText('修改后的列表'); await h.flush();
  assert.equal(await editor.locator('ul li').count(), 2);
  assert.match(await peer.locator('ul').innerText(), /修改后的列表/);
  await selectRendered(editor, '引用段落原样'); await page.keyboard.insertText('修改后的引用'); await h.flush();
  assert.match(await peer.locator('blockquote').innerText(), /修改后的引用/);
  assert.equal(await editor.locator('ol').getAttribute('start'), '3');
  checks.listsAndQuotesKeepTheirStructure = true;

  await selectRendered(editor, 'console.log'); await page.keyboard.insertText('console.info'); await h.flush();
  assert.match(await peer.locator('pre code.language-javascript').textContent(), /console.info/);
  assert.equal(await editor.locator('pre code strong').count(), 0);
  assert.match(await h.body(), /(?:~~~|```)+javascript\r\nconst literal = "\*\*keep\*\* \| \[\[Other\]\]";\r\nconsole.info\(literal\);/);
  checks.codeRemainsCodeAndRetainsLanguage = true;

  await selectRendered(editor, '链接前'); await page.keyboard.insertText('链接前已编辑'); await h.flush();
  assert.ok((await h.body()).includes('[[Other#Section|目标文章]]'), 'wiki target and alias survive adjacent edit');
  assert.ok((await h.body()).includes('![[Assets/one.png|120x80]]'), 'local image source and dimensions survive');
  assert.ok((await h.body()).includes('[ref]: Other.md#Section "精确保留定义"'), 'opaque reference definition preserved');
  assert.deepEqual(await editor.locator('img[data-image-path]').evaluateAll(nodes => nodes.map(n => n.dataset.imagePath)), ['Assets/one.png']);
  checks.localImagesWikiLinksAndOpaqueDefinitionsPreserved = true;

  await selectRendered(editor, '结尾段落'); await page.keyboard.insertText('最后一段已修改');
  await page.keyboard.press('Enter'); await page.keyboard.insertText('新建的段落');
  await h.flush();
  assert.match(await editor.innerText(), /最后一段已修改\s+新建的段落/);
  const finalSource = await h.body();
  assert.match(finalSource, /最后一段已修改\r\n(?:\r\n)?新建的段落/);
  assert.ok(finalSource.startsWith(prefix));
  checks.enterCreatesParagraphWithoutFlatteningDocument = true;

  assert.deepEqual(await frame.evaluate(() => ({ node: { ...board().nodes.find(n => n.id === 'article') }, camera: { ...board().view } })), geometry);
  assert.equal(await page.evaluate(() => richHost.calls.filter(c => c.method === 'save-layout').some(c => JSON.stringify(c.payload).includes('custom:'))), false);
  checks.cameraGeometryAndLayoutStorageUnchanged = true;
  await editor.blur();
  await page.screenshot({ path: new URL('rich-editor-after-edit.png', evidence).pathname });
  await page.evaluate(() => richReopen()); await page.waitForFunction(() => richHost.ready);
  const reopened = page.frames().find(f => f.parentFrame());
  await reopened.waitForSelector('[data-node="article"] .vb-inline-editor h2');
  assert.equal(await reopened.locator('[data-node="article"] .vb-inline-editor h2').textContent(), '就地修改的标题');
  assert.match(await reopened.locator('[data-node="article"] .vb-inline-editor table').innerText(), /修改后的单元格/);
  assert.equal(await h.body(), finalSource);
  checks.fullFrameReopenRetainsMarkdownAndRichFormatting = true;
  assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
  await writeFile(new URL('rich-editor-browser.json', evidence), JSON.stringify({ passed: true, checks, count: Object.keys(checks).length, errors: h.errors, remoteRequests: h.requests, sourceLength: finalSource.length, mode: 'actual bundled frame; isolated mocked Vault broker, trusted keyboard input' }, null, 2));
  console.log(`Rich editing passed: ${Object.keys(checks).length} functional groups.`);
} catch (error) {
  await page.screenshot({ path: new URL('rich-editor-failure.png', evidence).pathname });
  throw error;
} finally { await h.close(); }
