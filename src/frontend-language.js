/* Language is a UI preference: changing it never rebuilds the Board or its editors. */
(() => {
  const button=document.createElement('button');button.type='button';button.className='vb-language-button';button.dataset.testid='language-button';button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','切换界面语言');button.title='切换界面语言';
  button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z"/></svg>';
  document.querySelector('.header-right').append(button);
  const panel=document.createElement('div');panel.className='vb-language-panel';panel.dataset.testid='language-panel';panel.setAttribute('role','menu');panel.setAttribute('aria-label','界面语言');panel.hidden=true;
  panel.innerHTML='<button type="button" lang="zh-CN" role="menuitemradio" data-language="zh" data-testid="language-zh">简体中文<span aria-hidden="true">✓</span></button><button type="button" lang="en" role="menuitemradio" data-language="en" data-testid="language-en">English<span aria-hidden="true">✓</span></button>';
  document.body.append(panel);let pending=false;
  function position(){const r=button.getBoundingClientRect(),p=panel.getBoundingClientRect();panel.style.left=Math.round(Math.max(8,Math.min(innerWidth-p.width-8,r.right-p.width)))+'px';panel.style.top=Math.round(Math.min(innerHeight-p.height-8,r.bottom+8))+'px';}
  function update(){for(const option of panel.querySelectorAll('[data-language]')){const checked=VBI18n.language===option.dataset.language;option.setAttribute('aria-checked',String(checked));option.disabled=pending;option.querySelector('span').hidden=!checked;}button.setAttribute('aria-busy',String(pending));VBI18n.apply(panel);VBI18n.apply(button);}
  function close(){panel.hidden=true;button.setAttribute('aria-expanded','false');}
  button.addEventListener('click',e=>{e.stopPropagation();panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){update();position();}});
  window.addEventListener('pointerdown',e=>{if(e.target===button||button.contains(e.target)||panel.contains(e.target)){e.preventDefault();e.stopImmediatePropagation();}else close();},true);
  panel.addEventListener('click',async e=>{const option=e.target.closest('[data-language]');if(!option||pending)return;e.preventDefault();e.stopPropagation();pending=true;update();try{await VBI18n.setLanguage(option.dataset.language);close();}catch(error){toast(VBI18n.t('语言设置保存失败')+'：'+error.message);}finally{pending=false;update();}});
  window.addEventListener('keydown',e=>{
    if(e.target===button&&['ArrowDown','Enter',' '].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();panel.hidden=false;button.setAttribute('aria-expanded','true');update();position();panel.querySelector('[aria-checked="true"]').focus({preventScroll:true});return;}
    if(panel.hidden)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();const focused=panel.contains(document.activeElement);close();if(focused)button.focus({preventScroll:true});}
    else if(panel.contains(e.target)&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();const options=[...panel.querySelectorAll('button')],index=options.indexOf(document.activeElement);options[e.key==='Home'?0:e.key==='End'?options.length-1:(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length].focus({preventScroll:true});}
  },true);
  window.addEventListener('vb-language-change',update);window.addEventListener('resize',()=>{if(!panel.hidden)position();});update();
})();
