import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { RecycleService } from '../src/recycle';
import { initialLayout, sanitizeLayout, type Board, type Layout } from '../src/model';
import { syncFolderLayout } from '../src/folder-layout';

// Independent disk/index fixture. It never accesses a real Vault or reads original bodies.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const makeBoard = (id: string, folderPath?: string, parent='home'): Board => ({id,title:folderPath?folderPath.split('/').pop()!:id,parent:id==='home'?null:parent,theme:'product',iconMode:'default',folderColor:'mint',view:{x:70,y:-44,zoom:.8},nodes:[],edges:[],...(folderPath===undefined?{}:{folderPath,folderMissing:false})});
function fixture(nested=false) {
  type Entry={type:'file'|'folder';data?:string;size:number;mtime:number;ctime:number};
  const disk=new Map<string,Entry>(),index=new Map<string,any>(),renames:[string,string][]=[];
  function folder(path:string){disk.set(path,{type:'folder',size:0,mtime:10,ctime:10});}
  function add(path:string,data='fixture bytes'){const parts=path.split('/');for(let i=1;i<parts.length;i++)if(!disk.has(parts.slice(0,i).join('/')))folder(parts.slice(0,i).join('/'));disk.set(path,{type:'file',size:Buffer.byteLength(data),data,mtime:100,ctime:90});}
  function cache(path:string){const entry=disk.get(path);if(!entry)return;index.set(path,entry.type==='folder'?{path,children:[]}:{path,name:path.split('/').pop(),extension:path.split('.').pop(),stat:{size:entry.size,mtime:entry.mtime,ctime:entry.ctime}});}
  const adapter={
    exists:async(path:string)=>disk.has(path),stat:async(path:string)=>disk.get(path)||null,
    mkdir:async(path:string)=>{if(disk.has(path))throw Error('exists');folder(path);},
    write:async(path:string,data:string)=>{assert.ok(path.endsWith('manifest.json'));add(path,data);},
    read:async(path:string)=>{assert.ok(path.endsWith('manifest.json'),'never read original Markdown or media bodies');return disk.get(path)!.data!;},
    list:async(path:string)=>({files:[...disk.keys()].filter(p=>p.startsWith(path+'/')&&!p.slice(path.length+1).includes('/')&&disk.get(p)!.type==='file').sort(),folders:[...disk.keys()].filter(p=>p.startsWith(path+'/')&&!p.slice(path.length+1).includes('/')&&disk.get(p)!.type==='folder').sort()}),
    rename:async(from:string,to:string)=>{assert.ok(disk.has(from));assert.equal(disk.has(to),false,'never overwrite existing disk content');renames.push([from,to]);for(const old of [...disk.keys()].filter(p=>p===from||p.startsWith(from+'/'))){const next=to+old.slice(from.length);disk.set(next,disk.get(old)!);disk.delete(old);index.delete(old);}},
    reconcileInternalFile:async(path:string)=>{if(path.split('/').some(p=>p.startsWith('.'))||!disk.has(path)){for(const old of [...index.keys()])if(old===path||old.startsWith(path+'/'))index.delete(old);}else for(const p of disk.keys())if(p===path||p.startsWith(path+'/'))cache(p);},
  };
  folder('Group');if(nested){add('Group/Original.md','# Original');add('Else/Other.md','# Independent');}
  for(const path of disk.keys())cache(path);
  let layout:Layout=initialLayout();layout.boards.home=makeBoard('home','');layout.boards.group=makeBoard('group','Group');layout.boards.home.nodes=[{id:'group-entry',type:'board',board:'group',folderManaged:true,x:300,y:140},{id:'later',type:'note',title:'survivor',text:'keep',x:1000,y:400,w:240,h:280}];
  if(nested){layout.boards.child=makeBoard('child',undefined,'group');layout.boards.external=makeBoard('external','Else');layout.boards.group.nodes=[{id:'original',type:'article',doc:'Group/Original.md',folderManaged:true,x:40,y:60,w:420,h:520},{id:'free-entry',type:'board',board:'child',x:510,y:-300},{id:'external-alias',type:'board',board:'external',x:900,y:800}];layout.boards.child.nodes=[{id:'independent-ref',type:'article',doc:'Else/Other.md',x:-400,y:900,w:480,h:640},{id:'child-note',type:'note',title:'deep local note',text:'local',color:'purple',x:100,y:70,w:220,h:180}];layout.boards.external.nodes=[{id:'external-original',type:'article',doc:'Else/Other.md',folderManaged:true,x:800,y:650,w:420,h:520}];layout.boards.home.nodes.push({id:'external-entry',type:'board',board:'external',folderManaged:true,x:1450,y:720});}
  layout=sanitizeLayout(layout);
  const hooks={getLayout:()=>layout,setLayout:(value:Layout)=>{layout=value;},persist:async()=>{}};
  const app={vault:{adapter,getAbstractFileByPath:(path:string)=>index.get(path)||null,rename:async(file:{path:string},to:string)=>adapter.rename(file.path,to)}} as unknown as App;
  const sync=()=>syncFolderLayout(layout,[...disk].filter(([path,entry])=>entry.type==='folder'&&!path.split('/').some(p=>p.startsWith('.'))).map(([path])=>path),[...disk].filter(([path,entry])=>entry.type==='file'&&path.endsWith('.md')&&!path.split('/').some(p=>p.startsWith('.'))).map(([path])=>path));
  return {disk,index,adapter,add,renames,layout:()=>layout,service:new RecycleService(app,hooks),restart:()=>new RecycleService(app,hooks),sync};
}

