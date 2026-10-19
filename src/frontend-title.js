/* Card titles rename the real Markdown file through Obsidian's FileManager. */
(() => {
 const edits=new Map();let rendering=false;
 const flushBodies=window.VBInline.flushAll;
 const activeTitle=()=>document.activeElement?.closest?.('.vb-inline-title');
 const key=el=>el.dataset.titleNode;
 function entry(el){
  const id=key(el),doc=state.docs[el.dataset.titlePath];if(!doc||doc.missing)return;
  if(!edits.has(id))edits.set(id,{id,path:doc.path,value:doc.title,original:doc.title,focused:false,composing:false,pending:null,error:null});
  return edits.get(id);
 }
 function status(d){
  const card=[...document.querySelectorAll('#nodes > .paper')].find(el=>el.dataset.node===d.id);if(!card)return;
  let el=card.querySelector('.vb-title-status');
  if(!el){el=document.createElement('div');el.className='vb-title-status';el.setAttribute('role','status');card.querySelector('h2').after(el);}
  el.textContent=d.pending?'正在保存标题…':d.error||'';el.hidden=!el.textContent;
  card.querySelector('.vb-inline-title')?.setAttribute('aria-invalid',d.error?'true':'false');
 }
 function decorate(){
  for(const card of document.querySelectorAll('#nodes > .paper')){
   const n=board().nodes.find(n=>n.id===card.dataset.node),doc=n&&state.docs[n.doc],el=card.querySelector('h2 .highlight');if(!doc||!el)continue;
   el.classList.add('vb-inline-title');el.dataset.titlePath=doc.path;el.dataset.titleNode=n.id;
   el.setAttribute('contenteditable',doc.missing?'false':'plaintext-only');el.setAttribute('role','textbox');el.setAttribute('aria-label',`${doc.title} 文章标题`);el.setAttribute('aria-multiline','false');el.spellcheck=false;el.title='点击修改标题，Enter 保存，Esc 取消';
   const d=edits.get(n.id);if(d){el.textContent=d.value;status(d);}
  }
 }
 async function commit(d){
  if(d.pending)return d.pending;if(d.composing)return false;
  const value=d.value.trim();if(value===d.original){d.error=null;if(!d.focused)edits.delete(d.id);status(d);return true;}
  const submitted=d.value;
  d.pending=(async()=>{
   try{
    if(!(await flushBodies()))throw Error('正文草稿尚未保存，请先处理正文保存提示。');
    const oldPath=d.path,doc=await window.VBHost.rpc('rename-note',{path:oldPath,title:value});
    window.VBHost.applyRenameReferences({oldPath,newPath:doc.path,doc});
    d.path=doc.path;d.original=doc.title;if(d.value===submitted)d.value=doc.title;d.error=null;
    await save();return true;
   }catch(error){d.error=String(error?.message||error);return false;}
  })();status(d);
  const result=await d.pending;d.pending=null;
  if(result&&!d.focused&&d.value===d.original)edits.delete(d.id);
  render();status(d);return result;
 }
 const baseRender=render;
 render=function(){
  const active=activeTitle(),saved=active?{el:active,id:key(active),selection:[...Array(getSelection()?.rangeCount||0)].map((_,i)=>getSelection().getRangeAt(i).cloneRange())}:null;
  rendering=true;
  try{
   baseRender();decorate();
   if(saved){const replacement=[...document.querySelectorAll('.vb-inline-title')].find(el=>key(el)===saved.id);
    if(replacement){saved.el.dataset.titlePath=replacement.dataset.titlePath;replacement.replaceWith(saved.el);saved.el.focus({preventScroll:true});const selection=getSelection();selection?.removeAllRanges();for(const range of saved.selection)if(saved.el.contains(range.startContainer)&&saved.el.contains(range.endContainer))selection?.addRange(range);}
    else{const d=edits.get(saved.id);if(d){d.focused=false;void commit(d);}}
   }
  }finally{rendering=false;}
 };
 window.addEventListener('pointerdown',e=>{if(window.VBMultiSelection?.intercepts(e))return;if(e.target.closest?.('.vb-inline-title')&&mode!=='connect')e.stopImmediatePropagation();},true);
 window.addEventListener('click',e=>{
    if(window.VBMultiSelection?.blocksClick?.(e)){e.preventDefault();e.stopImmediatePropagation();return;}if(window.VBMultiSelection?.intercepts(e))return;const el=e.target.closest?.('.vb-inline-title');if(!el||mode==='connect')return;e.stopImmediatePropagation();select(key(el));},true);
 window.addEventListener('keydown',e=>{
  const el=e.target.closest?.('.vb-inline-title');if(!el)return;e.stopImmediatePropagation();const d=entry(el);if(!d)return;
  if(e.isComposing||d.composing||e.keyCode===229)return;
  if(e.key==='Escape'){e.preventDefault();d.value=d.original;d.error=null;el.textContent=d.original;el.blur();render();}
  else if(e.key==='Enter'||(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();d.value=el.textContent;void commit(d).then(ok=>{if(ok&&activeTitle()===el)el.blur();});}
 },true);
 document.addEventListener('focusin',e=>{const el=e.target.closest?.('.vb-inline-title');if(!el||rendering||el.getAttribute('contenteditable')==='false')return;const d=entry(el);if(d){d.focused=true;select(d.id);}});
 document.addEventListener('input',e=>{const el=e.target.closest?.('.vb-inline-title');if(!el)return;const d=entry(el);if(d){d.value=el.textContent;d.error=null;status(d);}});
 document.addEventListener('focusout',e=>{const el=e.target.closest?.('.vb-inline-title');if(!el||rendering)return;const d=edits.get(key(el));if(d){d.value=el.textContent;d.focused=false;void commit(d);}});
 document.addEventListener('compositionstart',e=>{const el=e.target.closest?.('.vb-inline-title');if(el){const d=entry(el);if(d)d.composing=true;}});
 document.addEventListener('compositionend',e=>{const el=e.target.closest?.('.vb-inline-title');if(el){const d=entry(el);if(d){d.composing=false;d.value=el.textContent;if(!d.focused)void commit(d);}}});
 window.VBTitle={decorate,renamePaths(oldPath,newPath,folder){
  const migrate=p=>p===oldPath||folder&&p.startsWith(oldPath+'/')?newPath+p.slice(oldPath.length):p;
  for(const d of edits.values()){
   const next=migrate(d.path);if(next===d.path)continue;
   const clean=d.value===d.original,title=state.docs[next]?.title||next.split('/').pop().replace(/\.md$/i,'');
   d.path=next;d.original=title;if(clean)d.value=title;
  }
  document.querySelectorAll('.vb-inline-title').forEach(el=>{
   const next=migrate(el.dataset.titlePath);if(next===el.dataset.titlePath)return;
   el.dataset.titlePath=next;const d=edits.get(key(el));if(d&&el.textContent!==d.value)el.textContent=d.value;
  });
 }};
 window.VBInline.flushAll=async()=>{if(!(await flushBodies()))return false;return (await Promise.all([...edits.values()].map(commit))).every(Boolean);};
 decorate();
})();
