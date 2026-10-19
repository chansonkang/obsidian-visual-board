// Public documentation screenshots from the actual built product and synthetic demo data.
// No user Vault, user articles, account, network service, or UI replacement is used.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_CORE_PATH||'playwright-core');
const root=new URL('../',import.meta.url),version=JSON.parse(await readFile(new URL('manifest.json',root),'utf8')).version;
const html=await readFile(new URL('src/frame.html',root),'utf8');
const photo='data:image/png;base64,'+(await readFile(new URL('vendor/prototype/assets/research-photo.png',root))).toString('base64');
const wav=Buffer.alloc(44+8000*40*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const note=(path,body,outgoing=[])=>({id:path,path,title:path.split('/').pop().replace(/\.md$/,''),body,mtime:1,outgoing,backlinks:[]});
const introPath='设计工作室/把灵感写成作品.md',systemPath='设计工作室/内容系统/一篇文章的生长.md',readingPath='阅读花园/慢一点，想清楚.md';
const docs={
 [introPath]:note(introPath,'# 把灵感写成作品\n\n## 让思考，有迹可循\n\n收集一束灵感，再给它一个可以慢慢生长的空间。\n\n- **看见**：保存值得回看的片段\n- **连接**：让文章与想法彼此相遇\n- **表达**：把零散线索写成自己的作品\n\n> 好的秩序，是给创造留出余地。\n\n下一步，走进 [[一篇文章的生长|内容系统]]。\n',[systemPath]),
 [systemPath]:note(systemPath,'# 一篇文章的生长\n\n## 从零散，到清晰\n\n写作从一个值得追问的想法开始。把材料放在一起，让它们慢慢长出自己的结构。\n\n### 今天的写作路径\n\n1. 收集真实的观察与片段\n2. 找到一条清晰的叙事主线\n3. 写下让读者带走的一个观点\n\n| 阶段 | 关注什么 | 下一步 |\n| --- | --- | --- |\n| 收集 | 有意思的事实 | 留下线索 |\n| 连接 | 想法之间的关系 | 形成提纲 |\n| 表达 | 清晰而具体 | 完成初稿 |\n\n> 留白，让新的想法有地方落下。\n\n### 留给明天\n\n- [x] 梳理文章的核心观点\n- [ ] 补充一个亲身经历的例子\n- [ ] 把结尾写得更轻一点\n\n将这篇文章和 [[慢一点，想清楚]] 放在一起回看。\n',[readingPath]),
 [readingPath]:note(readingPath,'# 慢一点，想清楚\n\n## 读书，也是在整理自己\n\n留下触动你的句子，记下它为什么与你有关。\n\n**不急着收集更多，先理解已经拥有的。**\n\n把阅读变成一场持续的对话。\n'),
};
const photoNode=(id,x,y,w=280)=>({id,type:'photo',title:'午后的一束光',imagePath:'附件/午后的光.png',imageWidth:1122,imageHeight:1402,x,y,w,h:(w-20)*1402/1122+20});
const audioNode=(id,x,y)=>({id,type:'audio',title:'午后 · 专注片段',filePath:'附件/午后·专注.wav',x,y,w:500,h:180});
const article=(id,doc,x,y,w,h)=>({id,type:'article',doc,x,y,w,h});
const layout={version:2,articleSizingVersion:1,currentBoard:'home',showKnowledge:false,showSpace:true,audioPlayback:{'附件/午后·专注.wav':{position:12,duration:40}},boards:{
 home:{id:'home',title:'我的灵感桌面',parent:null,folderPath:'',theme:'product',iconMode:'default',view:{x:0,y:0,zoom:1},nodes:[
  {id:'studio-entry',type:'board',board:'studio',x:70,y:30},{id:'reading-entry',type:'board',board:'reading',x:410,y:30},
  article('intro',introPath,780,30,370,510),photoNode('light',1220,30,280),
  {id:'small-thought',type:'note',title:'留一点空白',text:'不必急着把一切填满。\n\n先收藏，再连接，\n让好想法慢慢长出来。',color:'green',x:1220,y:440,w:280,h:195},
  audioNode('focus',110,465),
 ],edges:[]},
 studio:{id:'studio',title:'设计工作室',parent:'home',folderPath:'设计工作室',theme:'product',iconMode:'default',iconId:'palette',folderColor:'lavender',view:{x:0,y:0,zoom:1},nodes:[{id:'system-entry',type:'board',board:'system',x:100,y:50},article('intro-child',introPath,500,40,420,500)],edges:[]},
 reading:{id:'reading',title:'阅读花园',parent:'home',folderPath:'阅读花园',theme:'reading',iconMode:'default',iconId:'book-open',folderColor:'mint',view:{x:0,y:0,zoom:1},nodes:[article('reading-note',readingPath,500,40,420,500)],edges:[]},
 system:{id:'system',title:'内容系统',parent:'studio',folderPath:'设计工作室/内容系统',theme:'knowledge',iconMode:'default',iconId:'pen-line',folderColor:'peach',view:{x:0,y:0,zoom:1},nodes:[
  article('writing',systemPath,100,20,690,640),
  {id:'writing-note',type:'note',title:'这一篇，只讲一件事',text:'把复杂的想法，\n写成简单的句子。\n\n读完后，希望读者\n愿意开始记录自己的观察。',color:'green',x:900,y:30,w:300,h:245},
  photoNode('writing-light',1260,20,245),article('reading-reference',readingPath,900,340,430,300),
 ],edges:[]},
}};
const payload={layout,docs,assets:{'附件/午后的光.png':photo},embeds:{},mediaAssets:{},drafts:[],settings:{language:'zh',defaultIconMode:'default',attachmentFolder:'附件'},vaultName:'我的创作空间'};
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe sandbox="allow-scripts allow-modals allow-downloads" style="width:100%;height:100%;border:0;display:block"></iframe></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-site-isolation-trials']});
const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});const errors=[],network=[];page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))network.push(r.url());});await page.route('https://**',r=>r.abort());
try{
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(({html,payload,audio,version})=>{
  const iframe=document.querySelector('iframe');window.showcase={ready:false,payload};
  addEventListener('message',event=>{
   if(event.source!==iframe.contentWindow)return;const m=event.data;
   if(m.kind==='vb-boot'){iframe.contentWindow.postMessage({kind:'vb-init',channel:'public-showcase',payload},'*');return;}
   if(m.channel!=='public-showcase')return;if(m.kind==='vb-ready'){showcase.ready=true;return;}if(m.kind!=='vb-request')return;
   let result={ok:true};if(m.method==='read-audio')result={kind:'audio',mime:'audio/wav',base64:audio};
   if(m.method==='update-info')result={status:'not-configured',repository:'',autoCheck:true,currentVersion:version,shouldNotify:false};
   if(m.method==='save-layout')payload.layout=m.payload;
   if(m.method==='save-settings'){payload.settings={...payload.settings,...m.payload};result=payload.settings;}
   if(m.method==='update-note'){const doc=payload.docs[m.payload.path];if(doc&&doc.body===m.payload.expectedBody){doc.body=m.payload.body;result={ok:true,doc};}else result={ok:false,reason:'conflict'};}
   iframe.contentWindow.postMessage({kind:'vb-response',channel:'public-showcase',id:m.id,result},'*');
  });iframe.srcdoc=html;
 },{html,payload,audio:wav.toString('base64'),version});
 await page.waitForFunction(()=>showcase.ready);const frame=page.frames().find(f=>f.parentFrame());await frame.waitForSelector('[data-node="intro"] .vb-inline-editor');await frame.locator('[data-node="light"] img').evaluate(img=>img.decode());
 await frame.waitForFunction(()=>document.querySelector('audio')?.readyState>=1);
 await frame.evaluate(()=>{const a=document.querySelector('audio');a.muted=true;});
 await frame.getByTestId('audio-play-focus').click();await frame.waitForFunction(()=>document.querySelector('.vb-audio-player')?.classList.contains('is-playing'));
 await page.mouse.move(1580,980);await page.waitForTimeout(300);
 const directory=new URL('docs/images/',root);await mkdir(directory,{recursive:true});
 const overview=new URL('board-overview-v'+version+'.png',directory);await page.screenshot({path:overview.pathname});console.log('Overview ready: '+overview.pathname);
 // Navigate with the shipped Board API, then keep this sample layout at 100%.
 await frame.evaluate(()=>{navigate('studio');navigate('system');board().view={x:0,y:0,zoom:1};applyView();});
 await frame.waitForSelector('[data-node="writing"] .vb-inline-editor');
 const editor=frame.locator('[data-node="writing"] .vb-inline-editor');await editor.evaluate(el=>{el.focus({preventScroll:true});const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const i=node.nodeValue.indexOf('从零散，到清晰');if(i<0)continue;const range=document.createRange();range.setStart(node,i);range.setEnd(node,i);const s=getSelection();s.removeAllRanges();s.addRange(range);break;}});
 await frame.getByTestId('format-toolbar').waitFor({state:'visible'});await page.mouse.move(1580,980);await page.waitForTimeout(300);await page.screenshot({path:new URL('markdown-editor-v'+version+'.png',directory).pathname});
 await writeFile(new URL('showcase-provenance.json',directory),JSON.stringify({version,source:'Actual built src/frame.html; unchanged production UI',data:'Synthetic public Chinese notes, sample folders and generated silent WAV; bundled original demo photo',screenshots:['board-overview-v'+version+'.png','markdown-editor-v'+version+'.png'],viewport:{width:1600,height:1000},userVaultAccessed:false,externalRequests:network,errors},null,2));
 if(errors.length||network.length)throw Error('Showcase produced errors or external requests');console.log('Public showcase screenshots complete.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
