/* Remove selected components through the Vault recycle transaction, never by hiding an entry. */
(() => {
 function editing(target){return !!target?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]');}
 function selectedIds(){const valid=new Set(board().nodes.map(n=>n.id)),ids=window.VBMultiSelection?.ids||[];return [...new Set((ids.length?ids:selected?[selected]:[]).filter(id=>valid.has(id)))];}
 async function trash(){
  if(VBHistory.replaying||window.VBFolderInteraction?.moving)return false;
  const ids=selectedIds();if(!ids.length){toast('先选择需要删除的组件');return false;}
  const result=await VBHistory.nativeAction('trash-components',{board:board().id,ids});
  if(result){selected=null;window.VBMultiSelection?.clear();renderSelection();renderEdges();toast('已移到回收站，可按 Command+Z 撤销');}
  return !!result;
 }
 async function restore(token){
  const result=await VBHistory.nativeAction('restore-components',{token});
  if(result){closeModal(true);toast('已从回收站恢复，原来的位置与尺寸已保留');}
  return !!result;
 }
 async function list(){
  setModal('回收站','<p>正在读取回收记录…</p>');
  try{
   const response=await VBHost.rpc('list-trash'),items=Array.isArray(response)?response:response.items||[];
   if(!$('modal-root').childElementCount)return;
   const rows=items.map(item=>'<div class="trash-record"><strong>'+esc(item.label||'已删除组件')+'</strong><p>'+esc(String(item.count||0))+' 个组件 · '+esc(new Date(item.createdAt).toLocaleString())+'</p><div class="actions"><button class="btn" data-restore-trash="'+esc(item.token)+'" '+(['restored','restoring'].includes(item.status)?'disabled':'')+'>'+(['restored','restoring'].includes(item.status)?'已恢复':'恢复原位置')+'</button></div></div>').join('');
   setModal('回收站','<p>恢复会保留原路径、位置、尺寸和排列；同名文件存在时不会覆盖。</p>'+ (rows||'<p>回收站里暂时没有组件。</p>')+'<div class="modal-foot"><button class="btn" data-open-trash>刷新记录</button><button class="btn" data-action="close-modal">关闭</button></div>');
  }catch(e){toast(e.message);}
 }
 const baseSettings=settings;settings=function(){baseSettings();const note=document.querySelector('.settings-note');if(note)note.innerHTML=note.innerHTML.replace('移除卡片仅移除引用。','删除文件组件会移到回收站，可用 Command+Z 或回收站入口恢复。');const foot=document.querySelector('.modal .modal-foot');if(foot){const button=document.createElement('button');button.className='btn';button.dataset.openTrash='';button.dataset.testid='open-trash';button.textContent='回收站';foot.prepend(button);}};
 window.addEventListener('click',e=>{const button=e.target.closest?.('[data-open-trash],[data-restore-trash]');if(!button)return;e.preventDefault();e.stopImmediatePropagation();if(button.hasAttribute('data-open-trash'))void list();else{button.disabled=true;void restore(button.dataset.restoreTrash).then(ok=>{if(!ok&&button.isConnected)button.disabled=false;});}},true);
 remove=function(){void trash();};
 function lineDelete(){if(!window.VBEdgeStyle?.selected)return false;document.querySelector('[data-edge-delete]')?.click();return true;}
 const baseAction=action;action=function(name){if(name==='remove'){if(!lineDelete())void trash();return;}baseAction(name);};
 function deleteLabels(){for(const button of document.querySelectorAll('[data-action="remove"]')){button.setAttribute('aria-label','移到回收站');if(button.closest('#selection-bar'))button.textContent='移到回收站';}}
 const baseRenderSelection=renderSelection;renderSelection=function(){baseRenderSelection();deleteLabels();};
 const baseRender=render;render=function(){baseRender();deleteLabels();};
 window.addEventListener('keydown',e=>{
  if(!['Delete','Backspace'].includes(e.key)||e.isComposing||e.keyCode===229||editing(e.target)||$('modal-root').childElementCount)return;
  if(!window.VBEdgeStyle?.selected&&!selectedIds().length)return;
  e.preventDefault();e.stopImmediatePropagation();if(VBHistory.replaying)return;
  if(!lineDelete())void trash();
 },true);
 window.addEventListener('click',e=>{if(VBHistory.replaying&&e.target.closest?.('.bottom-toolbar,header,#popover,#edge-style-panel,#nodes>.node,#multiselect-panel,#selection-bar')){e.preventDefault();e.stopImmediatePropagation();}},true);
 window.VBRecycle={trash,restore,list,selectedIds,get busy(){return VBHistory.replaying;}};
 render();
})();
