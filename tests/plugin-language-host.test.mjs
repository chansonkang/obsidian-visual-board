import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

const compiled=await build({entryPoints:[new URL('../src/main.ts',import.meta.url).pathname],bundle:true,format:'cjs',platform:'node',external:['obsidian'],loader:{'.html':'text'},write:false});
const plain=value=>JSON.parse(JSON.stringify(value));
async function fixture(language='zh',undefinedCommand=false){
 const home={id:'home',title:'保存设置',parent:null,folderPath:'',theme:'product',view:{x:217,y:-95,zoom:1.5},nodes:[{id:'note',type:'note',title:'颜色',text:'界面语言',x:40,y:60,w:240,h:280}],edges:[]};
 let disk={schema:1,layout:{version:2,articleSizingVersion:1,currentBoard:'home',showKnowledge:true,showSpace:true,boards:{home}},settings:{language,noteFolder:'Notes',attachmentFolder:'My assets',baseUrl:'https://example.test/v1',model:'local-model',legacyFolderLinked:true,defaultIconMode:'ai'}},fail=false,factory;
 const messages=[],commands=[],ribbon=new Map(),leaves=[],saved=[];
 class Plugin{
  constructor(app,manifest){this.app=app;this.manifest=manifest;}
  loadData(){return Promise.resolve(plain(disk));}
  async saveData(data){if(fail)throw Error('fixture disk full');disk=plain(data);saved.push(plain(data));}
  registerView(_,fn){factory=fn;} registerEvent(){} registerObsidianProtocolHandler(){} addSettingTab(){}
  addRibbonIcon(_,title){ribbon.set('aria-label',title);return{setAttribute:(name,value)=>ribbon.set(name,value)};}
  addCommand(command){commands.push(command);return undefinedCommand?undefined:command;}
 }
 class ItemView{constructor(leaf){this.leaf=leaf;}}
 const app={vault:{configDir:'.obsidian',on:()=>({}),adapter:{read:async()=>'{}',write:async()=>{}},getAbstractFileByPath:()=>null},workspace:{getLeavesOfType:()=>leaves,getActiveFile:()=>null},metadataCache:{on:()=>({})}};
 const obsidian={Plugin,ItemView,PluginSettingTab:class{},Setting:class{},Notice:class{},TFile:class{},normalizePath:value=>value,requestUrl:async()=>{throw Error('Unexpected network request');}};
 const module={exports:{}};
 runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,require:name=>{assert.equal(name,'obsidian');return obsidian;},console,setTimeout,clearTimeout,TextEncoder,TextDecoder,URL,crypto:webcrypto,Uint8Array});
 const plugin=new module.exports.default(app,{id:'obsidian-visual-board',dir:'.obsidian/plugins/obsidian-visual-board'});await plugin.onload();
 const leaf={updateHeader(){this.updated=(this.updated||0)+1;}},view=factory(leaf);leaf.view=view;leaves.push(leaf);
 const frameAttributes=new Map();view.frame={setAttribute:(name,value)=>frameAttributes.set(name,value),contentWindow:{postMessage(message){messages.push(plain(message));}}};
 let id=0;
 return{plugin,view,messages,commands,ribbon,saved,frameAttributes,leaf,disk:()=>plain(disk),fail:value=>{fail=value;},async rpc(payload){const request='lang-'+ ++id;await view.handle({id:request,method:'save-settings',payload});return messages.find(message=>message.kind==='vb-response'&&message.id===request);},async reload(){const next=new plugin.constructor(app,plugin.manifest);await next.onload();return next;}};
}
test('actual host language RPC persists English/Chinese and broadcasts only UI preference changes',async()=>{
 const f=await fixture('en');
 try{
  assert.equal(f.plugin.settings.language,'en');assert.equal(f.commands[0].name,'Open Visual Board');assert.equal(f.commands[1].name,'Add the current note to the Board');assert.equal(f.ribbon.get('aria-label'),'Open Visual Board');assert.equal(f.view.getDisplayText(),'Visual Board');
  const layout=plain(f.plugin.layout),settings=plain(f.plugin.settings);
  const reply=await f.rpc({language:'zh'});assert.equal(reply.error,undefined);assert.equal(reply.result.language,'zh');assert.equal(f.disk().settings.language,'zh');
  assert.deepEqual(plain(f.plugin.layout),layout);assert.deepEqual({...f.disk().settings,language:'en'},settings);assert.equal(f.commands[0].name,'打开可视化桌面');assert.equal(f.ribbon.get('aria-label'),'打开可视化桌面');assert.equal(f.view.getDisplayText(),'可视化桌面');assert.equal(f.frameAttributes.get('title'),'可视化桌面');assert.equal(f.leaf.updated,1);
  assert.deepEqual(f.messages.filter(message=>message.type==='language').map(message=>message.payload),[{language:'zh'}]);
  const reloaded=await f.reload();try{assert.equal(reloaded.settings.language,'zh');assert.deepEqual(plain(reloaded.layout),layout);}finally{reloaded.onunload();}
 }finally{f.plugin.onunload();}
});
test('actual save-settings RPC rolls back disk failure and can subsequently save without corrupting layout',async()=>{
 const f=await fixture();try{
  const before=f.disk(),layout=plain(f.plugin.layout);f.fail(true);const failed=await f.rpc({language:'en'});assert.ok(failed.error,'actual host must return the save failure');assert.equal(f.plugin.settings.language,'zh');assert.deepEqual(f.disk(),before);assert.equal(f.messages.some(message=>message.type==='language'),false);assert.equal(f.commands[0].name,'打开可视化桌面');
  f.fail(false);const success=await f.rpc({language:'en'});assert.equal(success.error,undefined);assert.equal(f.plugin.settings.language,'en');assert.equal(f.disk().settings.language,'en');assert.deepEqual(f.disk().layout,layout);assert.equal(f.messages.filter(message=>message.type==='language').length,1);
 }finally{f.plugin.onunload();}
});
test('native setting language updates survive reload and roll back write failure, including minimal command mocks',async()=>{
 const f=await fixture('zh',true);try{
  const beforeLayout=plain(f.plugin.layout);await f.plugin.setLanguage('en');assert.equal(f.disk().settings.language,'en');assert.equal(f.ribbon.get('aria-label'),'Open Visual Board');
  const reloaded=await f.reload();try{assert.equal(reloaded.settings.language,'en');}finally{reloaded.onunload();}
  const eventCount=f.messages.filter(message=>message.type==='language').length;f.fail(true);await assert.rejects(f.plugin.setLanguage('zh'),/fixture disk full/);assert.equal(f.plugin.settings.language,'en');assert.equal(f.disk().settings.language,'en');assert.equal(f.messages.filter(message=>message.type==='language').length,eventCount);assert.deepEqual(plain(f.plugin.layout),beforeLayout);
 }finally{f.plugin.onunload();}
});
