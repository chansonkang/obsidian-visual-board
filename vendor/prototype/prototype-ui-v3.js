'use strict';

// The menu stays in the canvas chrome; no modal or page navigation is involved.
function ensureZoomPopover(){
  let menu=document.getElementById('zoom-popover');
  if(menu)return menu;
  menu=document.createElement('div');
  menu.id='zoom-popover';
  menu.setAttribute('role','menu');
  menu.setAttribute('aria-label','画布缩放预设');
  menu.innerHTML='<span class="zoom-heading">画布缩放</span>'+[50,75,100,150,200].map(percent=>`<button type="button" role="menuitemradio" aria-checked="false" data-zoom-preset="${percent}" data-testid="zoom-preset-${percent}"><span>${percent}%</span><span class="zoom-check" aria-hidden="true">✓</span></button>`).join('');
  $('scene').appendChild(menu);
  $('zoom-value').setAttribute('aria-haspopup','menu');
  $('zoom-value').setAttribute('aria-controls','zoom-popover');
  $('zoom-value').setAttribute('aria-expanded','false');
  return menu;
}
function closeZoomPopover(returnFocus=false){
  const menu=$('zoom-popover');
  if(!menu||!menu.classList.contains('open'))return;
  menu.classList.remove('open');
  $('zoom-value').setAttribute('aria-expanded','false');
  if(returnFocus)$('zoom-value').focus();
}
function refreshZoomChrome(){
  const percent=Math.round(board().view.zoom*100);
  $('zoom-value').textContent=percent+'%';
  $('zoom-value').setAttribute('aria-label','画布缩放 '+percent+'%，选择预设');
  const menu=$('zoom-popover');
  if(menu)menu.querySelectorAll('[data-zoom-preset]').forEach(button=>button.setAttribute('aria-checked',String(Number(button.dataset.zoomPreset)===percent)));
}
function zoom(){
  const menu=ensureZoomPopover(),open=!menu.classList.contains('open');
  menu.classList.toggle('open',open);
  $('zoom-value').setAttribute('aria-expanded',String(open));
  refreshZoomChrome();
  if(open){
    const current=menu.querySelector('[aria-checked="true"]')||menu.querySelector('[data-zoom-preset="100"]');
    current.focus({preventScroll:true});
  }
}
function setCanvasZoom(percent){
  const view=board().view,previous=view.zoom||1;
  const next=Math.max(30,Math.min(200,Math.round(Number(percent)||100)))/100;
  // Keep the world point under the visual center fixed while zooming.
  const canvas=$('canvas'),anchorX=canvas.clientWidth/2,anchorY=canvas.clientHeight/2;
  view.x=anchorX-(anchorX-view.x)/previous*next;
  view.y=anchorY-(anchorY-view.y)/previous*next;
  view.zoom=next;
  applyView();
  refreshZoomChrome();
  save();
  return Math.round(next*100);
}
function changeZoom(delta){
  if(!delta)return Math.round(board().view.zoom*100);
  const current=Math.round(board().view.zoom*100);
  const target=delta>0?(Math.floor(current/10)+1)*10:(Math.ceil(current/10)-1)*10;
  return setCanvasZoom(target);
}

document.addEventListener('click',event=>{
  const preset=event.target.closest('[data-zoom-preset]');
  if(preset){setCanvasZoom(Number(preset.dataset.zoomPreset));closeZoomPopover(true);return;}
  if(!event.target.closest('#zoom-popover,#zoom-value'))closeZoomPopover();
});
document.addEventListener('keydown',event=>{
  const menu=$('zoom-popover');
  if(!menu?.classList.contains('open'))return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeZoomPopover(true);return;}
  if(!menu.contains(event.target))return;
  const buttons=[...menu.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
    event.preventDefault();event.stopImmediatePropagation();
    let next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
    buttons[next].focus();
  }
},true);

// Old render code changes the label on each pan; keep it formatted consistently.
new MutationObserver(()=>{
  if($('zoom-value').textContent.endsWith('﹀'))refreshZoomChrome();
}).observe($('zoom-value'),{childList:true});
refreshZoomChrome();
