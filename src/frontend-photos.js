/* Local bitmap cards keep native pixel dimensions and proportional resizing. */
(() => {
 const measured=new Map(),loading=new Map();
 function measure(url){
  if(!measured.has(url)){const promise=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>img.naturalWidth&&img.naturalHeight?resolve({w:img.naturalWidth+20,h:img.naturalHeight+20,imageWidth:img.naturalWidth,imageHeight:img.naturalHeight}):reject(Error('图片尺寸无效。'));img.onerror=()=>reject(Error('图片无法解码，请重新选择 PNG、JPEG、WebP 或 GIF。'));img.src=url;});measured.set(url,promise);promise.catch(()=>measured.delete(url));}
  return measured.get(url);
 }
 function resize(n,start,dir,dx,dy,free){
  const ratio=n.imageWidth&&n.imageHeight?n.imageWidth/n.imageHeight:(start.w-20)/(start.h-20);
  const sw=Math.max(1,start.w-20),sh=Math.max(1,start.h-20);let width;
  if(dir.length===2){const sx=dir.includes('e')?1:-1,sy=dir.includes('s')?1:-1;const scale=1+(sx*dx*sw+sy*dy*sh)/(sw*sw+sh*sh);width=sw*scale;}
  else width=dir==='e'?sw+dx:dir==='w'?sw-dx:(sh+(dir==='s'?dy:-dy))*ratio;
  if(!free)width=Math.round(width/20)*20;
  width=Math.max(Math.max(1,ratio),Math.min(Math.min(99980,99980*ratio),width));
  const height=width/ratio+20;width+=20;n.w=width;n.h=height;
  n.x=dir.includes('w')?start.x+start.w-width:dir.includes('e')?start.x:start.x+(start.w-width)/2;
  n.y=dir.includes('n')?start.y+start.h-height:dir.includes('s')?start.y:start.y+(start.h-height)/2;
 }
 function handles(el,n){
  if(!el.querySelector('.resize-handle'))for(const dir of ['n','e','s','w','ne','se','sw','nw']){const h=document.createElement('span');h.className='resize-handle resize-'+dir;h.dataset.resize=dir;h.dataset.testid='resize-'+n.id+'-'+dir;h.setAttribute('role','button');h.tabIndex=0;h.setAttribute('aria-label','保持图片比例缩放 '+dir);el.append(h);}
  let badge=el.querySelector('.size-badge');if(!badge){badge=document.createElement('span');badge.className='size-badge';badge.dataset.testid='size-'+n.id;el.append(badge);}badge.textContent=Math.round(n.w)+' × '+Math.round(n.h);
 }
 function decorate(){
  for(const n of board().nodes){if(n.type!=='photo')continue;const el=[...$('nodes').children].find(el=>el.dataset.node===n.id);if(!el)continue;
   el.style.width=(n.w||320)+'px';el.style.height=(n.h||240)+'px';handles(el,n);
   const img=el.querySelector('img');if(!img)continue;let status=el.querySelector('.vb-photo-status');if(!status){status=document.createElement('span');status.className='vb-photo-status';status.hidden=true;el.append(status);}
   const path=n.imagePath,asset=VBHost.imageAsset(path);el.dataset.imagePath=path||'';
   img.onload=()=>{img.style.visibility='';status.hidden=true;};img.onerror=()=>{img.style.visibility='hidden';status.hidden=false;status.textContent='图片暂时无法显示，可点击更换图片';};
   if(!asset){status.hidden=false;status.textContent='正在读取本地图片…';if(!loading.has(path)){const task=VBHost.loadImageAsset(path).then(url=>{if(!url)throw Error('图片附件已移动或删除');render();}).catch(error=>{for(const card of document.querySelectorAll('.vault-photo'))if(card.dataset.imagePath===path){const s=card.querySelector('.vb-photo-status');if(s){s.hidden=false;s.textContent=error.message;}}}).finally(()=>loading.delete(path));loading.set(path,task);}continue;}
   if(!n.imageWidth||!n.imageHeight){void measure(asset).then(dimensions=>{if(n.imagePath!==path)return;Object.assign(n,dimensions);if(el.isConnected){el.style.width=n.w+'px';el.style.height=n.h+'px';handles(el,n);renderEdges();}void save();}).catch(error=>{status.hidden=false;status.textContent=error.message;});}
  }
 }
 window.VBPhotos={measure,resize,decorate};
 const baseRender=render;render=function(){baseRender();decorate();};
 const baseSelect=select;select=function(id){baseSelect(id);decorate();};
 decorate();
})();
