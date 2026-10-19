/* Folder Boards share the Vault hierarchy; ordinary card references stay local. */
(() => {
 const rpc=(method,payload)=>window.VBHost.rpc(method,payload);
 const rect=n=>{const el=[...$('nodes').children].find(e=>e.dataset.node===n.id);return{x:n.x,y:n.y,w:n.w||el?.offsetWidth||(n.type==='board'?300:480),h:n.h||el?.offsetHeight||(n.type==='board'?303:640)};};
 addPosition=function(type='article',dimensions){
  const b=board(),size=type==='board'?{w:300,h:303}:type==='note'?{w:240,h:280}:type==='photo'?(dimensions?.w&&dimensions?.h?{w:dimensions.w,h:dimensions.h}:{w:320,h:240}):type==='audio'?{w:500,h:180}:type==='pdf'?{w:360,h:520}:{w:480,h:640};
  const current=b.nodes.find(n=>n.id===selected),r=current&&rect(current);
  const visible=r&&b.view.x+(r.x+r.w)*b.view.zoom>0&&b.view.x+r.x*b.view.zoom<$('canvas').clientWidth&&b.view.y+(r.y+r.h)*b.view.zoom>0&&b.view.y+r.y*b.view.zoom<$('canvas').clientHeight-125;
  return VBPlacement.visibleNodePosition(b.nodes.map(rect),b.view,{w:$('canvas').clientWidth,h:Math.max(160,$('canvas').clientHeight-125)},size,visible?r:undefined);
 };
 // Newly inserted content is already visible. Never pan away from the article being read.
 revealInBoard=function(){};
 function mappedParent(){let b=board();while(b.folderPath===undefined&&b.parent)b=state.boards[b.parent];return b;}
 const baseDialog=openBoardDialog;
 openBoardDialog=function(id=null){baseDialog(id);const b=id?state.boards[id]:mappedParent();if(!$('new-board-title'))return;
  const intro=document.querySelector('.board-intro');if(intro&&b.folderPath!==undefined)intro.textContent=id?'名称与本地文件夹同步，图标可单独设置。':'在「'+(b.folderPath||'知识库根目录')+'」创建或关联文件夹，入口放在当前视野附近。';
 };
 function acceptMutation(result){if(result.layout)window.VBHost.acceptLayout(result.layout,true);}
 const baseCreate=createBoard;let creating=false;
 createBoard=async function(){
  const parent=mappedParent(),target=renameTarget&&state.boards[renameTarget];
  if((target?target.folderPath:parent.folderPath)===undefined)return baseCreate();
  if(creating)return;const title=$('new-board-title')?.value.trim();if(!title)return toast('请填写画板名称');
  const keepExisting=!!(target&&target.iconMode===iconMode&&target.iconUrl);
  const cached=iconMode==='ai'&&previewIcon.status==='generated'&&previewIcon.title===title?clone(previewIcon):null;
  if(iconMode==='ai'&&!hasAIConfig()&&!cached&&!keepExisting){previewIcon={status:'failed',error:'尚未配置图像服务。可以配置后生成，或用默认图标继续。'};renderIconPreview();return;}
  if(iconMode==='ai'&&previewIcon.status==='generating')return toast('预览图片正在生成，请稍候');
  const config={theme:chosenTheme,folderColor:window.VBFolderStyle?.color||'lavender',iconMode,iconId:chosenIcon||matchIcon(title),iconManual:manualIcon},current=board().id,camera={...board().view},position=addPosition('board'),dialog=$('new-board-title');
  creating=true;dialog.disabled=true;const submit=document.querySelector('[data-action="create-board"]');if(submit)submit.disabled=true;
  try{
   if(!(await VBInline.flushAll()))throw Error('请先处理文章草稿保存提示。');await save();
   const result=await rpc(target?'rename-folder':'create-folder',target?{board:target.id,title}:{parentBoard:parent.id,title,position});
   acceptMutation(result);const sub=state.boards[result.boardId];if(!sub)throw Error('文件夹已保存，请刷新画板目录。');
   Object.assign(sub,config);if(!keepExisting){delete sub.iconUrl;delete sub.iconPath;sub.iconStatus='default';}
   if(cached){sub.iconUrl=cached.url;sub.iconStatus='generated';sub.iconModel=cached.model;}
   const generate=config.iconMode==='ai'&&!cached&&!keepExisting;if(generate)sub.iconStatus='generating';
   if(state.currentBoard===current&&state.boards[current])board().view=camera;
   if(!target&&state.currentBoard===current){const entrance=board().nodes.find(n=>n.board===sub.id);if(entrance){Object.assign(entrance,position);selected=entrance.id;}}
   if($('new-board-title')===dialog)closeModal(true);await save();render();toast(target?'名称与本地文件夹已同步':'文件夹已关联，当前文章位置保持');
   if(generate)requestIcon(sub.title).then(result=>{const b=state.boards[sub.id];if(!b||b.title!==title)return;b.iconUrl=result.url;b.iconStatus='generated';b.iconModel=result.model;save();render();}).catch(error=>{const b=state.boards[sub.id];if(b){b.iconStatus='failed';save();render();}toast('图标生成失败：'+error.message);});
  }catch(error){toast(error.message);}finally{creating=false;if(dialog.isConnected)dialog.disabled=false;if(submit?.isConnected)submit.disabled=false;}
 };
 const baseMoveNode=moveNode;let moving=false;
 async function moveMappedBoard(b,dest){
  if(moving)return;moving=true;const camera={...board().view};
  try{if(!(await VBInline.flushAll()))throw Error('请先处理文章草稿保存提示。');await save();const result=await rpc('move-folder',{board:b.id,targetBoard:dest});acceptMutation(result);board().view=camera;selected=null;await save();render();toast('本地文件夹与画板层级已同步');}
  catch(e){toast(e.message);}finally{moving=false;}
 }
 moveNode=function(n,dest){const b=n?.board&&state.boards[n.board];if(b?.folderPath!==undefined){void moveMappedBoard(b,dest);return false;}return baseMoveNode(n,dest);};
 const baseRestore=restore;restore=function(id){const b=state.boards[id];if(b?.folderPath===undefined)return baseRestore(id);const parent=state.boards[b.parent]||state.boards.home;parent.hiddenFolderBoards=(parent.hiddenFolderBoards||[]).filter(x=>x!==id);if(!parent.nodes.some(n=>n.board===id)){const pos=parent.id===board().id?addPosition('board'):VBPlacement.visibleNodePosition(parent.nodes.map(n=>({x:n.x,y:n.y,w:n.w||300,h:n.h||303})),parent.view,{w:1200,h:600},{w:300,h:303});parent.nodes.push({id:newId('folder'),type:'board',board:id,folderManaged:true,...pos});}save();render();$('popover').innerHTML='';tree();};
 const baseRemove=remove;remove=function(){const n=node();if(n?.folderManaged){if(n.board)board().hiddenFolderBoards=[...new Set([...(board().hiddenFolderBoards||[]),n.board])];if(n.doc)board().hiddenFolderDocs=[...new Set([...(board().hiddenFolderDocs||[]),n.doc])];}baseRemove();};
 const baseAddDoc=addDoc;addDoc=function(id){if(board().hiddenFolderDocs)board().hiddenFolderDocs=board().hiddenFolderDocs.filter(path=>path!==id);baseAddDoc(id);};
 const baseMoveDialog=moveDialog;
 moveDialog=function(){
  const n=node(),b=n?.board&&state.boards[n.board];if(!b||b.folderPath===undefined)return baseMoveDialog();
  const options=Object.values(state.boards).filter(t=>t.folderPath!==undefined&&!t.folderMissing&&t.id!==b.id&&!descendant(t.id,b.id));
  setModal('移动本地文件夹',`<p>移动「${esc(b.folderPath)}」及其文章、子文件夹。链接随 Obsidian 原生移动更新。</p><select id="move-target" aria-label="目标文件夹">${options.map(t=>`<option value="${esc(t.id)}">${esc(t.folderPath||'知识库根目录')}</option>`).join('')}</select><div class="modal-foot"><button class="btn primary" data-action="confirm-move" data-testid="move-folder-confirm">移动文件夹</button></div>`);
 };
 const baseAction=action;
 action=function(a){
  if(a==='confirm-move'){
   const n=node(),b=n?.board&&state.boards[n.board];if(b?.folderPath!==undefined){const dest=$('move-target')?.value;if(!dest)return;
    const view={...board().view};void VBInline.flushAll().then(async ok=>{if(!ok)throw Error('请先处理文章草稿保存提示。');await save();const result=await rpc('move-folder',{board:b.id,targetBoard:dest});acceptMutation(result);board().view=view;selected=null;closeModal(true);await save();render();toast('本地文件夹与画板层级已同步');}).catch(e=>toast(e.message));return;
   }
  }
  if(a==='arrange-board'){arrange();return;}
  baseAction(a);
 };
 function contents(){
  return `<div class="board-contents"><h3>当前画板内容 · ${board().nodes.length}</h3>${board().nodes.map(n=>`<button data-locate-node="${esc(n.id)}" data-testid="locate-node-${esc(n.id)}">${esc(n.board?state.boards[n.board]?.title||'文件夹':n.doc?state.docs[n.doc]?.title||n.doc:n.title||'图片')}</button>`).join('')}<button class="btn" data-action="arrange-board" data-testid="arrange-board">整理到一起</button></div>`;
 }
 const baseTree=tree;tree=function(){baseTree();const el=$('popover').querySelector('.popover');if(!el)return;
  el.querySelector('h2').textContent='本地文件夹与画板';el.insertAdjacentHTML('beforeend',contents());
 };
 function arrange(){
  const b=board();if(!b.nodes.length)return;const viewport={w:$('canvas').clientWidth,h:Math.max(160,$('canvas').clientHeight-125)},start={x:Math.round(-b.view.x/b.view.zoom/20)*20,y:Math.round(-b.view.y/b.view.zoom/20)*20};
  const rowWidth=Math.max(600,viewport.w/b.view.zoom-80);let x=0,y=0,height=0;
  for(const n of b.nodes){const r=rect(n);if(x&&x+r.w>rowWidth){x=0;y+=Math.ceil((height+60)/20)*20;height=0;}n.x=start.x+x;n.y=start.y+y;x+=Math.ceil((r.w+60)/20)*20;height=Math.max(height,r.h);}
  $('popover').innerHTML='';save();render();window.VBHost.centerBoardContents();toast('内容已整理到一起');
 }
 document.addEventListener('click',e=>{const el=e.target.closest('[data-locate-node]');if(!el)return;e.stopImmediatePropagation();select(el.dataset.locateNode);$('popover').innerHTML='';window.VBHost.centerBoardContents(el.dataset.locateNode);},true);
 const baseRender=render;render=function(){baseRender();
  for(const n of board().nodes){if(!n.board)continue;const b=state.boards[n.board],el=[...$('nodes').children].find(e=>e.dataset.node===n.id);if(!b||!el)continue;
   const info=document.createElement('div');info.className='folder-source';info.textContent=b.folderPath===undefined?'自由画板':b.folderMissing?'文件夹已移走或删除':b.folderPath||'知识库根目录';info.title=info.textContent;el.append(info);
  }
  const parent=board(),h=$('board-title');h.title=parent.folderPath===undefined?'自由画板':parent.folderPath||'知识库根目录';
 };
 render();
})();
