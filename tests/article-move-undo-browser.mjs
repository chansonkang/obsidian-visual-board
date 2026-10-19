import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_CORE_PATH||'playwright-core'),{buildSync}=require('esbuild');
function actual(file){const m={exports:{}},code=buildSync({entryPoints:[new URL('../src/'+file,import.meta.url).pathname],bundle:true,format:'cjs',platform:'node',write:false}).outputFiles[0].text;new Function('require','module','exports',code)(require,m,m.exports);return m.exports;}
const {sanitizeLayout,renameReferences}=actual('model.ts'),{relocateArticle}=actual('article-move.ts'),html=await readFile(new URL('../src/frame.html',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x)),geom=n=>Object.fromEntries(['x','y','w','h'].map(k=>[k,n[k]]));
const sourcePath='Source/Memo.md',targetPath='Target/Memo.md',originalBody='# Memo\n\nOriginal [[Link]].',latestBody='# Memo\n\nNewer body after moving [[New Link]].';
const board=(id,path,nodes)=>({id,title:id==='home'?'移动撤销验收':id,parent:id==='home'?null:'home',theme:'research',iconMode:'default',iconId:'folder',folderPath:path,view:{x:0,y:0,zoom:1},nodes,edges:[]});
let payload={layout:sanitizeLayout({version:2,articleSizingVersion:1,currentBoard:'home',showKnowledge:true,showSpace:true,boards:{home:board('home','Source',[{id:'memo',type:'article',doc:sourcePath,x:100,y:100,w:320,h:300},{id:'note',type:'note',title:'Geometry order',text:'Never replace my contents',color:'yellow',x:400,y:560,w:240,h:240},{id:'target-entry',type:'board',board:'target',x:800,y:100},{id:'free-entry',type:'board',board:'free',x:1300,y:100}]),target:board('target','Target',[]),free:board('free',undefined,[])}}),docs:{[sourcePath]:{id:sourcePath,path:sourcePath,title:'Memo',body:originalBody,mtime:1,outgoing:['Link.md'],backlinks:[]}},assets:{},mediaAssets:{},embeds:{},drafts:[],settings:{defaultIconMode:'default',attachmentFolder:'Assets'},vaultName:'Move undo fixture'};
const files=new Map([[sourcePath,originalBody]]),tokens=new Map(),calls=[],errors=[],checks={};let pendingReplay=null,holdReplay=false;
const evidence=new URL('../evidence/',import.meta.url);await mkdir(evidence,{recursive:true});
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html style="height:100%"><body style="height:100%;margin:0;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="width:100%;height:100%;display:block;border:0"></iframe></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-site-isolation-trials']});let page,frame;
function docMove(oldPath,newPath){if(!files.has(oldPath))throw Error('article missing');if(files.has(newPath))throw Error('目标已有同名文章');const body=files.get(oldPath);files.delete(oldPath);files.set(newPath,body);const d={...payload.docs[oldPath],id:newPath,path:newPath,body,mtime:Date.now()};delete payload.docs[oldPath];payload.docs[newPath]=d;payload.layout=renameReferences(payload.layout,oldPath,newPath);return d;}
async function rpc(method,p){
 calls.push({method,payload:clone(p)});
 if(method==='save-layout'){payload.layout=sanitizeLayout(p);return {ok:true};}
 if(method==='update-note'){if(files.get(p.path)!==p.expectedBody)return {ok:false,reason:'conflict',current:files.get(p.path)};files.set(p.path,p.body);Object.assign(payload.docs[p.path],{body:p.body});return {ok:true,doc:clone(payload.docs[p.path])};}
 if(method==='move-article'){
  const n=payload.layout.boards[p.sourceBoard].nodes.find(n=>n.id===p.node),before=clone(n),oldPath=n.doc,newPath=payload.layout.boards[p.targetBoard].folderPath+'/Memo.md',doc=docMove(oldPath,newPath);
  assert.ok(relocateArticle(payload.layout,p.sourceBoard,n.id,p.targetBoard,newPath,before));const after=clone(payload.layout.boards[p.targetBoard].nodes.find(item=>item.id===n.id&&item.doc===newPath)),token='move-'+(tokens.size+1);
  tokens.set(token,{before,after,source:p.sourceBoard,target:p.targetBoard,phase:'moved'});return {moveToken:token,oldPath,newPath,doc,layout:clone(payload.layout),node:after};
 }
 if(method==='replay-article-move'){
  if(holdReplay)await new Promise(resolve=>{pendingReplay=resolve;});
  const token=tokens.get(p.token),undo=p.direction==='undo';assert.equal(token.phase,undo?'moved':'undone');
  const from=undo?token.target:token.source,to=undo?token.source:token.target,oldPath=undo?targetPath:sourcePath,newPath=undo?sourcePath:targetPath;
  const n=payload.layout.boards[from].nodes.find(n=>n.id==='memo');assert.equal(n.doc,oldPath);
  const doc=docMove(oldPath,newPath),captured=clone(n);assert.ok(relocateArticle(payload.layout,from,n.id,to,newPath,captured));
  const moved=payload.layout.boards[to].nodes.find(n=>n.id==='memo');Object.assign(moved,geom(undo?token.before:token.after));token.phase=undo?'undone':'moved';
  return {moveToken:p.token,oldPath,newPath,doc,layout:clone(payload.layout),node:clone(moved)};
 }
 return {ok:true};
}
async function sendSnapshot(stale=false){await page.evaluate(p=>document.getElementById('frame').contentWindow.postMessage({kind:'vb-event',channel:'move-channel',type:'snapshot',payload:p},'*'),stale?{...clone(payload),docs:{},layout:sanitizeLayout({})}:{...clone(payload),preserveView:true});await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
const stateOf=()=>frame.evaluate(()=>({current:state.currentBoard,view:{...board().view},boards:structuredClone(state.boards),docs:structuredClone(state.docs),history:VBHistory.counts,busy:VBHistory.replaying}));
async function waitIdle(){await frame.waitForFunction(()=>!VBFolderInteraction.moving&&!VBHistory.replaying&&!suppressClick);}
async function key(value){await page.keyboard.press(value);await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));}
async function canvasFocus(){await frame.locator('#canvas').focus();}
async function dragNode(id,dx,dy){await waitIdle();const s=await stateOf(),r=await frame.locator('[data-node="'+id+'"]>h2').boundingBox(),factor=s.view.zoom;await page.mouse.move(r.x+20,r.y+10);await page.mouse.down();await page.mouse.move(r.x+20+dx*factor,r.y+10+dy*factor,{steps:9});await page.mouse.up();await waitIdle();}
async function dropArticle(entry){await waitIdle();const h=await frame.getByTestId('drag-memo').boundingBox(),folder=await frame.locator('[data-node="'+entry+'"] .folder-art').boundingBox();assert.ok(h&&folder);await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(folder.x+folder.width/2,folder.y+folder.height/2,{steps:12});await page.mouse.up();await waitIdle();}
try{
 page=await browser.newPage({viewport:{width:1920,height:1200}});page.on('pageerror',e=>errors.push(String(e)));await page.route('https://**',route=>route.abort());await page.exposeFunction('movePayload',()=>payload);await page.exposeFunction('moveRPC',rpc);
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(html=>{const f=document.getElementById('frame');window.moveReady=false;addEventListener('message',async e=>{if(e.source!==f.contentWindow)return;const m=e.data;if(m.kind==='vb-boot'){f.contentWindow.postMessage({kind:'vb-init',channel:'move-channel',payload:await window.movePayload()},'*');return;}if(m.channel!=='move-channel')return;if(m.kind==='vb-ready'){window.moveReady=true;return;}if(m.kind!=='vb-request')return;try{f.contentWindow.postMessage({kind:'vb-response',channel:'move-channel',id:m.id,result:await window.moveRPC(m.method,m.payload)},'*');}catch(e){f.contentWindow.postMessage({kind:'vb-response',channel:'move-channel',id:m.id,error:e.message},'*');}});f.srcdoc=html;},html);await page.waitForFunction(()=>window.moveReady);frame=page.frames().find(f=>f.parentFrame());await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const starting=await stateOf(),noteOriginal=geom(starting.boards.home.nodes.find(n=>n.id==='note')),memoOriginal=geom(starting.boards.home.nodes.find(n=>n.id==='memo'));
 await dragNode('note',60,40);const noteMoved=geom((await stateOf()).boards.home.nodes.find(n=>n.id==='note'));assert.notDeepEqual(noteMoved,noteOriginal);
 await dropArticle('target-entry');await frame.waitForFunction(()=>state.boards.target.nodes.some(n=>n.id==='memo'));
 const moved=await stateOf(),memoPlaced=geom(moved.boards.target.nodes.find(n=>n.id==='memo'));assert.equal(moved.boards.home.nodes.some(n=>n.id==='memo'),false);assert.equal(files.get(targetPath),originalBody);assert.deepEqual(moved.history,{undo:2,redo:0});checks.physicalDropIdentityGeometryAndOneGlobalStep=true;
 await frame.getByTestId('open-board-target').click();await frame.waitForFunction(()=>state.currentBoard==='target');
 files.set(targetPath,latestBody);payload.docs[targetPath]={...payload.docs[targetPath],body:latestBody,mtime:10,outgoing:['New Link.md']};await sendSnapshot();
 holdReplay=true;await canvasFocus();const replayBefore=calls.filter(c=>c.method==='replay-article-move').length;await key('Meta+z');await frame.waitForFunction(()=>VBHistory.replaying);await key('Control+z');
 assert.equal(calls.filter(c=>c.method==='replay-article-move').length,replayBefore+1);const saveCount=calls.filter(c=>c.method==='save-layout').length;
 await sendSnapshot(true);assert.equal((await stateOf()).current,'target');assert.equal((await stateOf()).docs[targetPath].body,latestBody);
 await frame.getByTestId('zoom-out').click();const replayCamera=(await stateOf()).view;assert.equal(calls.filter(c=>c.method==='save-layout').length,saveCount,'busy replay must not save stale layout');
 holdReplay=false;assert.ok(pendingReplay);pendingReplay();pendingReplay=null;await waitIdle();await frame.waitForFunction(()=>state.boards.home.nodes.some(n=>n.id==='memo'));
 const undone=await stateOf();assert.deepEqual(undone.view,replayCamera);assert.equal(undone.current,'target');assert.equal(files.get(sourcePath),latestBody);assert.equal(files.has(targetPath),false);assert.deepEqual(geom(undone.boards.home.nodes.find(n=>n.id==='memo')),memoOriginal);assert.equal(undone.docs[sourcePath].body,latestBody);checks.crossLevelUndoPreservesNewBodyCameraAndAsyncBusy=true;
 await frame.getByTestId('crumb-home').click();await canvasFocus();await key('Meta+z');assert.deepEqual(geom((await stateOf()).boards.home.nodes.find(n=>n.id==='note')),noteOriginal);
 await key('Control+Shift+z');assert.deepEqual(geom((await stateOf()).boards.home.nodes.find(n=>n.id==='note')),noteMoved);
 await key('Meta+Shift+z');await waitIdle();await frame.waitForFunction(()=>state.boards.target.nodes.some(n=>n.id==='memo'));
 assert.deepEqual(geom((await stateOf()).boards.target.nodes.find(n=>n.id==='memo')),memoPlaced);assert.equal(files.get(targetPath),latestBody);checks.geometryAndNativeMoveChronologicalUndoRedo=true;
 files.set(sourcePath,'Another distinct article');await canvasFocus();const conflictCount=(await stateOf()).history.undo;await key('Meta+z');await waitIdle();
 assert.equal(files.get(sourcePath),'Another distinct article');assert.equal(files.get(targetPath),latestBody);assert.equal((await stateOf()).history.undo,conflictCount,'failed replay retains undo command');
 files.delete(sourcePath);await key('Meta+z');await waitIdle();await frame.waitForFunction(()=>state.boards.home.nodes.some(n=>n.id==='memo'));assert.equal(files.get(sourcePath),latestBody);checks.namingConflictProtectsBothFilesAndKeepsRetryableHistory=true;
 // Native editor undo must stay text undo even with a move future available.
 const editor=frame.locator('[data-node="memo"] .vb-inline-editor');await editor.click();await page.keyboard.press('Meta+End');await page.keyboard.type(' nativeMarker');const beforeNative=(await stateOf()).history;
 await key('Meta+z');assert.deepEqual((await stateOf()).history,beforeNative);assert.equal((await editor.innerText()).includes('nativeMarker'),false);await page.keyboard.press('Backspace');assert.equal((await stateOf()).boards.home.nodes.some(n=>n.id==='memo'),true);await key('Meta+z');await frame.getByTestId('select-memo').click();checks.editorNativeUndoNeverReplaysMoveOrDeletesArticle=true;
 // An unassociated Board moves only the reference; underlying file path and bytes stay put.
 await frame.evaluate(()=>VBInline.flushAll());const freeBody=files.get(sourcePath);
 await dropArticle('free-entry');await frame.waitForFunction(()=>state.boards.free.nodes.some(n=>n.id==='memo'));const freeMoved=await stateOf(),freeGeom=geom(freeMoved.boards.free.nodes.find(n=>n.id==='memo')),rpcCount=calls.filter(c=>c.method==='move-article').length;
 assert.equal(files.get(sourcePath),freeBody);await canvasFocus();await key('Meta+z');await frame.waitForFunction(()=>state.boards.home.nodes.some(n=>n.id==='memo'));assert.deepEqual(geom((await stateOf()).boards.home.nodes.find(n=>n.id==='memo')),memoOriginal);
 await key('Meta+Shift+z');await frame.waitForFunction(()=>state.boards.free.nodes.some(n=>n.id==='memo'));assert.deepEqual(geom((await stateOf()).boards.free.nodes.find(n=>n.id==='memo')),freeGeom);assert.equal(calls.filter(c=>c.method==='move-article').length,rpcCount);assert.equal(files.get(sourcePath),freeBody);checks.freeBoardReferenceMoveIsReversibleWithoutPhysicalFileMove=true;
 assert.deepEqual(errors,[]);await page.screenshot({path:new URL('article-move-undo-final.png',evidence).pathname});await writeFile(new URL('article-move-undo-browser.json',evidence),JSON.stringify({passed:true,checks,pageErrors:errors,actualFrameAndLayoutAlgorithms:true,mockedNativeTokenBroker:true,userVaultAccessed:false},null,2));console.log('Article move actual UI undo checks passed.');
}catch(e){if(page)await page.screenshot({path:new URL('article-move-undo-failure.png',evidence).pathname}).catch(()=>{});await writeFile(new URL('article-move-undo-failure.json',evidence),JSON.stringify({error:String(e),checks,state:frame?await stateOf().catch(()=>null):null,calls:calls.map(c=>({method:c.method,payload:c.method==='update-note'?{path:c.payload.path}:c.payload})),pageErrors:errors},null,2));throw e;}finally{await browser.close();server.close();}
