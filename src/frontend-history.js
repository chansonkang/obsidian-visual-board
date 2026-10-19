/* Geometry is local to each Board; native file/reference moves are reversible across levels. */
(() => {
 const histories=new Map(),moves={past:[],future:[]},LIMIT=100,fields=['x','y','w','h'];let gesturing=false,replaying=false,busy=false,sequence=0;
 const capture=n=>Object.fromEntries(fields.filter(k=>Number.isFinite(n?.[k])).map(k=>[k,n[k]]));
 const same=(a,b)=>fields.every(k=>a[k]===b[k]||Number.isFinite(a[k])&&Number.isFinite(b[k])&&Math.abs(a[k]-b[k])<1e-5);
 function restore(n,value){for(const k of fields){if(Object.hasOwn(value,k))n[k]=value[k];else delete n[k];}}
 function history(id){if(!histories.has(id))histories.set(id,{past:[],future:[]});return histories.get(id);}
 function newAction(){for(const h of histories.values())h.future=[];moves.future=[];return ++sequence;}
 function recordGeometryBatch(boardId,changes){
  const batch=changes.filter(({before,after})=>before&&after&&!same(before,after)&&[before.x,before.y,after.x,after.y].every(Number.isFinite)).map(({id,before,after})=>({id,before:{...before},after:{...after}}));
  if(!batch.length||busy)return;
  const h=history(boardId);h.past.push({kind:'geometry',changes:batch,order:newAction()});
  while(h.past.length>LIMIT||h.past.length>1&&h.past.reduce((sum,entry)=>sum+(entry.changes?.length||1),0)>20000)h.past.shift();
 }
 function recordGeometry(boardId,id,before,after){recordGeometryBatch(boardId,[{id,before,after}]);}
 function recordArticleMove(result){if(typeof result?.moveToken!=='string'||!result.moveToken)return;recordMove({kind:'article-move',token:result.moveToken});}
 function recordMove(command){if(busy)return;moves.past.push({...command,order:newAction()});if(moves.past.length>200)moves.past.shift();}
 function recordReferenceMove(command){recordMove({kind:'reference-move',...command});}
 const photoFields=['id','type','imagePath','sourceUrl','title','x','y','w','h','imageWidth','imageHeight'];
 const samePhoto=(a,b)=>a&&b&&photoFields.every(k=>a[k]===b[k]);
 function recordPhotoChange(boardId,before,after,index){
  if(busy||!after||after.type!=='photo'||before&&before.id!==after.id||before&&samePhoto(before,after))return;
  const h=history(boardId);h.past.push({kind:'photo',board:boardId,id:after.id,before:before?clone(before):null,after:clone(after),index,edges:[],order:newAction()});
  if(h.past.length>LIMIT)h.past.shift();
 }
 function photoChange(command,redo){
  const b=state.boards[command.board];if(!b)return false;
  const expected=redo?command.before:command.after,next=redo?command.after:command.before,n=b.nodes.find(n=>n.id===command.id);
  if(expected?!samePhoto(n,expected):!!n)return false;
  if(!next){
   command.index=b.nodes.indexOf(n);command.edges=b.edges.filter(e=>e.from===n.id||e.to===n.id).map(clone);
   b.nodes=b.nodes.filter(item=>item!==n);b.edges=b.edges.filter(e=>e.from!==n.id&&e.to!==n.id);
   if(selected===n.id)selected=null;
  }else if(n){Object.assign(n,clone(next));for(const k of photoFields)if(!Object.hasOwn(next,k))delete n[k];}
  else{
   b.nodes.splice(Math.min(command.index,b.nodes.length),0,clone(next));
   const ids=new Set(b.nodes.map(n=>n.id));for(const edge of command.edges)if(ids.has(edge.from)&&ids.has(edge.to)&&!b.edges.some(e=>e.id===edge.id))b.edges.push(clone(edge));
   selected=command.id;
  }
  window.VBMultiSelection?.clear();render();void save();return true;
 }
 const baseSave=save;save=function(){return busy?Promise.resolve():baseSave();};
 function focusGesture(){const canvas=$('canvas');canvas.tabIndex=-1;canvas.style.outline='none';canvas.focus({preventScroll:true});}
 async function applyResult(result){
  if(typeof result.oldPath==='string'&&typeof result.newPath==='string'&&result.oldPath!==result.newPath)VBHost.applyRenameReferences({oldPath:result.oldPath,newPath:result.newPath,folder:false,doc:result.doc});
  else if(result.doc)state.docs[result.doc.path]=result.doc;
  const incoming=result.docs||state.docs;state.docs=window.VBInline?VBInline.acceptDocs(incoming):incoming;
  for(const [path,url]of Object.entries(result.assets||{}))VBHost.registerAsset(path,url);
  if(result.mediaAssets&&window.VBMedia)Object.assign(VBMedia.assets,result.mediaAssets);
  await VBHost.acceptLayout(result.layout,true);
  if(selected&&!board().nodes.some(n=>n.id===selected))selected=null;
  window.VBMultiSelection?.clear();window.VBEdgeStyle?.clear();$('preview').innerHTML='';render();focusGesture();
  const restoredPath=result.restoredPaths?.find(path=>typeof path==='string'&&path);if(restoredPath)void VBHost.rpc('reveal-entry',{path:restoredPath}).catch(e=>toast(e.message));
 }
 function reference(command,redo){
  const source=state.boards[redo?command.source:command.target],target=state.boards[redo?command.target:command.source];
  const expected=redo?command.before:command.after,n=source?.nodes.find(n=>n.id===command.id);
  if(!source||!target||!n||!same(capture(n),expected)||target.nodes.some(n=>n.id===command.id)||n.type!==command.type||n.doc!==command.doc||n.imagePath!==command.imagePath||n.filePath!==command.filePath)return false;
  // Restore only this reference's geometry. Current content, file path, and unrelated links stay intact.
  source.nodes=source.nodes.filter(item=>item!==n);restore(n,redo?command.after:command.before);
  target.nodes.splice(Math.min(redo?command.targetIndex:command.sourceIndex,target.nodes.length),0,n);
  if(selected===n.id&&!board().nodes.includes(n))selected=null;window.VBMultiSelection?.clear();render();void save();return true;
 }
 async function apply(redo=false){
  if(busy||gesturing||window.VBConnections?.dragging||window.VBMultiSelection?.dragging||window.VBFolderInteraction?.moving)return false;
  const h=history(board().id),key=redo?'future':'past',other=redo?'past':'future';
  while(h[key].length||moves[key].length){
   const local=h[key].at(-1),global=moves[key].at(-1),rank=c=>redo?c?.undone:c?.order;
   const list=!local?moves:!global?h:rank(global)>rank(local)?moves:h,command=list[key].at(-1);
   if(command.kind==='photo'){
    if(!photoChange(command,redo)){list[key].pop();continue;}
    list[key].pop();command.undone=++sequence;list[other].push(command);return true;
   }
   if(command.kind==='geometry'){
    const b=board(),nodes=command.changes.map(change=>b.nodes.find(n=>n.id===change.id));
    if(command.changes.some((change,i)=>!nodes[i]||!same(capture(nodes[i]),redo?change.before:change.after))){list[key].pop();continue;}
    command.changes.forEach((change,i)=>restore(nodes[i],redo?change.after:change.before));
    list[key].pop();command.undone=++sequence;list[other].push(command);render();void save();return true;
   }
   if(command.kind==='reference-move'){
    if(!reference(command,redo)){list[key].pop();continue;}
    list[key].pop();command.undone=++sequence;list[other].push(command);return true;
   }
   // A failed native replay remains available, so a naming conflict never discards the user's undo.
   busy=true;document.body.classList.add('vb-moving-article');
   try{
    if(window.VBInline&&!(await VBInline.flushAll()))throw Error('请先处理文章保存冲突，再撤销组件操作。');
    await baseSave();replaying=true;
    const result=command.kind==='insertion'?await VBHost.rpc('replay-component-insertion',{token:command.token,direction:redo?'redo':'undo'}):command.kind==='trash'?await VBHost.rpc((redo?command.restored:!command.restored)?'restore-components':'redo-trash',{token:command.token}):await VBHost.rpc('replay-article-move',{token:command.token,direction:redo?'redo':'undo'});
    await applyResult(result);list[key].pop();command.undone=++sequence;list[other].push(command);return true;
   }catch(e){toast(e.message);return false;}finally{replaying=false;busy=false;document.body.classList.remove('vb-moving-article');}
  }
  return false;
 }
 async function nativeAction(method,payload){
  if(busy||gesturing||window.VBConnections?.dragging||window.VBMultiSelection?.dragging||window.VBFolderInteraction?.moving)return false;
  busy=true;document.body.classList.add('vb-moving-article');
  try{
   if(window.VBMedia)await VBMedia.flushPlayback();
   if(window.VBInline&&!(await VBInline.flushAll()))throw Error('请先处理文章草稿保存提示。');
   await baseSave();replaying=true;
   const result=await VBHost.rpc(method,payload);await applyResult(result);
   if(typeof result.undoToken==='string'){moves.past.push({kind:'insertion',token:result.undoToken,order:newAction()});if(moves.past.length>200)moves.past.shift();}
   for(const token of result.moveTokens||[])moves.past.push({kind:'article-move',token,order:newAction()});
   for(const change of result.geometryChanges||[]){const h=history(change.board);h.past.push({kind:'geometry',changes:[{id:change.id,before:change.before,after:change.after}],order:newAction()});if(h.past.length>LIMIT)h.past.shift();}
   if(moves.past.length>200)moves.past.splice(0,moves.past.length-200);

   if(typeof result.trashToken==='string'){
    for(const key of ['past','future'])moves[key]=moves[key].filter(c=>c.kind!=='trash'||c.token!==result.trashToken);
    moves.past.push({kind:'trash',token:result.trashToken,restored:method==='restore-components',order:newAction()});if(moves.past.length>200)moves.past.shift();
   }
   return result;
  }catch(e){toast(e.message);return false;}finally{replaying=false;busy=false;document.body.classList.remove('vb-moving-article');}
 }
 window.VBHistory={capture,recordGeometry,recordGeometryBatch,recordArticleMove,recordReferenceMove,recordPhotoChange,nativeAction,undo:()=>apply(),redo:()=>apply(true),
  beginGesture(){gesturing=true;},endGesture(){gesturing=false;},focusGesture,
  get gesturing(){return gesturing;},get replaying(){return busy;},
  get counts(){const h=history(board().id);return {undo:h.past.length+moves.past.length,redo:h.future.length+moves.future.length};},
 };
 window.addEventListener('pointerdown',e=>{if(busy&&e.target.closest?.('#nodes>.node,#multiselect-panel,#connection-controls')){e.preventDefault();e.stopImmediatePropagation();}},true);
 window.addEventListener('keydown',e=>{
  const key=e.key.toLowerCase(),modifier=e.ctrlKey||e.metaKey,undo=modifier&&key==='z'&&!e.shiftKey,redo=modifier&&(key==='y'||key==='z'&&e.shiftKey);
  if(!undo&&!redo||e.altKey||e.isComposing||e.keyCode===229||$('modal-root').childElementCount)return;
  if(e.target.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]'))return;
  e.preventDefault();e.stopImmediatePropagation();void apply(redo).then(ok=>{if(ok)toast(redo?'已重做组件操作':'已撤销组件操作');});
 },true);
})();
