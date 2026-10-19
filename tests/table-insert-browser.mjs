import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {richHarness,selectRendered} from './rich-editor-harness.mjs';
const checks=[];
const main='# Rich\n\nFirst **original** paragraph.\n\nSecond untouched.\n\n![[Assets/one.png]]\n\n```js\nconst untouched = 1;\n```\n';
async function open(h,needle){if(needle)await selectRendered(h.editor,needle,true);else await h.editor.click();await h.frame.getByTestId('format-toolbar').waitFor({state:'visible'});await h.frame.getByTestId('format-table').click();await h.frame.getByTestId('table-panel').waitFor({state:'visible'});}
let h=await richHarness(main);
try{
 const geometry=await h.frame.evaluate(()=>({view:{...board().view},nodes:board().nodes.map(({id,x,y,w,h})=>({id,x,y,w,h}))}));
 await open(h,'First');
 await h.frame.getByRole('button',{name:'增加表格列数',exact:true}).click();
 await h.frame.getByRole('button',{name:'减少表格正文行数',exact:true}).click();
 assert.equal(await h.frame.getByTestId('table-columns').textContent(),'4');assert.equal(await h.frame.getByTestId('table-rows').textContent(),'2');
 assert.equal(await h.editor.evaluate(el=>document.activeElement===el),true);
 await h.frame.getByTestId('table-insert').click();await h.frame.waitForFunction(()=>document.querySelector('[data-node="article"] table')?.rows.length===3);await h.flush();
 const inserted=await h.body();assert.match(inserted,/First \*\*original\*\* paragraph\.\n\n\| 列 1 \| 列 2 \| 列 3 \| 列 4 \|\n\| --- \| --- \| --- \| --- \|\n(?:\|   \|   \|   \|   \|\n){2}\nSecond untouched\./);
 assert.ok(inserted.endsWith(main.slice(main.indexOf('Second untouched.'))));assert.equal(await h.peer.locator('table').count(),1);
 assert.deepEqual(await h.frame.evaluate(()=>({view:{...board().view},nodes:board().nodes.map(({id,x,y,w,h})=>({id,x,y,w,h}))})),geometry);
 checks.push('Caret-only insertion creates chosen 4-column, 2-body-row native Markdown table after its paragraph; original Markdown, image, code and geometry remain exact');
 await h.page.keyboard.press('Meta+z');await h.flush();assert.equal(await h.body(),main);assert.equal(await h.editor.locator('table').count(),0);await h.page.keyboard.press('Meta+Shift+z');await h.flush();assert.equal(await h.body(),inserted);
 checks.push('Table insertion supports Command+Z and Command+Shift+Z and updates duplicate article peers');
 await selectRendered(h.editor,'列 1',true);await h.frame.waitForFunction(()=>document.querySelector('[data-testid="format-table"]').disabled);assert.equal(await h.frame.getByTestId('format-table').isDisabled(),true);assert.match(await h.frame.getByTestId('format-table').getAttribute('title'),/表格外/);
 await selectRendered(h.editor,'const untouched',true);await h.frame.waitForFunction(()=>document.querySelector('[data-testid="format-table"]').disabled);assert.equal(await h.frame.getByTestId('format-table').isDisabled(),true);checks.push('Existing table and code selections disable insertion with a visible reason');
 await open(h,'Second');await h.frame.getByRole('button',{name:'2 × 2',exact:true}).click();assert.equal(await h.frame.getByTestId('table-columns').textContent(),'2');assert.equal(await h.frame.getByTestId('table-rows').textContent(),'2');await h.page.keyboard.press('Escape');await h.flush();assert.equal(await h.body(),inserted);assert.equal(await h.frame.getByTestId('table-panel').isVisible(),false);
 checks.push('Preset selection and Escape cancellation keep source and editor selection intact');
 assert.deepEqual(h.errors,[]);assert.deepEqual(h.requests,[]);await h.close();
 for(const body of ['', '# Rich\n\n', '---\ntags: [test]\n---\n\n# Rich\n\n']){
  h=await richHarness(body);await open(h);await h.frame.getByTestId('table-insert').click();await h.frame.waitForFunction(()=>!!document.querySelector('[data-node="article"] table'));await h.flush();assert.ok((await h.body()).startsWith(body));assert.equal(await h.editor.locator('table tr').count(),4);assert.equal(await h.editor.locator('table th').count(),3);await h.page.keyboard.press('Meta+z');await h.flush();assert.equal(await h.body(),body);assert.deepEqual(h.errors,[]);await h.close();
 }
 checks.push('Empty documents, hidden title-only documents and frontmatter/title prefixes accept insertion and exact undo');
 h=await richHarness('# Rich\r\n\r\nFirst\r\n\r\nSecond\r\n');await open(h,'First');await h.frame.getByTestId('table-insert').click();await h.flush();const crlf=await h.body();assert.equal(crlf.replace(/\r\n/g,'').includes('\n'),false);assert.ok(crlf.endsWith('Second\r\n'));await h.page.setViewportSize({width:480,height:800});await open(h,'Second');await h.page.waitForTimeout(50);const box=await h.frame.getByTestId('table-panel').boundingBox();assert.ok(box.x>=7&&box.x+box.width<=473&&box.y>=7&&box.y+box.height<=793,JSON.stringify(box));await h.page.screenshot({path:new URL('../evidence/table-insert-browser.png',import.meta.url).pathname});assert.deepEqual(h.errors,[]);checks.push('CRLF source remains CRLF and table settings stay in the mobile viewport');
 await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/table-insert-browser.json',import.meta.url),JSON.stringify({passed:true,groups:checks.length,checks},null,2)+'\n');console.log(JSON.stringify({passed:true,groups:checks.length,checks}));
}finally{await h.close().catch(()=>{});}
