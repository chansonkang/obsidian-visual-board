import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../src/frontend-i18n.js',import.meta.url),'utf8');
const inventory=JSON.parse(await readFile(new URL('./fixtures/native-error-i18n-inventory.json',import.meta.url),'utf8'));
function runtime(language){
 const window={__VB_INIT:{settings:{language}},confirm:()=>true,addEventListener(){},dispatchEvent(){}};
 const document={body:{},documentElement:{},querySelectorAll:()=>[]};
 runInNewContext(source,{window,document,parent:{},MutationObserver:class{observe(){}},CustomEvent:class{},NodeFilter:{},queueMicrotask});
 return window.VBI18n;
}
test('English runtime covers the complete fixed native-error inventory and preserves external server diagnostics',()=>{
 const i18n=runtime('en'),missing=inventory.filter(message=>/\p{Script=Han}/u.test(i18n.t(message)));
 assert.deepEqual(missing,[],'Fixed product errors must not fall back to Chinese in English mode');
 assert.equal(i18n.t('此目录中已有同名文件，请更换标题。'),'A file with this name already exists in this folder. Choose another title.');
 const server='APImart upstream: 模型暂时不可用 (request_id=fixture-123)';assert.equal(i18n.t(server),server,'Unknown provider diagnostics must remain byte-for-byte unchanged');
});
test('Chinese runtime keeps fixed product errors and unknown diagnostics unchanged',()=>{
 const i18n=runtime('zh');assert.ok(inventory.every(message=>i18n.t(message)===message));
 assert.equal(i18n.t('EPERM: Notes/保存设置.md'),'EPERM: Notes/保存设置.md');
});

test('component clipboard and Markdown import/drop fixed errors translate without changing filenames or external diagnostics',async()=>{
 const modules=await Promise.all(['component-clipboard.ts','markdown-import.ts','main.ts'].map(name=>readFile(new URL('../src/'+name,import.meta.url),'utf8')));
 const messages=[...new Set(modules.flatMap(text=>[...text.matchAll(/(?:Error|failure)\('([^']+)'\)/g)].map(match=>match[1])).concat(['Markdown 文件导入失败，请检查本地文件夹。','文件未能移入。']))];
 const en=runtime('en'),zh=runtime('zh');
 assert.deepEqual(messages.filter(message=>/\p{Script=Han}/u.test(en.t(message))),[],'Every fixed clipboard/import/drop failure must have an English message');
 assert.ok(messages.every(message=>zh.t(message)===message),'Chinese errors must remain exact');
 for(const text of ['笔记/Markdown 文件超过 10 MiB，请选择较小的文件。.md','EPERM: Notes/朋友的文章.md','Upstream: 文件未能移入。 (id=raw-fixture)'])assert.equal(en.t(text),text,'Paths and external errors must not be partially translated');
});
