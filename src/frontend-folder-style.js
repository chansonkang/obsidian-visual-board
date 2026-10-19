/* Default folders combine local glass colors with independent Lucide stickers. */
(() => {
 const palette=[
  {id:'lavender',label:'雾紫',hex:'#c7bcec',filter:'none'},
  {id:'rose',label:'玫粉',hex:'#e7bdd4',filter:'hue-rotate(55deg) saturate(1.15)'},
  {id:'peach',label:'暖桃',hex:'#e8c6b0',filter:'hue-rotate(115deg) saturate(1.3)'},
  {id:'mint',label:'薄荷',hex:'#b6dac5',filter:'hue-rotate(245deg) saturate(.95)'},
  {id:'sky',label:'晴蓝',hex:'#b7cfea',filter:'hue-rotate(325deg) saturate(1.05)'},
  {id:'sand',label:'奶杏',hex:'#ddd0ae',filter:'hue-rotate(155deg) saturate(.75)'},
  {id:'slate',label:'雾灰',hex:'#c5cbd2',filter:'grayscale(1) saturate(0)'}
 ];
 const color=id=>palette.find(p=>p.id===id)||palette[0];
 window.VBFolderStyle={color:'lavender',palette};
 const baseFolder=defaultFolder;
 defaultFolder=function(name,id,status='default',folderColor='lavender'){
  const c=color(folderColor);
  return baseFolder(name,id,status).replace('class="folder-art custom-folder default-folder"','class="folder-art custom-folder default-folder" data-folder-color="'+c.id+'" style="--vb-folder-tint:'+c.filter+'"');
 };
 const baseArt=themeArt;
 themeArt=function(theme,b){if(b&&!b.iconUrl)return defaultFolder(b.title,b.iconId,b.iconStatus,b.folderColor);return baseArt(theme,b);};
 function renderColors(){
  let controls=$('default-folder-style');
  if(!controls){controls=document.createElement('fieldset');controls.id='default-folder-style';controls.dataset.testid='default-folder-style';controls.className='vb-folder-style';$('icon-picker').before(controls);}
  controls.hidden=iconMode!=='default';if(controls.hidden)return;
  const c=color(window.VBFolderStyle.color);
  controls.innerHTML='<legend>文件夹颜色</legend><div class="vb-folder-colors">'+palette.map(p=>'<button type="button" data-folder-color-choice="'+p.id+'" data-testid="folder-color-'+p.id+'" aria-label="文件夹颜色 '+p.label+'" aria-pressed="'+(p.id===c.id)+'" class="vb-color-choice '+(p.id===c.id?'selected':'')+'"><span class="vb-color-dot" style="background:'+p.hex+'"></span><span>'+p.label+'</span></button>').join('')+'</div><small>颜色与贴纸可以自由组合，全部保存在本地。</small>';
 }
 const basePreview=renderIconPreview;
 renderIconPreview=function(){
  basePreview();if(!$('board-icon-preview'))return;
  if(iconMode==='default'){
   $('board-icon-preview').innerHTML=defaultFolder($('new-board-title').value.trim()||'新的 Board',chosenIcon,'default',window.VBFolderStyle.color);
   $('icon-preview-title').textContent='玻璃文件夹 · 自由组合';
   $('icon-status').textContent=manualIcon?'已自定义':'按名称匹配';
   $('icon-description').textContent=color(window.VBFolderStyle.color).label+' · '+(iconCatalog().find(i=>i.id===chosenIcon)?.label||'文件夹');
   $('icon-save-note').textContent='颜色与贴纸独立选择，无需联网';
   const reset=document.createElement('button');reset.className='icon-config-link';reset.dataset.folderAutoIcon='';reset.textContent='按名称匹配贴纸';reset.dataset.testid='folder-auto-icon';$('icon-preview-actions').append(reset);
  }
  renderColors();
 };
 const baseDialog=openBoardDialog;
 openBoardDialog=function(id=null){window.VBFolderStyle.color=color(id?state.boards[id]?.folderColor:undefined).id;baseDialog(id);
  if(id&&$('new-board-title')){const dialog=document.querySelector('.board-modal');dialog?.setAttribute('aria-label','修改 Board 样式与名称');const title=dialog?.querySelector('.modal-header h2');if(title)title.textContent='修改 Board 样式与名称';}
 };
 const basePicker=iconPicker;
 iconPicker=function(){basePicker();for(const btn of document.querySelectorAll('#icon-picker [data-icon]')){btn.setAttribute('aria-pressed',String(btn.dataset.icon===chosenIcon));btn.classList.toggle('selected',btn.dataset.icon===chosenIcon);}};
 const baseSelection=renderSelection;
 renderSelection=function(){baseSelection();const n=node();if(!n?.board||!state.boards[n.board])return;const btn=document.createElement('button');btn.textContent='修改样式';btn.dataset.folderStyleBoard=n.board;btn.dataset.testid='edit-folder-style';$('selection-bar').insertBefore(btn,$('selection-bar').lastElementChild);};
 document.addEventListener('click',e=>{
  const t=e.target.closest('[data-folder-color-choice],[data-folder-auto-icon],[data-folder-style-board]');if(!t)return;e.preventDefault();e.stopImmediatePropagation();
  if(t.dataset.folderStyleBoard){openBoardDialog(t.dataset.folderStyleBoard);return;}
  if(t.hasAttribute('data-folder-auto-icon')){manualIcon=false;chosenIcon=matchIcon($('new-board-title').value.trim());$('icon-picker').innerHTML='';}
  else window.VBFolderStyle.color=color(t.dataset.folderColorChoice).id;
  renderIconPreview();
 },true);
 render();
})();
