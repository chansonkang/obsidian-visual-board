/* Drag a selected card's circular handle to any other component. No Vault text is modified. */
(() => {
 const controls=document.createElement('div');controls.id='connection-controls';controls.className='vb-connection-controls';$('world').append(controls);
 const preview=document.createElementNS('http://www.w3.org/2000/svg','svg');preview.classList.add('vb-connection-preview');preview.setAttribute('aria-hidden','true');preview.innerHTML='<path/>';$('world').append(preview);preview.setAttribute('hidden','');
 let gesture=null,suppressUntil=0,suppressPoint=null;
 const samePair=(a,b,c,d)=>a===c&&b===d||a===d&&b===c;
 const card=id=>[...$('nodes').children].find(el=>el.dataset.node===id);
 function worldPoint(x,y){const r=$('world').getBoundingClientRect(),scale=sceneScale*board().view.zoom;return {x:(x-r.left)/scale,y:(y-r.top)/scale};}
 function decorate(){
  const n=node(),el=n&&card(n.id);if(!el){controls.innerHTML='';return;}
  let button=controls.querySelector('button');if(button?.dataset.connectNode!==n.id){controls.innerHTML='';button=document.createElement('button');button.className='vb-connect-handle';button.dataset.connectNode=n.id;button.dataset.testid='connect-handle-'+n.id;button.setAttribute('aria-label','按住并拖动，连接到其他组件');button.title='按住拖到其他组件以连接';button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12h8M12 8v8"/></svg>';controls.append(button);}
  const r=el.getBoundingClientRect(),p=worldPoint(r.right,r.top+r.height/2);button.style.left=(p.x+18)+'px';button.style.top=(p.y-14)+'px';
 }
 function targetAt(x,y){for(const el of document.elementsFromPoint(x,y)){const n=el.closest?.('#nodes>.node');if(n&&n.dataset.node!==gesture?.from&&board().nodes.some(item=>item.id===n.dataset.node))return n;}return null;}
 function highlight(target){document.querySelectorAll('.vb-connection-target').forEach(el=>el.classList.remove('vb-connection-target'));if(target)target.classList.add('vb-connection-target');}
 function paint(x,y){const p=worldPoint(x,y),start=gesture.startWorld,delta=Math.max(50,Math.abs(p.x-start.x)*.4);preview.querySelector('path').setAttribute('d',`M${start.x},${start.y} C${start.x+delta},${start.y} ${p.x-delta},${p.y} ${p.x},${p.y}`);preview.removeAttribute('hidden');}
 function cancel(){const g=gesture;gesture=null;preview.setAttribute('hidden','');preview.querySelector('path').removeAttribute('d');highlight(null);document.body.classList.remove('vb-connecting');if(g&&controls.hasPointerCapture?.(g.pointer))controls.releasePointerCapture(g.pointer);}
 window.VBConnections={cancel,get dragging(){return !!gesture;},refresh:decorate};
 const baseRender=render;render=function(){if(gesture&&gesture.board!==board().id)cancel();baseRender();decorate();};
 const baseSelect=select;select=function(id){cancel();baseSelect(id);decorate();};
 const baseNavigate=navigate;navigate=function(id){cancel();baseNavigate(id);decorate();};
 const baseEdges=renderEdges;renderEdges=function(){baseEdges();decorate();};
 const baseAction=action;action=function(name){if(name==='connect'){mode='select';connectStart=null;decorate();toast(node()?'按住卡片旁的圆形按钮，拖到目标组件。':'先选中一个组件，再拖动它旁边的圆形按钮。');return;}baseAction(name);};
 window.addEventListener('pointerdown',e=>{
  const button=e.target.closest?.('[data-connect-node]');if(!button||e.button!==0||window.VBFolderInteraction?.moving)return;
  e.preventDefault();e.stopImmediatePropagation();cancel();window.VBEdgeStyle?.clear();
  const from=button.dataset.connectNode;if(!board().nodes.some(n=>n.id===from))return;
  const r=button.getBoundingClientRect();gesture={from,board:board().id,pointer:e.pointerId,startX:e.clientX,startY:e.clientY,startWorld:worldPoint(r.left+r.width/2,r.top+r.height/2),moved:false};
  controls.setPointerCapture(e.pointerId);document.body.classList.add('vb-connecting');
 },true);
 window.addEventListener('pointermove',e=>{
  if(!gesture||gesture.pointer!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();
  if(gesture.board!==board().id){cancel();return;}
  if(!gesture.moved&&Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY)<6)return;
  gesture.moved=true;paint(e.clientX,e.clientY);const target=targetAt(e.clientX,e.clientY);gesture.target=target?.dataset.node;highlight(target);
 },{capture:true,passive:false});
 window.addEventListener('pointerup',e=>{
  if(!gesture||gesture.pointer!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();const g=gesture,target=g.moved&&targetAt(e.clientX,e.clientY)?.dataset.node;cancel();suppressUntil=Date.now()+250;suppressPoint={x:e.clientX,y:e.clientY};
  if(!target||g.board!==board().id||target===g.from)return;
  const existing=board().edges.find(edge=>samePair(edge.from,edge.to,g.from,target));
  if(existing){window.VBEdgeStyle?.selectEdge({...existing,kind:'space'});return;}
  board().edges.push({from:g.from,to:target});state.showSpace=true;void save();renderEdges();window.VBEdgeStyle?.selectEdge({kind:'space',from:g.from,to:target});
 },true);
 window.addEventListener('pointercancel',e=>{if(gesture?.pointer===e.pointerId){e.stopImmediatePropagation();cancel();suppressUntil=Date.now()+250;}},true);
 window.addEventListener('keydown',e=>{if(gesture&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();suppressUntil=Date.now()+250;}},true);
 window.addEventListener('click',e=>{if(e.target.closest?.('[data-connect-node]')||Date.now()<suppressUntil&&suppressPoint&&Math.hypot(e.clientX-suppressPoint.x,e.clientY-suppressPoint.y)<3){e.preventDefault();e.stopImmediatePropagation();}},true);
 window.addEventListener('blur',cancel);
 decorate();
})();
