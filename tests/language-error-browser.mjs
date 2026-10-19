import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {richHarness,fixturePath} from './rich-editor-harness.mjs';
const h=await richHarness('# Rich\n\nOriginal Markdown.\n',{settings:{language:'en'}});
const nativeError='文件列表尚未打开，请先启用 Obsidian「文件列表」核心插件并打开侧栏。';
try{
 const {frame,page}=h;
 await frame.waitForFunction(()=>VBI18n.language==='en');
 await page.evaluate(error=>{richHost.rpcErrors={'reveal-entry':error};},nativeError);
 await frame.getByTestId('select-article').click();await frame.getByTestId('reveal-article-in-explorer').click();
 await frame.waitForFunction(()=>document.querySelector('#toast').textContent.startsWith('Could not reveal in file explorer:'));
 const english=await frame.locator('#toast').textContent();assert.equal(/[\u3400-\u9fff]/u.test(english),false,english);assert.match(english,/file explorer|file list/i);assert.ok(english.includes(fixturePath));
 await frame.evaluate(()=>VBI18n.setLanguage('zh',{persist:false}));await frame.getByTestId('reveal-article-in-explorer').click();
 await frame.waitForFunction(error=>document.querySelector('#toast').textContent.includes(error),nativeError);
 const chinese=await frame.locator('#toast').textContent();assert.ok(chinese.includes(nativeError)&&chinese.includes(fixturePath));
 assert.equal(await h.body(),'# Rich\n\nOriginal Markdown.\n');assert.equal(await page.evaluate(()=>richHost.calls.filter(c=>c.method==='update-note').length),0);
 assert.deepEqual(h.errors,[]);await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/language-error-browser.json',import.meta.url),JSON.stringify({passed:true,checks:['native RPC validation error translated before UI composition','language switch restores original Chinese error','file path and source remain exact'],english,chinese,userVaultAccessed:false},null,2));console.log('Localized native error composition passed.');
}finally{await h.close();}
