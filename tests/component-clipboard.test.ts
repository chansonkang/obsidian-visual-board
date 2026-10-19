import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { ComponentClipboardService } from '../src/component-clipboard';
import { initialLayout, Layout, Board, sanitizeLayout } from '../src/model';
import { syncFolderLayout } from '../src/folder-layout';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const board = (id: string, path: string, parent = 'home'): Board => ({id,title:path.split('/').pop() || id,parent,folderPath:path,theme:'product',iconMode:'default',folderColor:'mint',iconId:'leaf',view:{x:123,y:44,zoom:.6},nodes:[],edges:[]});
function fixture() {
  const entries = new Map<string, any>(), contents = new Map<string, Uint8Array>(), copied: string[] = [], removed: string[] = [];
  let layout = initialLayout(), failures = '', persists = 0, revision = 0, duringCopy: (() => void) | undefined;
  const mkdir = (path: string) => {if(entries.has(path)) throw Error('collision'); const entry = {path,children:[]}; entries.set(path,entry); const parent = entries.get(path.slice(0,Math.max(0,path.lastIndexOf('/')))); parent?.children.push(entry); return entry;};
  const add = (path: string, text = path) => {let current=''; for(const part of path.split('/').slice(0,-1)) {current=current?current+'/'+part:part;if(!entries.has(current))mkdir(current);} const bytes=new TextEncoder().encode(text),entry={path,name:path.split('/').pop(),extension:path.split('.').pop(),stat:{size:bytes.length,ctime:10,mtime:20}}; entries.set(path,entry);contents.set(path,bytes);entries.get(path.slice(0,Math.max(0,path.lastIndexOf('/'))))?.children.push(entry); return entry;};
  mkdir('');add('Source/A.md','# A\nOriginal **body** [[Peer]]');add('Source/image.png','PNG');add('Source/song.mp3','MP3');add('Source/paper.pdf','PDF');add('Group/Sub/B.md','# B');add('Group/Sub/unrepresented.bin','extra');mkdir('Target');
  layout.boards.home=board('home','');layout.boards.home.parent=null;
  layout.boards.target=board('target','Target');layout.boards.group=board('group','Group');layout.boards.sub=board('sub','Group/Sub','group');
  layout.boards.home.nodes=[{id:'a',type:'article',doc:'Source/A.md',x:11,y:21,w:480,h:640},{id:'p',type:'photo',imagePath:'Source/image.png',x:511,y:21,w:100,h:60,imageWidth:100,imageHeight:60},{id:'au',type:'audio',filePath:'Source/song.mp3',x:11,y:721},{id:'pdf',type:'pdf',filePath:'Source/paper.pdf',x:511,y:721},{id:'s',type:'note',title:'Sticky',text:'hello',color:'pink',x:1011,y:21},{id:'b',type:'board',board:'group',x:1011,y:721}];
  layout.boards.home.edges=[{from:'a',to:'s',lineStyle:'dashed',width:3.5},{from:'a',to:'p'}];
  layout.boards.group.nodes=[{id:'sub',type:'board',board:'sub',x:150,y:250},{id:'group-sticky',type:'note',title:'Nested',text:'local',color:'yellow',x:-40,y:80}];
  layout.boards.sub.nodes=[{id:'nested',type:'article',doc:'Group/Sub/B.md',x:723,y:-14,w:660,h:440},{id:'external',type:'article',doc:'Source/A.md',x:0,y:0}];
  layout.audioPlayback={'Source/song.mp3':{position:15,duration:120}};layout.visibleArticleHeadings=['Source/A.md'];layout=sanitizeLayout(layout);
  const app={vault:{getAllLoadedFiles:()=>[...entries.values()].filter(e=>e.path),getAbstractFileByPath:(p:string)=>entries.get(p)||null,adapter:{exists:async(p:string)=>entries.has(p)},createFolder:async(p:string)=>{if(failures==='folder')throw Error('folder failed');mkdir(p);},copy:async(source:any,p:string)=>{if(failures==='copy' && copied.length===1)throw Error('copy failed');if(entries.has(p))throw Error('collision');const bytes=contents.get(source.path)!;const result=add(p);contents.set(p,bytes.slice());result.stat.size=bytes.length;copied.push(p);duringCopy?.();return result;},delete:async(entry:any)=>{removed.push(entry.path);entries.delete(entry.path);contents.delete(entry.path);const parent=entries.get(entry.path.slice(0,Math.max(0,entry.path.lastIndexOf('/'))));if(parent)parent.children=parent.children.filter((e:any)=>e!==entry);}}} as unknown as App;
  const replayCalls: string[]=[];
  const recycle={trash:async(b:string,ids:string[])=>{replayCalls.push('trash:'+b+':'+ids.join(','));return {trashToken:'trash-token',layout,paths:[]};},restore:async(t:string)=>{replayCalls.push('restore:'+t);return {trashToken:t,layout,paths:[]};},redo:async(t:string)=>{replayCalls.push('redo:'+t);return {trashToken:t,layout,paths:[]};}};
  const hooks={getLayout:()=>layout,setLayout:(v:Layout)=>{layout=v;},revision:()=>revision,persist:async()=>{if(failures==='persist')throw Error('persist failed');persists++;}};
  const service=new ComponentClipboardService(app,hooks,recycle as any);
  return{service,app,entries,contents,copied,removed,replayCalls,layout:()=>layout,persisted:()=>persists,fail:(v:string)=>{failures=v;},add,onCopy:(f:()=>void)=>{duringCopy=f;},bumpRevision:()=>{revision++;}};
}

