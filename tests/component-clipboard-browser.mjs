import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {richHarness,selectRendered,fixturePath,fixturePNG} from './rich-editor-harness.mjs';
const checks=[];const h=await richHarness('# Rich\n\nEditable **text**.\n');
try{
 await h.page.evaluate(()=>{
  const iframe=document.getElementById('frame'),host=window.richHost;host.componentCopies={};host.insertions={};host.sequence=0;host.nativeClipboard='';
  host.componentRPC=m=>{
   if(!['copy-components','paste-components','import-markdown','drop-markdown','replay-component-insertion'].includes(m.method))return false;
   host.calls.push({method:m.method,payload:structuredClone(m.payload)});const p=m.payload;let result,error;
   const snapshot=()=>({layout:structuredClone(host.payload.layout),docs:structuredClone(host.payload.docs),assets:{...host.payload.assets},mediaAssets:{}});
   try{
    if(m.method==='copy-components'){
     const clipboard='vb-components:v1:aaaaaaaa-bbbb-cccc-dddd-'+String(++host.sequence).padStart(12,'0');
     host.componentCopies[clipboard]={nodes:structuredClone(host.payload.layout.boards[p.board].nodes.filter(n=>p.ids.includes(n.id)))};host.nativeClipboard=clipboard;result={clipboard};
    }else if(m.method==='replay-component-insertion'){
     const entry=host.insertions[p.token];host.payload.layout=structuredClone(p.direction==='undo'?entry.before:entry.after);result=snapshot();
    }else{
     const before=structuredClone(host.payload.layout),board=host.payload.layout.boards[p.targetBoard],createdIds=[],imported=[],createdPaths=[];
     if(m.method==='paste-components'){
      const source=host.componentCopies[p.clipboard||host.nativeClipboard];if(!source)throw Error('Clipboard does not contain copied components');
      const left=Math.min(...source.nodes.map(n=>n.x)),top=Math.min(...source.nodes.map(n=>n.y));for(const original of source.nodes){const n={...structuredClone(original),id:'pasted-'+(++host.sequence),x:(p.position?.x||80)+original.x-left,y:(p.position?.y||80)+original.y-top};if(n.doc){const doc=host.payload.docs[n.doc],path=(board.folderPath?board.folderPath+'/':'')+'copy-'+host.sequence+'.md';n.doc=path;host.payload.docs[path]={...doc,id:path,path,title:'copy-'+host.sequence};createdPaths.push(path);}board.nodes.push(n);createdIds.push(n.id);}
     }else{
      for(const [index,file]of(p.files||p.paths.map(path=>({name:path.split('/').at(-1),path}))).entries()){
       const name=file.name.endsWith('.md')?file.name:file.name+'.md',path=(board.folderPath?board.folderPath+'/':'')+name,id='imported-'+(++host.sequence),body=file.bytes?new TextDecoder().decode(new Uint8Array(file.bytes)):'# Internal';
       host.payload.docs[path]={id:path,path,title:name.slice(0,-3),body,outgoing:[],backlinks:[]};board.nodes.push({id,type:'article',doc:path,x:p.position?.x??80,y:(p.position?.y??80)+index*420,w:440,h:360});createdIds.push(id);createdPaths.push(path);imported.push({index,name,path,nodeId:id});
      }
     }
     const undoToken='insertion-'+(++host.sequence);host.insertions[undoToken]={before,after:structuredClone(host.payload.layout)};result={...snapshot(),createdIds,createdPaths,imported,undoToken};
    }
   }catch(e){error=e.message;}
   iframe.contentWindow.postMessage({kind:'vb-response',channel:'rich-fixture',id:m.id,result,error},'*');return true;
  };
 });
 await h.frame.evaluate(()=>{
  board().folderPath='Notes';state.boards.child.folderPath='Notes/Nested';
  board().nodes=[board().nodes[0],{id:'sticky',type:'note',title:'便签',text:'A note',x:760,y:0,w:240,h:280,color:'mint'},{id:'photo',type:'photo',title:'one',imagePath:'Assets/one.png',x:80,y:900,w:300,h:300,imageWidth:1,imageHeight:1},{id:'audio',type:'audio',title:'Track',filePath:'Assets/track.mp3',x:500,y:900,w:500,h:180},{id:'pdf',type:'pdf',title:'Document',filePath:'Assets/document.pdf',x:1050,y:900,w:360,h:520},{id:'folder',type:'board',board:'child',x:1050,y:0,w:300,h:300}];
  board().view={x:35,y:70,zoom:.7};render();window.VBHistory.focusGesture();
 });await h.frame.evaluate(()=>save());
 const geometry=await h.frame.evaluate(()=>({view:{...board().view},nodes:board().nodes.map(n=>({id:n.id,x:n.x,y:n.y,w:n.w,h:n.h}))}));
 await h.page.keyboard.press('Meta+a');await h.page.keyboard.press('Meta+c');await h.page.waitForFunction(()=>window.richHost.nativeClipboard.startsWith('vb-components:v1:'));
 const copied=await h.page.evaluate(()=>window.richHost.calls.filter(c=>c.method==='copy-components').at(-1));assert.deepEqual(new Set(copied.payload.ids),new Set(['article','sticky','photo','audio','pdf','folder']));assert.equal(copied.payload.board,'home');
 checks.push('Command+A then Command+C copies all six selected component types through the native clipboard');
 const clipboard=await h.page.evaluate(()=>window.richHost.nativeClipboard);await h.frame.evaluate(clipboard=>{const transfer=new DataTransfer();transfer.setData('text/plain',clipboard);document.getElementById('canvas').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));},clipboard);await h.frame.waitForFunction(()=>board().nodes.length===12);
 const pasted=await h.frame.evaluate(()=>board().nodes.filter(n=>n.id.startsWith('pasted-')));assert.equal(pasted.length,6);assert.equal(new Set(pasted.map(n=>n.type)).size,6);assert.deepEqual(await h.frame.evaluate(()=>board().view),geometry.view);for(let i=1;i<pasted.length;i++){assert.equal(pasted[i].x-pasted[0].x,geometry.nodes[i].x-geometry.nodes[0].x);assert.equal(pasted[i].y-pasted[0].y,geometry.nodes[i].y-geometry.nodes[0].y);}assert.match(pasted[0].doc,/^Notes\/copy-/);
 assert.deepEqual(await h.frame.evaluate(()=>board().nodes.filter(n=>!n.id.startsWith('pasted-')).map(n=>({id:n.id,x:n.x,y:n.y,w:n.w,h:n.h}))),geometry.nodes);
 checks.push('Native paste receives current Board/placement, preserves relative geometry, camera and original layout, and creates an independent article path');
 await h.frame.evaluate(()=>window.VBHistory.focusGesture());await h.page.keyboard.press('Meta+z');await h.frame.waitForFunction(()=>board().nodes.length===6);await h.page.keyboard.press('Meta+Shift+z');await h.frame.waitForFunction(()=>board().nodes.length===12);assert.deepEqual(await h.frame.evaluate(()=>board().view),geometry.view);
 checks.push('Component paste is a single Command+Z action and restores on Command+Shift+Z without changing camera');
 const copyCount=()=>h.page.evaluate(()=>window.richHost.calls.filter(c=>c.method==='copy-components').length);const count=await copyCount();await selectRendered(h.editor,'Editable');await h.page.keyboard.press('Meta+c');assert.equal(await copyCount(),count);
 await h.editor.evaluate(el=>{const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});event.clipboardData.setData('text/plain','plain text');el.dispatchEvent(event);});await h.flush();assert.match(await h.body(),/plain text/);assert.equal(await h.page.evaluate(()=>window.richHost.calls.filter(c=>c.method==='paste-components').length),1);
 checks.push('Rich-editor text selection and paste retain ordinary text clipboard behavior');
 await h.frame.evaluate(()=>{window.VBHistory.focusGesture();getSelection().removeAllRanges();select('folder');});assert.equal(await h.frame.getByTestId('component-copy').count(),1);assert.equal(await h.frame.getByTestId('component-paste').count(),1);await h.frame.getByTestId('selection-more').click();assert.equal(await h.frame.getByTestId('component-paste').isVisible(),true);await h.frame.getByTestId('selection-more').click();assert.equal(await h.frame.getByTestId('canvas-paste-components').count(),1);assert.match(await h.frame.getByTestId('component-copy').getAttribute('title'),/复制/);await h.frame.evaluate(()=>window.VBI18n.setLanguage('en'));assert.match(await h.frame.getByTestId('component-copy').getAttribute('title'),/Copy components/);await h.frame.getByTestId('component-copy').click();await h.page.waitForFunction(n=>window.richHost.calls.filter(c=>c.method==='copy-components').length===n, count+1);
 checks.push('Icon copy/paste controls are available for selections and blank-canvas paste, with Chinese/English accessible tooltips');
 const markdown='# 拖入标题\n\n正文 **加粗**，UTF-8。\n';
 await h.frame.evaluate(({markdown})=>{
  const transfer=new DataTransfer();transfer.items.add(new File([markdown],'外部文章.md',{type:'text/markdown'}));const target=document.getElementById('canvas'),rect=target.getBoundingClientRect();target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+600,clientY:rect.top+500}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+600,clientY:rect.top+500}));
 },{markdown});await h.page.waitForFunction(()=>window.richHost.calls.some(c=>c.method==='import-markdown'));
 const imported=await h.page.evaluate(()=>window.richHost.calls.filter(c=>c.method==='import-markdown').at(-1));assert.equal(imported.payload.targetBoard,'home');assert.equal(imported.payload.position.x%20,0);assert.equal(imported.payload.position.y%20,0);assert.equal(new TextDecoder().decode(new Uint8Array(imported.payload.files[0].bytes)),markdown);await h.frame.waitForFunction(()=>board().nodes.some(n=>n.doc==='Notes/外部文章.md'));assert.deepEqual(await h.frame.evaluate(()=>board().view),geometry.view);
 checks.push('Dropping an external Markdown file forwards exact UTF-8 bytes and a grid-snapped position to the mapped current folder');
 await h.frame.evaluate(()=>{
  const target=document.querySelector('[data-node="folder"]'),r=target.getBoundingClientRect(),transfer=new DataTransfer();transfer.items.add(new File(['# Nested'],'Nested.md',{type:'text/markdown'}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:r.x+20,clientY:r.y+20}));if(!target.classList.contains('vb-markdown-drop-target'))throw Error('No folder drop highlight');target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:r.x+20,clientY:r.y+20}));
 });await h.page.waitForFunction(()=>window.richHost.calls.filter(c=>c.method==='import-markdown').length===2);await h.frame.waitForFunction(()=>state.boards.child.nodes.some(n=>n.doc==='Notes/Nested/Nested.md'));const nested=await h.page.evaluate(()=>window.richHost.calls.filter(c=>c.method==='import-markdown').at(-1));assert.equal(nested.payload.targetBoard,'child');assert.equal(nested.payload.position,undefined);assert.equal(await h.frame.evaluate(()=>board().id),'home');assert.deepEqual(await h.frame.evaluate(()=>board().view),geometry.view);
 checks.push('Folder drop highlights its icon, targets its mapped child folder and never navigates away or changes the current camera');
 await h.frame.evaluate(()=>{const target=document.getElementById('canvas'),transfer=new DataTransfer();transfer.setData('text/plain','[[Notes/Existing|Existing article]]');target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:600,clientY:500}));});await h.page.waitForFunction(()=>window.richHost.calls.some(c=>c.method==='drop-markdown'));assert.deepEqual(await h.page.evaluate(()=>window.richHost.calls.find(c=>c.method==='drop-markdown').payload.paths),['Notes/Existing']);
 const parser=await h.frame.evaluate(()=>{const parse=(type,text)=>{const transfer=new DataTransfer();transfer.setData(type,text);return VBClipboard.parsePaths(transfer);};return [parse('text/plain','[Note](Notes/My%20File.md)'),parse('text/uri-list','obsidian://open?vault=Fixture&file=Notes%2FDeep'),parse('application/obsidian',JSON.stringify({files:[{path:'Notes/A.md'}]})),parse('text/plain','https://host.invalid/file.md')];});assert.deepEqual(parser,[['Notes/My File.md'],['Notes/Deep'],['Notes/A.md'],[]]);
 checks.push('Explorer wiki links, Markdown links, Obsidian URLs and native path payloads resolve to local paths; remote URLs are excluded');
 const drops=await h.page.evaluate(()=>window.richHost.calls.filter(c=>['import-markdown','drop-markdown'].includes(c.method)).length);await h.editor.evaluate(el=>{const transfer=new DataTransfer();transfer.items.add(new File(['# Must stay editor'],'Not imported.md',{type:'text/markdown'}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));});assert.equal(await h.page.evaluate(()=>window.richHost.calls.filter(c=>['import-markdown','drop-markdown'].includes(c.method)).length),drops);
 checks.push('File drops inside an active text editor do not create canvas components');
 const imagePasteKey=await h.frame.evaluate(()=>{getSelection().removeAllRanges();window.VBHistory.focusGesture();const event=new KeyboardEvent('keydown',{key:'v',metaKey:true,bubbles:true,cancelable:true});document.getElementById('canvas').dispatchEvent(event);return event.defaultPrevented;});assert.equal(imagePasteKey,false);
 checks.push('Command+V is not consumed by the component module before the native paste event, preserving image clipboard paste');
 const beforeGuard=await h.page.evaluate(()=>window.richHost.calls.filter(c=>c.method==='import-markdown').length);
 await h.frame.evaluate(()=>{
  const target=document.getElementById('canvas'),file={name:'Too big.md',size:40*1024*1024+1,arrayBuffer(){throw Error('Oversized file must not be allocated');}},event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperties(event,{dataTransfer:{value:{files:[file],types:['Files'],getData:()=>''}},clientX:{value:600},clientY:{value:500}});target.dispatchEvent(event);
 });await h.frame.waitForFunction(()=>document.getElementById('toast').textContent.includes('40 MiB'));assert.equal(await h.page.evaluate(()=>window.richHost.calls.filter(c=>c.method==='import-markdown').length),beforeGuard);
 await h.frame.evaluate(()=>{
  const target=document.getElementById('canvas'),files=Array.from({length:33},(_,index)=>({name:index+'.md',size:0,arrayBuffer(){throw Error('Too many files must not be allocated');}})),event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperties(event,{dataTransfer:{value:{files,types:['Files'],getData:()=>''}},clientX:{value:600},clientY:{value:500}});target.dispatchEvent(event);
 });await h.frame.waitForFunction(()=>document.getElementById('toast').textContent.includes('32'));assert.equal(await h.page.evaluate(()=>window.richHost.calls.filter(c=>c.method==='import-markdown').length),beforeGuard);
 await h.frame.evaluate(()=>{
  state.boards.child.folderMissing=true;const target=document.querySelector('[data-node="folder"]'),transfer=new DataTransfer();transfer.items.add(new File(['# Reject'],'Missing.md',{type:'text/markdown'}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));if(target.classList.contains('vb-markdown-drop-target'))throw Error('Missing folder should not highlight as a valid destination');target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));delete state.boards.child.folderMissing;
 });await h.frame.waitForFunction(()=>document.getElementById('toast').textContent.includes('missing'));assert.equal(await h.page.evaluate(()=>window.richHost.calls.filter(c=>c.method==='import-markdown').length),beforeGuard);
 checks.push('Oversized batches and missing mapped folders are rejected before file allocation or native mutation');
 await h.frame.evaluate(()=>{
  const transfer=new DataTransfer();transfer.items.add(new File(['# Markdown extension'],'Also.markdown',{type:'text/markdown'}));document.getElementById('canvas').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:600,clientY:500}));
 });await h.page.waitForFunction(n=>window.richHost.calls.filter(c=>c.method==='import-markdown').length===n,beforeGuard+1);assert.equal(await h.page.evaluate(()=>window.richHost.calls.filter(c=>c.method==='import-markdown').at(-1).payload.files[0].name),'Also.markdown');
 checks.push('The .markdown filename extension is accepted alongside .md');
 assert.deepEqual(h.errors,[]);assert.deepEqual(h.requests,[]);await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/component-clipboard-browser.json',import.meta.url),JSON.stringify({passed:true,groups:checks.length,checks},null,2)+'\n');console.log(JSON.stringify({passed:true,groups:checks.length,checks}));
}finally{await h.close();}
