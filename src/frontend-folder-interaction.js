/* Select real Vault entries and drop article cards into their mapped directories. */
(() => {
 const rpc=(method,payload)=>window.VBHost.rpc(method,payload);
 let lastReveal='',revealTimer,gesture=null,moving=false;
 window.VBFolderInteraction={revealNow,get moving(){return moving||!!window.VBHistory?.replaying;}};
 const hint=document.createElement('div');hint.className='vb-folder-drop-hint';hint.hidden=true;hint.setAttribute('role','status');document.body.append(hint);
 function revealNow(path){clearTimeout(revealTimer);lastReveal=path;return rpc('reveal-entry',{path}).catch(error=>{if(lastReveal===path)lastReveal='';throw error;});}
 function reveal(path){clearTimeout(revealTimer);if(!path||path===lastReveal)return;revealTimer=setTimeout(()=>{void revealNow(path).catch(error=>toast(error.message));},70);}
 const baseSelect=select;
 select=function(id){baseSelect(id);if(mode==='connect')return;const n=board().nodes.find(n=>n.id===id);if(n?.doc)reveal(n.doc);else if(n?.imagePath)reveal(n.imagePath);else if(n?.board)reveal(state.boards[n.board]?.folderPath);};
 const baseNavigate=navigate;navigate=function(id){baseNavigate(id);reveal(state.boards[id]?.folderPath);};
 function decorate(){for(const card of document.querySelectorAll('#nodes>.paper')){if(card.querySelector('[data-drag-card]'))continue;const button=document.createElement('button');button.className='vb-card-drag-handle';button.dataset.dragCard=card.dataset.node;button.dataset.testid='drag-'+card.dataset.node;button.setAttribute('aria-label','拖动文章，放入文件夹');button.title='拖动卡片；放到文件夹图标上即可移入';button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="4" stroke-linecap="round"/></svg>';card.querySelector('.node-actions')?.prepend(button);}}
 const baseRender=render;render=function(){baseRender();decorate();};
 window.addEventListener('click',e=>{if(window.VBMultiSelection?.blocksClick?.(e)){e.preventDefault();e.stopImmediatePropagation();return;}const handle=e.target.closest?.('[data-drag-card]');if(handle){e.stopImmediatePropagation();if(!suppressClick)select(handle.dataset.dragCard);}},true);
 window.addEventListener('pointerdown',e=>{
  gesture=null;hint.hidden=true;if(e.button!==0||moving||window.VBHistory?.replaying||mode==='connect'||e.target.closest?.('#modal-root,#preview,#selection-bar,[data-resize],.vb-inline-editor,.vb-inline-title,.vb-inline-status'))return;
  const card=e.target.closest?.('#nodes>.node');if(!card||e.target.closest('button')&&!e.target.closest('[data-drag-card]'))return;
  const n=board().nodes.find(n=>n.id===card.dataset.node);
  gesture={id:card.dataset.node,board:board().id,before:window.VBHistory?.capture(n),pointer:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};
 },true);
 window.addEventListener('pointermove',e=>{if(!gesture||gesture.pointer!==e.pointerId)return;gesture.x=e.clientX;gesture.y=e.clientY;if(!gesture.moved&&Math.abs(e.clientX-gesture.startX)+Math.abs(e.clientY-gesture.startY)>5){gesture.moved=true;const n=board().nodes.find(n=>n.id===gesture.id);if(n?.doc)reveal(n.doc);}},true);
 window.addEventListener('pointerup',e=>{if(gesture?.pointer!==e.pointerId)return;gesture.x=e.clientX;gesture.y=e.clientY;hint.hidden=true;setTimeout(()=>{gesture=null;},0);},true);
 window.addEventListener('pointercancel',()=>{gesture=null;hint.hidden=true;},true);
 const baseDrop=dropTarget;
 dropTarget=function(n){
  if(n.type!=='article'||!gesture||gesture.id!==n.id||!gesture.moved)return baseDrop(n);
  let target;for(const t of [...board().nodes].reverse()){
   if(t.type!=='board'||t.id===n.id||!state.boards[t.board]||state.boards[t.board].folderMissing)continue;
   const el=[...$('nodes').children].find(el=>el.dataset.node===t.id)?.querySelector('.folder-art');if(!el)continue;const r=el.getBoundingClientRect();
   if(gesture.x>=r.left&&gesture.x<=r.right&&gesture.y>=r.top&&gesture.y<=r.bottom){target=t;break;}
  }
  hint.hidden=!target;if(target){hint.textContent='松开放入「'+state.boards[target.board].title+'」';hint.style.left=Math.max(8,Math.min(innerWidth-230,gesture.x+16))+'px';hint.style.top=Math.max(8,Math.min(innerHeight-50,gesture.y+16))+'px';}return target;
 };
 const baseMove=moveNode;
 moveNode=function(n,dest){
  const target=state.boards[dest];
  if(n?.type!=='article'||target?.folderPath===undefined){
   const source=board(),index=source.nodes.indexOf(n),before=gesture?.id===n?.id&&gesture.board===source.id?gesture.before:window.VBHistory?.capture(n);
   const done=baseMove(n,dest);
   if(done&&n&&n.type!=='board'&&before&&target?.nodes.includes(n))window.VBHistory?.recordReferenceMove({id:n.id,type:n.type,doc:n.doc,imagePath:n.imagePath,filePath:n.filePath,source:source.id,target:target.id,sourceIndex:index,targetIndex:target.nodes.indexOf(n),before,after:window.VBHistory.capture(n)});
   return done;
  }
  if(moving||window.VBHistory?.replaying){toast('文章正在移动，请稍候');return false;}if(target.folderMissing){toast('目标文件夹已移动或删除');return false;}
  moving=true;document.body.classList.add('vb-moving-article');const sourceBoard=board().id,id=n.id;
  // Geometry restores the source position synchronously before this transaction begins.
  Promise.resolve().then(async()=>{
   try{
    if(!(await VBInline.flushAll()))throw Error('请先处理文章保存冲突，再移动。');await save();
    const result=await rpc('move-article',{sourceBoard,node:id,targetBoard:dest});
    if(result.oldPath!==result.newPath)window.VBHost.applyRenameReferences({oldPath:result.oldPath,newPath:result.newPath,folder:false,doc:result.doc});
    else if(result.doc)state.docs[result.doc.path]=result.doc;
    state.docs=VBInline.acceptDocs(state.docs);window.VBHost.acceptLayout(result.layout,true);
    if(state.currentBoard===sourceBoard&&selected===id)selected=null;
    window.VBHistory?.recordArticleMove(result);window.VBHistory?.focusGesture();
    render();reveal(result.newPath);toast(result.warning||'文章已移入「'+target.title+'」');
   }catch(e){render();toast(e.message);}finally{moving=false;document.body.classList.remove('vb-moving-article');hint.hidden=true;}
  });return false;
 };
 render();
})();