test('empty mapped folder is absent from active Board tree after trash and restarts with the same identity/layout',async()=>{
  const f=fixture(),before=clone(f.layout().boards.group),entry=clone(f.layout().boards.home.nodes[0]);const result=await f.service.trash('home',['group-entry']);f.sync();
  assert.equal(f.layout().boards.group,undefined);assert.equal(f.disk.has('Group'),false);assert.equal(f.layout().boards.home.nodes.some(n=>n.board==='group'),false);
  f.layout().boards.home.nodes.find(n=>n.id==='later')!.x=-9000;
  const rows=await f.restart().list();assert.equal(rows[0].token,result.trashToken);await f.restart().restore(result.trashToken);f.sync();
  assert.deepEqual(f.layout().boards.group,before);assert.deepEqual(f.layout().boards.home.nodes.find(n=>n.id==='group-entry'),entry);assert.equal(f.layout().boards.home.nodes.find(n=>n.id==='later')!.x,-9000);assert.equal(f.disk.has('Group'),true);
});

test('mapped folder plus free descendants and external Board references survive manifest reload without touching independent source or later layouts',async()=>{
  const f=fixture(true),group=clone(f.layout().boards.group),child=clone(f.layout().boards.child);const result=await f.service.trash('home',['group-entry']);f.sync();
  assert.equal(f.layout().boards.group,undefined);assert.equal(f.layout().boards.child,undefined);assert.ok(f.layout().boards.external);assert.equal(f.disk.get('Else/Other.md')!.data,'# Independent');
  f.layout().boards.external.nodes[0].x=9900;f.layout().boards.home.nodes.find(n=>n.id==='later')!.y=-12000;
  assert.equal((await f.restart().list())[0].token,result.trashToken);await f.restart().restore(result.trashToken);f.sync();
  assert.deepEqual(f.layout().boards.group,group);assert.deepEqual(f.layout().boards.child,child);assert.equal(f.layout().boards.external.nodes[0].x,9900);assert.equal(f.layout().boards.home.nodes.find(n=>n.id==='later')!.y,-12000);assert.equal(f.disk.get('Else/Other.md')!.data,'# Independent');assert.equal(f.renames.some(([from])=>from==='Else'||from==='Else/Other.md'),false);
});

test('redo rejects a same-path replacement directory even when original node IDs and child names remain',async()=>{
  const f=fixture(true),result=await f.service.trash('home',['group-entry']);await f.restart().restore(result.trashToken);const count=f.renames.length;
  f.disk.get('Group')!.ctime+=1000;f.disk.get('Group')!.mtime+=1000;f.disk.get('Group/Original.md')!.data='# New directory bytes';f.index.delete('Group');f.index.set('Group',{path:'Group',children:[]});
  await assert.rejects(f.restart().redo(result.trashToken),/替换|改变|外部|身份/);assert.equal(f.renames.length,count);assert.equal(f.disk.get('Group/Original.md')!.data,'# New directory bytes');assert.ok(f.layout().boards.group);
});

test('latest recycle record remains discoverable after restart with over 200 UUID-sorted directories',async()=>{
  const f=fixture();
  for(let i=1;i<=205;i++){
    const newest=i===205,token=(newest?'00000000':'ffffffff')+'-0000-4000-8000-'+i.toString(16).padStart(12,'0'),id='note-'+i;
    const manifest={schema:1,token,createdAt:i,label:newest?'newest':'older '+i,status:'trashed',selection:{board:'home',ids:[id]},items:[],captures:[{board:'home',index:0,node:{id,type:'note',title:'local',text:'fixture',x:0,y:0}}],relations:[],boards:[]};
    f.add('.trash/visual-board/'+token+'/manifest.json',JSON.stringify(manifest));
  }
  const records=await f.restart().list();assert.equal(records.length,200);assert.equal(records[0].createdAt,205);assert.equal(records[0].label,'newest');assert.ok(records.some(r=>r.token.startsWith('00000000')));
});
