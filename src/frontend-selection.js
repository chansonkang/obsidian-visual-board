/* A background tap clears selection. Panning and floating controls retain it. */
(() => {
 let tap=null;
 function blank(target){return $('scene').contains(target)&&!target.closest?.('#nodes>.node,.vb-edge-hit,[data-connect-node],#connection-controls,#modal-root,#preview,#popover,#edge-style-panel,#sticky-style-panel,#multiselect-panel,#selection-bar,#mode-banner,header,.heading,.bottom-toolbar,.zoom-controls,.settings,button,input,textarea,select,[contenteditable="true"]');}
 window.addEventListener('pointerdown',e=>{tap=e.button===0&&blank(e.target)?{pointer:e.pointerId,x:e.clientX,y:e.clientY,board:board().id,up:false}:null;},true);
 window.addEventListener('pointerup',e=>{if(tap?.pointer===e.pointerId){tap.up=Math.abs(e.clientX-tap.x)+Math.abs(e.clientY-tap.y)<=5;tap.ended=performance.now();}},true);
 window.addEventListener('pointercancel',()=>{tap=null;},true);
 window.addEventListener('click',e=>{
  const current=tap;tap=null;if(!current?.up||current.board!==board().id||performance.now()-current.ended>500||!blank(e.target))return;
  selected=null;mode='select';connectStart=null;$('preview').innerHTML='';window.VBMultiSelection?.clear();window.VBConnections?.cancel();window.VBEdgeStyle?.clear();
  document.querySelectorAll('#nodes>.selected').forEach(el=>el.classList.remove('selected'));
  renderSelection();renderEdges();e.stopImmediatePropagation();
 },true);
})();
