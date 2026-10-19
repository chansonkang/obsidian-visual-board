/* Sticky size, local palette, and paint order are saved in the existing node layout. */
(() => {
 const colors=[['yellow','奶黄','#fff6bb'],['green','薄荷','#d5f6cf'],['pink','浅粉','#f7dce8'],['blue','晴蓝','#d7eafa'],['purple','雾紫','#e7def8'],['peach','暖桃','#f8e1ce'],['white','米白','#f9f7ef']];
 const panel=document.createElement('section');panel.id='sticky-style-panel';panel.dataset.testid='sticky-style-panel';panel.className='vb-sticky-panel';panel.hidden=true;panel.setAttribute('aria-label','便签颜色与叠放顺序');$('scene').append(panel);let closedFor='',timer,rendering=false,editTarget=null;const drafts=new Map(),limits={title:1000,text:100000};
 const key=(b,id)=>b+'::'+id,lookup=(b,id)=>state.boards[b]?.nodes.find(n=>n.id===id&&n.type==='note');
 // Earlier versions measured natural note height. Initialize only dimensions the user never set.
 let migrated=false;for(const b of Object.values(state.boards))for(const n of b.nodes){if(n.type!=='note')continue;const old=window.__VB_INIT.layout.boards[b.id]?.nodes.find(item=>item.id===n.id);if(old&&old.w===undefined){n.w=240;migrated=true;}if(old&&old.h===undefined){n.h=280;migrated=true;}}
 function renderPanel(){const n=node(),key=n?.id+':'+board().id;if(n?.type!=='note'||closedFor===key){panel.hidden=true;return;}panel.hidden=false;const current=colors.some(c=>c[0]===n.color)?n.color:'green';
  if(panel.dataset.noteKey!==key){panel.dataset.noteKey=key;panel.innerHTML='<div class="vb-sticky-header"><strong>便签样式</strong><button data-sticky-close aria-label="关闭便签样式">×</button></div><div class="vb-sticky-size"></div><button class="vb-sticky-edit-open" data-sticky-edit data-testid="sticky-panel-edit">编辑便签</button><span class="vb-sticky-label">颜色</span><div class="vb-sticky-colors">'+colors.map(([id,label,hex])=>'<button data-sticky-color="'+id+'" data-testid="sticky-color-'+id+'" aria-label="便签颜色 '+label+'"><i style="background:'+hex+'"></i>'+label+'</button>').join('')+'</div><span class="vb-sticky-label">叠放顺序</span><div class="vb-sticky-order">'+[['front','置顶'],['back','置底'],['forward','前移一层'],['backward','后移一层']].map(([id,label])=>'<button data-sticky-order="'+id+'" data-testid="sticky-order-'+id+'">'+label+'</button>').join('')+'</div>';}
  panel.querySelector('.vb-sticky-size').textContent=Math.round(n.w||240)+' × '+Math.round(n.h||280)+' · 拖动四边调整';for(const btn of panel.querySelectorAll('[data-sticky-color]')){const active=btn.dataset.stickyColor===current;btn.classList.toggle('selected',active);btn.setAttribute('aria-pressed',String(active));}
 }
 function plain(el){
  if(el.nodeType===Node.ELEMENT_NODE&&el.childNodes.length===1&&el.firstChild.nodeName==='BR')return '';
  const read=parent=>{let value='';[...parent.childNodes].forEach((child,i)=>{if(child.nodeType===Node.TEXT_NODE)value+=child.nodeValue;else if(child.nodeName==='BR')value+='\n';else{const block=/^(DIV|P|LI)$/.test(child.nodeName);if(block&&i>0&&parent.childNodes[i-1]?.nodeName!=='BR')value+='\n';if(!(block&&child.childNodes.length===1&&child.firstChild.nodeName==='BR'))value+=read(child);}});return value;};
  return read(el).replace(/\r\n?/g,'\n');
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(()=>{void save();},250);}
 function write(b,id,field,value){
  const n=lookup(b,id);if(!n)return false;
  if(value.length>limits[field]){toast((field==='title'?'便签标题':'便签正文')+'最多 '+limits[field]+' 个字符');return false;}
  if((n[field]||'')===value)return true;
  n[field]=value;const k=key(b,id),d=drafts.get(k)||{board:b,id,values:{}};d.values[field]=value;drafts.set(k,d);schedule();return true;
 }
 function merge(layout,ack=false){for(const[k,d]of drafts){const n=layout.boards[d.board]?.nodes.find(n=>n.id===d.id&&n.type==='note');if(!n){if(ack)drafts.delete(k);continue;}if(ack&&Object.entries(d.values).every(([f,v])=>(n[f]||'')===v)){drafts.delete(k);continue;}Object.assign(n,d.values);}}
 const baseAccept=VBHost.acceptLayout;VBHost.acceptLayout=async function(...args){
  const active=document.activeElement?.closest?.('.vb-sticky-editor');
  if(active?.__vbStickyTouched)write(active.dataset.stickyBoard,active.dataset.stickyNode,active.dataset.stickyField,plain(active));
  const accepted=await baseAccept(...args);
  if(accepted!==false){drafts.clear();if(active)active.__vbStickyTouched=false;}
  return accepted;
 };
 const baseSave=save;save=function(){clearTimeout(timer);merge(state);return baseSave();};
 async function flush(){clearTimeout(timer);return save();}
 const baseFlush=window.VBInline?.flushAll;if(baseFlush)VBInline.flushAll=async()=>{await flush();return baseFlush();};
 function decorate(){
  for(const el of document.querySelectorAll('#nodes>.sticky')){
   const id=el.dataset.node;for(const[field,selector]of [['title','h2'],['text','.excerpt']]){const editor=el.querySelector(selector);if(!editor)continue;editor.classList.add('vb-sticky-editor');editor.dataset.stickyField=field;editor.dataset.stickyBoard=board().id;editor.dataset.stickyNode=id;editor.dataset.testid='sticky-'+field+'-'+id;editor.dataset.placeholder=field==='title'?'点击填写标题':'点击记录想法…';editor.dataset.empty=String(!plain(editor));editor.setAttribute('contenteditable','plaintext-only');editor.setAttribute('role','textbox');editor.setAttribute('aria-label',field==='title'?'便签标题':'便签正文');editor.setAttribute('aria-multiline',String(field==='text'));editor.spellcheck=false;}
   if(!el.querySelector('[data-sticky-drag]')){const button=document.createElement('button');button.className='vb-card-drag-handle';button.dataset.dragCard=id;button.dataset.stickyDrag='';button.dataset.testid='sticky-drag-'+id;button.setAttribute('aria-label','拖动便签');button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="4" stroke-linecap="round"/></svg>';el.querySelector('.node-actions')?.prepend(button);}
  }
 }
 const baseRender=render;render=function(){
  const active=document.activeElement?.closest?.('.vb-sticky-editor'),saved=active?{el:active,board:active.dataset.stickyBoard,id:active.dataset.stickyNode,field:active.dataset.stickyField,scrollTop:active.scrollTop,ranges:[...Array(getSelection()?.rangeCount||0)].map((_,i)=>{const r=getSelection().getRangeAt(i);return {start:r.startContainer,so:r.startOffset,end:r.endContainer,eo:r.endOffset};})}:null;
  rendering=true;try{
   merge(state);for(const b of Object.values(state.boards))for(const n of b.nodes)if(n.type==='note'){n.w||=240;n.h||=280;}baseRender();decorate();renderPanel();
   if(saved&&board().id===saved.board&&lookup(saved.board,saved.id)){
    const replacement=[...document.querySelectorAll('.vb-sticky-editor')].find(e=>e.dataset.stickyNode===saved.id&&e.dataset.stickyField===saved.field);if(replacement){if(!saved.el.__vbStickyTouched&&plain(saved.el)!==(lookup(saved.board,saved.id)[saved.field]||'')){saved.el.textContent=lookup(saved.board,saved.id)[saved.field]||'';saved.ranges=[];}replacement.replaceWith(saved.el);saved.el.focus({preventScroll:true});saved.el.scrollTop=saved.scrollTop;const selection=getSelection();selection.removeAllRanges();for(const r of saved.ranges)if(saved.el.contains(r.start)&&saved.el.contains(r.end)){const range=document.createRange();range.setStart(r.start,r.so);range.setEnd(r.end,r.eo);selection.addRange(range);}}
   }
  }finally{rendering=false;}
 };
 const baseSelect=select;select=function(id){closedFor='';baseSelect(id);renderPanel();};
 const baseSelection=renderSelection;renderSelection=function(){baseSelection();if(node()?.type==='note'){for(const[label,data,test]of [['编辑便签','stickyEdit','edit-sticky'],['便签样式','stickyOpen','edit-sticky-style']]){const btn=document.createElement('button');btn.textContent=label;btn.dataset[data]='';btn.dataset.testid=test;$('selection-bar').insertBefore(btn,$('selection-bar').lastElementChild);}}renderPanel();};
 function openEdit(){const n=node();if(n?.type!=='note')return;editTarget={board:board().id,id:n.id};if(!setModal('编辑便签','<label for="sticky-edit-title">标题</label><input id="sticky-edit-title" data-testid="sticky-edit-title" maxlength="1000" value="'+esc(n.title||'')+'" aria-label="便签标题"><label for="sticky-edit-text">正文</label><textarea id="sticky-edit-text" data-testid="sticky-edit-text" maxlength="100000" aria-label="便签正文">'+esc(n.text||'')+'</textarea><div class="modal-foot"><small>保留原便签的位置、颜色和尺寸。</small><button class="btn" data-action="close-modal" data-testid="sticky-edit-cancel">取消</button><button class="btn primary" data-sticky-save data-testid="sticky-edit-save">保存修改</button></div>',true))editTarget=null;}
 function editing(e){return e.target.closest?.('.vb-sticky-editor');}
 window.addEventListener('pointerdown',e=>{
  const el=editing(e);if(!el)return;if(window.VBMultiSelection?.intercepts(e))return;e.stopImmediatePropagation();if(mode==='connect'||window.VBFolderInteraction?.moving)e.preventDefault();
 },true);
 window.addEventListener('click',e=>{const el=editing(e);if(!el)return;if(window.VBMultiSelection?.blocksClick?.(e))return;e.stopImmediatePropagation();if(mode!=='connect'&&selected!==el.dataset.stickyNode)select(el.dataset.stickyNode);},true);
 window.addEventListener('dblclick',e=>{if(editing(e))e.stopImmediatePropagation();},true);
 document.addEventListener('focusin',e=>{const el=editing(e);if(!el||rendering)return;if(mode==='connect'||window.VBFolderInteraction?.moving){el.blur();return;}select(el.dataset.stickyNode);});
 document.addEventListener('input',e=>{
  const el=editing(e);if(el){const field=el.dataset.stickyField,n=lookup(el.dataset.stickyBoard,el.dataset.stickyNode);if(n)el.__vbStickyTouched=true;if(n&&!write(el.dataset.stickyBoard,n.id,field,plain(el)))el.textContent=n[field]||'';el.dataset.empty=String(!plain(el));return;}

 });
 document.addEventListener('focusout',e=>{const el=editing(e);if(el&&!rendering){el.__vbStickyTouched=false;void flush();}});
 function selectedLength(el){const selection=getSelection();if(!selection?.rangeCount)return 0;const r=selection.getRangeAt(0);return el.contains(r.startContainer)&&el.contains(r.endContainer)?plain(r.cloneContents()).length:0;}
 window.addEventListener('beforeinput',e=>{const el=editing(e);if(!el||!e.inputType?.startsWith('insert')||typeof e.data!=='string')return;if(plain(el).length-selectedLength(el)+e.data.length>limits[el.dataset.stickyField]){e.preventDefault();toast('已达到便签内容长度上限');}},true);
 window.addEventListener('paste',e=>{const el=editing(e);if(!el)return;const pasted=e.clipboardData?.getData('text/plain');if(typeof pasted==='string'&&plain(el).length-selectedLength(el)+pasted.length>limits[el.dataset.stickyField]){e.preventDefault();e.stopImmediatePropagation();toast('粘贴内容超过便签长度上限');}},true);
 window.addEventListener('keydown',e=>{
  const el=editing(e);if(!el)return;e.stopImmediatePropagation();if(e.isComposing||e.keyCode===229)return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void flush();}
  else if(e.key==='Escape'){e.preventDefault();el.blur();window.VBHistory?.focusGesture();}
  else if(e.key==='Enter'&&el.dataset.stickyField==='title'){e.preventDefault();el.closest('.sticky').querySelector('[data-sticky-field="text"]')?.focus();}
 },true);
 window.addEventListener('click',e=>{const edit=e.target.closest?.('[data-sticky-edit],[data-sticky-save]');if(!edit)return;e.preventDefault();e.stopImmediatePropagation();if(edit.hasAttribute('data-sticky-edit'))openEdit();else if(editTarget&&lookup(editTarget.board,editTarget.id)){const title=$('sticky-edit-title').value,text=$('sticky-edit-text').value;if(title.length>limits.title||text.length>limits.text){toast('便签内容超过长度上限');return;}write(editTarget.board,editTarget.id,'title',title);write(editTarget.board,editTarget.id,'text',text);void flush();closeModal(true);editTarget=null;render();}else{toast('此便签已被移除');closeModal(true);editTarget=null;}},true);
 window.VBSticky={flush,openEdit};
 window.addEventListener('pointerdown',e=>{if(e.target.closest?.('#sticky-style-panel'))e.stopImmediatePropagation();},true);
 window.addEventListener('click',e=>{const button=e.target.closest?.('[data-sticky-color],[data-sticky-order],[data-sticky-close],[data-sticky-open]');if(!button)return;e.stopImmediatePropagation();const n=node();if(n?.type!=='note')return;
  if(button.hasAttribute('data-sticky-close')){closedFor=n.id+':'+board().id;renderPanel();return;}if(button.hasAttribute('data-sticky-open')){closedFor='';renderPanel();return;}
  if(button.dataset.stickyColor)n.color=button.dataset.stickyColor;
  else{const nodes=board().nodes,index=nodes.indexOf(n),order=button.dataset.stickyOrder;let destination=order==='front'?nodes.length-1:order==='back'?0:order==='forward'?Math.min(nodes.length-1,index+1):Math.max(0,index-1);nodes.splice(index,1);nodes.splice(destination,0,n);}
  void save();render();
 },true);
 render();if(migrated)void save();
})();
