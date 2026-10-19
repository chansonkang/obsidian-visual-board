/* The frame draws the interface; only the Obsidian host can read/write Vault files. */
(() => {
 const pending=new Map();let request=0;const channel=window.__VB_CHANNEL;
 const rpc=(method,payload={})=>new Promise((resolve,reject)=>{const id='r'+(++request);const timer=setTimeout(()=>{pending.delete(id);reject(Error('操作等待超时，请重试。'));},method==='generate-icon'?500000:method==='read-audio'||['paste-components','import-markdown','drop-markdown','replay-component-insertion'].includes(method)?120000:30000);pending.set(id,{resolve,reject,timer});parent.postMessage({kind:'vb-request',channel,id,method,payload},'*');});
 window.VBHost={rpc,nativeRevision:Number(window.__VB_INIT.nativeRevision)||0};
 const pendingImages=new Map();let assets=window.__VB_INIT.assets||{}, embeds=window.__VB_INIT.embeds||{}, hostSettings=window.__VB_INIT.settings;
 window.VBHost.registerAsset=(path,url)=>{assets[path]=url;pendingImages.set(path,{url,until:Date.now()+30000});};
 window.VBHost.imageAsset=path=>assets[path];
 window.VBHost.loadImageAsset=async path=>{const fresh=await rpc('image-assets',{paths:[path]});if(fresh[path])assets[path]=fresh[path];return fresh[path];};
 const iconPaths=new Map(Object.values(state.boards).filter(b=>b.iconPath&&assets[b.iconPath]).map(b=>[assets[b.iconPath],b.iconPath]));
 for(const b of Object.values(state.boards))if(b.iconPath&&assets[b.iconPath])b.iconUrl=assets[b.iconPath];
 function applyRenameReferences({oldPath,newPath,folder=false,doc}){
  const migrate=p=>p===oldPath||folder&&p.startsWith(oldPath+'/')?newPath+p.slice(oldPath.length):p;
  for(const b of Object.values(state.boards)){if(b.hiddenFolderDocs)b.hiddenFolderDocs=b.hiddenFolderDocs.map(migrate);if(folder&&b.folderPath!==undefined){const previous=b.folderPath;b.folderPath=migrate(previous);if(b.title===previous.split('/').pop())b.title=b.folderPath.split('/').pop();}if(b.iconPath)b.iconPath=migrate(b.iconPath);for(const n of b.nodes){if(n.doc)n.doc=migrate(n.doc);if(n.imagePath){const previous=n.imagePath;n.imagePath=migrate(previous);if(n.imagePath!==previous)n.title=n.imagePath.split('/').pop().replace(/\.[^.]+$/,'');}if(n.filePath){const previous=n.filePath;n.filePath=migrate(previous);if(n.filePath!==previous)n.title=n.filePath.split('/').pop().replace(/\.[^.]+$/,'');}}}
  for(const [path,d] of Object.entries(state.docs)){const next=migrate(path);if(next!==path){delete state.docs[path];state.docs[next]={...d,id:next,path:next,title:next.split('/').pop().replace(/\.md$/i,'')};window.VBInline?.rename(path,next);}}
  for(const d of Object.values(state.docs)){d.outgoing=(d.outgoing||[]).map(migrate);d.backlinks=(d.backlinks||[]).map(migrate);}
  for(const [path,list]of Object.entries(embeds)){const next=migrate(path);if(next!==path){delete embeds[path];embeds[next]=list;}for(const e of list)if(e.path)e.path=migrate(e.path);}
  if(state.audioPlayback)for(const path of Object.keys(state.audioPlayback)){const next=migrate(path);if(next!==path){state.audioPlayback[next]=state.audioPlayback[path];delete state.audioPlayback[path];}}
  if(state.visibleArticleHeadings)state.visibleArticleHeadings=[...new Set(state.visibleArticleHeadings.map(migrate))];
  if(doc)state.docs[newPath]=doc;
  if(imageInsertion)imageInsertion.path=migrate(imageInsertion.path);
  window.VBTitle?.renamePaths(oldPath,newPath,folder);
 }
 function applyNativeDelete(payload){
  const matches=path=>typeof path==='string'&&(path===payload.path||payload.folder&&path.startsWith(payload.path+'/'));
  VBNativeReferences.applyNativeReferenceChange(state,{type:'delete',path:payload.path,folder:!!payload.folder,revision:payload.nativeRevision||0});
  const incoming={...state.docs};for(const [path,doc]of Object.entries(incoming))if(matches(path))incoming[path]={...doc,missing:true};
  state.docs=window.VBInline?VBInline.acceptDocs(incoming):incoming;
  if(selected&&!board().nodes.some(n=>n.id===selected)){selected=null;window.VBMultiSelection?.clear();window.VBEdgeStyle?.clear();$('preview').innerHTML='';}
  render();void save();
 }
 window.VBHost.applyRenameReferences=applyRenameReferences;
 let saveChain=Promise.resolve();
 save=function(){for(const b of Object.values(state.boards)){if(b.iconUrl&&iconPaths.has(b.iconUrl))b.iconPath=iconPaths.get(b.iconUrl);if(b.iconMode==='default')delete b.iconPath;}const snapshot=clone(state);snapshot.nativeRevision=VBHost.nativeRevision;delete snapshot.docs;for(const b of Object.values(snapshot.boards))delete b.iconUrl;saveChain=saveChain.catch(()=>{}).then(()=>rpc('save-layout',snapshot)).catch(e=>toast('画板保存失败：'+e.message));return saveChain;};
 fit=function(){sceneScale=Math.min(1,Math.max(.75,innerWidth/1536));$('scene').style.width=innerWidth/sceneScale+'px';$('scene').style.height=innerHeight/sceneScale+'px';$('scene').style.transform=`scale(${sceneScale})`;$('scene').style.left='0';$('scene').style.top='0';};
 renderEdges=function(){const b=board(),out=[];const draw=(a,z,kind)=>{if(!a||!z)return;const aw=a.w||(a.type==='board'?300:200),zw=z.w||(z.type==='board'?300:200),right=z.x>=a.x,x1=a.x+(right?aw:0),y1=a.y+(a.h||240)/2,x2=z.x+(right?0:zw),y2=z.y+(z.h||240)/2;out.push(`<path class="edge ${kind}" d="M${x1},${y1} C${x1+80},${y1} ${x2-80},${y2} ${x2},${y2}"/>`);};if(state.showSpace)b.edges.forEach(e=>draw(b.nodes.find(n=>n.id===e.from),b.nodes.find(n=>n.id===e.to),'space'));if(state.showKnowledge){const seen=new Set();for(const a of b.nodes.filter(n=>n.doc))for(const target of state.docs[a.doc]?.outgoing||[])for(const z of b.nodes.filter(n=>n.doc===target)){const key=[a.id,z.id].sort().join(':');if(a.id!==z.id&&!seen.has(key)){seen.add(key);draw(a,z,'knowledge');}}}$('edges').innerHTML=out.join('');};
 // Render the sticker border as real vector strokes, avoiding offset-shadow fringes.
 const baseDefaultFolder=defaultFolder;
 defaultFolder=function(name,id,status){
  const source=iconSvg(name,id),svg=new DOMParser().parseFromString(source,'image/svg+xml').documentElement;
  const ns='http://www.w3.org/2000/svg',outline=document.createElementNS(ns,'g'),ink=document.createElementNS(ns,'g');
  outline.setAttribute('class','sticker-outline');ink.setAttribute('class','sticker-ink');
  for(const child of [...svg.children]){outline.append(child.cloneNode(true));ink.append(child);}
  svg.append(outline,ink);svg.setAttribute('aria-hidden','true');
  return baseDefaultFolder(name,id,status).replace(source,new XMLSerializer().serializeToString(svg));
 };
 const baseSelection=renderSelection;
 renderSelection=function(){baseSelection();const n=node();if(n?.doc){const reveal=document.createElement('button');reveal.textContent='在文件列表中显示';reveal.dataset.nativeRevealPath=n.doc;reveal.dataset.testid='reveal-article-in-explorer';$('selection-bar').insertBefore(reveal,$('selection-bar').lastElementChild);const fit=document.createElement('button');fit.textContent='适配文章尺寸';fit.dataset.fitArticle=n.id;fit.dataset.testid='fit-article-size';$('selection-bar').insertBefore(fit,$('selection-bar').lastElementChild);const details=document.createElement('button');details.textContent='文章联系';details.dataset.preview=n.doc;$('selection-bar').insertBefore(details,$('selection-bar').lastElementChild);}if(n&&(n.doc||n.imagePath||n.sourceUrl||n.board)){const btn=document.createElement('button');btn.textContent='复制链接';btn.dataset.copyNode=n.id;btn.dataset.testid='copy-selected-url';$('selection-bar').insertBefore(btn,$('selection-bar').lastElementChild);}};
 window.VBHost.articleImages=(body,path)=>{
  const decode=link=>{try{return decodeURIComponent(link);}catch{return link;}};
  const localPath=link=>{const parts=path.split('/').slice(0,-1);for(const p of decode(link).split('/')){if(p==='..'){if(!parts.length)return;parts.pop();}else if(p&&p!=='.')parts.push(p);}return parts.join('/');};
  return VBImages.articleImageTokens(body).map(token=>{const link=decode(token.link),resolved=(embeds[path]||[]).find(e=>decode(e.link)===link||e.path===link);const imagePath=resolved?.path||(assets[link]?link:localPath(link));return {...token,path:imagePath,url:assets[imagePath]};}).filter(t=>t.url);
 };
 function decorate(){for(const n of board().nodes){const el=[...$('nodes').children].find(e=>e.dataset.node===n.id);if(!el)continue;if(n.type==='photo'){el.classList.add('vault-photo');el.style.width=(n.w||320)+'px';el.style.height=(n.h||240)+'px';el.style.backgroundImage='none';el.innerHTML=el.querySelector('.node-actions')?.outerHTML||'';const img=document.createElement('img');if(assets[n.imagePath])img.src=assets[n.imagePath];img.alt=n.title||n.imagePath||'图片';img.draggable=false;el.append(img);const label=document.createElement('div');label.className='image-caption';label.textContent=n.title||n.imagePath?.split('/').pop()||'图片';el.append(label);const replace=document.createElement('button');replace.className='vb-replace-image';replace.dataset.replaceImage=n.id;replace.dataset.testid='replace-image-'+n.id;replace.textContent='更换图片';replace.setAttribute('aria-label','更换图片');el.append(replace);}if(n.doc)el.classList.toggle('missing-note',!!state.docs[n.doc]?.missing);}}
 const baseRender=render;render=function(){const resized=VBArticleSizing.fitArticleCards(state,state.docs);baseRender();decorate();if(resized)void save();};
 function centerBoardContents(targetId,withPreview=false){
  const items=targetId?board().nodes.filter(n=>n.id===targetId):board().nodes;
  const rects=items.map(n=>{const el=[...$('nodes').children].find(el=>el.dataset.node===n.id);return {x:n.x,y:n.y,w:n.w||el?.offsetWidth||300,h:n.h||el?.offsetHeight||240};});
  const reserved=withPreview&&$('preview').childElementCount?$('preview').offsetWidth+64:0;
  board().view=VBViewport.centeredBoardView(rects,{w:Math.max(200,$('canvas').clientWidth-reserved),h:Math.max(1,$('canvas').clientHeight-125)});
  applyView();void save();
 }
 window.VBHost.centerBoardContents=centerBoardContents;
 window.VBHost.acceptLayout=(layout,preserveView=true)=>{
  const previous=state,current=previous.currentBoard;
  state={...layout,docs:previous.docs,imageService:previous.imageService};
  if(preserveView){for(const b of Object.values(state.boards))if(previous.boards[b.id])b.view={...previous.boards[b.id].view};if(state.boards[current])state.currentBoard=current;}
  for(const b of Object.values(state.boards))if(b.iconPath&&assets[b.iconPath]){b.iconUrl=assets[b.iconPath];iconPaths.set(b.iconUrl,b.iconPath);}
 };
 const baseNavigate=navigate;navigate=function(id){if(!state.boards[id]||!closeModal())return;baseNavigate(id);centerBoardContents();};
 const baseSearchHit=searchV3OpenHit;searchV3OpenHit=function(el){baseSearchHit(el);if(el.dataset.searchPlace===state.currentBoard&&selected===el.dataset.searchNode)centerBoardContents(selected,true);};

 openPreview=function(docId){const d=state.docs[docId];if(!d)return;const relations=(label,ids)=>`<h3 class="relation-heading">${label} · ${ids.length}</h3>`+ids.map(id=>`<button class="relation" data-preview="${esc(id)}">↗ ${esc(state.docs[id]?.title||id)}<small>${esc(id)}</small></button>`).join('');$('preview').innerHTML=`<div class="preview-header"><small>MARKDOWN · 本地原文</small><button data-action="close-preview" aria-label="关闭文章预览">×</button></div><h2>${esc(d.title)}</h2><div class="path">${esc(d.path)}</div><div class="vb-markdown-read vb-preview-markdown" data-preview-path="${esc(d.path)}" data-testid="formatted-note-preview"></div><div class="actions"><button class="btn" data-edit="${esc(d.id)}" data-testid="edit-document">在卡片中编辑</button><button class="btn" data-native-open="${esc(d.path)}">在 Obsidian 打开</button><button class="btn" data-copy-path="${esc(d.path)}">复制链接</button></div>${d.missing?'<p class="path">原文已移动或删除，可以移除此引用。</p>':''}${relations('出链',d.outgoing||[])}${relations('反向链接',d.backlinks||[])}`;window.VBMarkdownView?.render($('preview').querySelector('.vb-preview-markdown'),d.body,d.path);};
 editDoc=function(path){const n=board().nodes.find(n=>n.doc===path);if(n){select(n.id);const el=document.querySelector(`[data-node="${CSS.escape(n.id)}"] .excerpt`);el?.focus();}else rpc('open-note',{path}).catch(e=>toast(e.message));};
 showSearchHitPreview=function(path,line,query){
  openPreview(path);const d=state.docs[path],content=$('preview').querySelector('.vb-preview-markdown');if(!d||!content)return;
  const lines=d.body.split('\n'),target=Math.max(1,Math.min(Number(line)||1,lines.length));
  const start=lines.slice(0,target-1).reduce((sum,text)=>sum+text.length+1,0);
  const blocks=[...content.querySelectorAll('[data-vb-source-start]')];
  const containing=blocks.filter(el=>Number(el.dataset.vbSourceStart)<=start&&Number(el.dataset.vbSourceEnd)>start).sort((a,b)=>(Number(a.dataset.vbSourceEnd)-Number(a.dataset.vbSourceStart))-(Number(b.dataset.vbSourceEnd)-Number(b.dataset.vbSourceStart)));
  const hit=containing[0]||blocks.find(el=>Number(el.dataset.vbSourceStart)>=start)||blocks.at(-1)||content;
  hit.classList.add('vb-preview-search-hit');hit.dataset.testid='search-matched-line';hit.dataset.sourceLine=String(target);
  if(query){const escaped=String(query).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(escaped,'giu'),walker=document.createTreeWalker(hit,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())if(!walker.currentNode.parentElement.closest('.vb-article-image'))nodes.push(walker.currentNode);
   for(const node of nodes){const matches=[...node.nodeValue.matchAll(pattern)];for(const match of matches.reverse()){const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);const mark=document.createElement('mark');mark.className='vb-preview-query';range.surroundContents(mark);}}
  }
  const context=document.createElement('div');context.className='search-v3-context';context.dataset.testid='search-location-context';context.textContent='定位至第 '+target+' 行'+(query?' · “'+query+'”':'');content.before(context);
  const btn=document.createElement('button');btn.className='btn';btn.textContent='在 Obsidian 定位此行';btn.dataset.nativeOpen=path;btn.dataset.nativeLine=String(target-1);$('preview').querySelector('.actions').prepend(btn);
  requestAnimationFrame(()=>{if(hit.isConnected)hit.scrollIntoView({block:'nearest',inline:'nearest'});});
 };

 requestIcon=async function(name,force=false,signal){if(signal?.aborted)throw new DOMException('Aborted','AbortError');const config=state.imageService||hostSettings;const result=await rpc('generate-icon',{name,theme:chosenTheme,force,service:{baseUrl:config.baseUrl,model:config.model,apiKey:sessionApiKey}});iconPaths.set(result.url,result.path);assets[result.path]=result.url;if(signal?.aborted)throw new DOMException('Aborted','AbortError');return result;};
 saveAIConfig=function(){sessionApiKey=$('ai-api-key').value.trim();state.imageService={baseUrl:$('ai-base-url').value.trim(),model:$('ai-model').value.trim()};rpc('save-settings',state.imageService).then(settings=>{hostSettings=settings;toast('配置已保存，密钥仅留在本次会话');}).catch(e=>toast(e.message));$('icon-service-panel').innerHTML='';renderIconPreview();};
 settings=function(){setModal('画板设置',`<div class="setting-row"><span>知识链接 · 本地出链与反向链接</span><input type="checkbox" id="knowledge-check" ${state.showKnowledge?'checked':''} aria-label="显示知识虚线"></div><div class="setting-row"><span>画板连线 · 手动空间关系</span><input type="checkbox" id="space-check" ${state.showSpace?'checked':''} aria-label="显示手动实线"></div><p class="settings-note">已接入「${esc(window.__VB_INIT.vaultName)}」本地知识库。<br>点击卡片正文直接编辑，修改自动保存。删除组件会将对应本地文件移入回收站。<br>图片附件：${esc(hostSettings.attachmentFolder)}<br>文章目录与默认图标可在 Obsidian 插件设置中调整。</p><p class="settings-note">布局会自动保存在本地，并保留最近 10 份排版备份。更新插件时请保留原有数据文件。</p><p class="settings-note" data-testid="board-runtime-version">Visual Board · ${esc(window.__VB_RUNTIME_VERSION||'unknown')}</p><div class="modal-foot"><button class="btn" data-action="export">导出画板布局</button><button class="btn primary" data-action="save-settings">保存设置</button></div>`);};
 function revealArticle(path){return window.VBFolderInteraction?.revealNow(path)||rpc('reveal-entry',{path});}
 async function createLocalArticle(){
  const title=($('library-input')?.value||'').trim()||'未命名文章',originBoard=board().id;
  let d;
  try{d=await rpc('create-note',{title,board:originBoard});}catch(error){toast(error.message);return;}
  state.docs[d.id]=d;
  if(board().id===originBoard){
   const existing=board().nodes.find(n=>n.folderManaged&&n.doc===d.id);
   if(existing){const point=window.VBToolbarDrop?.takePosition();if(point)Object.assign(existing,point);select(existing.id);closeModal(true);save();render();}
   else addDoc(d.id);
   toast('文章已保存：'+d.path);
   void revealArticle(d.path).catch(error=>toast('文章已保存：'+d.path+'；文件列表定位失败：'+error.message));
  }else toast('文章已保存：'+d.path+'；请回到原画板查看');
 }
 const baseAction=action;action=function(a){if(a==='create-document'){void createLocalArticle();return;}if(a==='image'){imageDialog();return;}if(a==='import-v1'||a==='reset')return;if(a==='export'){const data=clone(state);delete data.docs;delete data.imageService;for(const b of Object.values(data.boards))delete b.iconUrl;const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='visual-board-layout.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);return;}baseAction(a);};
 let imageInsertion=null,imageContext=null;
 function imageDialog(replaceId=null){const n=node(),replacement=replaceId&&board().nodes.find(item=>item.id===replaceId&&item.type==='photo');imageContext={board:board().id,replaceId:replacement?.id};imageInsertion=replacement?null:window.VBInline?.imageInsertion(n?.doc)||null;setModal(replacement?'更换图片':'添加图片',`<p>选择本地图片、粘贴图片，或填写图片网址。图片保存到知识库附件目录。</p><input type="file" id="image-file" data-testid="image-file" accept="image/png,image/jpeg,image/webp,image/gif"><input id="image-url" data-testid="image-url" placeholder="https://… 图片地址" aria-label="图片网址">${!replacement&&n?.doc?'<label class="image-insert-label"><input type="checkbox" id="image-into-article" checked> 插入选中的文章正文</label>':''}<div class="modal-foot"><button class="btn primary" data-import-image="true" data-testid="import-image">${replacement?'更换图片':'放入图片'}</button></div>`);}
 async function importImage(file,url){
  if(!file&&!url)throw Error('请选择一张图片或填写图片网址。');
  const context=imageContext,dialog=$('image-file'),into=!!$('image-into-article')?.checked,insertion=imageInsertion;
  const originId=context?.board||board().id,originalNode=node(),articleId=originalNode?.id;
  if(window.VBInline&&!(await VBInline.flushAll()))throw Error('请先处理文章草稿冲突，再插入图片。');
  const payload={name:file?.name||'图片',url:url||undefined};
  if(file)payload.base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('无法读取图片'));reader.readAsDataURL(file);});
  const image=await rpc('import-image',payload);VBHost.registerAsset(image.path,image.url);
  const dimensions=await window.VBPhotos.measure(image.url);
  if(dialog&&!dialog.isConnected)throw Error('图片已保存到附件目录，此次放置已取消。');
  const origin=state.boards[originId];if(!origin)throw Error('原画板已删除，图片已保存到附件目录，请重新放置。');
  let focusArticle=null;
  if(context?.replaceId){
   const existing=origin.nodes.find(n=>n.id===context.replaceId&&n.type==='photo');
   if(!existing)throw Error('原图片卡片已被移除，附件已保存到本地。');
   const before=clone(existing);existing.imagePath=image.path;const width=existing.w||dimensions.w;
   Object.assign(existing,dimensions,{w:width,h:Math.max(1,width-20)*dimensions.imageHeight/dimensions.imageWidth+20});
   existing.title=file?.name||image.path.split('/').pop()||'图片';
   if(image.sourceUrl)existing.sourceUrl=image.sourceUrl;else delete existing.sourceUrl;
   window.VBHistory?.recordPhotoChange(origin.id,before,existing,origin.nodes.indexOf(existing));
  }else if(into&&originalNode?.doc){
   const selectedNode=origin.nodes.find(n=>n.id===articleId&&n.type==='article'),d=selectedNode&&state.docs[selectedNode.doc];
   if(!d||d.missing)throw Error('原文章已移动或删除，图片已保存到附件目录。');
   if(insertion?.path===d.path&&insertion.body!==d.body)throw Error('图片已保存，但文章已发生变化，请重新选择插入位置。');
   const position=insertion?.path===d.path?insertion:{start:d.body.length,end:d.body.length};
   const body=VBImages.insertArticleImage(d.body,position.start,position.end,'![['+image.path+']]');
   const result=await VBInline.applyEdit(d.path,body,{expectedBody:d.body,node:selectedNode.id,start:position.start,end:position.end});
   if(!result.ok)throw Error('图片已保存到附件目录；'+(result.message||'原文发生变化，请重试插入。'));
   embeds[d.id]=[...(embeds[d.id]||[]),{path:image.path,link:image.path}];
   focusArticle={path:d.path,node:selectedNode.id,offset:position.start};
  }else{
   if(origin.id!==board().id)throw Error('已切换画板，图片已保存到附件目录，请返回原画板放置。');
   const n={id:newId('image'),type:'photo',imagePath:image.path,...(image.sourceUrl?{sourceUrl:image.sourceUrl}:{}),title:file?.name||'图片',...dimensions,...addPosition('photo',dimensions)};
   origin.nodes.push(n);selected=n.id;window.VBHistory?.recordPhotoChange(origin.id,null,n,origin.nodes.length-1);
  }
  closeModal(true);save();render();
  if(focusArticle&&origin.id===board().id)VBInline.focus(focusArticle.path,focusArticle.node,focusArticle.offset);
  else if(origin.id===board().id)window.VBHistory?.focusGesture();
  void rpc('reveal-entry',{path:image.path}).catch(error=>toast(error.message));toast('图片已保存到本地');
 }
 document.addEventListener('click',e=>{const el=e.target.closest('[data-copy-node],[data-copy-path],[data-native-open],[data-import-image],[data-fit-article],[data-replace-image],[data-native-reveal-path]');if(!el)return;e.preventDefault();e.stopImmediatePropagation();if(el.dataset.nativeRevealPath){void revealArticle(el.dataset.nativeRevealPath).then(()=>toast('已在文件列表中定位：'+el.dataset.nativeRevealPath)).catch(error=>toast('文件列表定位失败：'+error.message+'；文章路径：'+el.dataset.nativeRevealPath));return;}if(el.dataset.replaceImage){selected=el.dataset.replaceImage;imageDialog(selected);return;}if(el.dataset.fitArticle){const n=board().nodes.find(n=>n.id===el.dataset.fitArticle);if(n){Object.assign(n,VBArticleSizing.articleCardSize(state.docs[n.doc]));render();save();toast('已按文章长度适配，全文可在卡片内滚动');}return;}if(el.hasAttribute('data-import-image')){el.disabled=true;importImage($('image-file').files[0],$('image-url').value.trim()).catch(error=>{el.disabled=false;toast(error.message);});return;}if(el.dataset.nativeOpen){rpc('open-note',{path:el.dataset.nativeOpen,line:el.dataset.nativeLine?Number(el.dataset.nativeLine):undefined}).catch(e=>toast(e.message));return;}let data={path:el.dataset.copyPath};if(el.dataset.copyNode){const n=board().nodes.find(n=>n.id===el.dataset.copyNode);data={path:n?.doc||n?.imagePath,sourceUrl:n?.sourceUrl,board:n?.board};}rpc('copy-link',data).then(()=>toast('链接已复制')).catch(e=>toast(e.message));},true);
 window.addEventListener('pointerdown',e=>{if(e.target.closest?.('[data-replace-image]'))e.stopImmediatePropagation();},true);
 document.addEventListener('paste',e=>{const image=[...e.clipboardData?.files||[]].find(f=>f.type.startsWith('image/'));if(!image)return;e.preventDefault();e.stopImmediatePropagation();const inline=e.target.closest('.vb-inline-editor');if(inline){selected=inline.closest('[data-node]').dataset.node;window.VBInline?.captureImageInsertion(inline);}imageDialog();const checkbox=$('image-into-article');if(checkbox)checkbox.checked=!!inline;importImage(image).catch(error=>toast(error.message));},true);
 window.addEventListener('message',async e=>{if(e.source!==parent||e.data?.channel!==channel)return;const data=e.data;if(data.kind==='vb-response'){const task=pending.get(data.id);if(task){clearTimeout(task.timer);pending.delete(data.id);if(!data.error&&data.result?.layout&&Number.isFinite(data.result.nativeRevision))VBHost.nativeRevision=Math.max(VBHost.nativeRevision,data.result.nativeRevision);data.error?task.reject(Error(window.VBI18n?.t(data.error)||data.error)):task.resolve(data.result);}return;}if(data.kind!=='vb-event')return;if(data.type==='notice'){toast(data.payload);return;}if(data.type==='center-board'){centerBoardContents();return;}if(data.type==='snapshot'){if(Number(data.payload.nativeRevision)<VBHost.nativeRevision)return;if(Number.isFinite(data.payload.nativeRevision))VBHost.nativeRevision=Math.max(VBHost.nativeRevision,data.payload.nativeRevision);if(window.VBFolderInteraction?.moving)return;const p=data.payload;state.docs=window.VBInline?VBInline.acceptDocs(p.docs):p.docs;assets={...(p.assets||{})};for(const [path,pin]of pendingImages){if(assets[path]||Date.now()>pin.until)pendingImages.delete(path);else assets[path]=pin.url;}embeds=p.embeds;hostSettings=p.settings;if(p.layout)window.VBHost.acceptLayout(p.layout,!!p.preserveView);for(const b of Object.values(state.boards))if(b.iconPath&&assets[b.iconPath]){b.iconUrl=assets[b.iconPath];iconPaths.set(b.iconUrl,b.iconPath);}render();if(p.layout&&!p.preserveView)centerBoardContents();return;}if(data.type==='rename'){if(Number(data.payload.nativeRevision)<VBHost.nativeRevision)return;if(Number.isFinite(data.payload.nativeRevision))VBHost.nativeRevision=Math.max(VBHost.nativeRevision,data.payload.nativeRevision);applyRenameReferences(data.payload);if(!window.VBFolderInteraction?.moving){render();save();}return;}if(data.type==='delete'){if(Number(data.payload.nativeRevision)<VBHost.nativeRevision)return;if(Number.isFinite(data.payload.nativeRevision))VBHost.nativeRevision=Math.max(VBHost.nativeRevision,data.payload.nativeRevision);applyNativeDelete(data.payload);return;}if(data.type==='flush'){await window.VBMedia?.flushPlayback();await window.VBInline?.flushAll();await saveChain;parent.postMessage({kind:'vb-flushed',channel},'*');}});
 fit();render();
 centerBoardContents();
 let cameraTouched=false;const cameraSelect=select;select=function(id){cameraTouched=true;cameraSelect(id);};for(const type of ['pointerdown','wheel','keydown'])window.addEventListener(type,()=>{cameraTouched=true;},{capture:true,passive:true});
 window.addEventListener('resize',()=>{fit();if(cameraTouched)applyView();else centerBoardContents();});
 requestAnimationFrame(()=>{fit();if(!cameraTouched)centerBoardContents();});
})();
