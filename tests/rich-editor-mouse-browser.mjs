import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness } from './rich-editor-harness.mjs';

// Actual physical mouse and keyboard against the bundled opaque iframe. No helper
// creates the mouse test selections. The final separate case exercises the browser
// focus contract needed by accessibility clients which set selection before focus.
const body = '\uFEFF---\r\nkeep: "local"\r\n---\r\n\r\n# Title\r\n\r\n## HeadingOriginal\r\n\r\nParagraphOriginal\r\n\r\n| A | B |\r\n| --- | ---: |\r\n| C | 12 |\r\n';
const evidence = new URL('../evidence/', import.meta.url);
await mkdir(evidence, { recursive: true });
const checks = [];
for (const interval of [0, 12, 50]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const h = await richHarness(body);
    try {
      const box = await h.editor.locator('p').boundingBox(); assert.ok(box);
      if (interval) await h.page.evaluate(ms => { window.mouseSnapshots = setInterval(() => richSnapshot(), ms); }, interval);
      await h.page.mouse.dblclick(box.x + 55, box.y + 9, { delay: 60 });
      const selection = await h.frame.evaluate(() => ({ text: getSelection().toString(), anchor: getSelection().anchorNode?.parentElement?.tagName, focus: getSelection().focusNode?.parentElement?.tagName }));
      assert.equal(selection.text, 'ParagraphOriginal'); assert.equal(selection.anchor, 'P'); assert.equal(selection.focus, 'P');
      await h.page.keyboard.insertText('ParagraphEdited'); await h.flush();
      if (interval) await h.page.evaluate(() => clearInterval(window.mouseSnapshots));
      assert.equal(await h.body(), body.replace('ParagraphOriginal', 'ParagraphEdited'));
      assert.equal(await h.editor.locator('h2').textContent(), 'HeadingOriginal');
      assert.equal(await h.editor.locator('p').textContent(), 'ParagraphEdited');
      assert.deepEqual(h.errors, []);
      checks.push({ method: 'physical doubleclick + keyboard', interval, attempt, selection: selection.text, exactSource: true });
    } finally { await h.close(); }
  }
}
const h = await richHarness(body);
try {
  const selected = await h.editor.evaluate(el => {
    const node = el.querySelector('p').firstChild, range = document.createRange(); range.selectNodeContents(node);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const before = selection.toString(); el.focus({ preventScroll: true });
    return { before, after: selection.toString() };
  });
  assert.deepEqual(selected, { before: 'ParagraphOriginal', after: 'ParagraphOriginal' });
  await h.page.keyboard.insertText('AccessibleReplacement'); await h.flush();
  assert.equal(await h.body(), body.replace('ParagraphOriginal', 'AccessibleReplacement'));
  checks.push({ method: 'separate selection then focus contract', exactSource: true });
  await h.page.screenshot({ path: new URL('rich-editor-mouse.png', evidence).pathname });
} finally { await h.close(); }

for(const word of ['ParagraphOriginal','b'])for(const interval of [0,25]){
  const source='# Title\r\n\r\n## HeadingOriginal\r\n\r\n'+word+'\r\n\r\n这里保留 **加粗** 和 _斜体_。\r\n';
  const h=await richHarness(source);
  try{
    await h.page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(h.page.url()).origin});
    await h.page.evaluate(()=>navigator.clipboard.writeText('ParagraphSaved'));
    const box=await h.editor.locator('p').first().evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const b=r.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height};});
    if(interval)await h.page.evaluate(ms=>{window.mouseSnapshots=setInterval(()=>richSnapshot(),ms);},interval);
    // A single glyph's right half can select the following paragraph separator
    // in plain Chromium too. Hit the actual word's left ink, then assert selection.
    await h.page.mouse.dblclick(box.x+box.w*.25,box.y+box.h/2,{delay:60});
    assert.equal(await h.frame.evaluate(()=>getSelection().toString()),word);
    await h.page.keyboard.press('Meta+v');await h.flush();
    if(interval)await h.page.evaluate(()=>clearInterval(window.mouseSnapshots));
    assert.equal(await h.body(),source.replace(word,'ParagraphSaved'));
    assert.equal(await h.editor.locator('p').count(),2);
    assert.equal(await h.editor.locator('h2').textContent(),'HeadingOriginal');
    assert.equal(await h.editor.locator('strong').textContent(),'加粗');
    assert.deepEqual(h.errors,[]);
    checks.push({method:'real clipboard.writeText + physical word doubleclick + trusted MetaV',word,interval,exactSource:true});
  }finally{await h.close();}
}
{
 const h=await richHarness(body);
 try{
  const rect=await h.editor.locator('p').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const b=r.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height};});
  await h.page.mouse.move(rect.x+.1,rect.y+rect.h/2);await h.page.mouse.down();await h.page.mouse.move(rect.x+rect.w-.1,rect.y+rect.h/2,{steps:10});await h.page.mouse.up();
  assert.equal(await h.frame.evaluate(()=>getSelection().toString()),'ParagraphOriginal');
  await h.page.keyboard.insertText('FirstDragReplacement');await h.flush();
  assert.equal(await h.body(),body.replace('ParagraphOriginal','FirstDragReplacement'));
  checks.push({method:'first read click native mouse drag selection',exactSource:true});
 }finally{await h.close();}
}
{
 const h=await richHarness('# Title\n\n');
 try{
  const box=await h.editor.boundingBox();await h.page.mouse.click(box.x+25,box.y+15);await h.page.keyboard.insertText('NewParagraph');await h.flush();
  assert.match(await h.body(),/^# Title\n\nNewParagraph(?:\n)*$/);
  assert.equal(await h.editor.getAttribute('contenteditable'),'true');
  checks.push({method:'empty body first mouse click and native typing',newParagraph:true});
 }finally{await h.close();}
}

{
 const h=await richHarness(body);
 try{
  const geometry=await h.frame.evaluate(()=>JSON.stringify({nodes:board().nodes,view:board().view}));
  const headingBox=await h.editor.locator('h2').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const b=r.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height};});
  await h.page.mouse.click(headingBox.x+headingBox.w*.25,headingBox.y+headingBox.h/2);await h.page.keyboard.insertText('Edited');await h.flush();
  const heading=await h.editor.locator('h2').textContent();assert.equal(await h.body(),body.replace('HeadingOriginal',heading));
  checks.push({method:'first read physical heading click caret',exactOtherBlocks:true});
  const cell=h.editor.locator('tbody td').first(),cellBox=await cell.boundingBox();await h.page.mouse.click(cellBox.x+12,cellBox.y+12);await h.page.keyboard.insertText('CellEdit');await h.flush();
  assert.match(await cell.textContent(),/CellEdit/);assert.equal(await h.editor.locator('p').textContent(),'ParagraphOriginal');assert.equal(await h.editor.locator('h2').textContent(),heading);
  assert.equal(await h.frame.evaluate(()=>JSON.stringify({nodes:board().nodes,view:board().view})),geometry);
  checks.push({method:'physical table cell click caret',geometryAndOtherBlocks:true});
 }finally{await h.close();}
}
await writeFile(new URL('rich-editor-mouse-browser.json', evidence), JSON.stringify({ passed: true, count: checks.length, checks, scope: 'Real built frame, isolated memory Vault; physical mouse/keyboard, real browser clipboard via permissions+trusted MetaV, snapshot stress; one explicitly separate accessibility focus-contract case' }, null, 2));
console.log(`Rich mouse selection passed: ${checks.length} cases.`);
