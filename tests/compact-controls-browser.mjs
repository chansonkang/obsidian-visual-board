import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {richHarness,fixturePath} from './rich-editor-harness.mjs';
const checks=[],h=await richHarness('# Rich\n\nEditable **text**.\n');
try{
 const f=h.frame;
 await f.evaluate(()=>select('article'));
 const bar=f.locator('#selection-bar'),more=f.getByTestId('selection-more'),menu=f.getByTestId('selection-more-menu');
 assert.equal(await bar.locator(':scope>button').count(),5);assert.equal(await bar.locator(':scope>span').textContent(),'Rich');
 assert.equal(await f.getByTestId('reveal-article-in-explorer').isVisible(),true);assert.equal(await f.getByTestId('component-copy').isVisible(),true);assert.equal(await f.getByTestId('copy-selected-url').isVisible(),true);
 assert.equal(await f.getByTestId('fit-article-size').isVisible(),false);assert.equal(await menu.locator('[data-action="move"]').count(),1);assert.equal(await menu.locator('[data-action="remove"]').count(),1);assert.equal(await menu.locator('[data-preview]').count(),1);assert.equal(await menu.getByTestId('component-paste').count(),1);
 assert.equal(await bar.locator(':scope>button').evaluateAll(buttons=>buttons.every(b=>b.querySelector('svg')&&b.title&&b.getAttribute('aria-label'))),true);
 checks.push('Single selection has a truncated name and five icon controls; all existing secondary actions and selectors remain in More');
 await more.click();assert.equal(await menu.isVisible(),true);assert.equal(await more.getAttribute('aria-expanded'),'true');await h.page.keyboard.press('ArrowDown');assert.equal(await menu.locator('button').first().evaluate(el=>document.activeElement===el),true);await h.page.keyboard.press('Escape');assert.equal(await menu.isVisible(),false);assert.equal(await more.evaluate(el=>document.activeElement===el),true);
 await more.click();await f.getByTestId('fit-article-size').click();await f.waitForFunction(()=>document.getElementById('toast').textContent.includes('适配'));assert.equal(await menu.isVisible(),false);
 await more.click();await h.editor.focus();assert.equal(await menu.isVisible(),false);
 checks.push('More is anchored and keyboard accessible; its original fit action executes, and focusing an editor closes the menu');
 await f.getByTestId('reveal-article-in-explorer').click();await h.page.waitForFunction(()=>richHost.calls.some(c=>c.method==='reveal-entry'));
 assert.equal(await h.page.evaluate(()=>richHost.calls.findLast(c=>c.method==='reveal-entry').payload.path),fixturePath);
 checks.push('Primary reveal uses the existing native action and correct article path');
 await f.evaluate(()=>window.VBI18n.setLanguage('en'));assert.equal(await more.getAttribute('title'),'More actions');assert.equal(await f.getByTestId('reveal-article-in-explorer').getAttribute('aria-label'),'Reveal in file explorer');assert.equal(await f.getByTestId('fit-article-size').textContent(),'Fit note card');assert.equal(await bar.locator(':scope>span').textContent(),'Rich');await f.evaluate(()=>window.VBI18n.setLanguage('zh'));assert.equal(await more.getAttribute('title'),'更多操作');
 checks.push('Chinese and English icon labels update without translating the component name');
 await f.evaluate(()=>{board().nodes.push({id:'folder-compact',type:'board',board:'child',x:1200,y:0},{id:'sticky-compact',type:'note',title:'保持标题',text:'保持正文',x:300,y:0,w:240,h:240});render();select('folder-compact');});
 assert.equal(await f.getByTestId('enter-selected-board').isVisible(),true);await more.click();assert.equal(await f.getByTestId('edit-folder-style').isVisible(),true);assert.equal(await menu.locator('[data-action="rename-selected"]').isVisible(),true);await more.click();
 await f.evaluate(()=>select('sticky-compact'));assert.equal(await f.getByTestId('edit-sticky').isVisible(),true);await more.click();assert.equal(await f.getByTestId('edit-sticky-style').isVisible(),true);await more.click();
 checks.push('Folder entry, rename, folder style, sticky editing and sticky style retain their original controls');
 await f.evaluate(()=>{const original=document.createElement('button');original.textContent='Custom original action';original.dataset.testid='compact-custom-action';document.getElementById('selection-bar').append(original);window.VBCompactControls.refresh();});await more.click();assert.equal(await f.getByTestId('compact-custom-action').getAttribute('aria-label'),'Custom original action');await more.click();
 checks.push('Unknown extension actions retain their original accessible name in overflow');
 const stateBefore=await f.evaluate(()=>({view:{...board().view},nodes:structuredClone(board().nodes)}));
 function overlap(a,b){return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;}
 for(const width of [1536,900,580,390]){
  await h.page.setViewportSize({width,height:1024});await f.waitForFunction(w=>Math.abs(innerWidth-w)<2,width);await new Promise(resolve=>setTimeout(resolve,100));
  const boxes=await f.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};return {bar:rect('#selection-bar'),main:rect('.bottom-toolbar'),zoom:rect('.zoom-controls'),width:innerWidth,height:innerHeight,hint:getComputedStyle(document.querySelector('.vb-multiselect-hint')).display,buttons:[...document.querySelectorAll('.bottom-toolbar button')].map(b=>({w:b.offsetWidth,h:b.offsetHeight}))};});
  assert.ok(boxes.main.bottom<=boxes.height+1&&boxes.bar.bottom<=boxes.height+1,'Controls remain vertically in viewport at '+width);assert.ok(boxes.bar.left>=0&&boxes.bar.right<=boxes.width+1,'Selection remains inside viewport at '+width);assert.ok(boxes.main.left>=0&&boxes.main.right<=boxes.width+1,'Main toolbar remains inside viewport at '+width);assert.ok(!overlap(boxes.bar,boxes.main),'Selection and creation bars overlap at '+width);assert.ok(!overlap(boxes.zoom,boxes.main),'Zoom and main toolbar overlap at '+width);assert.ok(!overlap(boxes.zoom,boxes.bar),'Zoom and selection overlap at '+width);assert.ok(boxes.buttons.every(b=>b.w===44&&b.h===44));assert.equal(boxes.hint,'none');
  await more.click();const mr=await menu.boundingBox();assert.ok(mr.x>=0&&mr.x+mr.width<=width+1);await more.click();
 }
 assert.deepEqual(await f.evaluate(()=>({view:{...board().view},nodes:structuredClone(board().nodes)})),stateBefore);
 checks.push('At 1536, 900, 580 and 390 px controls stay inside the viewport and never overlap; 44 px targets, menu bounds and user layout are preserved');
 await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await f.evaluate(()=>select('article'));await h.page.screenshot({path:new URL('../evidence/compact-controls-narrow.png',import.meta.url).pathname});await h.page.setViewportSize({width:1536,height:1024});await f.waitForFunction(()=>Math.abs(document.getElementById('scene').getBoundingClientRect().width-1536)<2);await f.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await f.evaluate(()=>select('article'));await more.click();await f.locator('#canvas').click({position:{x:1450,y:500}});assert.equal(await f.evaluate(()=>selected),null);assert.equal(await bar.textContent(),'');
 checks.push('A blank-canvas click closes More and clears component selection');
 assert.equal(await h.body(),'# Rich\n\nEditable **text**.\n');assert.deepEqual(h.errors,[]);assert.deepEqual(h.requests,[]);
 await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/compact-controls-browser.json',import.meta.url),JSON.stringify({passed:true,checks,userVaultAccessed:false},null,2));console.log('Compact controls: '+checks.length+' checks passed.');
}finally{await h.close();}

// Fresh desktop compositor capture avoids Chromium's stale tiled paint after repeated viewport resizing.
const shot=await richHarness('# Rich\n\nEditable **text**.\n');try{await shot.frame.evaluate(()=>select('article'));await shot.page.screenshot({path:new URL('../evidence/compact-controls-desktop.png',import.meta.url).pathname});}finally{await shot.close();}