test('all six component types duplicate independent local bytes, relative geometry, style, relations and nested Board folder layouts',async()=>{
 const f=fixture(),original=clone(f.layout()),ids=original.boards.home.nodes.map(n=>n.id),{clipboard}=f.service.copy('home',ids);
 assert.match(clipboard,/^vb-components:v1:[a-f0-9-]+$/);assert.equal(clipboard.includes('body'),false);
 const result=await f.service.paste(clipboard,'target',{x:300,y:400}),nodes=result.layout.boards.target.nodes;
 assert.equal(nodes.length,6);assert.equal(new Set(nodes.map(n=>n.id)).size,6);assert.ok(nodes.every(n=>!ids.includes(n.id)));
 for(let i=0;i<6;i++){assert.equal(nodes[i].x,300+original.boards.home.nodes[i].x-11);assert.equal(nodes[i].y,400+original.boards.home.nodes[i].y-21);assert.equal(nodes[i].type,original.boards.home.nodes[i].type);}
 assert.equal(nodes[0].doc,'Target/A copy.md');assert.deepEqual(f.contents.get(nodes[0].doc!),f.contents.get('Source/A.md'));
 assert.equal(nodes[1].imagePath,'Target/image copy.png');assert.equal(nodes[2].filePath,'Target/song copy.mp3');assert.equal(nodes[3].filePath,'Target/paper copy.pdf');assert.equal(nodes[4].color,'pink');
 assert.deepEqual(result.layout.boards.target.edges.map(e=>({...e,from:nodes.findIndex(n=>n.id===e.from),to:nodes.findIndex(n=>n.id===e.to)})),[{from:0,to:4,lineStyle:'dashed',width:3.5},{from:0,to:1}]);
 const group=result.layout.boards[nodes[5].board!],sub=result.layout.boards[group.nodes[0].board!];
 assert.equal(group.parent,'target');assert.equal(group.folderPath,'Target/Group copy');assert.equal(group.folderColor,'mint');assert.equal(group.iconId,'leaf');assert.equal(sub.folderPath,'Target/Group copy/Sub');
 assert.deepEqual(sub.nodes.map(n=>[n.x,n.y,n.w,n.h]),original.boards.sub.nodes.map(n=>[n.x,n.y,n.w,n.h]));
 assert.equal(sub.nodes[0].doc,'Target/Group copy/Sub/B.md');assert.equal(sub.nodes[1].doc,'Target/Group copy/Sub/A copy.md');assert.ok(f.entries.has('Target/Group copy/Sub/unrepresented.bin'));
 assert.deepEqual(result.layout.audioPlayback?.['Target/song copy.mp3'],{position:15,duration:120});assert.ok(result.layout.visibleArticleHeadings?.includes('Target/A copy.md'));
 assert.deepEqual(result.layout.boards.home,original.boards.home);assert.deepEqual(result.layout.boards.group,original.boards.group);assert.equal(f.persisted(),1);
});

test('repeated paste suffixes collisions without overwrites; frozen selection and sticky content remain independent',async()=>{
 const f=fixture(),{clipboard}=f.service.copy('home',['a','s']);f.layout().boards.home.nodes[4].text='later edit';
 const one=await f.service.paste(clipboard,'target',{x:0,y:0});const two=await f.service.paste(clipboard,'target',{x:800,y:0});
 assert.equal(one.layout.boards.target.nodes[1].text,'hello');assert.equal(two.layout.boards.target.nodes[2].doc,'Target/A copy 2.md');assert.notEqual(one.createdIds[0],two.createdIds[0]);
 assert.equal(f.contents.get('Source/A.md')?.length,new TextEncoder().encode('# A\nOriginal **body** [[Peer]]').length);
});

test('preflight rejects missing, foreign, invalid and oversized sources without writes or layout changes',async()=>{
 for(const kind of ['missing','foreign','target','oversized']){
  const f=fixture(),{clipboard}=f.service.copy('home',['a']),before=clone(f.layout());
  if(kind==='missing')f.entries.delete('Source/A.md');if(kind==='oversized')f.entries.get('Source/A.md').stat.size=300*1024*1024;
  await assert.rejects(f.service.paste(kind==='foreign'?'vb-components:v1:unknown':clipboard,kind==='target'?'no-such-board':'target',{x:0,y:0}));assert.deepEqual(clone(f.layout()),before);assert.equal(f.copied.length,0);
 }
});

