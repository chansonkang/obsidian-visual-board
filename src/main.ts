import { Plugin, ItemView, WorkspaceLeaf, PluginSettingTab, Setting, Notice, TFile, normalizePath, requestUrl, apiVersion } from 'obsidian';
import { VaultBridge } from './vault';
import { IconService } from './icons';
import { ImageService, obsidianUrl } from './images';
import { BoardNode, BoardEdge, KnowledgeEdgeStyle, Layout, initialLayout, sanitizeLayout, renameReferences, safeVaultPath } from './model';
import { fitArticleCards } from './article-sizing';
import { FolderBridge } from './folders';
import { syncFolderLayout, migrateFolderPaths, findFolderBoard } from './folder-layout';
import { visibleNodePosition } from './node-placement';
import { relocateArticle } from './article-move';
import { revealVaultEntry } from './explorer';
import { MediaService } from './media';
import { RecycleService } from './recycle';
import { NativeReferenceSync } from './native-reference-sync';
import { importMarkdownFiles } from './markdown-import';
import { ComponentClipboardService } from './component-clipboard';
import { LayoutStorage, validatedBoardData } from './layout-storage';
import frameHtml from './frame.html';
import { UpdateService, UpdateResult, normalizeUpdateRepository } from './updates';
import updateSource from '../update-source.json';
import { Language, cleanLanguage, translate } from './i18n';
const VIEW = 'visual-board-desktop';
interface Draft {path:string;body:string;expectedBody:string;updatedAt:number}
interface Settings { language:Language; noteFolder:string; attachmentFolder:string; baseUrl:string; model:string; defaultIconMode:'default'|'ai'; legacyFolderLinked:boolean; updateRepository:string; autoCheckUpdates:boolean }
const defaults:Settings = {language:'zh',noteFolder:'',attachmentFolder:'Visual Board Assets',baseUrl:'https://api.apimart.ai/v1',model:'gpt-4o-image',defaultIconMode:'default',legacyFolderLinked:false,updateRepository:normalizeUpdateRepository(updateSource.repository)||'',autoCheckUpdates:true};
interface ArticleMoveRecord {
 token:string;file:TFile;oldPath:string;newPath:string;sourceBoard:string;targetBoard:string;
 before:BoardNode;after:BoardNode;sourceFolder:string|undefined;targetFolder:string;
 beforeEdges:BoardEdge[];beforeKnowledge:KnowledgeEdgeStyle[];afterEdges:BoardEdge[];afterKnowledge:KnowledgeEdgeStyle[];
 phase:'moved'|'undone';invalid:boolean;busy:boolean;
}
export default class VisualBoardPlugin extends Plugin {
 explorerRevealDepth=0;layout:Layout=initialLayout(); settings:Settings={...defaults}; vaultBridge!:VaultBridge; icons!:IconService; images!:ImageService; folders!:FolderBridge;media!:MediaService;recycle!:RecycleService; private legacyLinking?:Promise<void>;
 private layoutStorage?:LayoutStorage;private storageBlocked=false;
 private updater?:UpdateService;private updateResult?:UpdateResult;private updateTimer?:ReturnType<typeof setTimeout>;private updatesDisposed=false;private updateGeneration=0;private announcedUpdates=new Set<string>();
 drafts:Record<string,Draft>=Object.create(null); private writes:Promise<void>=Promise.resolve(); private refreshTimer:ReturnType<typeof setTimeout>|undefined;
 private clipboard?:ComponentClipboardService;componentMutating=false;private componentIdle:Promise<void>=Promise.resolve();private finishComponent?:()=>void;
 clipboardService(){return this.clipboard ||= new ComponentClipboardService(this.app,{getLayout:()=>this.layout,setLayout:layout=>{this.layout=layout;},persist:()=>this.persist(),revision:()=>this.nativeSync.revision},this.recycle);}
 async componentMutation<T>(operation:()=>Promise<T>):Promise<T>{if(this.componentMutating||this.recycle.active)throw Error('组件正在处理，请稍候。');this.componentMutating=true;this.componentIdle=new Promise(resolve=>{this.finishComponent=resolve;});try{return await operation();}finally{this.componentMutating=false;this.finishComponent?.();this.finishComponent=undefined;}}
 nativeSync=new NativeReferenceSync();private vaultReady:Promise<void>=Promise.resolve();private startupReconciled?:Promise<boolean>;
 private ribbon?:HTMLElement; private localizedCommands:{name:string}[]=[];
 private articleMoves=new Map<string,ArticleMoveRecord>();private nativeArticleMoves=new Map<TFile,{oldPath:string,newPath:string}>();
 async onload(){
  let saved:any;const adapter=this.app.vault.adapter;
  if(['exists','read','write','rename','remove','mkdir'].every(method=>typeof (adapter as any)[method]==='function')){
   this.layoutStorage=new LayoutStorage(adapter,normalizePath(this.manifest.dir||this.app.vault.configDir+'/plugins/'+this.manifest.id),10,normalizePath(this.app.vault.configDir+'/visual-board-layout-backups/'+this.manifest.id));
   const loaded=await this.layoutStorage.load(()=>this.loadData());
   if(loaded.status==='blocked'){this.storageBlocked=true;new Notice('画板布局未能安全读取，已停止写入并保留原文件，请检查本地布局备份。');throw Error('Board layout could not be loaded safely; existing files have been preserved.');}
   saved=loaded.data;
   if(loaded.status==='recovered')new Notice(translate(cleanLanguage(saved?.settings?.language),'已从本地备份恢复画板布局，原组件位置已保留。'));
  }else{const raw=await this.loadData();saved=raw==null?null:validatedBoardData(raw);if(raw!=null&&!saved){this.storageBlocked=true;throw Error('Board layout could not be loaded safely; existing files have been preserved.');}}
  this.layout=sanitizeLayout(saved?.layout);this.settings=this.cleanSettings(saved?.settings);
  this.updater=new UpdateService(()=>({repository:this.settings.updateRepository,currentVersion:this.manifest.version||'0.0.0',appVersion:apiVersion||this.manifest.minAppVersion||'1.5.0',pluginId:this.manifest.id,autoCheck:this.settings.autoCheckUpdates}),async()=>{try{return JSON.parse(await this.app.vault.adapter.read(this.updateStatePath()));}catch{return null;}},cache=>this.app.vault.adapter.write(this.updateStatePath(),JSON.stringify(cache)),requestUrl);
  try{const raw=JSON.parse(await this.app.vault.adapter.read(this.draftPath()));for(const d of Object.values(raw) as Draft[])if(safeVaultPath(d.path)&&d.path.endsWith('.md')&&typeof d.body==='string'&&typeof d.expectedBody==='string')this.drafts[d.path]=d;}catch{}
  this.media=new MediaService(this.app,()=>this.settings.attachmentFolder);this.folders=new FolderBridge(this.app);this.vaultBridge=new VaultBridge(this.app,this);this.icons=new IconService(this.app,()=>this.settings);this.images=new ImageService(this.app,()=>this.settings.attachmentFolder);
  this.recycle=new RecycleService(this.app,{getLayout:()=>this.layout,setLayout:layout=>{this.layout=layout;},persist:()=>this.persist()});
  this.registerView(VIEW,leaf=>new BoardView(leaf,this));
  // Focusing a Board (including explorer selection) preserves its camera; navigation fits explicitly.
  this.registerObsidianProtocolHandler('visual-board',async params=>{const view=await this.openBoard();if(params.board&&this.layout.boards[params.board]){this.layout.currentBoard=params.board;await this.persist();await view.refresh(true);}});
  this.ribbon=this.addRibbonIcon('panels-top-left',this.text('打开可视化桌面'),()=>void this.openBoard());
  this.localizedCommands.push(this.addCommand({id:'open-desktop',name:this.text('打开可视化桌面'),callback:()=>void this.openBoard()}));
  this.localizedCommands.push(this.addCommand({id:'add-current-note',name:this.text('把当前文章放入画板'),checkCallback:(checking)=>{const f=this.app.workspace.getActiveFile();if(!f||f.extension!=='md')return false;if(!checking)void this.addCurrent(f);return true;}}));
  this.localizedCommands.push(this.addCommand({id:'check-for-updates',name:this.settings.language==='en'?'Check for updates':'检查插件更新',callback:()=>{void this.checkForUpdates(true,true);}}));
  this.addSettingTab(new BoardSettings(this.app,this));
  if(typeof this.app.workspace.onLayoutReady==='function')this.vaultReady=new Promise(resolve=>this.app.workspace.onLayoutReady(()=>resolve()));
  this.registerEvent(this.app.vault.on('create',()=>this.scheduleRefresh()));
  this.registerEvent(this.app.vault.on('modify',()=>this.scheduleRefresh()));
  this.registerEvent(this.app.vault.on('delete',file=>{
   if(!this.recycle.ownsEvent(file.path)){this.invalidateArticleMoves(file.path,file);const event=this.nativeSync.record(this.layout,{type:'delete',path:file.path,folder:!(file instanceof TFile)});for(const view of this.views())view.send('delete',{path:file.path,folder:event.folder,removedNodes:event.type==='delete'?event.removedNodes:undefined,nativeRevision:event.revision});void this.persist();}
   this.scheduleRefresh();
  }));
  this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{
   if(this.recycle.ownsEvent(oldPath,file.path)){this.scheduleRefresh();return;}
   const expected=file instanceof TFile?this.nativeArticleMoves.get(file):undefined;
   if(!expected||expected.oldPath!==oldPath||expected.newPath!==file.path)this.invalidateArticleMoves(oldPath,file);
   const folder=!(file instanceof TFile);const migrate=(p:string)=>p===oldPath||folder&&p.startsWith(oldPath+'/')?file.path+p.slice(oldPath.length):p;
   this.layout=sanitizeLayout(this.layout);const event=this.nativeSync.record(this.layout,{type:'rename',path:oldPath,newPath:file.path,folder});
   for(const b of Object.values(this.layout.boards)){if(b.iconPath)b.iconPath=migrate(b.iconPath);for(const n of b.nodes){if(n.doc)n.doc=migrate(n.doc);if(n.imagePath)n.imagePath=migrate(n.imagePath);if(n.filePath)n.filePath=migrate(n.filePath);}}
   if(this.layout.audioPlayback)for(const path of Object.keys(this.layout.audioPlayback)){const next=migrate(path);if(next!==path){this.layout.audioPlayback[next]=this.layout.audioPlayback[path];delete this.layout.audioPlayback[path];}}
   if(this.layout.visibleArticleHeadings)this.layout.visibleArticleHeadings=[...new Set(this.layout.visibleArticleHeadings.map(migrate))];
   for(const [p,d]of Object.entries(this.drafts)){const next=migrate(p);if(next!==p){delete this.drafts[p];this.drafts[next]={...d,path:next};}}void this.persistDrafts();
   for(const view of this.views())view.send('rename',{oldPath,newPath:file.path,folder,nativeRevision:event.revision});
   void this.persist();this.scheduleRefresh();
  }));
  this.registerEvent(this.app.metadataCache.on('resolved',()=>this.scheduleRefresh()));
  this.registerEvent(this.app.metadataCache.on('changed',()=>this.scheduleRefresh()));
  void this.vaultReady.then(()=>{if(!this.updatesDisposed)this.scheduleUpdateCheck(8000);});
 }
 onunload(){this.updatesDisposed=true;if(this.updateTimer)clearTimeout(this.updateTimer);this.updater?.dispose();if(this.refreshTimer)clearTimeout(this.refreshTimer);this.articleMoves.clear();this.nativeArticleMoves.clear();}
 private invalidateArticleMoves(path:string,file?:unknown){for(const record of this.articleMoves.values())if(record.file===file||[record.oldPath,record.newPath].some(p=>p===path||p.startsWith(path+'/')))record.invalid=true;}
 rebindRestoredMoves(paths:string[]){for(const record of this.articleMoves.values()){if(record.invalid)continue;const expected=record.phase==='moved'?record.newPath:record.oldPath;if(paths.some(path=>expected===path||expected.startsWith(path+'/'))){const file=this.app.vault.getAbstractFileByPath(expected);if(file instanceof TFile)record.file=file;}}}
 beginArticleMove(file:TFile,oldPath:string,newPath:string){if(this.nativeArticleMoves.has(file))throw Error('这篇文章正在移动，请稍候。');this.nativeArticleMoves.set(file,{oldPath,newPath});}
 endArticleMove(file:TFile){this.nativeArticleMoves.delete(file);}
 rememberArticleMove(record:Omit<ArticleMoveRecord,'token'|'phase'|'invalid'|'busy'>){const token=crypto.randomUUID();this.articleMoves.set(token,{...record,token,phase:'moved',invalid:false,busy:false});while(this.articleMoves.size>200)this.articleMoves.delete(this.articleMoves.keys().next().value!);return token;}
 async replayArticleMove(token:unknown,direction:unknown){
  const record=typeof token==='string'?this.articleMoves.get(token):undefined;
  if(!record||record.invalid||direction!=='undo'&&direction!=='redo')throw Error('这次移动已失效，请重新定位文章。');
  if(record.busy||direction==='undo'&&record.phase!=='moved'||direction==='redo'&&record.phase!=='undone')throw Error('移动记录与当前状态不一致，不能重复撤销或重做。');
  const undo=direction==='undo',fromBoard=undo?record.targetBoard:record.sourceBoard,toBoard=undo?record.sourceBoard:record.targetBoard;
  const oldPath=undo?record.newPath:record.oldPath,newPath=undo?record.oldPath:record.newPath,source=this.layout.boards[fromBoard],target=this.layout.boards[toBoard];
  const node=source?.nodes.find(n=>n.id===record.before.id),restore=undo?record.before:record.after;
  if(!source||!target||source.folderMissing||target.folderMissing||this.layout.boards[record.sourceBoard]?.folderPath!==record.sourceFolder||this.layout.boards[record.targetBoard]?.folderPath!==record.targetFolder||!node||node.type!=='article'||node.doc!==oldPath||this.app.vault.getAbstractFileByPath(oldPath)!==record.file||record.file.path!==oldPath)throw Error('文章或画板已被移动、删除，当前状态不能撤销。');
  const parent=newPath.slice(0,Math.max(0,newPath.lastIndexOf('/')));
  // An explicitly added reference may live on a mapped Board other than its file's folder.
  // Undo restores that reference where it was, while the native file goes to its original folder.
  const manualOrigin=undo&&record.before.folderManaged!==true&&target.folderPath!==undefined&&target.folderPath!==parent;
  const preflight=sanitizeLayout(this.layout);if(manualOrigin)delete preflight.boards[toBoard].folderPath;
  // Preflight placement against current layout, before the native file is touched.
  if(!relocateArticle(preflight,fromBoard,node.id,toBoard,newPath,node))throw Error('目标画板卡片发生冲突，当前移动不能撤销。');
  this.beginArticleMove(record.file,oldPath,newPath);record.busy=true;
  try{
   const captured={...node},doc=await this.vaultBridge.move(oldPath,parent);
   if(record.invalid||doc.path!==newPath||this.app.vault.getAbstractFileByPath(newPath)!==record.file)throw Error('文章在移动期间发生外部变化，请重新定位。');
   this.layout=renameReferences(this.layout,oldPath,newPath);
   const destinationBoard=this.layout.boards[toBoard],mapping=destinationBoard?.folderPath;let placed=false;
   if(manualOrigin&&destinationBoard)delete destinationBoard.folderPath;
   try{placed=relocateArticle(this.layout,fromBoard,node.id,toBoard,newPath,captured);}finally{if(manualOrigin&&destinationBoard)destinationBoard.folderPath=mapping;}
   if(!placed)throw Error('文章已移动，但卡片状态发生变化，请重新定位。');
   const moved=this.layout.boards[toBoard].nodes.find(n=>n.id===node.id)!;
   if(undo){if(record.before.folderManaged===undefined)delete moved.folderManaged;else moved.folderManaged=record.before.folderManaged;}
   for(const field of ['x','y','w','h','angle'] as const){if(restore[field]===undefined)delete moved[field];else moved[field]=restore[field]!;}
   this.syncFolders();
   const dest=this.layout.boards[toBoard],ids=new Set(dest.nodes.map(n=>n.id));
   for(const edge of undo?record.beforeEdges:record.afterEdges)if(ids.has(edge.from)&&ids.has(edge.to)&&!dest.edges.some(e=>e.from===edge.from&&e.to===edge.to||e.from===edge.to&&e.to===edge.from))dest.edges.push({...edge});
   for(const style of undo?record.beforeKnowledge:record.afterKnowledge)if(ids.has(style.from)&&ids.has(style.to)&&!(dest.knowledgeEdgeStyles||[]).some(e=>e.from===style.from&&e.to===style.to||e.from===style.to&&e.to===style.from))(dest.knowledgeEdgeStyles||=[]).push({...style});
   record.phase=undo?'undone':'moved';await this.persist();
   if(record.invalid||record.file.path!==newPath||this.app.vault.getAbstractFileByPath(newPath)!==record.file)throw Error('文章在保存期间发生外部变化，请重新定位。');
   this.scheduleRefresh();
   return {moveToken:record.token,oldPath,newPath,doc,layout:this.layout,node:{...moved},direction};
  }finally{record.busy=false;this.endArticleMove(record.file);}
 }
 text(key:string){return translate(this.settings.language,key);}
 languageChanged(){
  this.ribbon?.setAttribute('aria-label',this.text('打开可视化桌面'));
  const names=['打开可视化桌面','把当前文章放入画板'];this.localizedCommands.forEach((command,index)=>{if(command)command.name=index===2?(this.settings.language==='en'?'Check for updates':'检查插件更新'):this.text(names[index]);});
  for(const view of this.views())view.setLanguage();
 }
 async setLanguage(value:unknown){const old=this.settings.language;this.settings.language=cleanLanguage(value);try{await this.persist();}catch(error){this.settings.language=old;throw error;}this.languageChanged();}
 cleanSettings(raw:any):Settings{return {language:cleanLanguage(raw?.language),noteFolder:typeof raw?.noteFolder==='string'?raw.noteFolder:'',attachmentFolder:typeof raw?.attachmentFolder==='string'?raw.attachmentFolder:defaults.attachmentFolder,baseUrl:typeof raw?.baseUrl==='string'?raw.baseUrl:defaults.baseUrl,model:typeof raw?.model==='string'?raw.model:defaults.model,defaultIconMode:raw?.defaultIconMode==='ai'?'ai':'default',legacyFolderLinked:raw?.legacyFolderLinked===true,updateRepository:typeof raw?.updateRepository==='string'?(normalizeUpdateRepository(raw.updateRepository)??defaults.updateRepository):defaults.updateRepository,autoCheckUpdates:raw?.autoCheckUpdates!==false};}
 updateStatePath(){return `${this.manifest.dir||this.app.vault.configDir+'/plugins/'+this.manifest.id}/update-state.json`;}
 updateInfo():Omit<UpdateResult,'status'>&{status:UpdateResult['status']|'not-checked';repository:string;autoCheck:boolean}{return {...(this.updateResult||{status:!this.settings.updateRepository?'not-configured':this.settings.autoCheckUpdates?'not-checked':'disabled',currentVersion:this.manifest.version||'0.0.0',shouldNotify:false}),repository:this.settings.updateRepository,autoCheck:this.settings.autoCheckUpdates};}
 private scheduleUpdateCheck(delay:number){
  if(this.updateTimer)clearTimeout(this.updateTimer);
  if(this.updatesDisposed||!this.settings.updateRepository||!this.settings.autoCheckUpdates)return;
  this.updateTimer=setTimeout(()=>{void this.checkForUpdates(false).finally(()=>this.scheduleUpdateCheck(60*60*1000));},delay);
  (this.updateTimer as any)?.unref?.();
 }
 async configureUpdates(input:{repository?:unknown;autoCheck?:unknown}){
  if(typeof input.repository!=='string'||typeof input.autoCheck!=='boolean')throw Error(this.settings.language==='en'?'Invalid update settings.':'更新设置无效。');
  const repository=normalizeUpdateRepository(input.repository);if(repository===null)throw Error(this.settings.language==='en'?'Enter a public GitHub repository as owner/repository.':'请填写公开 GitHub 仓库，格式为作者名/仓库名。');
  const previous=this.settings,next={...previous,updateRepository:repository,autoCheckUpdates:input.autoCheck};this.settings=next;
  try{await this.persist();}catch(error){if(this.settings===next)this.settings=previous;throw error;}
  this.updateGeneration++;this.updateResult=undefined;this.updater?.reset();this.scheduleUpdateCheck(8000);return this.updateInfo();
 }
 async checkForUpdates(manual=false,announce=false){
  const generation=this.updateGeneration,result=await this.updater!.check({manual});if(this.updatesDisposed||generation!==this.updateGeneration)return this.updateInfo();
  this.updateResult=result;
  const key=this.settings.updateRepository.toLowerCase()+'|'+result.latestVersion,notify=result.shouldNotify&&!this.announcedUpdates.has(key);if(notify)this.announcedUpdates.add(key);
  if(notify||announce)new Notice(this.updateMessage(result),10000);
  if(notify)for(const view of this.views())view.send('update-available',this.updateInfo());
  return this.updateInfo();
 }
 async ignoreUpdate(version:unknown){if(typeof version!=='string'||version!==this.updateResult?.latestVersion)throw Error(this.settings.language==='en'?'No matching release is selected.':'没有对应的更新版本。');await this.updater!.ignore(version);if(this.updateResult)this.updateResult={...this.updateResult,shouldNotify:false};return {...this.updateInfo(),status:'ignored'};}
 updateUrl(kind:unknown){
  if(kind!=='release'&&kind!=='download')throw Error('Invalid update action.');
  const result=this.updateResult,repo=normalizeUpdateRepository(this.settings.updateRepository),value=kind==='release'?result?.releaseUrl:result?.downloadUrl;
  if(!repo||!result||!['available','up-to-date','incompatible'].includes(result.status)||!value||kind==='download'&&result.status==='incompatible')throw Error(this.settings.language==='en'?'Check for updates first.':'请先检查更新。');
  const tag=result.releaseUrl?.split('/').pop()||'',prefix=`https://github.com/${repo}/releases/`,expected=kind==='release'?prefix+'tag/'+tag:prefix+'download/'+tag+'/';
  if(kind==='release'?value!==expected:!value.startsWith(expected)||!/^[a-zA-Z0-9_.-]+\.zip$/i.test(value.slice(expected.length)))throw Error('Invalid release URL.');
  return value;
 }
 private updateMessage(result:UpdateResult){
  const en=this.settings.language==='en',messages:Record<string,[string,string]>={
   'not-configured':['尚未配置 GitHub 更新仓库，请在 Visual Board 设置中填写。','No GitHub release repository is configured. Open Visual Board settings.'],
   'available':['Visual Board 有新版本 '+result.latestVersion+'，请在画板设置中查看更新。','Visual Board '+result.latestVersion+' is available. Open Board settings to update.'],
   'up-to-date':['Visual Board 已是最新版本。','Visual Board is up to date.'],
   'offline':['无法连接 GitHub，请联网后重试。','Could not reach GitHub. Try again when online.'],
   'not-found':['未找到 GitHub 仓库或正式发布版本。','GitHub repository or stable release was not found.'],
   'rate-limited':['GitHub 请求次数已达上限，请稍后重试。','GitHub request limit reached. Try again later.'],
   'incompatible':['新版要求更高的 Obsidian 版本，请先升级 Obsidian。','The release requires a newer Obsidian version. Update Obsidian first.'],
   'invalid-release':['发布包或版本信息不完整，请联系作者。','The release package or version information is invalid. Contact the author.'],
   'disabled':['自动更新检查已关闭。','Automatic update checks are off.'],
   'invalid-config':['GitHub 仓库配置无效。','The GitHub repository setting is invalid.']};
  return (messages[result.status]||messages.offline)[en?1:0];
 }
 syncFolders(){return syncFolderLayout(this.layout,this.folders.list(),this.app.vault.getMarkdownFiles().map(f=>f.path),{preserveUnconfirmedMissing:true});}
 async linkLegacyFolders(){
  if(this.settings.legacyFolderLinked)return;
  if(this.legacyLinking)return this.legacyLinking;
  this.legacyLinking=(async()=>{
   this.layout.boards.home.folderPath='';const pending=Object.values(this.layout.boards).filter(b=>b.id!=='home'&&b.folderPath===undefined).map(b=>b.id);
   while(pending.length){let progressed=false;
    for(let i=pending.length-1;i>=0;i--){const b=this.layout.boards[pending[i]];if(!b){pending.splice(i,1);progressed=true;continue;}const parent=this.layout.boards[b.parent||'home'];if(parent?.folderPath===undefined){if(pending.includes(parent?.id))continue;pending.splice(i,1);progressed=true;continue;}
     try{let title=b.title,path=await this.folders.create(parent?.folderPath||'',title),suffix=2;while(findFolderBoard(this.layout,path)){title=b.title+' '+suffix++;path=await this.folders.create(parent?.folderPath||'',title);}const current=this.layout.boards[b.id];if(current){current.folderPath=path;const currentParent=this.layout.boards[current.parent||'home'];if(currentParent&&!currentParent.nodes.some(n=>n.board===current.id))currentParent.hiddenFolderBoards=[...new Set([...(currentParent.hiddenFolderBoards||[]),current.id])];}}
     catch{new Notice('画板「'+b.title+'」未能关联文件夹，请检查名称；其内容和布局已保留。');}
     pending.splice(i,1);progressed=true;
    }
    if(!progressed)break;
   }
   this.settings.legacyFolderLinked=true;await this.persist();
  })();try{await this.legacyLinking;}finally{this.legacyLinking=undefined;}
 }
 views():BoardView[]{return this.app.workspace.getLeavesOfType(VIEW).map(l=>l.view).filter((v):v is BoardView=>v instanceof BoardView);}
 async openBoard(){let leaf=this.app.workspace.getLeavesOfType(VIEW)[0];if(!leaf){leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:VIEW,active:true});}await this.app.workspace.revealLeaf(leaf);const view=leaf.view as BoardView;view.send('center-board',{});return view;}
 async addCurrent(file:TFile){const b=this.layout.boards[this.layout.currentBoard];b.nodes.push({id:'card-'+crypto.randomUUID(),type:'article',doc:file.path,...visibleNodePosition(b.nodes.map(n=>({x:n.x,y:n.y,w:n.w||(n.type==='board'?300:480),h:n.h||(n.type==='board'?303:640)})),b.view,{w:1200,h:600},{w:480,h:640})});await this.persist();const view=await this.openBoard();await view.refresh(true);}
 persist():Promise<void>{if(this.storageBlocked)return Promise.reject(Error('画板布局未能安全读取，已停止写入并保留原文件。'));const payload={schema:1,layout:this.layout,settings:this.settings};const serialized=JSON.parse(JSON.stringify(payload));this.writes=this.writes.catch(()=>{}).then(()=>this.layoutStorage?this.layoutStorage.write(serialized).catch(()=>{throw Error('画板布局保存失败，已保留上一次有效布局，请稍后重试。');}):this.saveData(serialized));return this.writes;}
 draftPath(){return `${this.manifest.dir||this.app.vault.configDir+'/plugins/'+this.manifest.id}/draft-recovery.json`;}
 persistDrafts(){const value=JSON.stringify(this.drafts);this.writes=this.writes.catch(()=>{}).then(()=>this.app.vault.adapter.write(this.draftPath(),value));return this.writes;}
 async saveDraft(p:any){const path=safeVaultPath(p.path);if(!path||!path.endsWith('.md')||typeof p.body!=='string'||typeof p.expectedBody!=='string'||p.body.length>20000000)throw Error('草稿内容无效。');const at=Number(p.updatedAt)||Date.now();if(!this.drafts[path]||at>=this.drafts[path].updatedAt){this.drafts[path]={path,body:p.body,expectedBody:p.expectedBody,updatedAt:at};await this.persistDrafts();}}
 async clearDraft(p:any){const d=this.drafts[p.path];if(d&&d.body===p.body){delete this.drafts[p.path];await this.persistDrafts();}}
 scheduleRefresh(){if(this.refreshTimer)clearTimeout(this.refreshTimer);this.refreshTimer=setTimeout(()=>{for(const v of this.views())void v.refresh();},180);}
 async snapshot(){while(true){const idle=this.componentIdle;await idle;if(idle!==this.componentIdle)continue;const result=await this.snapshotOnce();if(!this.componentMutating&&idle===this.componentIdle&&result.nativeRevision===this.nativeSync.revision)return result;}}
 private async snapshotOnce(){await this.vaultReady;await this.recycle?.whenIdle();await this.linkLegacyFolders();
  if(!this.startupReconciled)this.startupReconciled=(async()=>{let changed=false;while(true){const target=this.layout;changed=await this.nativeSync.pruneMissing(target,this.app)||changed;if(target!==this.layout)continue;if(changed)await this.persist();return changed;}})();await this.startupReconciled;
  const folderLayoutChanged=this.syncFolders(),nativeRevision=this.nativeSync.revision;const refs=Object.values(this.layout.boards).flatMap(b=>b.nodes.flatMap(n=>n.doc?[n.doc]:[]));const docs=await this.vaultBridge.snapshot(refs);
  if(fitArticleCards(this.layout,docs)||folderLayoutChanged)await this.persist();
  const paths=new Set<string>();for(const b of Object.values(this.layout.boards)){if(b.iconPath)paths.add(b.iconPath);for(const n of b.nodes)if(n.imagePath)paths.add(n.imagePath);}
  const embeds:Record<string,{link:string,path:string}[]>={};
  for(const d of Object.values(docs)){const f=this.app.vault.getAbstractFileByPath(d.path);if(!(f instanceof TFile))continue;embeds[d.path]=[];for(const embed of this.app.metadataCache.getFileCache(f)?.embeds||[]){const target=this.app.metadataCache.getFirstLinkpathDest(embed.link.split('#')[0],d.path);if(target&&/^(png|jpe?g|webp|gif)$/i.test(target.extension)){paths.add(target.path);embeds[d.path].push({link:embed.link,path:target.path});}}}
  const mediaPaths=Object.values(this.layout.boards).flatMap(b=>b.nodes.flatMap(n=>n.filePath?[n.filePath]:[]));const mediaAssets=await this.media.mediaAssets(mediaPaths);const assets=await this.images.imageAssets([...paths]);return {mediaAssets,layout:this.layout,nativeRevision,folderLayoutChanged,docs,assets,embeds,settings:this.settings,vaultName:this.app.vault.getName(),drafts:Object.values(this.drafts)};
 }
}
class BoardView extends ItemView {
 private lastLayoutRevision=0;private frame?:HTMLIFrameElement;private channel=crypto.randomUUID();private ready=false;private refreshing=false;private pendingRefresh=false;private pendingIncludeLayout=false;private movingArticles=new Set<string>();private flushDone?:()=>void;
 constructor(leaf:WorkspaceLeaf,private plugin:VisualBoardPlugin){super(leaf);}
 getViewType(){return VIEW;}getDisplayText(){return this.plugin.text('可视化桌面');}
 setLanguage(){this.frame?.setAttribute?.('title',this.plugin.text('可视化桌面'));this.send('language',{language:this.plugin.settings.language});(this.leaf as any).updateHeader?.();}getIcon(){return 'panels-top-left';}
 async onOpen(){this.contentEl.empty();this.contentEl.addClass('visual-board-container');this.frame=this.contentEl.createEl('iframe',{cls:'visual-board-frame',attr:{title:this.plugin.text('可视化桌面'),sandbox:'allow-scripts allow-modals allow-downloads'}});
  const win=this.contentEl.ownerDocument.defaultView!;const handler=(e:MessageEvent)=>{if(e.source!==this.frame?.contentWindow)return;const data=e.data;if(data?.kind==='vb-boot'){void this.plugin.snapshot().then(payload=>{this.lastLayoutRevision=payload.nativeRevision;this.frame?.contentWindow?.postMessage({kind:'vb-init',channel:this.channel,payload},'*');}).catch(()=>new Notice(this.plugin.text('读取本地文章失败，请重新打开画板。')));return;}
   if(data?.channel!==this.channel)return;if(data.kind==='vb-ready'){this.ready=true;return;}if(data.kind==='vb-flushed'){this.flushDone?.();return;}if(data.kind==='vb-request'&&typeof data.id==='string'&&typeof data.method==='string')void this.handle(data);
  };win.addEventListener('message',handler);this.register(()=>win.removeEventListener('message',handler));this.frame.srcdoc=frameHtml;
 }
 send(type:string,payload:unknown){this.frame?.contentWindow?.postMessage({kind:'vb-event',channel:this.channel,type,payload},'*');}
 private notifyOtherRecycleViews(snapshot:Awaited<ReturnType<VisualBoardPlugin['snapshot']>>){for(const view of this.plugin.views())if(view!==this)view.send('snapshot',{...snapshot,layout:this.plugin.layout,preserveView:true});}
 async refresh(includeLayout=false){if(!this.ready)return;if(this.refreshing){this.pendingRefresh=true;this.pendingIncludeLayout||=includeLayout;return;}this.refreshing=true;try{let snapshot=await this.plugin.snapshot();while(snapshot.nativeRevision!==this.plugin.nativeSync.revision)snapshot=await this.plugin.snapshot();const sendLayout=includeLayout||snapshot.folderLayoutChanged||snapshot.nativeRevision!==this.lastLayoutRevision;this.send('snapshot',{...snapshot,layout:sendLayout?snapshot.layout:undefined,preserveView:!includeLayout});if(sendLayout)this.lastLayoutRevision=snapshot.nativeRevision;}catch{this.send('notice',this.plugin.text('本地文章暂时无法刷新，请稍后再试。'));}finally{this.refreshing=false;if(this.pendingRefresh){this.pendingRefresh=false;const nextLayout=this.pendingIncludeLayout;this.pendingIncludeLayout=false;void this.refresh(nextLayout);}}}
 async onClose(){if(this.ready)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,4000);this.flushDone=()=>{clearTimeout(timer);resolve();};this.send('flush',{});});await this.plugin.persist();this.ready=false;this.frame=undefined;}
 private async moveArticle(p:any){
    const source=this.plugin.layout.boards[p.sourceBoard],target=this.plugin.layout.boards[p.targetBoard],node=source?.nodes.find(n=>n.id===p.node);
    if(!node||node.type!=='article'||!node.doc||target?.folderPath===undefined||target.folderMissing||source.id===target.id)throw Error('请选择文章和有效的目标文件夹。');
    const oldPath=node.doc,captured={...node},plannedPath=(target.folderPath?target.folderPath+'/':'')+oldPath.split('/').pop(),file=this.plugin.app.vault.getAbstractFileByPath(oldPath);if(!(file instanceof TFile))throw Error('这篇文章已被移动或删除。');if(!relocateArticle(sanitizeLayout(this.plugin.layout),source.id,captured.id,target.id,plannedPath,captured))throw Error('目标画板中存在冲突的卡片，请刷新后重试。');if(this.movingArticles.has(oldPath))throw Error('这篇文章正在移动，请稍候。');
    const beforeEdges=source.edges.filter(e=>e.from===captured.id||e.to===captured.id).map(e=>({...e})),beforeKnowledge=(source.knowledgeEdgeStyles||[]).filter(e=>e.from===captured.id||e.to===captured.id).map(e=>({...e}));
    this.plugin.beginArticleMove(file,oldPath,plannedPath);this.movingArticles.add(oldPath);
    try{
     const doc=await this.plugin.vaultBridge.move(oldPath,target.folderPath);
     this.plugin.layout=renameReferences(this.plugin.layout,oldPath,doc.path);
     const placed=relocateArticle(this.plugin.layout,source.id,captured.id,target.id,doc.path,captured);
     const placedNode=this.plugin.layout.boards[target.id]?.nodes.find(n=>n.id===captured.id);if(placedNode&&p.position&&Number.isFinite(p.position.x)&&Number.isFinite(p.position.y)){placedNode.x=Math.max(-1e6,Math.min(1e6,Math.round(p.position.x/20)*20));placedNode.y=Math.max(-1e6,Math.min(1e6,Math.round(p.position.y/20)*20));}
     this.plugin.syncFolders();await this.plugin.persist();
     if(file.path!==doc.path||this.plugin.app.vault.getAbstractFileByPath(doc.path)!==file)throw Error('文章在移动保存期间发生外部变化，请重新定位。');
     const destination=this.plugin.layout.boards[target.id],moved=destination?.nodes.find(n=>n.id===captured.id),moveToken=placed&&moved?this.plugin.rememberArticleMove({file,oldPath,newPath:doc.path,sourceBoard:source.id,targetBoard:target.id,before:captured,after:{...moved},sourceFolder:source.folderPath,targetFolder:target.folderPath,beforeEdges,beforeKnowledge,afterEdges:destination.edges.filter(e=>e.from===captured.id||e.to===captured.id).map(e=>({...e})),afterKnowledge:(destination.knowledgeEdgeStyles||[]).filter(e=>e.from===captured.id||e.to===captured.id).map(e=>({...e}))}):undefined;
     this.plugin.scheduleRefresh();return {oldPath,newPath:doc.path,doc,layout:this.plugin.layout,node:moved?{...moved}:undefined,moveToken,warning:placed?undefined:'文章已移动，本地目录已同步，请在目标文件夹中查看。'};
    }finally{this.movingArticles.delete(oldPath);this.plugin.endArticleMove(file);}
 }
 private async handle(data:{id:string,method:string,payload:any}){
  const reply=(result:any,error?:string)=>this.frame?.contentWindow?.postMessage({kind:'vb-response',channel:this.channel,id:data.id,result:result?.layout?{...result,nativeRevision:this.plugin.nativeSync.revision}:result,error},'*');
  try{const p=data.payload||{};if(this.plugin.componentMutating&&['save-layout','create-note','create-folder','rename-folder','move-folder','move-article','drop-markdown','paste-components','import-markdown','replay-component-insertion','replay-article-move','rename-note','update-note','trash-components','restore-components','redo-trash'].includes(data.method))throw Error('组件正在处理，请稍候。');if(this.plugin.recycle.active&&['save-layout','create-note','create-folder','rename-folder','move-folder','move-article','replay-article-move','rename-note','update-note','import-media','import-image','generate-icon','paste-components','import-markdown','drop-markdown','replay-component-insertion'].includes(data.method))throw Error('回收站正在处理文件，请稍候再修改。');switch(data.method){
   case 'update-info':reply(this.plugin.updateInfo());break;
   case 'check-update':reply(await this.plugin.checkForUpdates(true));break;
   case 'configure-updates':reply(await this.plugin.configureUpdates(p));break;
   case 'ignore-update':reply(await this.plugin.ignoreUpdate(p.version));break;
   case 'open-update':{const url=this.plugin.updateUrl(p.kind);this.contentEl.ownerDocument.defaultView?.open(url,'_blank','noopener,noreferrer');reply({ok:true});break;}
   case 'save-draft':await this.plugin.saveDraft(p);reply({ok:true});break;
   case 'clear-draft':await this.plugin.clearDraft(p);reply({ok:true});break;
   case 'save-layout':if(this.plugin.recycle.active)throw Error('文件正在回收或恢复，请稍后保存布局。');this.plugin.layout=this.plugin.nativeSync.accept(p.layout||p,p.nativeRevision,this.plugin.layout,path=>!!this.plugin.app.vault.getAbstractFileByPath(path));this.plugin.syncFolders();await this.plugin.persist();reply({ok:true});break;
   case 'trash-components':{const result=await this.plugin.recycle.trash(String(p.board||''),Array.isArray(p.ids)?p.ids:[]),snapshot=await this.plugin.snapshot();reply({...result,layout:this.plugin.layout,docs:snapshot.docs,assets:snapshot.assets,mediaAssets:snapshot.mediaAssets});this.notifyOtherRecycleViews(snapshot);this.plugin.scheduleRefresh();break;}
   case 'restore-components':{const result=await this.plugin.recycle.restore(String(p.token||''));this.plugin.rebindRestoredMoves(result.restoredPaths||[]);const snapshot=await this.plugin.snapshot();reply({...result,layout:this.plugin.layout,docs:snapshot.docs,assets:snapshot.assets,mediaAssets:snapshot.mediaAssets});this.notifyOtherRecycleViews(snapshot);this.plugin.scheduleRefresh();break;}
   case 'redo-trash':{const result=await this.plugin.recycle.redo(String(p.token||'')),snapshot=await this.plugin.snapshot();reply({...result,layout:this.plugin.layout,docs:snapshot.docs,assets:snapshot.assets,mediaAssets:snapshot.mediaAssets});this.notifyOtherRecycleViews(snapshot);this.plugin.scheduleRefresh();break;}
   case 'list-trash':reply(await this.plugin.recycle.list());break;
   case 'snapshot':reply(await this.plugin.snapshot());break;
   case 'create-note':{if(this.plugin.layout.boards[p.board]?.folderMissing)throw Error('当前本地文件夹已移动或删除，请先重新定位。');const doc=await this.plugin.vaultBridge.create(String(p.title||''),this.plugin.layout.boards[p.board]?.folderPath??this.plugin.settings.noteFolder);reply(doc);this.plugin.scheduleRefresh();break;}
   case 'create-folder':{const parent=this.plugin.layout.boards[p.parentBoard];if(!parent||parent.folderPath===undefined||parent.folderMissing)throw Error('请先选择已关联的本地文件夹画板。');const path=await this.plugin.folders.create(parent.folderPath,String(p.title||''));this.plugin.syncFolders();const b=findFolderBoard(this.plugin.layout,path)!;const entry=parent.nodes.find(n=>n.board===b.id);if(entry&&p.position&&Number.isFinite(p.position.x)&&Number.isFinite(p.position.y)){entry.x=Math.max(-1e6,Math.min(1e6,p.position.x));entry.y=Math.max(-1e6,Math.min(1e6,p.position.y));}await this.plugin.persist();reply({path,boardId:b.id,layout:this.plugin.layout});this.plugin.scheduleRefresh();break;}
   case 'rename-folder':{const b=this.plugin.layout.boards[p.board];if(!b?.folderPath)throw Error('此画板未关联文件夹，或是知识库根目录。');const oldPath=b.folderPath,path=await this.plugin.folders.rename(oldPath,String(p.title||''));migrateFolderPaths(this.plugin.layout,oldPath,path);this.plugin.syncFolders();await this.plugin.persist();reply({path,boardId:b.id,layout:this.plugin.layout});this.plugin.scheduleRefresh();break;}
   case 'move-folder':{const b=this.plugin.layout.boards[p.board],dest=this.plugin.layout.boards[p.targetBoard];if(!b?.folderPath||dest?.folderPath===undefined||dest.folderMissing)throw Error('请选择有效的本地文件夹画板。');const oldPath=b.folderPath,path=await this.plugin.folders.move(oldPath,dest.folderPath);migrateFolderPaths(this.plugin.layout,oldPath,path);this.plugin.syncFolders();await this.plugin.persist();reply({path,boardId:b.id,layout:this.plugin.layout});this.plugin.scheduleRefresh();break;}
   case 'reveal-entry':this.plugin.explorerRevealDepth++;try{await revealVaultEntry(this.plugin.app,String(p.path||''));reply({ok:true});}finally{this.plugin.explorerRevealDepth--;}break;
   case 'move-article':reply(await this.moveArticle(p));break;
   case 'replay-article-move':reply(await this.plugin.replayArticleMove(p.token,p.direction));break;
   case 'rename-note':{const doc=await this.plugin.vaultBridge.rename(String(p.path||''),String(p.title||''));reply(doc);this.plugin.scheduleRefresh();break;}
   case 'update-note':{const result=await this.plugin.vaultBridge.update(String(p.path),String(p.body),String(p.expectedBody));reply(result);this.plugin.scheduleRefresh();break;}
   case 'open-note':await this.plugin.vaultBridge.open(String(p.path),typeof p.line==='number'?p.line:undefined,p.linktext);reply({ok:true});break;
   case 'import-media':reply(await this.plugin.media.import(p));this.plugin.scheduleRefresh();break;
   case 'media-assets':reply(await this.plugin.media.mediaAssets(Array.isArray(p.paths)?p.paths.slice(0,1000).filter((v:unknown)=>typeof v==='string'):[]));break;
   case 'read-pdf':reply(await this.plugin.media.readPdf(String(p.path||'')));break;
   case 'open-media':await this.plugin.media.open(String(p.path||''));reply({ok:true});break;
   case 'list-media':reply(this.plugin.app.vault.getAllLoadedFiles().filter(f=>f instanceof TFile&&/^(pdf|mp3|wav|m4a|ogg|flac|aac|opus|webm)$/i.test(f.extension)&&!f.path.split('/').some(part=>part.startsWith('.'))).map(f=>({path:f.path,title:(f as TFile).basename,kind:/\.pdf$/i.test(f.path)?'pdf':'audio'})));break;
   case 'open-external':{const url=new URL(String(p.url||''));if(!['http:','https:','mailto:'].includes(url.protocol)||url.username||url.password)throw Error('此链接地址不能打开。');this.contentEl.ownerDocument.defaultView?.open(url.href,'_blank','noopener,noreferrer');reply({ok:true});break;}
   case 'generate-icon':reply(await this.plugin.icons.generate(p));break;
   case 'image-assets':reply(await this.plugin.images.imageAssets(Array.isArray(p.paths)?p.paths.slice(0,1000).filter((v:unknown)=>typeof v==='string'):[]));break;
   case 'read-audio':reply(await this.plugin.media.readAudio(String(p.path||'')));break;
   case 'import-image':reply(await this.plugin.images.import(p));this.plugin.scheduleRefresh();break;
   case 'save-settings':{const old=this.plugin.settings,next=this.plugin.cleanSettings({...old,...p});this.plugin.settings=next;try{await this.plugin.persist();}catch(error){if(this.plugin.settings===next)this.plugin.settings=old;throw error;}reply(this.plugin.settings);if(next.language!==old.language)this.plugin.languageChanged();break;}
   case 'copy-components':{const result=this.plugin.clipboardService().copy(String(p.board||''),Array.isArray(p.ids)?p.ids:[]);await this.contentEl.ownerDocument.defaultView!.navigator.clipboard.writeText(result.clipboard);reply(result);break;}
   case 'paste-components':{const clipboard=typeof p.clipboard==='string'?p.clipboard:await this.contentEl.ownerDocument.defaultView!.navigator.clipboard.readText();const target=this.plugin.layout.boards[p.targetBoard],position=p.position||visibleNodePosition((target?.nodes||[]).map(n=>({x:n.x,y:n.y,w:n.w||480,h:n.h||640})),target?.view||{x:0,y:0,zoom:1},{w:1200,h:600},{w:480,h:640});const result=await this.plugin.componentMutation(()=>this.plugin.clipboardService().paste(clipboard,String(p.targetBoard||''),position));const snapshot=await this.plugin.snapshot();reply({...snapshot,...result,layout:this.plugin.layout});this.notifyOtherRecycleViews(snapshot);this.plugin.scheduleRefresh();break;}
   case 'import-markdown':{const result=await this.plugin.componentMutation(async()=>{const imported=await importMarkdownFiles(this.plugin.app,()=>this.plugin.layout,String(p.targetBoard||''),p.files,p.position);this.plugin.syncFolders();await this.plugin.persist();const createdIds=imported.nodes.map(n=>n.id),undoToken=createdIds.length?this.plugin.clipboardService().rememberInsertion(String(p.targetBoard),createdIds):undefined;return {...imported,createdIds,createdPaths:imported.importedPaths,undoToken};});const snapshot=await this.plugin.snapshot();reply({...snapshot,...result,layout:this.plugin.layout});this.notifyOtherRecycleViews(snapshot);this.plugin.scheduleRefresh();break;}
   case 'drop-markdown':{const result=await this.plugin.componentMutation(async()=>{
    if(!Array.isArray(p.paths)||!p.paths.length||p.paths.length>32)throw Error('请选择知识库中的 Markdown 文件。');
    const target=this.plugin.layout.boards[p.targetBoard];if(!target||target.folderPath===undefined||target.folderMissing)throw Error('请选择有效的目标文件夹。');
    const moveTokens:string[]=[],createdIds:string[]=[],importedPaths:string[]=[],failures:{name:string;error:string}[]=[],geometryChanges:{board:string;id:string;before:any;after:any}[]=[];const seen=new Set<string>();
    for(const raw of p.paths){try{if(typeof raw!=='string'||raw.length>4096)throw Error('文章路径无效。');const safe=safeVaultPath(raw);let file=safe?this.plugin.app.vault.getAbstractFileByPath(safe):null;if(!(file instanceof TFile)&&safe&&!/\.md$/i.test(safe))file=this.plugin.app.vault.getAbstractFileByPath(safe+'.md');if(!(file instanceof TFile)&&safe)file=this.plugin.app.metadataCache.getFirstLinkpathDest(safe,'');if(!(file instanceof TFile)||file.extension.toLowerCase()!=='md'||!safeVaultPath(file.path)||file.path.split('/').some(part=>part.startsWith('.')))throw Error('知识库内找不到此 Markdown 文件。');if(seen.has(file.path))continue;seen.add(file.path);
     this.plugin.syncFolders();const currentTarget=this.plugin.layout.boards[target.id];if(!currentTarget||currentTarget.folderPath!==target.folderPath||currentTarget.folderMissing)throw Error('目标文件夹已改变，请重新拖入。');
     const parent=file.path.slice(0,Math.max(0,file.path.lastIndexOf('/'))),source=Object.values(this.plugin.layout.boards).find(b=>b.folderPath===parent),n=source?.nodes.find(n=>n.doc===file!.path);if(!source||!n)throw Error('文章目录尚未同步，请稍后再试。');
     const pos=p.position&&Number.isFinite(p.position.x)&&Number.isFinite(p.position.y)?{x:p.position.x+createdIds.length*40,y:p.position.y+createdIds.length*40}:undefined;
     if(source.id===target.id){const before={x:n.x,y:n.y,...(n.w?{w:n.w}:{}),...(n.h?{h:n.h}:{})};if(pos){n.x=Math.max(-1e6,Math.min(1e6,Math.round(pos.x/20)*20));n.y=Math.max(-1e6,Math.min(1e6,Math.round(pos.y/20)*20));geometryChanges.push({board:target.id,id:n.id,before,after:{...before,x:n.x,y:n.y}});}createdIds.push(n.id);importedPaths.push(file.path);}
     else{const moved=await this.moveArticle({sourceBoard:source.id,node:n.id,targetBoard:target.id,position:pos});if(moved.moveToken)moveTokens.push(moved.moveToken);if(moved.node)createdIds.push(moved.node.id);importedPaths.push(moved.newPath);}
    }catch(error){failures.push({name:String(raw).slice(0,4096),error:error instanceof Error?error.message:'文件未能移入。'});}}
    await this.plugin.persist();return {createdIds,importedPaths,moveTokens,geometryChanges,failures};
   });const snapshot=await this.plugin.snapshot();reply({...snapshot,...result,layout:this.plugin.layout});this.notifyOtherRecycleViews(snapshot);this.plugin.scheduleRefresh();break;}
   case 'replay-component-insertion':{if(p.direction!=='undo'&&p.direction!=='redo')throw Error('撤销方向无效。');const result=await this.plugin.componentMutation(()=>this.plugin.clipboardService().replay(String(p.token||''),p.direction));const snapshot=await this.plugin.snapshot();reply({...snapshot,...result,layout:this.plugin.layout});this.notifyOtherRecycleViews(snapshot);this.plugin.scheduleRefresh();break;}
   case 'copy-link':{let url:string;if(p.sourceUrl){const source=new URL(p.sourceUrl);if(!['http:','https:'].includes(source.protocol)||source.username||source.password)throw Error('图片来源地址无效。');url=source.href;}else if(p.board){url=`obsidian://visual-board?vault=${encodeURIComponent(this.app.vault.getName())}&board=${encodeURIComponent(p.board)}`;}else{const path=safeVaultPath(p.path);if(!path)throw Error('请选择本地文章或图片。');url=obsidianUrl(this.app.vault.getName(),path);}await this.contentEl.ownerDocument.defaultView!.navigator.clipboard.writeText(url);reply({url});break;}
   default:throw Error('无法识别该操作。');
  }}catch(error){reply(undefined,error instanceof Error?error.message:'操作失败，请重试。');}
 }
}
class BoardSettings extends PluginSettingTab {
 constructor(app:VisualBoardPlugin['app'],private plugin:VisualBoardPlugin){super(app,plugin);}
 display(){const {containerEl}=this,t=(key:string)=>this.plugin.text(key);containerEl.empty();containerEl.createEl('h2',{text:t('Visual Board · 可视化桌面')});
  new Setting(containerEl).setName(t('界面语言')).setDesc(t('切换中文或英文，设置会保存在当前知识库中。')).addDropdown(d=>d.addOption('zh','中文').addOption('en','English').setValue(this.plugin.settings.language).onChange(async value=>{try{await this.plugin.setLanguage(value);this.display();}catch(error){d.setValue(this.plugin.settings.language);new Notice(error instanceof Error?error.message:String(error));}}));
  containerEl.createEl('p',{text:t('删除组件会将对应本地文件或文件夹移入插件回收站；可撤销或从回收站恢复，原有排列保留。便签作为本地布局记录回收。')});
  new Setting(containerEl).setName(t('打开可视化桌面')).addButton(b=>b.setButtonText(t('打开画板')).onClick(()=>void this.plugin.openBoard()));
  const u=(zh:string,en:string)=>this.plugin.settings.language==='en'?en:zh;let repository=this.plugin.settings.updateRepository;
  containerEl.createEl('h3',{text:u('插件更新','Plugin updates')});
  containerEl.createEl('p',{text:u('当前版本：','Installed version: ')+this.plugin.manifest.version});
  new Setting(containerEl).setName(u('GitHub 更新仓库','GitHub release repository')).setDesc(u('填写公开仓库的作者名/仓库名。检查仅访问发布元数据，不发送文章。','Enter the public owner/repository. Checks request release metadata and never send your notes.')).addText(input=>input.setPlaceholder('owner/repository').setValue(repository).onChange(value=>{repository=value;})).addButton(b=>b.setButtonText(u('保存','Save')).onClick(async()=>{try{await this.plugin.configureUpdates({repository,autoCheck:this.plugin.settings.autoCheckUpdates});this.display();}catch(error){new Notice(String(error instanceof Error?error.message:error));}}));
  new Setting(containerEl).setName(u('联网时每天检查一次更新','Check daily when online')).addToggle(toggle=>toggle.setValue(this.plugin.settings.autoCheckUpdates).onChange(async value=>{try{await this.plugin.configureUpdates({repository:this.plugin.settings.updateRepository,autoCheck:value});}catch(error){toggle.setValue(this.plugin.settings.autoCheckUpdates);new Notice(String(error instanceof Error?error.message:error));}}));
  new Setting(containerEl).setName(u('检查新版','Check for a new release')).setDesc(u('发现新版本后打开 GitHub 发布页；安装由你手动完成或交给 Obsidian、BRAT。','Open the GitHub release for updates. Install manually, or use Obsidian or BRAT.')).addButton(b=>b.setButtonText(u('检查更新','Check for updates')).onClick(async()=>{b.setDisabled(true);try{await this.plugin.checkForUpdates(true,true);this.display();}finally{b.setDisabled(false);}})).addButton(b=>b.setButtonText(u('打开发布页','Open release')).setDisabled(!this.plugin.updateInfo().releaseUrl).onClick(()=>{try{window.open(this.plugin.updateUrl('release'),'_blank','noopener,noreferrer');}catch(error){new Notice(String(error instanceof Error?error.message:error));}}));
  new Setting(containerEl).setName(t('新文章保存目录')).setDesc(t('留空保存在知识库根目录。')).addText(t=>t.setValue(this.plugin.settings.noteFolder).onChange(async value=>{if(value&&(!safeVaultPath(value)||value.startsWith('.')))return;this.plugin.settings.noteFolder=value;await this.plugin.persist();}));
  new Setting(containerEl).setName(t('图片附件目录')).addText(t=>t.setValue(this.plugin.settings.attachmentFolder).onChange(async value=>{if(!value||!safeVaultPath(value)||value.split('/').some(p=>p.startsWith('.')))return;this.plugin.settings.attachmentFolder=normalizePath(value);await this.plugin.persist();}));
  new Setting(containerEl).setName(t('默认 Board 图标')).addDropdown(d=>d.addOption('default',t('默认玻璃文件夹 + Lucide')).addOption('ai',t('AI 主题图片')).setValue(this.plugin.settings.defaultIconMode).onChange(async v=>{this.plugin.settings.defaultIconMode=v==='ai'?'ai':'default';await this.plugin.persist();}));
  new Setting(containerEl).setName(t('生图服务')).setDesc(t('选择 APImart 可自动填写服务地址与模型；API Key 在新建 Board 内配置。')).addDropdown(d=>d.addOption('apimart','APImart').addOption('compatible',t('其他兼容服务')).setValue(/^https:\/\/api\.apimart\.ai(?:\/|$)/.test(this.plugin.settings.baseUrl)?'apimart':'compatible').onChange(async v=>{if(v==='apimart'){this.plugin.settings.baseUrl='https://api.apimart.ai/v1';this.plugin.settings.model='gpt-4o-image';await this.plugin.persist();}}));
  containerEl.createEl('p',{text:t('AI 模式在新建 Board 中配置服务地址、模型和本次会话密钥。只发送 Board 名称与配色；文章正文不发送。')});
 }
}
