/* Per-relation visual styles. Knowledge edges still come exclusively from Vault links. */
(() => {
 let selectedEdge=null,saveTimer;const panel=document.createElement('section');panel.id='edge-style-panel';panel.className='vb-edge-panel';panel.dataset.testid='edge-style-panel';panel.hidden=true;panel.setAttribute('aria-label','编辑关系连线');$('scene').append(panel);
 const pair=(a,b)=>JSON.stringify([a,b].sort()),key=e=>e.kind+':'+pair(e.from,e.to);
 const restore=document.createElement('button');restore.className='vb-edge-restore';restore.dataset.testid='restore-knowledge-edges';restore.hidden=true;$('scene').append(restore);
 window.VBEdgeStyle={get selected(){return selectedEdge;},clear,selectEdge};
 function entry(){if(!selectedEdge||selectedEdge.board!==board().id)return;const b=board();return selectedEdge.kind==='space'?b.edges.find(e=>pair(e.from,e.to)===pair(selectedEdge.from,selectedEdge.to)):(b.knowledgeEdgeStyles||[]).find(e=>pair(e.from,e.to)===pair(selectedEdge.from,selectedEdge.to));}
 const defaults=kind=>({lineStyle:kind==='knowledge'?'dashed':'solid',width:kind==='knowledge'?1.5:2});
 function renderPanel(){
  const hidden=(board().knowledgeEdgeStyles||[]).filter(e=>e.hidden===true).length;restore.hidden=!hidden;restore.textContent='恢复隐藏文章连线 · '+hidden;
  if(!selectedEdge){panel.hidden=true;panel.dataset.edgeKey='';return;}panel.hidden=false;
  const current=key(selectedEdge),e=entry()||{},d=defaults(selectedEdge.kind),width=e.width??d.width,style=e.lineStyle||d.lineStyle;
  if(panel.dataset.edgeKey!==current){panel.dataset.edgeKey=current;panel.innerHTML='<div class="vb-edge-header"><strong>'+(selectedEdge.kind==='space'?'画板连线':'文章链接')+'</strong><button data-edge-close data-testid="edge-style-close" aria-label="关闭连线编辑">×</button></div><div class="vb-edge-types"><button data-edge-style="solid" data-testid="edge-style-solid">实线</button><button data-edge-style="dashed" data-testid="edge-style-dashed">虚线</button></div><label class="vb-edge-width-label" for="edge-width">线条粗细 <span id="edge-width-label"></span></label><input id="edge-width" data-testid="edge-style-width" type="range" min="1" max="8" step="0.5" aria-label="线条粗细"><div class="vb-edge-presets">'+[1,2,4,6].map(w=>'<button data-edge-width="'+w+'">'+w+' px</button>').join('')+'</div><div class="vb-edge-footer"><button data-edge-reset data-testid="edge-style-reset">恢复默认</button><button data-edge-delete data-testid="edge-style-delete">'+(selectedEdge.kind==='space'?'删除连线':'在此画板隐藏')+'</button></div>'+(selectedEdge.kind==='knowledge'?'<small class="vb-edge-note">只隐藏当前画板中的连线，原文双向链接保留。</small>':'');}
  for(const button of panel.querySelectorAll('[data-edge-style]')){const active=button.dataset.edgeStyle===style;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  panel.querySelector('#edge-width-label').textContent=width+' px';const range=panel.querySelector('#edge-width');if(document.activeElement!==range)range.value=String(width);
 }
 function clear(){selectedEdge=null;renderEdges();}
 function update(values){if(!selectedEdge)return;let e=entry();if(!e&&selectedEdge.kind==='knowledge'){e={from:selectedEdge.from,to:selectedEdge.to};(board().knowledgeEdgeStyles||=[]).push(e);}if(!e)return;Object.assign(e,values);renderEdges();clearTimeout(saveTimer);saveTimer=setTimeout(()=>void save(),140);}
 renderEdges=function(){
  const b=board(),out=[],visible=new Set();
  const draw=(a,z,kind,style)=>{if(!a||!z||kind==='knowledge'&&style?.hidden===true)return;const e={board:b.id,kind,from:a.id,to:z.id},k=key(e);visible.add(k);const d=defaults(kind),w=style?.width??d.width,line=style?.lineStyle||d.lineStyle;
   const width=n=>n.w||document.querySelector('[data-node="'+CSS.escape(n.id)+'"]')?.offsetWidth||(n.type==='board'?300:320);
   const height=n=>n.h||document.querySelector('[data-node=\"'+CSS.escape(n.id)+'\"]')?.offsetHeight||(n.type==='board'?303:240);
   const right=z.x>=a.x,x1=a.x+(right?width(a):0),y1=a.y+height(a)/2,x2=z.x+(right?0:width(z)),y2=z.y+height(z)/2,delta=right?80:-80,path=`M${x1},${y1} C${x1+delta},${y1} ${x2-delta},${y2} ${x2},${y2}`;
   const attrs='data-edge-kind="'+kind+'" data-edge-from="'+esc(a.id)+'" data-edge-to="'+esc(z.id)+'"';
   out.push('<g class="vb-edge-group"><path class="edge '+kind+(selectedEdge&&key(selectedEdge)===k?' edge-selected':'')+'" d="'+path+'" style="stroke-width:'+w+';stroke-dasharray:'+(line==='dashed'?'6 7':'none')+'" data-testid="edge-line-'+kind+'-'+esc(a.id)+'-'+esc(z.id)+'"/><path class="vb-edge-hit" '+attrs+' d="'+path+'" data-testid="edge-hit-'+kind+'-'+esc(a.id)+'-'+esc(z.id)+'" tabindex="0" role="button" aria-label="编辑'+(kind==='space'?'画板连线':'文章链接')+'"/></g>');
  };
  if(state.showSpace)b.edges.forEach(e=>draw(b.nodes.find(n=>n.id===e.from),b.nodes.find(n=>n.id===e.to),'space',e));
  if(state.showKnowledge){const seen=new Set();for(const a of b.nodes.filter(n=>n.doc))for(const target of state.docs[a.doc]?.outgoing||[])for(const z of b.nodes.filter(n=>n.doc===target)){const p=pair(a.id,z.id);if(a.id===z.id||seen.has(p))continue;seen.add(p);draw(a,z,'knowledge',(b.knowledgeEdgeStyles||[]).find(e=>pair(e.from,e.to)===p));}}
  $('edges').innerHTML=out.join('');if(selectedEdge&&(selectedEdge.board!==b.id||!visible.has(key(selectedEdge))))selectedEdge=null;renderPanel();
 };
 function selectEdge(e){if(!e||!['space','knowledge'].includes(e.kind)||!board().nodes.some(n=>n.id===e.from)||!board().nodes.some(n=>n.id===e.to)||e.from===e.to)return;window.VBMultiSelection?.clear();selected=null;$('preview').innerHTML='';document.querySelectorAll('#nodes>.selected').forEach(el=>el.classList.remove('selected'));renderSelection();selectedEdge={board:board().id,kind:e.kind,from:e.from,to:e.to};renderEdges();window.VBHistory?.focusGesture();}
 function selectLine(hit){selectEdge({kind:hit.dataset.edgeKind,from:hit.dataset.edgeFrom,to:hit.dataset.edgeTo});}
 window.addEventListener('pointerdown',e=>{const hit=e.target.closest?.('.vb-edge-hit');if(hit){e.preventDefault();e.stopImmediatePropagation();selectLine(hit);return;}if(e.target.closest?.('#edge-style-panel')){e.stopImmediatePropagation();return;}if(selectedEdge&&!e.target.closest?.('#selection-bar,.bottom-toolbar'))clear();},true);
 window.addEventListener('click',e=>{
  const hit=e.target.closest?.('.vb-edge-hit');if(hit){e.stopImmediatePropagation();selectLine(hit);return;}
  const button=e.target.closest?.('#edge-style-panel button');if(!button)return;e.stopImmediatePropagation();
  if(button.hasAttribute('data-edge-close'))clear();else if(button.dataset.edgeStyle)update({lineStyle:button.dataset.edgeStyle});else if(button.dataset.edgeWidth)update({width:Number(button.dataset.edgeWidth)});
  else if(button.hasAttribute('data-edge-reset')){const e=entry();if(e){delete e.width;delete e.lineStyle;renderEdges();void save();}}
  else if(button.hasAttribute('data-edge-delete')&&selectedEdge){if(selectedEdge.kind==='space'){const p=pair(selectedEdge.from,selectedEdge.to);board().edges=board().edges.filter(e=>pair(e.from,e.to)!==p);}else{let e=entry();if(!e){e={from:selectedEdge.from,to:selectedEdge.to};(board().knowledgeEdgeStyles||=[]).push(e);}e.hidden=true;}selectedEdge=null;renderEdges();void save();}
 },true);
 panel.addEventListener('input',e=>{if(e.target.id==='edge-width')update({width:Number(e.target.value)});});panel.addEventListener('change',()=>{clearTimeout(saveTimer);void save();});
 restore.addEventListener('pointerdown',e=>{e.stopPropagation();});restore.addEventListener('click',e=>{e.stopPropagation();for(const style of board().knowledgeEdgeStyles||[])delete style.hidden;state.showKnowledge=true;renderEdges();void save();});
 window.addEventListener('keydown',e=>{if(e.target.closest?.('.vb-edge-hit')&&['Enter',' '].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();selectLine(e.target.closest('.vb-edge-hit'));}else if(selectedEdge&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();clear();}},true);
 const baseSelect=select;select=function(id){selectedEdge=null;baseSelect(id);renderEdges();};const baseNavigate=navigate;navigate=function(id){selectedEdge=null;baseNavigate(id);renderEdges();};
 renderEdges();
})();
