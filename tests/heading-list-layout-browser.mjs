import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness, selectRendered } from './rich-editor-harness.mjs';

// A real built frame and toolbar, isolated from the user's Vault.
const evidence = new URL('../evidence/', import.meta.url), checks = [], stages = [];
await mkdir(evidence, { recursive: true });
async function inspect(editor) {
  return editor.evaluate(el => {
    const rect = node => { const b = node.getBoundingClientRect(); return { x:b.x, y:b.y, width:b.width, height:b.height, right:b.right, bottom:b.bottom }; };
    const firstGlyph = node => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); let text;
      while (text = walker.nextNode()) if (text.nodeValue.trim()) {
        const i = text.nodeValue.search(/\S/), range = document.createRange(); range.setStart(text, i); range.setEnd(text, i + 1); return rect({ getBoundingClientRect: () => range.getBoundingClientRect() });
      }
      return null;
    };
    return {
      html: el.innerHTML, text: el.innerText, editor: rect(el), scale: el.getBoundingClientRect().width / el.offsetWidth,
      invalid: [...el.querySelectorAll('h1,h2,h3,h4,h5,h6,p')].filter(n => n.querySelector('h1,h2,h3,h4,h5,h6,p,ol,ul')).map(n => n.outerHTML),
      items: [...el.querySelectorAll('li')].map(node => {
        const list = node.parentElement, heading = [...node.children].find(n => /^H[1-6]$/.test(n.tagName));
        return { text: node.textContent, rect:rect(node), list:rect(list), glyph:firstGlyph(heading || node), heading:heading ? rect(heading) : null,
          font:parseFloat(getComputedStyle(node).fontSize), headingFont:heading ? parseFloat(getComputedStyle(heading).fontSize) : null,
          marker:{ content:getComputedStyle(node,'::marker').content, font:getComputedStyle(node,'::marker').fontSize, position:getComputedStyle(node).listStylePosition },
          lineHeight:getComputedStyle(heading || node).lineHeight, headingMarginTop:heading ? parseFloat(getComputedStyle(heading).marginTop) : null };
      }),
    };
  });
}
function validStructure(layout, stage) {
  assert.deepEqual(layout.invalid, [], stage + ': no heading/paragraph may contain block headings or lists');
  for (const item of layout.items) {
    if (!item.glyph) continue;
    assert.ok(item.glyph.x >= layout.editor.x - 1, stage + ': first text glyph remains inside editor');
    assert.ok(item.glyph.x - item.list.x >= item.font * layout.scale * 1.55, stage + ': list has room for its numeric marker');
    if (item.heading) {
      assert.ok(item.heading.y >= item.rect.y - 1, stage + ': heading must not rise above its own list item');
      assert.ok(item.heading.bottom <= item.rect.bottom + 1, stage + ': heading must remain inside its list item');
      assert.ok(item.headingMarginTop <= 1, stage + ': first heading starts on the marker line');
    }
  }
}

