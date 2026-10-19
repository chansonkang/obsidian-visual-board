/* Multi-card layout commands keep source files, dimensions, paint order, and camera unchanged. */
(() => {
 const chosen=new Set();let selectionBoard=board().id,gesture=null,blocked=null;
 const panel=document.createElement('section');panel.id='multiselect-panel';panel.className='vb-multiselect-panel';panel.hidden=true;panel.setAttribute('aria-label','多选组件排列');$('scene').append(panel);
 panel.innerHTML='<div class="vb-multi-summary"><strong data-multi-count></strong><small>Shift 点击增减 · Shift 拖空白框选</small><button data-multi-clear aria-label="取消多选" title="取消多选">×</button></div><div class="vb-multi-actions"><label>间距 <input data-multi-gap data-testid="multi-gap" type="number" min="0" max="2000" step="20" value="40" aria-label="排列间距"></label><button data-multi-command="horizontal" data-testid="multi-horizontal">横向等距</button><button data-multi-command="vertical" data-testid="multi-vertical">纵向等距</button><i></i>'+[['left','左对齐'],['centerX','水平居中'],['right','右对齐'],['top','顶部对齐'],['centerY','垂直居中'],['bottom','底部对齐']].map(([id,title])=>'<button data-multi-command="'+id+'" data-testid="multi-'+id+'">'+title+'</button>').join('')+'<button data-multi-trash data-testid="multi-trash">移到回收站</button></div>';
 const hint=document.createElement('div');hint.className='vb-multiselect-hint';hint.textContent='Shift 点击多选 · Shift 拖动空白框选';$('scene').append(hint);
 const marquee=document.createElement('div');marquee.className='vb-selection-marquee';marquee.dataset.testid='multi-marquee';marquee.hidden=true;marquee.setAttribute('aria-hidden','true');document.body.append(marquee);
 const card=id=>[...$('nodes').children].find(el=>el.dataset.node===id);
 const capture=n=>window.VBHistory?.capture(n)||Object.fromEntries(['x','y','w','h'].filter(key=>Number.isFinite(n[key])).map(key=>[key,n[key]]));
 const quantize=value=>Math.round(value/20)*20;
 const nodes=()=>board().nodes.filter(n=>chosen.has(n.id));
 const rect=n=>({x:n.x,y:n.y,w:n.w||card(n.id)?.offsetWidth||300,h:n.h||card(n.id)?.offsetHeight||240});
 function editing(target){
  if(target.closest?.('input,textarea,select'))return true;
  const editable=target.closest?.('[contenteditable="true"],[contenteditable="plaintext-only"]');
  return !!editable&&(editable===document.activeElement||editable.contains(document.activeElement));
 }
 function eligible(event){
  if(event.button!==undefined&&event.button!==0||editing(event.target)||$('modal-root').childElementCount||window.VBFolderInteraction?.moving)return null;
  const el=event.target.closest?.('#nodes>.node');if(!el)return null;
  if(event.target.closest('[data-resize],[data-connect-node],[data-inline-action],audio,video'))return null;
  const button=event.target.closest('button');if(button&&!button.matches('[data-drag-card],.folder-name'))return null;
  if(!event.shiftKey&&event.target.closest('a'))return null;
  return board().nodes.some(n=>n.id===el.dataset.node)?el:null;
 }
 function intercepts(event){const el=eligible(event);return !!el&&(event.shiftKey||chosen.size>1&&chosen.has(el.dataset.node));}
 function blank(target){return $('canvas').contains(target)&&!target.closest?.('#nodes>.node,.vb-edge-hit,#connection-controls,#multiselect-panel,#selection-bar,#preview,#popover,#edge-style-panel,#sticky-style-panel,.bottom-toolbar,.zoom-controls,button,input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]');}
 function block(x,y){blocked={x,y,until:performance.now()+350};}
 function blocksClick(event){return !!blocked&&performance.now()<blocked.until&&Math.hypot(event.clientX-blocked.x,event.clientY-blocked.y)<4;}
 function refresh(sync=true){
  if(selectionBoard!==board().id){chosen.clear();selectionBoard=board().id;}
  const valid=new Set(board().nodes.map(n=>n.id));for(const id of chosen)if(!valid.has(id))chosen.delete(id);
  if(sync&&chosen.size<=1){chosen.clear();if(selected&&valid.has(selected))chosen.add(selected);}
  for(const el of $('nodes').children)el.classList.toggle('vb-multi-selected',chosen.size>1&&chosen.has(el.dataset.node));
  $('scene').classList.toggle('vb-has-multiple',chosen.size>1);panel.hidden=chosen.size<2;hint.hidden=chosen.size>1;
  panel.querySelector('[data-multi-count]').textContent='已选 '+chosen.size+' 个组件';
  for(const button of panel.querySelectorAll('[data-multi-command]'))button.disabled=chosen.size<2;
 }
 function paint(){const elements=new Map([...$('nodes').children].map(el=>[el.dataset.node,el]));for(const n of nodes()){const el=elements.get(n.id);if(el){el.style.left=n.x+'px';el.style.top=n.y+'px';}}renderEdges();refresh();}
 function cancel(){
  const g=gesture;gesture=null;if(g)block(g.lastX??g.sx,g.lastY??g.sy);marquee.hidden=true;document.documentElement.classList.remove('vb-multi-dragging');
  if(g?.kind==='move'){const b=state.boards[g.board];for(const item of g.items){const n=b?.nodes.find(n=>n.id===item.id);if(n===item.ref){n.x=item.before.x;n.y=item.before.y;}}window.VBHistory?.endGesture();}
  if(g?.kind==='box'){chosen.clear();g.initial.forEach(id=>chosen.add(id));selected=g.primary;for(const el of $('nodes').children)el.classList.toggle('selected',el.dataset.node===selected);renderSelection();}
  if(g&&$('canvas').hasPointerCapture?.(g.pointer))$('canvas').releasePointerCapture(g.pointer);
  paint();
 }
 function clear(){if(gesture)cancel();chosen.clear();selectionBoard=board().id;refresh(false);}
 const baseSelect=select;
 function setSelection(ids,primary){
  const valid=new Set(board().nodes.map(n=>n.id));chosen.clear();ids.forEach(id=>{if(valid.has(id))chosen.add(id);});selectionBoard=board().id;
  selected=chosen.has(primary)?primary:[...chosen].at(-1)||null;mode='select';connectStart=null;
  window.VBEdgeStyle?.clear();
  if(selected)baseSelect(selected);else{for(const el of $('nodes').children)el.classList.remove('selected');renderSelection();}
  refresh();window.VBConnections?.refresh();
 }
 select=function(id){chosen.clear();selectionBoard=board().id;if(board().nodes.some(n=>n.id===id))chosen.add(id);baseSelect(id);refresh();};
 const baseRender=render;render=function(){
  if(gesture&&(gesture.board!==board().id||gesture.kind==='move'&&gesture.items.some(item=>board().nodes.find(n=>n.id===item.id)!==item.ref)))cancel();
  baseRender();refresh();
 };
 const baseEdges=renderEdges;renderEdges=function(){baseEdges();refresh();};
 const baseView=applyView;applyView=function(){baseView();refresh();};
 const baseNavigate=navigate;navigate=function(id){if(id!==board().id&&state.boards[id])clear();baseNavigate(id);refresh();};
 function arrange(command){
  if(gesture||chosen.size<2||window.VBHistory?.replaying||window.VBFolderInteraction?.moving)return;const list=nodes(),gap=Number(panel.querySelector('[data-multi-gap]').value);
  if(!Number.isFinite(gap)||gap<0||gap>2000){toast('请填写 0 到 2000 的排列间距。');return;}
  window.VBHistory?.focusGesture();const elements=new Map([...$('nodes').children].map(el=>[el.dataset.node,el])),sizes=new Map(list.map(n=>[n.id,{x:n.x,y:n.y,w:n.w||elements.get(n.id)?.offsetWidth||300,h:n.h||elements.get(n.id)?.offsetHeight||240}]));const changes=list.map(n=>({id:n.id,before:capture(n)})),bounds=list.map(n=>sizes.get(n.id));
  const left=Math.min(...bounds.map(r=>r.x)),top=Math.min(...bounds.map(r=>r.y)),right=Math.max(...bounds.map(r=>r.x+r.w)),bottom=Math.max(...bounds.map(r=>r.y+r.h));
  if(command==='horizontal'||command==='vertical'){
   const axis=command==='horizontal'?'x':'y',extent=axis==='x'?'w':'h';let cursor=axis==='x'?left:top;
   const order=new Map(board().nodes.map((n,i)=>[n.id,i]));[...list].sort((a,b)=>a[axis]-b[axis]||order.get(a.id)-order.get(b.id)).forEach(n=>{n[axis]=cursor;cursor+=sizes.get(n.id)[extent]+gap;});
  }else for(const n of list){const r=sizes.get(n.id);if(command==='left')n.x=left;else if(command==='right')n.x=right-r.w;else if(command==='top')n.y=top;else if(command==='bottom')n.y=bottom-r.h;else if(command==='centerX')n.x=(left+right-r.w)/2;else if(command==='centerY')n.y=(top+bottom-r.h)/2;}
  changes.forEach((change,i)=>change.after=capture(list[i]));window.VBHistory?.recordGeometryBatch(board().id,changes);paint();void save();
 }
 window.VBMultiSelection={clear,intercepts,blocksClick,refresh,restored:refresh,get ids(){return [...chosen];},get dragging(){return !!gesture;}};
 window.addEventListener('pointerdown',event=>{
  if(event.button!==0||!event.isPrimary||gesture||$('modal-root').childElementCount)return;
  if(event.target.closest?.('#multiselect-panel')){event.stopImmediatePropagation();return;}
  const el=eligible(event);
  if(el&&event.shiftKey){event.preventDefault();event.stopImmediatePropagation();const ids=new Set(chosen);if(selected&&!ids.size)ids.add(selected);if(ids.has(el.dataset.node))ids.delete(el.dataset.node);else ids.add(el.dataset.node);block(event.clientX,event.clientY);window.VBHistory?.focusGesture();setSelection([...ids],el.dataset.node);return;}
  if(el&&chosen.size>1&&chosen.has(el.dataset.node)){
   event.preventDefault();event.stopImmediatePropagation();window.VBHistory?.focusGesture();selected=el.dataset.node;
   gesture={kind:'move',board:board().id,pointer:event.pointerId,sx:event.clientX,sy:event.clientY,primary:el.dataset.node,moved:false,items:nodes().map(n=>({id:n.id,ref:n,before:capture(n)}))};refresh();return;
  }
  if(event.shiftKey&&blank(event.target)){
   event.preventDefault();event.stopImmediatePropagation();window.VBHistory?.focusGesture();const initial=[...chosen];if(selected&&!initial.length)initial.push(selected);
   gesture={kind:'box',board:board().id,pointer:event.pointerId,sx:event.clientX,sy:event.clientY,moved:false,initial,primary:selected};$('canvas').setPointerCapture(event.pointerId);return;
  }
 },true);
 window.addEventListener('pointermove',event=>{
  const g=gesture;if(!g||g.pointer!==event.pointerId)return;g.lastX=event.clientX;g.lastY=event.clientY;event.preventDefault();event.stopImmediatePropagation();if(g.board!==board().id){cancel();return;}
  if(!g.moved&&Math.abs(event.clientX-g.sx)+Math.abs(event.clientY-g.sy)<=5)return;
  if(!g.moved){g.moved=true;if(g.kind==='move'){window.VBHistory?.beginGesture();$('canvas').setPointerCapture(g.pointer);document.documentElement.classList.add('vb-multi-dragging');}}
  if(g.kind==='move'){
   const dx=(event.clientX-g.sx)/sceneScale/board().view.zoom,dy=(event.clientY-g.sy)/sceneScale/board().view.zoom,anchor=g.items.find(n=>n.id===g.primary).before;
   const tx=event.altKey?dx:quantize(anchor.x+dx)-anchor.x,ty=event.altKey?dy:quantize(anchor.y+dy)-anchor.y;
   const current=new Map(board().nodes.map(n=>[n.id,n]));for(const item of g.items){const n=current.get(item.id);if(n!==item.ref){cancel();return;}n.x=item.before.x+tx;n.y=item.before.y+ty;}paint();
  }else{
   const left=Math.min(g.sx,event.clientX),top=Math.min(g.sy,event.clientY),right=Math.max(g.sx,event.clientX),bottom=Math.max(g.sy,event.clientY);
   Object.assign(marquee.style,{left:left+'px',top:top+'px',width:right-left+'px',height:bottom-top+'px'});marquee.hidden=false;
   const elements=new Map([...$('nodes').children].map(el=>[el.dataset.node,el]));const hits=board().nodes.filter(n=>{const r=elements.get(n.id)?.getBoundingClientRect();return r&&r.right>left&&r.left<right&&r.bottom>top&&r.top<bottom;}).map(n=>n.id);
   setSelection([...new Set([...g.initial,...hits])],g.primary);
  }
 },{capture:true,passive:false});
 window.addEventListener('pointerup',event=>{
  const g=gesture;if(!g||g.pointer!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();gesture=null;marquee.hidden=true;block(event.clientX,event.clientY);
  if($('canvas').hasPointerCapture?.(g.pointer))$('canvas').releasePointerCapture(g.pointer);document.documentElement.classList.remove('vb-multi-dragging');
  if(g.kind==='move'){window.VBHistory?.endGesture();if(g.moved){const current=new Map(state.boards[g.board].nodes.map(n=>[n.id,n]));window.VBHistory?.recordGeometryBatch(g.board,g.items.map(item=>({id:item.id,before:item.before,after:capture(current.get(item.id))})));void save();paint();}else setSelection([g.primary],g.primary);}
  refresh();
 },true);
 window.addEventListener('pointercancel',event=>{if(gesture?.pointer===event.pointerId){event.stopImmediatePropagation();block(event.clientX,event.clientY);cancel();}},true);
 window.addEventListener('lostpointercapture',event=>{if(gesture?.pointer===event.pointerId)cancel();},true);
 window.addEventListener('click',event=>{
  if(blocksClick(event)){event.preventDefault();event.stopImmediatePropagation();return;}
  const control=event.target.closest?.('[data-multi-command],[data-multi-clear],[data-multi-trash]');if(!control)return;event.preventDefault();event.stopImmediatePropagation();
  if(control.hasAttribute('data-multi-trash')){void window.VBRecycle?.trash();return;}
  if(control.hasAttribute('data-multi-clear')){clear();selected=null;renderSelection();renderEdges();}else arrange(control.dataset.multiCommand);
 },true);
 window.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&gesture){event.preventDefault();event.stopImmediatePropagation();cancel();return;}
  if(event.key==='Escape'&&chosen.size>1&&!editing(event.target)) {event.preventDefault();event.stopImmediatePropagation();clear();selected=null;renderSelection();renderEdges();return;}
  if(!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='a'||event.altKey||event.isComposing||editing(event.target)||$('modal-root').childElementCount)return;
  if(!$('scene').contains(event.target)&&event.target!==document.body&&event.target!==document.documentElement)return;
  event.preventDefault();event.stopImmediatePropagation();window.VBHistory?.focusGesture();setSelection(board().nodes.map(n=>n.id),selected);
 },true);
 window.addEventListener('wheel',event=>{if(gesture){event.preventDefault();event.stopImmediatePropagation();}},{capture:true,passive:false});
 window.addEventListener('blur',()=>{if(gesture)cancel();});
 if(selected)chosen.add(selected);refresh();
})();
