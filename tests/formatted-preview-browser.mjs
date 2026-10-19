import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {richHarness,fixturePath} from './rich-editor-harness.mjs';
const body='# Rich\n\n## A heading\n\nFirst **bold** and _italic_.\n\n- first item\n- second item\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```md\n# literal **code**\n```\n\nFinal target+ with **needle**.\n';
const version=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8')).version;
const h=await richHarness(body);
try{
 const {frame,page}=h;
 await frame.evaluate(path=>openPreview(path),fixturePath);
 const preview=frame.getByTestId('formatted-note-preview');assert.equal(await preview.getAttribute('contenteditable'),null);
 assert.equal(await preview.locator('h2').textContent(),'A heading');assert.equal(await preview.locator('strong').first().textContent(),'bold');assert.equal(await preview.locator('table').count(),1);assert.equal(await preview.locator('ul li').count(),2);
 assert.doesNotMatch(await preview.innerText(),/## A heading|\*\*bold\*\*|\| --- \|/);assert.match(await preview.locator('pre code').textContent(),/# literal \*\*code\*\*/);
 const line=body.split('\n').findIndex(s=>s.startsWith('Final target'))+1;
 await frame.evaluate(({path,line})=>showSearchHitPreview(path,line,'target+'),{path:fixturePath,line});
 assert.equal(await frame.locator('#preview .vb-preview-query').textContent(),'target+');assert.equal(await frame.getByTestId('search-matched-line').getAttribute('data-source-line'),String(line));
 await frame.locator('#preview [data-native-line]').click();await page.waitForFunction(()=>richHost.calls.some(c=>c.method==='open-note'));
 const opened=await page.evaluate(()=>richHost.calls.findLast(c=>c.method==='open-note'));assert.deepEqual(opened.payload,{path:fixturePath,line:line-1});
 await frame.getByTestId('settings').click();assert.equal((await frame.getByTestId('board-runtime-version').textContent()).trim(),'Visual Board · '+version);
 assert.equal(await h.body(),body);assert.deepEqual(h.errors,[]);assert.deepEqual(h.requests,[]);
 await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/formatted-preview-browser.json',import.meta.url),JSON.stringify({passed:true,checks:['readonly preview renders headings, inline formats, lists and tables','fenced code preserves literal Markdown','literal regex keyword locates rendered source block','open original targets exact original line','actual running bundle version is visible','no note writes or external requests'],userVaultAccessed:false},null,2));console.log('Formatted preview and search-line navigation passed.');
}finally{await h.close();}
