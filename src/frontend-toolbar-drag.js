/* Drag a creation tool into the current Board; dialogs keep their usual actions. */
(() => {
 const kinds=new Map([['article','文章'],['note','便签'],['board','Board'],['image','图片'],['media','PDF / 音频']]);
 let dragging=null,placement=null,launching=false,suppress=false;
 const snap=value=>Math.round(value/20)*20;
 function dropPoint(x,y){
  const canvas=$('canvas'),rect=canvas.getBoundingClientRect();
  if(x<rect.left||x>=rect.right||y<rect.top||y>=rect.bottom)return null;
  const hit=document.elementFromPoint(x,y);
  if(hit?.closest('.bottom-toolbar,.header,.header-right,.top-left,.heading,#selection-bar,#preview,#popover,#modal-root,#sticky-style-panel,.zoom-control,.zoom-controls,.settings-button,button,input,textarea,select'))return null;
  const view=board().view,scale=sceneScale*view.zoom;
  if(!Number.isFinite(scale)||scale<=0)return null;
  return {x:snap(((x-rect.left)/sceneScale-view.x)/view.zoom),y:snap(((y-rect.top)/sceneScale-view.y)/view.zoom)};
 }
 function clearDrag(){
  const previous=dragging;dragging=null;previous?.ghost?.remove();
  document.documentElement.classList.remove('vb-tool-dragging');
  if(previous?.button.hasPointerCapture?.(previous.id))previous.button.releasePointerCapture(previous.id);
 }
 const basePosition=addPosition;
 addPosition=function(type,dimensions){
  if(placement&&placement.board===board().id){const point={...placement.point};placement=null;return point;}
  return basePosition(type,dimensions);
 };
 const baseClose=closeModal;
 closeModal=function(force){const queued=placement,closed=baseClose(force);if(closed&&!launching)queueMicrotask(()=>{if(placement===queued&&!$('modal-root').childElementCount)placement=null;});return closed;};
 const baseNavigate=navigate;navigate=function(id){placement=null;clearDrag();return baseNavigate(id);};
 // An automatically synchronized article may already exist when create-note resolves.
 window.VBToolbarDrop={
  takePosition(){if(!placement||placement.board!==board().id)return null;const point={...placement.point};placement=null;return point;},
  clear(){placement=null;clearDrag();},
 };
 for(const button of document.querySelectorAll('.bottom-toolbar [data-action]'))if(kinds.has(button.dataset.action)){button.classList.add('vb-draggable-tool');button.title=(button.title||button.getAttribute('aria-label')||kinds.get(button.dataset.action))+' · 可拖到画板';}
 window.addEventListener('pointerdown',event=>{
  if(event.button!==0||!event.isPrimary||$('modal-root').childElementCount)return;
  const button=event.target.closest?.('.bottom-toolbar [data-action]');
  if(!button||!kinds.has(button.dataset.action))return;
  placement=null;clearDrag();
  dragging={id:event.pointerId,button,kind:button.dataset.action,startX:event.clientX,startY:event.clientY,board:board().id,active:false};
  button.setPointerCapture(event.pointerId);
 },true);
 window.addEventListener('pointermove',event=>{
  const drag=dragging;if(!drag||event.pointerId!==drag.id)return;
  if(!drag.active&&Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<8)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(!drag.active){drag.active=true;drag.ghost=document.createElement('div');drag.ghost.className='vb-tool-drag-ghost';drag.ghost.dataset.testid='toolbar-drag-ghost';drag.ghost.setAttribute('aria-hidden','true');document.body.append(drag.ghost);document.documentElement.classList.add('vb-tool-dragging');}
  const point=dropPoint(event.clientX,event.clientY);drag.ghost.classList.toggle('invalid',!point);
  drag.ghost.textContent=kinds.get(drag.kind)+(point?' · 松开放置':' · 移到画板内');
  drag.ghost.style.left=event.clientX+14+'px';drag.ghost.style.top=event.clientY-34+'px';
 },true);
 window.addEventListener('pointerup',event=>{
  const drag=dragging;if(!drag||event.pointerId!==drag.id)return;
  const point=drag.active&&drag.board===board().id?dropPoint(event.clientX,event.clientY):null;
  clearDrag();if(!drag.active)return;
  event.preventDefault();event.stopImmediatePropagation();suppress=true;setTimeout(()=>{suppress=false;},0);
  if(!point)return;
  selected=null;mode='select';connectStart=null;renderSelection();
  placement={board:board().id,point};launching=true;
  try{action(drag.kind);}finally{launching=false;if(!$('modal-root').childElementCount)placement=null;}
 },true);
 window.addEventListener('click',event=>{if(suppress){event.preventDefault();event.stopImmediatePropagation();suppress=false;}},true);
 window.addEventListener('pointercancel',event=>{if(event.pointerId===dragging?.id)clearDrag();},true);
 window.addEventListener('lostpointercapture',event=>{if(event.pointerId===dragging?.id)clearDrag();},true);
 window.addEventListener('keydown',event=>{if(event.key==='Escape'&&dragging){event.preventDefault();event.stopImmediatePropagation();clearDrag();}},true);
 window.addEventListener('blur',()=>clearDrag());
})();
