import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
// Real generated sandbox frame and physical pointer gestures. No user Vault is accessed.
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_CORE_PATH||'playwright-core');
const html=await readFile(new URL('../src/frame.html',import.meta.url),'utf8');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
const pdfObjects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream'];
let pdf='%PDF-1.4\n',offsets=[];for(let i=0;i<pdfObjects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${pdfObjects[i]}\nendobj\n`;}
const xref=Buffer.byteLength(pdf);pdf+='xref\n0 5\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
const pdfBase64=Buffer.from(pdf).toString('base64');
const wav=Buffer.alloc(44+1600);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(1600,40);
const wavUrl='data:audio/wav;base64,'+wav.toString('base64');
const doc={id:'Notes/Existing.md',path:'Notes/Existing.md',title:'已有文章',body:'# 已有文章\n\n这是原文，不会因拖出卡片改变。',outgoing:[],backlinks:[],mtime:1};
const payload={layout:{version:2,articleSizingVersion:1,currentBoard:'home',showKnowledge:true,showSpace:true,boards:{home:{id:'home',title:'工具拖出验收',parent:null,folderPath:'',theme:'product',iconMode:'default',view:{x:0,y:0,zoom:1},nodes:[{id:'old-photo',type:'photo',imagePath:'Assets/old.png',sourceUrl:'https://example.com/old.png',title:'旧图片',x:20,y:20,w:320,h:240}],edges:[]}}},docs:{[doc.id]:doc},assets:{'Assets/old.png':png},embeds:{},drafts:[],settings:{defaultIconMode:'default',attachmentFolder:'Assets'},vaultName:'Toolbar fixture',mediaAssets:{}};
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-site-isolation-trials']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:'))requests.push(r.url());});
 await page.route('https://**',route=>route.abort());await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(({html,payload,png,pdfBase64,wavUrl})=>{
  const iframe=document.getElementById('frame');window.toolbarHost={ready:false,payload,calls:[],imageCount:0};
  addEventListener('message',event=>{
   if(event.source!==iframe.contentWindow)return;const m=event.data;
   if(m.kind==='vb-boot'){iframe.contentWindow.postMessage({kind:'vb-init',channel:'toolbar-channel',payload},'*');return;}
   if(m.channel!=='toolbar-channel')return;if(m.kind==='vb-ready'){window.toolbarHost.ready=true;return;}if(m.kind!=='vb-request')return;
   window.toolbarHost.calls.push({method:m.method,payload:m.payload});let result={ok:true};
   if(m.method==='save-layout')payload.layout=m.payload;
   if(m.method==='create-note'){
    const p=m.payload,path=p.title+'.md';result={id:path,path,title:p.title,body:'# '+p.title+'\n\n本地新建正文。',outgoing:[],backlinks:[],mtime:1};payload.docs[path]=result;
    const b=payload.layout.boards[p.board];b.nodes.push({id:'native-created',type:'article',doc:path,folderManaged:true,x:40,y:40,w:280,h:260});
    iframe.contentWindow.postMessage({kind:'vb-event',channel:m.channel,type:'snapshot',payload:{...payload,preserveView:true}},'*');
   }
   if(m.method==='create-folder'){
    const p=m.payload,id='native-folder',b=payload.layout.boards[p.parentBoard];payload.layout.boards[id]={id,title:p.title,parent:b.id,folderPath:p.title,theme:'product',iconMode:'default',view:{x:0,y:0,zoom:1},nodes:[],edges:[]};b.nodes.push({id:'native-entrance',type:'board',board:id,folderManaged:true,...p.position});result={boardId:id,layout:payload.layout};
   }
   if(m.method==='import-image'){const path='Assets/import-'+(++window.toolbarHost.imageCount)+'.png';result={path,url:png,...(m.payload.url?{sourceUrl:m.payload.url}:{})};payload.assets[path]=png;}
   if(m.method==='import-media'){const path='Assets/'+m.payload.name;result={path,title:m.payload.name,kind:'audio',url:wavUrl};payload.mediaAssets[path]=result;}
   if(m.method==='list-media')result=[{path:'Assets/existing.pdf',title:'已有 PDF',kind:'pdf'}];
   if(m.method==='media-assets')result=Object.fromEntries(m.payload.paths.map(path=>[path,payload.mediaAssets[path]||{path,kind:'pdf'}]));
   if(m.method==='read-pdf')result={base64:pdfBase64};
   iframe.contentWindow.postMessage({kind:'vb-response',channel:m.channel,id:m.id,result},'*');
  });iframe.srcdoc=html;
 },{html,payload,png,pdfBase64,wavUrl});
 await page.waitForFunction(()=>window.toolbarHost.ready);const frame=page.frames().find(f=>f.parentFrame());assert.ok(frame);await frame.waitForFunction(()=>window.VBToolbarDrop);
 await frame.evaluate(()=>{board().view={x:90,y:-60,zoom:.5};applyView();});
 const originalView=await frame.evaluate(()=>({...board().view})),oldPhoto=await frame.evaluate(()=>({...board().nodes[0]}));
 const expected=async(x,y)=>frame.evaluate(({x,y})=>{const r=document.getElementById('canvas').getBoundingClientRect(),v=board().view;return{x:Math.round(((x-r.left)/sceneScale-v.x)/v.zoom/20)*20,y:Math.round(((y-r.top)/sceneScale-v.y)/v.zoom/20)*20};},{x,y});
 async function dragTool(kind,x=810,y=430,{cancel=false}={}){
  const button=frame.locator('.bottom-toolbar [data-action="'+kind+'"]'),box=await button.boundingBox();assert.ok(box);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(x,y,{steps:12});
  if(cancel)await page.keyboard.press('Escape');await page.mouse.up();
 }
 async function stableCamera(){assert.deepEqual(await frame.evaluate(()=>({...board().view})),originalView);}
 async function assertPlaced(id,point){const n=await frame.evaluate(id=>({...board().nodes.find(n=>n.id===id)}),id);assert.deepEqual({x:n.x,y:n.y},point);await stableCamera();return n;}
 // Simple click and movement below the threshold preserve the existing modal behavior.
 await frame.locator('.bottom-toolbar [data-action="note"]').click();await frame.locator('#note-title').waitFor();await frame.locator('[data-action="close-modal"]').click();
 const noteButton=await frame.locator('.bottom-toolbar [data-action="note"]').boundingBox();await page.mouse.move(noteButton.x+noteButton.width/2,noteButton.y+noteButton.height/2);await page.mouse.down();await page.mouse.move(noteButton.x+noteButton.width/2+3,noteButton.y+noteButton.height/2+2);await page.mouse.up();await frame.locator('#note-title').waitFor();await frame.locator('[data-action="close-modal"]').click();
 // Invalid title/tool-bar drops and cancelled drags create no components or dialogs.
 for(const target of [{x:600,y:100},{x:750,y:noteButton.y+noteButton.height/2}]){await dragTool('note',target.x,target.y);assert.equal(await frame.locator('.modal').count(),0);}
 for(const kind of ['select','connect','remove']){await dragTool(kind,1200,230);assert.equal(await frame.locator('.modal').count(),0);assert.equal(await frame.evaluate(()=>board().nodes.length),1);}
 await dragTool('note',810,430,{cancel:true});assert.equal(await frame.locator('.modal').count(),0);assert.equal(await frame.locator('[data-testid="toolbar-drag-ghost"]').count(),0);assert.equal(await frame.evaluate(()=>board().nodes.length),1);
 // The selected component origin lands on the world grid at zoom .5 and sceneScale < 1.
 const notePoint=await expected(810,430);await dragTool('note');await frame.locator('#note-title').fill('拖出便签');await frame.locator('#note-text').fill('拖出后的本地内容');await frame.locator('[data-action="save-note"]').click();
 const noteId=await frame.evaluate(()=>board().nodes.find(n=>n.title==='拖出便签').id);await assertPlaced(noteId,notePoint);assert.equal(await frame.locator('.modal').count(),0);
 // Existing article reference and native auto-managed new article both use the chosen point.
 const articlePoint=await expected(850,470);await dragTool('article',850,470);await frame.locator('[data-search-add="Notes/Existing.md"]').click();const articleId=await frame.evaluate(()=>board().nodes.find(n=>n.doc==='Notes/Existing.md').id);await assertPlaced(articleId,articlePoint);assert.equal(await frame.evaluate(()=>state.docs['Notes/Existing.md'].body),doc.body);
 const nativePoint=await expected(930,510);await dragTool('article',930,510);await frame.locator('#library-input').fill('拖出新文章');await frame.locator('[data-action="create-document"]').click();await frame.waitForFunction(()=>board().nodes.find(n=>n.id==='native-created')?.x!==40);await assertPlaced('native-created',nativePoint);assert.equal(await frame.evaluate(()=>board().nodes.filter(n=>n.doc==='拖出新文章.md').length),1);
 const folderPoint=await expected(710,370);await dragTool('board',710,370);await frame.locator('#new-board-title').fill('拖出目录');await frame.locator('[data-action="create-board"]').click();await frame.waitForFunction(()=>board().nodes.some(n=>n.id==='native-entrance'));await assertPlaced('native-entrance',folderPoint);assert.equal(await frame.evaluate(()=>state.currentBoard),'home');
 const imagePoint=await expected(600,550);await dragTool('image',600,550);assert.equal(await frame.locator('#image-into-article').count(),0);await frame.locator('#image-file').setInputFiles({name:'dropped.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await frame.locator('[data-import-image]').click();await frame.waitForFunction(()=>board().nodes.some(n=>n.imagePath==='Assets/import-1.png'));const imageId=await frame.evaluate(()=>board().nodes.find(n=>n.imagePath==='Assets/import-1.png').id);await assertPlaced(imageId,imagePoint);
 const audioPoint=await expected(670,500);await dragTool('media',670,500);await frame.locator('#media-files').setInputFiles({name:'dropped.wav',mimeType:'audio/wav',buffer:wav});await frame.locator('[data-import-media]').click();await frame.waitForFunction(()=>board().nodes.some(n=>n.filePath==='Assets/dropped.wav'));const audioId=await frame.evaluate(()=>board().nodes.find(n=>n.type==='audio').id);await assertPlaced(audioId,audioPoint);
 const pdfPoint=await expected(550,360);await dragTool('media',550,360);await frame.locator('[data-add-media="Assets/existing.pdf"]').click();const pdfId=await frame.evaluate(()=>board().nodes.find(n=>n.type==='pdf').id);await assertPlaced(pdfId,pdfPoint);await frame.waitForFunction(id=>document.querySelector('[data-testid="pdf-page-'+id+'"]')?.textContent==='1 / 1',pdfId);
 // Closing a dragged creation dialog releases its point for the next ordinary click.
 await dragTool('note',1200,240);await frame.locator('[data-action="close-modal"]').click();await frame.locator('.bottom-toolbar [data-action="note"]').click();await frame.locator('#note-title').fill('普通点击创建');await frame.locator('[data-action="save-note"]').click();const ordinary=await frame.evaluate(()=>board().nodes.find(n=>n.title==='普通点击创建'));assert.notDeepEqual({x:ordinary.x,y:ordinary.y},await expected(1200,240));
 // Image replacement cancellation leaves the existing image and paint order unchanged.
 const beforeOrder=await frame.evaluate(()=>board().nodes.map(n=>n.id));
 const beforeImports=await page.evaluate(()=>window.toolbarHost.imageCount);
 await frame.evaluate(()=>{selected='old-photo';render();});await frame.locator('[data-replace-image="old-photo"]').click();await frame.locator('#image-file').setInputFiles({name:'cancelled.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await frame.locator('[data-action="close-modal"]').click();
 assert.deepEqual(await frame.evaluate(()=>({...board().nodes.find(n=>n.id==='old-photo')})),oldPhoto);assert.equal(await page.evaluate(()=>window.toolbarHost.imageCount),beforeImports);
 // Saving a replacement retains identity, geometry, and other components, clearing stale source URL.
 await frame.evaluate(()=>{selected='old-photo';render();});await frame.locator('[data-replace-image="old-photo"]').click();await frame.locator('#image-file').setInputFiles({name:'replacement.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await frame.locator('[data-import-image]').click();await frame.waitForFunction(()=>board().nodes.find(n=>n.id==='old-photo')?.imagePath==='Assets/import-2.png');
 const replaced=await frame.evaluate(()=>({...board().nodes.find(n=>n.id==='old-photo')}));const expectedReplacement={...oldPhoto,imagePath:'Assets/import-2.png',title:'replacement.png'};delete expectedReplacement.sourceUrl;assert.deepEqual(replaced,expectedReplacement);assert.deepEqual(await frame.evaluate(()=>board().nodes.map(n=>n.id)),beforeOrder);await stableCamera();
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);const evidence=new URL('../evidence/',import.meta.url);await mkdir(evidence,{recursive:true});await page.screenshot({path:new URL('toolbar-drag-browser.png',evidence).pathname});
 const previewTool=await frame.locator('.bottom-toolbar [data-action=\"image\"]').boundingBox();await page.mouse.move(previewTool.x+previewTool.width/2,previewTool.y+previewTool.height/2);await page.mouse.down();await page.mouse.move(1010,310,{steps:10});assert.equal(await frame.locator('[data-testid=\"toolbar-drag-ghost\"]').count(),1);await page.screenshot({path:new URL('toolbar-drag-preview.png',evidence).pathname});await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await frame.locator('.modal').count(),0);await stableCamera();
 await writeFile(new URL('toolbar-drag-browser.json',evidence),JSON.stringify({passed:true,checks:['ordinary click','sub-threshold click','invalid title/tool-bar drops and non-creation tools','Escape cancellation','drag note','drag article reference','native managed article race','drag mapped Board','drag image file','drag audio file','drag existing PDF','cancel clears queued placement','image replacement cancel/save preserves identity/geometry/order'],view:originalView,sceneScale:await frame.evaluate(()=>sceneScale),grid:20,cameraPreserved:true,sourceBodyPreserved:true,pageErrors:errors,externalRequests:requests},null,2));
 console.log('Toolbar drag checks passed: 13 pointer/placement/file-selection/replacement checks, unchanged zoom/pan and Markdown.');
}finally{await browser.close();server.close();}
