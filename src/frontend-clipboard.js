/* Component clipboard uses native file copies; text editing keeps its own clipboard. */
(() => {
 let busy=false,pointer=null,pasteCount=0,lastPastePoint='',dropTarget=null;
 const tokenPattern=/^vb-components:v1:[a-z0-9-]+$/i;
 const t=(zh,en)=>window.VBI18n?.language==='en'?en:zh;
 const svg=path=>'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+path+'"/></svg>';
 const icons={copy:svg('M8 8h12v12H8zM4 16V4h12'),paste:svg('M9 5H5v16h14V5h-4M9 3h6v4H9zM9 12h6M9 16h6')};
 function protectedTarget(target){return !!target?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"],#modal-root,#preview');}
 function hasTextSelection(){const selection=getSelection();return !!selection&&!selection.isCollapsed&&!!selection.toString();}
 function sceneTarget(target){return target===document.body||target===document.documentElement||!!$('scene').contains(target);}
 function selectedIds(){const ids=window.VBMultiSelection?.ids||[];return [...new Set((ids.length?ids:selected?[selected]:[]).filter(id=>board().nodes.some(n=>n.id===id)))];}
 function blocked(){return busy||window.VBHistory?.replaying||window.VBFolderInteraction?.moving||window.VBMultiSelection?.dragging||window.VBConnections?.dragging||$('modal-root').childElementCount;}
 function canvasPoint(x,y){
  const rect=$('canvas').getBoundingClientRect(),view=board().view,scale=sceneScale*view.zoom;
  if(!Number.isFinite(scale)||scale<=0||x<rect.left||x>=rect.right||y<rect.top||y>=rect.bottom)return null;
  return {x:Math.round((((x-rect.left)/sceneScale-view.x)/view.zoom)/20)*20,y:Math.round((((y-rect.top)/sceneScale-view.y)/view.zoom)/20)*20};
 }
 function placement(){
  const rect=$('canvas').getBoundingClientRect();
  const point=pointer?.board===board().id?canvasPoint(pointer.x,pointer.y):null;
  const center=point||canvasPoint(rect.left+rect.width/2,rect.top+rect.height/2)||{x:80,y:80};
  const key=board().id+':'+center.x+':'+center.y;if(key!==lastPastePoint){lastPastePoint=key;pasteCount=0;}
  const offset=20*(pasteCount++%10);return {x:center.x+offset,y:center.y+offset};
 }
 function makeButton(kind){const button=document.createElement('button');button.className='vb-component-clipboard';button.dataset.componentClipboard=kind;button.dataset.testid='component-'+kind;button.innerHTML=icons[kind];return button;}
 function labelButtons(){for(const button of document.querySelectorAll('[data-component-clipboard]')){const copy=button.dataset.componentClipboard==='copy';const label=copy?t('复制组件','Copy components'):t('粘贴组件','Paste components');button.title=label+(copy?' · ⌘/Ctrl+C':' · ⌘/Ctrl+V');button.setAttribute('aria-label',label);button.disabled=busy;}}
 const baseSelection=renderSelection;renderSelection=function(){baseSelection();const bar=$('selection-bar');if(selectedIds().length){const end=bar.lastElementChild;bar.insertBefore(makeButton('copy'),end);bar.insertBefore(makeButton('paste'),end);}labelButtons();};
 const pasteButton=makeButton('paste');pasteButton.dataset.testid='canvas-paste-components';$('scene').querySelector('.bottom-toolbar').append(pasteButton);labelButtons();
 window.addEventListener('vb-language-change',labelButtons);
 async function copy(){
  const ids=selectedIds(),sourceBoard=board().id;if(!ids.length||blocked())return false;busy=true;labelButtons();
  try{if(window.VBInline&&!(await VBInline.flushAll()))throw Error(t('请先处理文章草稿保存提示。','Resolve the note draft before copying components.'));if(window.VBMedia)await VBMedia.flushPlayback();await save();const result=await VBHost.rpc('copy-components',{board:sourceBoard,ids});if(!tokenPattern.test(result.clipboard||''))throw Error(t('组件复制失败，请重试。','Could not copy components. Try again.'));toast(t('组件已复制，可粘贴到画板或文件夹层级。','Components copied. Paste them into a Board or folder.'));return result.clipboard;}
  catch(error){toast(error.message);return false;}finally{busy=false;labelButtons();}
 }
 async function mutate(method,payload){
  if(blocked())return false;busy=true;labelButtons();const origin=board().id;
  try{
   const result=await window.VBHistory.nativeAction(method,payload);if(!result)return false;
   const created=result.createdIds||result.nodes?.map(n=>n.id)||[];
   if(board().id===origin&&board().id===payload.targetBoard&&created.length){const id=[...created].reverse().find(id=>board().nodes.some(n=>n.id===id));if(id)select(id);}
   if(result.failures?.length){const failure=result.failures[0],message=window.VBI18n?.t(failure.error)||failure.error;toast(t('未完成 '+result.failures.length+' 个文件：','Could not finish '+result.failures.length+' file(s): ')+(failure.name||'')+' · '+message+(failure.path?t('；已保存：','; saved at: ')+failure.path:''));}
   else toast(method==='paste-components'?t('组件已粘贴，可按 Command/Ctrl+Z 撤销。','Components pasted. Use Command/Ctrl+Z to undo.'):t('Markdown 已放入对应的本地目录。','Markdown files added to the matching local folder.'));
   return result;
  }finally{busy=false;labelButtons();}
 }
 function paste(clipboard){if(clipboard&&!tokenPattern.test(clipboard.trim()))return Promise.resolve(false);return mutate('paste-components',{targetBoard:board().id,position:placement(),...(clipboard?{clipboard:clipboard.trim()}:{})});}
 window.addEventListener('keydown',event=>{
  if(!(event.metaKey||event.ctrlKey)||event.altKey||event.shiftKey||event.isComposing||protectedTarget(event.target)||hasTextSelection()||!sceneTarget(event.target)||blocked())return;
  const key=event.key.toLowerCase();if(key==='c'&&selectedIds().length){event.preventDefault();event.stopImmediatePropagation();void copy();}
 },true);
 window.addEventListener('copy',event=>{if(protectedTarget(event.target)||hasTextSelection()||!sceneTarget(event.target)||blocked()||!selectedIds().length)return;event.preventDefault();event.stopImmediatePropagation();void copy();},true);
 window.addEventListener('paste',event=>{if(protectedTarget(event.target)||hasTextSelection()||!sceneTarget(event.target)||blocked())return;const text=event.clipboardData?.getData('text/plain')?.trim();if(!tokenPattern.test(text||''))return;event.preventDefault();event.stopImmediatePropagation();void paste(text);},true);
 window.addEventListener('click',event=>{const control=event.target.closest?.('[data-component-clipboard]');if(!control)return;event.preventDefault();event.stopImmediatePropagation();if(control.dataset.componentClipboard==='copy')void copy();else void paste();},true);
 window.addEventListener('pointermove',event=>{if(!protectedTarget(event.target)&&$('canvas').contains(event.target)&&!event.target.closest('.bottom-toolbar,#selection-bar,.header,.header-right,.top-left,.heading,#popover,.zoom-controls'))pointer={x:event.clientX,y:event.clientY,board:board().id};},true);
 function parsePaths(transfer){
  const values=[];for(const type of ['application/obsidian','text/obsidian','text/plain','text/uri-list']){let text='';try{text=transfer?.getData(type)||'';}catch{}if(text)values.push(text);}
  const result=[];const add=value=>{if(typeof value!=='string')return;let path=value.trim();try{path=decodeURIComponent(path);}catch{}path=path.replace(/\\/g,'/').replace(/^\.\//,'').split('#')[0];if(path&&!/^https?:\/\//i.test(path)&&!/^file:\/\//i.test(path)&&!path.includes('\n')&&!path.includes('\0'))result.push(path);};
  function json(value){if(!value)return;if(Array.isArray(value)){value.forEach(json);return;}if(typeof value==='object'){if(value.path)add(value.path);if(value.file)json(value.file);if(value.files)json(value.files);}else if(typeof value==='string'&&/\.md(?:$|#)/i.test(value))add(value);}
  for(const text of values){try{json(JSON.parse(text));}catch{}for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('#'))continue;
   if(/^obsidian:\/\//i.test(line)){try{const url=new URL(line),file=url.searchParams.get('file');if(file)add(file);}catch{}continue;}
   const wiki=[...line.matchAll(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)];if(wiki.length){for(const match of wiki)add(match[1]);continue;}
   const links=[...line.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^ )]+))(?:\s+"[^"]*")?\)/g)];if(links.length){for(const match of links)if(/\.md(?:$|#)/i.test(match[1]||match[2]))add(match[1]||match[2]);continue;}
   if(/\.md(?:$|#)/i.test(line))add(line);
  }}return [...new Set(result)];
 }
 function handlesDrop(event){if(protectedTarget(event.target)||!$('canvas').contains(event.target)||$('modal-root').childElementCount)return false;const transfer=event.dataTransfer;if(!transfer)return false;const files=[...transfer.files||[]];if(files.some(file=>/\.(md|markdown)$/i.test(file.name)))return true;if(parsePaths(transfer).length)return true;return event.type==='dragover'&&[...transfer.items||[]].some(item=>item.kind==='file'&&(/markdown/i.test(item.type)||!item.type));}
 function clearDrop(){dropTarget?.classList.remove('vb-markdown-drop-target');dropTarget=null;$('scene').classList.remove('vb-markdown-dropping');}
 function targetFor(event){const card=event.target.closest?.('#nodes>.node');const n=card&&board().nodes.find(n=>n.id===card.dataset.node);return n?.type==='board'&&state.boards[n.board]?{board:n.board,card,invalid:!!state.boards[n.board].folderMissing}:{board:board().id,card:null};}
 window.addEventListener('dragover',event=>{if(!handlesDrop(event)){clearDrop();return;}event.preventDefault();event.stopImmediatePropagation();event.dataTransfer.dropEffect='copy';const target=targetFor(event);if(target.invalid){clearDrop();event.dataTransfer.dropEffect='none';return;}if(target.card!==dropTarget){clearDrop();dropTarget=target.card;dropTarget?.classList.add('vb-markdown-drop-target');}$('scene').classList.add('vb-markdown-dropping');},true);
 window.addEventListener('dragleave',event=>{if(!event.relatedTarget||!$('canvas').contains(event.relatedTarget))clearDrop();},true);
 window.addEventListener('drop',event=>{
  if(!handlesDrop(event))return;event.preventDefault();event.stopImmediatePropagation();const target=targetFor(event),point=target.card?undefined:canvasPoint(event.clientX,event.clientY),files=[...event.dataTransfer.files||[]].filter(file=>/\.(md|markdown)$/i.test(file.name)),paths=parsePaths(event.dataTransfer);clearDrop();if(target.invalid){toast(t('本地文件夹已删除，请先恢复或关联文件夹。','The local folder is missing. Restore or link it first.'));return;}
  void(async()=>{if(blocked())return;const payload={targetBoard:target.board,...(point?{position:point}:{})};if(files.length){if(files.length>32||files.reduce((sum,file)=>sum+file.size,0)>40*1024*1024)throw Error(t('一次最多导入 32 个 Markdown 文件，总大小不能超过 40 MiB。','Import up to 32 Markdown files at a time, totaling at most 40 MiB.'));const entries=[];for(const file of files)entries.push({name:file.name,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))});await mutate('import-markdown',{...payload,files:entries});}else if(paths.length)await mutate('drop-markdown',{...payload,paths});})().catch(error=>toast(error.message));
 },true);
 window.addEventListener('blur',clearDrop);const baseNavigate=navigate;navigate=function(id){clearDrop();pointer=null;return baseNavigate(id);};
 window.VBClipboard={copy,paste,handlesDrop,parsePaths};renderSelection();
})();
