/* A persistent contextual toolbar. Pointer controls keep the native article selection. */
(() => {
  'use strict';
  const t=key=>window.VBI18n?.t(key)||key;
  // Lucide-style vector marks stay crisp at every canvas zoom. No external assets.
  const icons={paragraph:'<path d="M13 4v16M18 4v16M20 4H9a5 5 0 0 0 0 10h4"/>',h1:'<path d="M4 5v14M14 5v14M4 12h10M18 10l2-1v10M18 19h4"/>',h2:'<path d="M3 5v14M12 5v14M3 12h9M16 12a3 3 0 0 1 6 0c0 2-6 4-6 7h6"/>',h3:'<path d="M3 5v14M12 5v14M3 12h9M16 10a3 3 0 0 1 6 1c0 2-2 2-3 2 1 0 3 0 3 3a3 3 0 0 1-6 1"/>',bold:'<path d="M6 12h8a4 4 0 0 1 0 8H6V4h7a4 4 0 0 1 0 8"/>',italic:'<path d="M19 4h-9M14 20H5M15 4 9 20"/>','unordered-list':'<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>','ordered-list':'<path d="M10 6h11M10 12h11M10 18h11M3 4h1v5M3 9h2M3 14a2 2 0 0 1 4 0c0 1-4 3-4 5h4"/>',quote:'<path d="M3 11h6v6H3v-6c0-4 2-5 5-5M15 11h6v6h-6v-6c0-4 2-5 5-5"/>',table:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',done:'<path d="m5 12 4 4L19 6"/>'};
  const toolbar=document.createElement('div');toolbar.id='vb-format-toolbar';toolbar.className='vb-format-toolbar';toolbar.dataset.testid='format-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','文章格式工具');toolbar.hidden=true;
  const items=[['paragraph','正文'],['h1','标题 1'],['h2','标题 2'],['h3','标题 3'],['bold','加粗'],['italic','斜体'],['unordered-list','圆点列表'],['ordered-list','编号列表'],['quote','引用'],['table','插入表格'],['done','完成']];
  for(const[kind,label]of items){const button=document.createElement('button');button.type='button';button.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+icons[kind]+'</svg>';button.dataset.formatCommand=kind;button.dataset.testid='format-'+kind;button.setAttribute('aria-label',t(label));button.title=t(label);button.tabIndex=0;if(kind!=='done')button.setAttribute('aria-pressed','false');toolbar.append(button);}
  document.body.append(toolbar);
  const tablePanel=document.createElement('div');tablePanel.className='vb-table-panel';tablePanel.dataset.testid='table-panel';tablePanel.setAttribute('role','dialog');tablePanel.setAttribute('aria-label','插入 Markdown 表格');tablePanel.hidden=true;
  tablePanel.innerHTML='<div class="vb-table-panel-title" data-format-label="插入表格">插入表格</div><div class="vb-table-presets"><button type="button" data-table-preset="2">2 × 2</button><button type="button" data-table-preset="3">3 × 3</button><button type="button" data-table-preset="4">4 × 4</button></div><div class="vb-table-fields"><div><span data-format-label="列数">列数</span><span class="vb-table-stepper"><button type="button" data-table-step="columns:-1" data-format-aria="减少表格列数">−</button><output data-testid="table-columns">3</output><button type="button" data-table-step="columns:1" data-format-aria="增加表格列数">+</button></span></div><div><span data-format-label="正文行数">正文行数</span><span class="vb-table-stepper"><button type="button" data-table-step="rows:-1" data-format-aria="减少表格正文行数">−</button><output data-testid="table-rows">3</output><button type="button" data-table-step="rows:1" data-format-aria="增加表格正文行数">+</button></span></div></div><p data-format-label="另含一行表头，插入在当前段落后。">另含一行表头，插入在当前段落后。</p><div class="vb-table-panel-actions"><button type="button" data-table-cancel data-format-label="取消">取消</button><button type="button" data-testid="table-insert" data-table-insert data-format-label="插入">插入</button></div><div class="vb-table-error" role="status"></div>';
  document.body.append(tablePanel);
  const tableButton=toolbar.querySelector('[data-format-command="table"]');tableButton.setAttribute('aria-haspopup','dialog');tableButton.setAttribute('aria-expanded','false');
  let owner=null,bookmark=null,frame=0,dirty=true,tableTarget=null;
  const tooltip=document.createElement('div');tooltip.id='vb-format-tooltip';tooltip.className='vb-format-tooltip';tooltip.setAttribute('role','tooltip');tooltip.hidden=true;document.body.append(tooltip);let tooltipOwner=null;
  function hideTooltip(){tooltipOwner?.removeAttribute('aria-describedby');tooltipOwner=null;tooltip.hidden=true;}
  function positionTooltip(){if(!tooltipOwner?.isConnected||toolbar.hidden){hideTooltip();return;}const rect=tooltipOwner.getBoundingClientRect(),tip=tooltip.getBoundingClientRect();tooltip.style.left=Math.round(Math.max(8,Math.min(innerWidth-tip.width-8,rect.left+(rect.width-tip.width)/2)))+'px';tooltip.style.top=Math.round(rect.bottom+tip.height+8<innerHeight?rect.bottom+7:Math.max(8,rect.top-tip.height-7))+'px';}
  function showTooltip(button){if(!button||!toolbar.contains(button))return;hideTooltip();tooltipOwner=button;button.setAttribute('aria-describedby',tooltip.id);tooltip.textContent=button.title;tooltip.hidden=false;positionTooltip();}
  function localize(){toolbar.setAttribute('aria-label',t('文章格式工具'));tablePanel.setAttribute('aria-label',t('插入 Markdown 表格'));for(const el of tablePanel.querySelectorAll('[data-format-label]'))el.textContent=t(el.dataset.formatLabel);for(const el of tablePanel.querySelectorAll('[data-format-aria]'))el.setAttribute('aria-label',t(el.dataset.formatAria));for(const [kind,label]of items){const button=toolbar.querySelector('[data-format-command="'+kind+'"]');button.setAttribute('aria-label',t(label));button.title=t(label);}dirty=true;if(valid(owner))refreshStates();if(tooltipOwner)showTooltip(tooltipOwner);}
  const editorFrom=target=>target?.closest?.('.vb-inline-editor');
  function valid(el){
    return !!el?.isConnected&&el.dataset.inlineReadonly!=='true'&&el.dataset.markdownMode==='edit'&&state.docs[el.dataset.inlinePath]&&!state.docs[el.dataset.inlinePath].missing&&board().nodes.some(n=>n.id===el.dataset.inlineNode&&n.doc===el.dataset.inlinePath);
  }
  function busy(){return mode==='connect'||window.VBHistory?.replaying||window.VBFolderInteraction?.moving||window.VBMultiSelection?.dragging||window.VBConnections?.dragging||!!$('modal-root')?.childElementCount;}
  function capture(){
    if(!valid(owner)){bookmark=null;return false;}
    const selection=getSelection();if(!selection?.rangeCount){bookmark=null;return false;}
    const range=selection.getRangeAt(0);if(!owner.contains(range.startContainer)||!owner.contains(range.endContainer)){bookmark=null;return false;}
    bookmark={start:range.startContainer,startOffset:range.startOffset,end:range.endContainer,endOffset:range.endOffset};return true;
  }
  function restore(){
    if(!valid(owner)||!bookmark||!owner.contains(bookmark.start)||!owner.contains(bookmark.end))return false;
    owner.focus({preventScroll:true});
    if(!owner.contains(bookmark.start)||!owner.contains(bookmark.end))return false;
    const range=document.createRange();
    try{range.setStart(bookmark.start,bookmark.startOffset);range.setEnd(bookmark.end,bookmark.endOffset);}catch{return false;}
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return true;
  }
  function commandState(command){try{return document.queryCommandState(command);}catch{return false;}}
  function refreshStates(){
    const context=window.VBRichEditor?.commandContext(owner)||{valid:false},selection=getSelection(),node=selection?.anchorNode,element=node?.nodeType===1?node:node?.parentElement;
    const heading=element?.closest('h1,h2,h3,h4,h5,h6'),quote=!!element?.closest('blockquote'),ul=commandState('insertUnorderedList'),ol=commandState('insertOrderedList');
    const pressed={paragraph:!heading&&!quote&&!ul&&!ol,h1:heading?.tagName==='H1',h2:heading?.tagName==='H2',h3:heading?.tagName==='H3',bold:commandState('bold'),italic:commandState('italic'),'unordered-list':ul,'ordered-list':ol,quote};
    for(const button of toolbar.children){const kind=button.dataset.formatCommand;
      button.disabled=!!owner.__vbRich?.composing||kind!=='done'&&(!context.valid||context.code||context.imageSelection||context.imageBlock&&!['bold','italic'].includes(kind)||context.inlineCode&&['bold','italic'].includes(kind)||context.table&&!['bold','italic'].includes(kind));
      button.title=t(kind==='table'&&(context.code||context.table)?'请将光标移到代码块或表格外的段落，再插入表格':kind!=='done'&&(context.imageSelection||context.imageBlock&&!['bold','italic'].includes(kind))?'请在纯文字段落中使用此格式':items.find(item=>item[0]===kind)[1]);
      if(kind!=='done')button.setAttribute('aria-pressed',pressed[kind]?'true':'false');
    }
    if(tooltipOwner){tooltip.textContent=tooltipOwner.title;positionTooltip();}
  }
  function position(){
    const rect=owner.closest('.paper').getBoundingClientRect(),bar=toolbar.getBoundingClientRect(),margin=8;
    let x=rect.left+(rect.width-bar.width)/2,y=rect.top-bar.height-10;
    if(y<margin){if(rect.right+bar.width+10<innerWidth){x=rect.right+10;y=rect.top;}else y=margin;}
    x=Math.max(margin,Math.min(innerWidth-bar.width-margin,x));y=Math.max(margin,Math.min(innerHeight-bar.height-margin,y));
    toolbar.style.left=Math.round(x)+'px';toolbar.style.top=Math.round(y)+'px';
    if(!tablePanel.hidden){const panel=tablePanel.getBoundingClientRect(),top=y+bar.height+8;tablePanel.style.left=Math.round(Math.max(margin,Math.min(innerWidth-panel.width-margin,x+bar.width-panel.width)))+'px';tablePanel.style.top=Math.round(top+panel.height<innerHeight-margin?top:Math.max(margin,y-panel.height-8))+'px';}
  }
  function closeTable(){tablePanel.hidden=true;tableTarget=null;tableButton.setAttribute('aria-expanded','false');}
  function close(){const previous=owner;closeTable();hideTooltip();owner=null;bookmark=null;toolbar.hidden=true;dirty=true;if(previous&&document.activeElement!==previous)window.VBInline?.finishEdit(previous);}
  function tick(){
    frame=0;
    const active=editorFrom(document.activeElement);
    if(!valid(owner)||active!==owner&&!toolbar.contains(document.activeElement)&&!tablePanel.contains(document.activeElement)){close();return;}
    toolbar.hidden=!!busy();
    if(toolbar.hidden)closeTable();
    if(!toolbar.hidden){if(dirty&&!tableTarget){refreshStates();dirty=false;}position();if(tooltipOwner)positionTooltip();}else hideTooltip();
    frame=requestAnimationFrame(tick);
  }
  function refresh(){dirty=true;if(owner&&!frame)frame=requestAnimationFrame(tick);}
  document.addEventListener('focusin',event=>{const el=editorFrom(event.target);if(valid(el)){if(owner!==el)close();owner=el;capture();refresh();}else if(!toolbar.contains(event.target)&&!tablePanel.contains(event.target))close();});
  document.addEventListener('selectionchange',()=>{if(owner&&!tablePanel.contains(document.activeElement)&&!toolbar.contains(document.activeElement)){capture();refresh();}});
  function focusedTool(){const button=document.activeElement?.closest?.('[data-format-command]');return button&&toolbar.contains(button)?button:null;}
  // Layout updates can move a stationary pointer between icons. The keyboard
  // focus remains the source of its explanation until focus leaves the rail.
  toolbar.addEventListener('pointerover',event=>showTooltip(focusedTool()||event.target.closest?.('[data-format-command]')));
  toolbar.addEventListener('pointerout',event=>{if(!event.target.closest?.('[data-format-command]')?.contains(event.relatedTarget)){const focused=focusedTool();if(focused)showTooltip(focused);else hideTooltip();}});
  toolbar.addEventListener('focusin',event=>showTooltip(event.target.closest?.('[data-format-command]')));
  toolbar.addEventListener('focusout',hideTooltip);
  document.addEventListener('input',event=>{if(editorFrom(event.target)===owner){capture();refresh();}});
  for(const type of['compositionstart','compositionend'])document.addEventListener(type,event=>{if(editorFrom(event.target)===owner)refresh();});
  window.addEventListener('pointerdown',event=>{if(tablePanel.contains(event.target)){event.stopImmediatePropagation();if(!event.target.matches('input'))event.preventDefault();return;}if(!toolbar.contains(event.target)){if(!tablePanel.hidden)closeTable();return;}capture();event.preventDefault();event.stopImmediatePropagation();},true);
  window.addEventListener('mousedown',event=>{if(toolbar.contains(event.target)||tablePanel.contains(event.target)){if(!event.target.matches('input'))event.preventDefault();event.stopImmediatePropagation();}},true);
  function tableSnapshot(){
    if(!valid(owner)||!restore())return null;
    const selection=getSelection(),range=selection.getRangeAt(0),context=window.VBRichEditor?.commandContext(owner);
    if(!context?.valid||context.code||context.table||context.imageSelection||context.imageBlock)return null;
    const body=window.VBRichEditor.serialize(owner),start=window.VBRichEditor.sourceOffset(owner,range),end=window.VBRichEditor.sourceOffset(owner,range,true);
    let root=range.endContainer;
    while(root&&root.parentNode!==owner&&root!==owner)root=root.parentNode;
    const boundary=document.createRange();
    if(root&&root!==owner){let next=root.nextSibling;while(next&&next.nodeType===Node.TEXT_NODE&&!next.nodeValue.trim())next=next.nextSibling;if(next)boundary.setStartBefore(next);else boundary.setStart(owner,owner.childNodes.length);}else boundary.setStart(owner,Math.min(range.endOffset,owner.childNodes.length));
    boundary.collapse(true);
    const at=Math.max(owner.__vbHiddenPrefix||0,Math.min(body.length,window.VBRichEditor.sourceOffset(owner,boundary)));
    return {el:owner,path:owner.dataset.inlinePath,node:owner.dataset.inlineNode,board:state.currentBoard,body,at,start,end};
  }
  function openTable(){
    if(!tablePanel.hidden){closeTable();return;}
    tableTarget=tableSnapshot();if(!tableTarget)return;
    tablePanel.querySelector('.vb-table-error').textContent='';tablePanel.hidden=false;tableButton.setAttribute('aria-expanded','true');position();
  }
  async function insertTable(){
    const target=tableTarget;if(!target||!valid(target.el)||state.currentBoard!==target.board||busy())return;
    const columns=Number(tablePanel.querySelector('[data-testid="table-columns"]').textContent),rows=Number(tablePanel.querySelector('[data-testid="table-rows"]').textContent),error=tablePanel.querySelector('.vb-table-error');
    if(!Number.isInteger(columns)||columns<2||columns>6||!Number.isInteger(rows)||rows<1||rows>10){error.textContent=t('请选择 2–6 列、1–10 行正文。');return;}
    if(window.VBRichEditor.serialize(target.el)!==target.body){error.textContent=t('文章已变化，请关闭后重新选择插入位置。');return;}
    const eol=target.body.includes('\r\n')?'\r\n':'\n',row=cells=>'| '+cells.join(' | ')+' |',header=row(Array.from({length:columns},(_,i)=>t('列')+' '+(i+1))),lines=[header,row(Array(columns).fill('---')),...Array.from({length:rows},()=>row(Array(columns).fill(' ')))];
    const before=target.body.slice(0,target.at),after=target.body.slice(target.at),padding=value=>!value||value.endsWith(eol+eol)?'':value.endsWith(eol)?eol:eol+eol;
    const leading=padding(before),table=lines.join(eol),trailing=after?after.startsWith(eol+eol)?'':after.startsWith(eol)?eol:eol+eol:eol;
    const next=before+leading+table+trailing+after,caret=before.length+leading.length+2;
    restore();closeTable();
    const result=await window.VBInline?.applyEdit(target.path,next,{expectedBody:target.body,node:target.node,start:target.start,end:target.end,kind:'insertTable'});
    if(result?.ok===false){toast(t('表格未保存，请检查卡片中的保存提示。'));return;}
    if(state.currentBoard===target.board&&valid(target.el))window.VBInline?.focus(target.path,target.node,caret);
    capture();refresh();
  }
  window.addEventListener('click',event=>{
    if(tablePanel.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();const step=event.target.closest('[data-table-step]'),preset=event.target.closest('[data-table-preset]');if(step){const [axis,delta]=step.dataset.tableStep.split(':'),output=tablePanel.querySelector('[data-testid="table-'+axis+'"]');output.textContent=String(Math.max(axis==='columns'?2:1,Math.min(axis==='columns'?6:10,Number(output.textContent)+Number(delta))));}else if(preset){tablePanel.querySelector('[data-testid="table-columns"]').textContent=preset.dataset.tablePreset;tablePanel.querySelector('[data-testid="table-rows"]').textContent=preset.dataset.tablePreset;}else if(event.target.closest('[data-table-cancel]')){closeTable();restore();refresh();}else if(event.target.closest('[data-table-insert]'))void insertTable();return;}
    const button=event.target.closest?.('[data-format-command]');if(!button||!toolbar.contains(button))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(button.disabled||!valid(owner)||owner?.__vbRich?.composing||busy())return;
    const kind=button.dataset.formatCommand;
    if(kind==='done'){const el=owner;restore();close();el.blur();void window.VBInline?.flushAll();return;}
    if(kind==='table'){openTable();if(event.detail===0&&!tablePanel.hidden)tablePanel.querySelector('button')?.focus({preventScroll:true});return;}
    closeTable();
    if(!toolbar.contains(document.activeElement)&&!capture()||!restore())return;
    window.VBRichEditor?.runCommand(owner,kind);capture();refresh();
  },true);
  window.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase();
    if((toolbar.contains(event.target)||tablePanel.contains(event.target))&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.isComposing&&event.keyCode!==229&&(key==='z'||key==='y')){
      event.preventDefault();event.stopImmediatePropagation();
      if(valid(owner)&&!owner.__vbRich?.composing&&!busy()){closeTable();if(restore()){window.VBInline?.historyUndo(owner,key==='y'||event.shiftKey);capture();refresh();}}
    }
  },true);
  window.addEventListener('keydown',event=>{if(event.altKey&&event.key==='F10'&&editorFrom(event.target)===owner){event.preventDefault();event.stopImmediatePropagation();capture();toolbar.querySelector('button:not(:disabled)')?.focus({preventScroll:true});return;}if(toolbar.contains(event.target)||tablePanel.contains(event.target)||!tablePanel.hidden&&event.key==='Escape'){event.stopImmediatePropagation();if(event.key==='Escape'){event.preventDefault();hideTooltip();closeTable();if(restore())refresh();}else if(toolbar.contains(event.target)&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const buttons=[...toolbar.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(event.target),at=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;buttons[at]?.focus({preventScroll:true});}}},true);
  window.addEventListener('vb-language-change',localize);localize();
  window.addEventListener('resize',refresh);window.addEventListener('scroll',refresh,true);
  window.VBFormatToolbar={refresh,hide:close,focus(){if(valid(owner)&&!busy()&&!owner.__vbRich?.composing&&capture())toolbar.querySelector('button:not(:disabled)')?.focus({preventScroll:true});},get editor(){return owner;}};
})();
