import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness, selectRendered } from './rich-editor-harness.mjs';
const h=await richHarness('# Rich\n\n**第一，任务完成率：** 用户反馈。\n\n第二，满意度： 用户认可。\n\n## 第三，安全负向事件\n\n### 第四，持续检查\n');
try{
 const {frame,editor,page}=h;
 await selectRendered(editor,'第二，满意度：');
 await page.keyboard.press('Control+b');
 const colors=()=>editor.evaluate(el=>Object.fromEntries([...el.querySelectorAll('strong,b,h2,h3')].map((n,i)=>[i,{tag:n.tagName,color:getComputedStyle(n).color,text:n.textContent}])));
 const edited=await colors();assert.ok(Object.values(edited).some(n=>n.tag==='B'),'actual Chromium bold command creates the alternate inline tag');
 for(const n of Object.values(edited))assert.equal(n.color,'rgb(37, 49, 64)','Markdown bold, edited bold and all headings share the same ink');
 await h.flush();await editor.blur();await page.evaluate(()=>richSnapshot());await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const reread=await colors();for(const n of Object.values(reread))assert.equal(n.color,'rgb(37, 49, 64)');
 assert.match(await h.body(),/\*\*第二，满意度：\*\*/);assert.deepEqual(h.errors,[]);
 await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/heading-color-browser.json',import.meta.url),JSON.stringify({passed:true,edited,reread,checks:['native b and Markdown strong share heading color','H2/H3 use same ink','saved Markdown retains formatting','snapshot retains color'],userVaultAccessed:false},null,2));
 await page.screenshot({path:new URL('../evidence/heading-color-browser.png',import.meta.url).pathname});console.log('Heading color consistency passed: editing, save and snapshot.');
}finally{await h.close();}
