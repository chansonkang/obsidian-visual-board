/* Conflict copies live outside the plugin directory and never rotate with layout history. */
(() => {
 const t=(zh,en)=>hostLanguage()==='en'?en:zh;
 function hostLanguage(){return window.VBI18n?.language||document.documentElement.lang;}
 const base=settings;settings=function(){base();const foot=document.querySelector('.modal .modal-foot');if(foot){const button=document.createElement('button');button.className='btn';button.dataset.layoutRecovery='';button.textContent=t('保存冲突记录','Saved conflict copies');foot.prepend(button);}};
 async function show(){
  try{const files=await VBHost.rpc('list-layout-conflicts');setModal(t('保存冲突记录','Saved conflict copies'),'<p>'+t('同时修改同一处内容时，副本会保存在本地。可下载完整副本，找回便签文字与组件排版。','When the same content is edited concurrently, a local copy is kept. Download it to recover sticky text and component layouts.')+'</p>'+files.slice(0,50).map(name=>'<div class="trash-record"><strong>'+esc(new Date(Number(name.split('-')[0])).toLocaleString())+'</strong><button class="btn" data-download-layout-copy="'+esc(name)+'">'+t('下载恢复副本','Download recovery copy')+'</button></div>').join('')+(files.length?'':'<p>'+t('目前没有保存冲突。','No save conflicts yet.')+'</p>'));}catch(error){toast(error.message);}
 }
 document.addEventListener('click',async event=>{const button=event.target.closest?.('[data-layout-recovery],[data-download-layout-copy]');if(!button)return;event.preventDefault();if(button.hasAttribute('data-layout-recovery')){void show();return;}try{const name=button.dataset.downloadLayoutCopy,copy=await VBHost.rpc('read-layout-conflict',{name}),url=URL.createObjectURL(new Blob([JSON.stringify(copy,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='visual-board-recovery-'+name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){toast(error.message);}},true);
})();