const target = '2.12.2 企业原有规范';
const tail = '保留 **原文格式** 和 `source`。\n\n12. Existing item\n13. Another item\n';
let h = await richHarness('# Rich\n\n' + target + '\n\n' + tail);
try {
  const geometry = await h.frame.evaluate(() => ({ view:{...board().view}, nodes:board().nodes.map(({id,x,y,w,h})=>({id,x,y,w,h})) }));
  for (const [kind, expected] of [['h1','H1'],['ordered-list','OL'],['h2','H2'],['unordered-list','UL'],['h3','H3'],['paragraph','P'],['ordered-list','OL'],['ordered-list','P'],['h2','H2']]) {
    await selectRendered(h.editor, target); await h.frame.getByTestId('format-' + kind).click(); await h.flush();
    const layout = await inspect(h.editor); stages.push({ stage:kind, ...layout }); validStructure(layout, kind);
    const containing = await h.editor.evaluate((el, target) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
      while (node = walker.nextNode()) if (node.nodeValue.includes(target)) return { heading:node.parentElement.closest('h1,h2,h3')?.tagName || null, list:node.parentElement.closest('ol,ul')?.tagName || null };
      return null;
    }, target);
    assert.ok(containing, kind + ': original chapter number/text survives');
    if (/^h[123]$/.test(kind)) assert.deepEqual(containing, {heading:kind.toUpperCase(),list:null});
    if (expected === 'OL') assert.deepEqual(containing, {heading:null,list:'OL'});
    if (expected === 'P') assert.deepEqual(containing, {heading:null,list:null});
    if (kind === 'unordered-list') assert.deepEqual(containing, {heading:null,list:'UL'});
    if (kind === 'paragraph') assert.deepEqual(containing, {heading:null,list:null});
    assert.ok((await h.body()).endsWith(tail), kind + ': unrelated source bytes and original list numbering survive');
    assert.equal(/^(?:#{1,6})\s*$/m.test(await h.body()), false, kind + ': no orphan Markdown heading markers');
  }
  assert.deepEqual(await h.frame.evaluate(() => ({ view:{...board().view}, nodes:board().nodes.map(({id,x,y,w,h})=>({id,x,y,w,h})) })), geometry);
  await h.page.screenshot({path:new URL('heading-list-toolbar-transitions.png',evidence).pathname});
  checks.push('Toolbar heading/list transitions remain mutually exclusive, preserve chapter text and untouched source');
  const final = await h.body(); await h.editor.blur();
  const read = await inspect(h.editor); validStructure(read,'reading after transitions');
  assert.equal(await h.body(), final);
  await h.page.evaluate(() => richReopen()); await h.page.waitForFunction(() => richHost.ready);
  const reopened = h.page.frames().find(f => f.parentFrame()).locator('[data-node="article"] .vb-inline-editor'); await reopened.locator('h2').waitFor();
  const layout = await inspect(reopened); validStructure(layout,'reopened transitions');
  assert.equal(await reopened.locator('h2').filter({hasText:target}).count(),1);
  checks.push('Saved Markdown reopens with the same single heading and valid block structure');
  assert.deepEqual(h.errors,[]);assert.deepEqual(h.requests,[]);
} finally { await h.close(); }

const legal = '# Rich\n\n100. # 一级标题 2.12.2 原有编号\n101. 下一条\n\n中间段落。\n\n200. ## 二级标题 2.12.2 原有编号\n201. 下一条\n\n中间段落。\n\n300. ### 三级标题 2.12.2 原有编号\n301. 下一条\n\n1. 外层条目\n   1. ## 嵌套二级标题\n   2. 嵌套后续条目\n\n结尾原文。\n';
h = await richHarness(legal);
try {
  const before = await inspect(h.editor); stages.push({stage:'legal-list-headings-reading',...before}); validStructure(before,'legal original reading');
  assert.equal(await h.editor.locator('li > h1').count(),1);assert.equal(await h.editor.locator('li > h2').count(),2);assert.equal(await h.editor.locator('li > h3').count(),1);
  await h.page.screenshot({path:new URL('heading-list-existing-reading.png',evidence).pathname});
  await selectRendered(h.editor,'一级标题');
  const editing = await inspect(h.editor); stages.push({stage:'legal-list-headings-editing',...editing}); validStructure(editing,'legal original editing');
  assert.deepEqual(editing.items.map(n=>({rect:n.rect,heading:n.heading,glyph:n.glyph})),before.items.map(n=>({rect:n.rect,heading:n.heading,glyph:n.glyph})), 'focus does not move existing heading/marker text');
  await h.flush();assert.equal(await h.body(),legal, 'reading/focus leaves original legal numbered-heading Markdown exact');
  await h.page.screenshot({path:new URL('heading-list-existing-editing.png',evidence).pathname});
  await h.editor.blur();await h.flush();assert.equal(await h.body(),legal);
  checks.push('Existing legal list-item headings H1–H3 and nested lists have aligned gutters without rewriting Markdown');
  assert.deepEqual(h.errors,[]);assert.deepEqual(h.requests,[]);
} finally { await h.close(); }

await writeFile(new URL('heading-list-layout-browser.json',evidence),JSON.stringify({passed:true,checks,groups:checks.length,stages,mode:'actual built iframe and toolbar; isolated mocked Vault'},null,2)+'\n');
console.log('Heading/list layout passed: '+checks.length+' functional groups.');