test('copy and persistence failures roll back only newly created local copies and preserve original metadata',async()=>{
 for(const fail of ['copy','persist']){const f=fixture(),before=clone(f.layout()),beforePaths=[...f.entries.keys()].sort(),{clipboard}=f.service.copy('home',['a','p','b']);f.fail(fail);await assert.rejects(f.service.paste(clipboard,'target',{x:0,y:0}),/failed/);assert.deepEqual(clone(f.layout()),before);assert.deepEqual([...f.entries.keys()].sort(),beforePaths);assert.equal(f.service.active,false);}
});

test('insertion undo and redo use real recycle contract and reject duplicate replay; import insertions share history',async()=>{
 const f=fixture(),{clipboard}=f.service.copy('home',['s']),result=await f.service.paste(clipboard,'target',{x:0,y:0});
 await f.service.replay(result.undoToken,'undo');await assert.rejects(f.service.replay(result.undoToken,'undo'));await f.service.replay(result.undoToken,'redo');await f.service.replay(result.undoToken,'undo');
 assert.deepEqual(f.replayCalls,['trash:target:'+result.createdIds[0],'restore:trash-token','redo:trash-token']);
 assert.match(f.service.rememberInsertion('target',result.createdIds),/^[a-f0-9-]+$/);await assert.rejects(f.service.replay('invalid','undo'));assert.throws(()=>f.service.rememberInsertion('target',['missing']));
});


test('nested copied aliases preserve shared internal identity and survive real folder synchronization',async()=>{
 const f=fixture();f.layout().boards.group.nodes.push({id:'internal-alias',type:'article',doc:'Group/Sub/B.md',x:10,y:10},{id:'external-alias',type:'article',doc:'Source/A.md',x:20,y:20});
 const {clipboard}=f.service.copy('home',['b']),result=await f.service.paste(clipboard,'target',{x:0,y:0});const group=result.layout.boards[result.layout.boards.target.nodes[0].board!],sub=result.layout.boards[group.nodes[0].board!];
 assert.equal(group.nodes[2].doc,sub.nodes[0].doc);assert.equal(group.nodes[2].folderManaged,undefined);assert.equal(group.nodes[3].doc,'Target/Group copy/A copy.md');assert.equal(sub.nodes[1].doc,'Target/Group copy/Sub/A copy.md');assert.notEqual(group.nodes[3].doc,sub.nodes[1].doc);
 const aliasIds=group.nodes.map(n=>n.id);syncFolderLayout(result.layout,[...f.entries.values()].filter(e=>'children'in e && e.path).map(e=>e.path),[...f.entries.keys()].filter(p=>p.endsWith('.md')));
 assert.ok(aliasIds.every(id=>result.layout.boards[group.id].nodes.some(n=>n.id===id)));
});

test('case-insensitive existing filename collisions are suffixed and a new service cannot consume another session token',async()=>{
 const f=fixture();f.add('Target/A COPY.md','existing');const {clipboard}=f.service.copy('home',['a']);const result=await f.service.paste(clipboard,'target',{x:0,y:0});assert.equal(result.layout.boards.target.nodes[0].doc,'Target/A copy 2.md');
 const other=fixture();await assert.rejects(other.service.paste(clipboard,'target',{x:0,y:0}),/剪贴板/);assert.equal(other.copied.length,0);
});


test('external source rename during an awaited copy aborts insertion, cleans partial copies and retains native reference updates',async()=>{
 const f=fixture(),{clipboard}=f.service.copy('home',['a','p']);let renamed=false;f.onCopy(()=>{if(renamed)return;renamed=true;const entry=f.entries.get('Source/A.md');f.entries.delete('Source/A.md');entry.path='Source/Renamed.md';f.entries.set(entry.path,entry);f.contents.set(entry.path,f.contents.get('Source/A.md')!);f.contents.delete('Source/A.md');f.layout().boards.home.nodes[0].doc=entry.path;f.bumpRevision();});
 await assert.rejects(f.service.paste(clipboard,'target',{x:0,y:0}),/改变|移动|替换/);
 assert.equal(f.layout().boards.home.nodes[0].doc,'Source/Renamed.md');assert.ok(f.entries.has('Source/Renamed.md'));assert.equal(f.entries.has('Source/A.md'),false);assert.equal(f.layout().boards.target.nodes.length,0);assert.ok(![...f.entries.keys()].some(p=>p.startsWith('Target/')));assert.equal(f.persisted(),0);
});

test('external target folder deletion during copy cannot install a stale Board layout or roll back native deletion',async()=>{
 const f=fixture(),{clipboard}=f.service.copy('home',['a']);f.onCopy(()=>{f.entries.delete('Target');f.layout().boards.target.folderMissing=true;f.bumpRevision();});
 await assert.rejects(f.service.paste(clipboard,'target',{x:0,y:0}),/改变/);assert.equal(f.layout().boards.target.folderMissing,true);assert.equal(f.layout().boards.target.nodes.length,0);assert.equal(f.entries.has('Target/A copy.md'),false);assert.equal(f.entries.has('Target'),false);
});
