/* Source-mapped rich editing. Only changed top-level blocks are converted to Markdown. */
(() => {
  'use strict';
  const runtime = window.VBTurndown;
  if (!runtime?.Service) return;
  let identity = 0, conversionMeta = null;
  const converter = new runtime.Service({ headingStyle: 'atx', bulletListMarker: '-', emDelimiter: '_', strongDelimiter: '**', codeBlockStyle: 'fenced' });
  converter.use(runtime.gfm);
  converter.addRule('vbParagraphBreak',{filter:node=>node.nodeName==='BR'&&node.hasAttribute('data-vb-paragraph-break'),replacement:()=>'\n\n'});
  converter.addRule('vbStrike',{filter:['del','s','strike'],replacement:content=>'~~'+content+'~~'});
  converter.addRule('vbEmphasis', { filter: ['em','i','strong','b'], replacement: (content,node)=>{
    if(!content.trim())return content;
    const marker=node.getAttribute('data-vb-inline-markup')||(/^(STRONG|B)$/.test(node.nodeName)?'**':'_');
    return marker+content+marker;
  }});
  converter.addRule('vbImage', { filter: node => node.nodeType === 1 && node.hasAttribute('data-image-markdown'), replacement: (_content, node) => node.getAttribute('data-image-markdown') || '' });
  converter.addRule('vbWiki', { filter: node => node.nodeName === 'A' && node.hasAttribute('data-vb-source-markdown'), replacement: (_content, node) => {
    const original = node.getAttribute('data-vb-source-markdown'), label = node.textContent || '';
    if (label === node.getAttribute('data-vb-original-label')) return original;
    return '[[' + (node.getAttribute('data-vb-note-link') || '') + '|' + label.replace(/[\]\r\n]/g, '') + ']]';
  } });
  converter.addRule('vbLink', { filter: node => node.nodeName === 'A' && node.hasAttribute('data-vb-markdown-link'), replacement: (content, node) => {
    const href = node.getAttribute('data-vb-markdown-link') || '';
    const target = /[\s()]/.test(href) ? '<' + href.replace(/[<>\r\n]/g, '') + '>' : href;
    return '[' + content + '](' + target + (node.getAttribute('title') ? ' "' + node.getAttribute('title').replace(/"/g, '\\"') + '"' : '') + ')';
  } });
  converter.addRule('vbCode', { filter: 'pre', replacement: (_content, node) => {
    const value = (node.querySelector('code') || node).textContent.replace(/\n$/, '');
    if (node.getAttribute('data-vb-code-kind') === 'code_block') return '\n\n' + value.split('\n').map(line => '    ' + line).join('\n') + '\n\n';
    const marker = (node.getAttribute('data-vb-code-markup') || '```')[0];
    const longest = Math.max(2, ...[...value.matchAll(new RegExp(marker === '`' ? '`+' : '~+', 'g'))].map(match => match[0].length));
    const fence = marker.repeat(Math.max(3, longest + 1));
    return '\n\n' + fence + (node.getAttribute('data-vb-code-info') || '') + '\n' + value + '\n' + fence + '\n\n';
  } });
  converter.addRule('vbDecoration', { filter:node=>node.nodeType===1&&node.hasAttribute('data-vb-decoration'), replacement:()=>'' });
  converter.addRule('vbHighlight', { filter:'mark', replacement:content=>'=='+content+'==' });
  converter.addRule('vbTaskItem', {
    filter:node=>node.nodeName==='LI'&&/^\[[ xX]\]$/.test(node.getAttribute('data-vb-task-markup')||''),
    replacement:(content,node,options)=>{
      let prefix=options.bulletListMarker+'   ';
      const parent=node.parentNode;
      if(parent.nodeName==='OL'){const start=parent.getAttribute('start'),index=[...parent.children].indexOf(node);prefix=(start?Number(start)+index:index+1)+'.  ';}
      content=node.getAttribute('data-vb-task-markup')+(node.getAttribute('data-vb-task-space')||' ')+content.replace(/^\n+/,'');
      content=content.replace(/\n+$/,'\n').replace(/\n/g,'\n'+' '.repeat(prefix.length));
      return prefix+content+(node.nextSibling&&!/\n$/.test(content)?'\n':'');
    }
  });
  converter.addRule('vbCallout', {
    filter:node=>node.nodeName==='BLOCKQUOTE'&&node.hasAttribute('data-vb-callout-header'),
    replacement:(content,node)=>'\n\n'+(node.getAttribute('data-vb-callout-header')+'\n'+content.replace(/^\n+|\n+$/g,'')).split('\n').map(line=>'> '+line).join('\n')+'\n\n'
  });
  converter.addRule('vbPastedMarkdown', {
    filter: node => { const record=conversionMeta?.pasted?.get(node.getAttribute?.('data-vb-paste-id')); return !!record&&canonical(node)===record.html; },
    replacement: (_content,node) => {const raw=conversionMeta.pasted.get(node.getAttribute('data-vb-paste-id')).raw;return node.isBlock?raw:raw.trim();}
  });
  const canonical = node => {
    const clone = node.cloneNode(true);
    if (clone.nodeType !== Node.ELEMENT_NODE) return clone.textContent;
    for (const item of [clone, ...clone.querySelectorAll('*')]) {
      for (const attr of [...item.attributes]) if (/^data-vb-(?:source-(?:start|end)|rich-id)$/.test(attr.name)) item.removeAttribute(attr.name);
    }
    return clone.outerHTML;
  };
  function baseline(el, source) {
    const records = [];
    for (const node of el.children) {
      const start = Number(node.dataset.vbSourceStart), end = Number(node.dataset.vbSourceEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < (records.at(-1)?.end || 0)) continue;
      node.dataset.vbRichId = String(++identity);
      records.push({ id: node.dataset.vbRichId, node, start, end, html: canonical(node), raw: source.slice(start, end) });
    }
    el.__vbRich = { source, records, eol: source.includes('\r\n') ? '\r\n' : '\n', initial: el.innerHTML, edited:false, touched:new Set(), groups:[], orderedVersions:[], composing:false, commanding:false, pasted:new Map() };
  }
  function convert(node, eol, meta) {
    let clone = node.cloneNode(true);
    if(clone.nodeType===Node.TEXT_NODE){const span=document.createElement('span');span.textContent=clone.textContent;clone=span;}
    if (clone.nodeType === Node.ELEMENT_NODE) {
      for (const cell of clone.querySelectorAll('th,td')) if (['left', 'right', 'center'].includes(cell.style.textAlign)) cell.setAttribute('align', cell.style.textAlign);
    }
    const previous=conversionMeta;conversionMeta=meta;
    try {
      const value = converter.turndown(clone.outerHTML).replace(/\r\n?/g, '\n');
      return eol === '\n' ? value : value.replace(/\n/g, eol);
    } finally { conversionMeta=previous; }
  }
  const rootsOf=el=>[...el.childNodes].filter(node=>node.nodeType!==Node.TEXT_NODE||node.nodeValue.trim());
  function activeGroups(meta,roots){
    const positions=new Map(roots.map((node,i)=>[node,i])),used=new Set(),result=[];
    for(const group of [...(meta.groups||[])].reverse()){
      const start=positions.get(group.roots[0]);
      if(start===undefined||group.roots.some((node,i)=>roots[start+i]!==node||used.has(node)))continue;
      if(result.some(other=>group.start<other.end&&group.end>other.start))continue;
      result.push(group);group.roots.forEach(node=>used.add(node));
    }
    return result;
  }
  function structureBefore(el){const roots=rootsOf(el);return{roots,html:roots.map(canonical),groups:activeGroups(el.__vbRich,roots)};}
  function structureAfter(el,before){
    const meta=el.__vbRich,after=rootsOf(el);let first=0,end=before.roots.length,afterEnd=after.length;
    while(first<end&&first<afterEnd&&before.roots[first]===after[first]&&before.html[first]===canonical(after[first]))first++;
    while(end>first&&afterEnd>first&&before.roots[end-1]===after[afterEnd-1]&&before.html[end-1]===canonical(after[afterEnd-1])){end--;afterEnd--;}
    if(first===end&&first===afterEnd)return;
    // In-place inline edits already belong to one original block, with no wrapper change.
    if(end-first===afterEnd-first&&before.roots.slice(first,end).every((node,i)=>node===after[first+i]))return;
    let expanded=true;
    while(expanded){expanded=false;for(const group of before.groups){const indices=group.roots.map(node=>before.roots.indexOf(node));if(indices.some(i=>i>=first&&i<end)){const a=Math.min(...indices),b=Math.max(...indices)+1;if(a<first||b>end){first=Math.min(first,a);end=Math.max(end,b);expanded=true;}}}}
    afterEnd=after.length-(before.roots.length-end);
    const covered=[];
    for(const node of before.roots.slice(first,end)){
      const group=before.groups.find(group=>group.roots.includes(node));if(group){covered.push(group);continue;}
      for(const record of meta.records)if(record.node===node||node.contains?.(record.node)||node.nodeType===1&&record.id===node.dataset.vbRichId&&!before.roots.includes(record.node))covered.push(record);
    }
    if(!covered.length)return;
    const start=Math.min(...covered.map(record=>record.start)),finish=Math.max(...covered.map(record=>record.end));
    const roots=after.slice(first,afterEnd);if(!roots.length||finish<=start)return;
    meta.groups.push({start,end:finish,roots});
    // Each entry retains a native undo version; a bounded history avoids unbounded editing memory.
    if(meta.groups.length>200)meta.groups.splice(0,meta.groups.length-200);
  }
  function compose(el) {
    const meta = el.__vbRich;
    if (!meta) return { body: el.__vbRawSource || '', segments: [] };
    const { source, records, eol } = meta;
    const segments = [];
    let body = '', cursor = 0, index = 0;
    const append = (node, markdown) => { const start = body.length; body += markdown; if (node) segments.push({ node, start, end: body.length, markdown }); };
    const present = new Set(el.childNodes), groups=activeGroups(meta,rootsOf(el)), grouped=new Set(groups.flatMap(group=>group.roots));
    const firstGroups=new Map(groups.map(group=>[group.roots[0],group]));
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim()) continue;
      const group=firstGroups.get(node);
      if(group&&group.start>=cursor){
        while(index<records.length&&records[index].end<=group.start){append(null,source.slice(cursor,records[index].start));cursor=records[index++].end;}
        append(null,source.slice(cursor,group.start));
        let hadRoot=false, previousBlock=false, paragraphBreak=false;
        for(const root of group.roots){
          if(root.nodeName==='BR'&&root.hasAttribute('data-vb-paragraph-break')){paragraphBreak=true;continue;}
          const block=/^(?:P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE)$/.test(root.nodeName);
          if(hadRoot&&(paragraphBreak||previousBlock||block)&&!body.endsWith(eol+eol))append(null,body.endsWith(eol)?eol:eol+eol);
          append(root,root.nodeName==='BR'?'  '+eol:convert(root,eol,meta));hadRoot=true;previousBlock=block;paragraphBreak=false;
        }
        append(null,source.slice(group.start,group.end).match(/(?:\r?\n)+$/)?.[0]||'');
        cursor=group.end;while(index<records.length&&records[index].end<=group.end)index++;
        continue;
      }
      if(grouped.has(node)&&!group)continue;
      let found = records.findIndex((record, i) => i >= index && record.node === node);
      if (found < 0 && node.nodeType === Node.ELEMENT_NODE) found = records.findIndex((record, i) => i >= index && record.id === node.dataset.vbRichId && !present.has(record.node) && canonical(node) === record.html);
      if (found >= index) {
        while (index < found) { append(null, source.slice(cursor, records[index].start)); cursor = records[index++].end; }
        const record = records[index++];
        append(null, source.slice(cursor, record.start));
        const unchanged = !meta.touched.has(record.node) || canonical(node) === record.html;
        const trailing = record.raw.match(/(?:\r?\n)+$/)?.[0] || '';
        const value = unchanged ? record.raw : convert(node, eol, meta) + trailing;
        append(node, value); cursor = record.end;
      } else {
        const value = convert(node, eol, meta);
        if (!value && node.nodeName !== 'P' && node.nodeName !== 'DIV') continue;
        // New paragraphs are inserted between original blocks; opaque source gaps stay untouched.
        if (!body) { append(null, source.slice(0, el.__vbHiddenPrefix || 0)); cursor = Math.max(cursor, el.__vbHiddenPrefix || 0); }
        if (body && !body.endsWith(eol + eol)) append(null, body.endsWith(eol) ? eol : eol + eol);
        append(node, value); append(null, eol + eol);
      }
    }
    while (index < records.length) { append(null, source.slice(cursor, records[index].start)); cursor = records[index++].end; }
    append(null, source.slice(cursor));
    if (!meta.edited || el.innerHTML === meta.initial) body = source;
    return { body, segments };
  }
  function serialize(el) { return compose(el).body; }
  function decodedSource(source) {
    let value='', positions=[];
    for(let i=0;i<source.length;){
      let end=i+1, chunk=source[i];
      if(source[i]==='\\' && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[i+1]||'')){chunk=source[i+1];end=i+2;}
      else if(source[i]==='&'){
        const entity=/^&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]+);/.exec(source.slice(i));
        if(entity){const textarea=document.createElement('textarea');textarea.innerHTML=entity[0];if(textarea.value!==entity[0]){chunk=textarea.value;end=i+entity[0].length;}}
      }else if(source[i]==='\r'&&source[i+1]==='\n'){chunk='\n';end=i+2;}
      for(let j=0;j<chunk.length;j++){positions.push(i);value+=chunk[j];}
      i=end;
    }
    positions.push(source.length);return{value,positions};
  }
  function textMappings(segment) {
    const result = [], walker = document.createTreeWalker(segment.node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT), decoded=decodedSource(segment.markdown);
    let cursor=0, decodedCursor=0;
    const add=node=>{
      if(node.parentElement?.closest('.vb-article-image,[data-vb-decoration]'))return;
      // Markdown renderer indentation between block children is DOM formatting,
      // not visible text. Consuming it skips the first list/table cell mapping.
      if (/^[\t \r\n]*[\r\n][\t \r\n]*$/.test(node.nodeValue) && /^(?:UL|OL|TABLE|THEAD|TBODY|TFOOT|TR|BLOCKQUOTE)$/.test(node.parentElement?.tagName || '')) return;
      const value=node.nodeValue;let found=decoded.value.indexOf(value,decodedCursor), offsets;
      if(found>=0){offsets=decoded.positions.slice(found,found+value.length+1).map(i=>segment.start+i);decodedCursor=found+value.length;cursor=decoded.positions[decodedCursor];}
      else{
        found=segment.markdown.indexOf(value,cursor);
        if(found>=0){offsets=Array.from({length:value.length+1},(_,i)=>segment.start+found+i);cursor=found+value.length;while(decodedCursor<decoded.positions.length&&decoded.positions[decodedCursor]<cursor)decodedCursor++;}
      }
      if(offsets)result.push({node,start:offsets[0],length:value.length,offsets});
    };
    const advance=position=>{cursor=position;while(decodedCursor<decoded.positions.length&&decoded.positions[decodedCursor]<cursor)decodedCursor++;};
    if(segment.node.nodeType===Node.TEXT_NODE)add(segment.node);else while(walker.nextNode()){
      const node=walker.currentNode;
      if(node.nodeType===Node.TEXT_NODE){add(node);continue;}
      if(node.hasAttribute('data-image-markdown')){const index=segment.markdown.indexOf(node.dataset.imageMarkdown,cursor);if(index>=0)advance(index+node.dataset.imageMarkdown.length);}
      else if(node.hasAttribute('data-vb-source-markdown')){
        const original=node.dataset.vbSourceMarkdown,label=node.textContent||'',token=label===node.dataset.vbOriginalLabel?original:'[['+(node.dataset.vbNoteLink||'')+'|'+label.replace(/[\]\r\n]/g,'')+']]';
        const index=segment.markdown.indexOf(token,cursor);if(index>=0)advance(index+(token.includes('|')?token.indexOf('|')+1:2));
      }
    }
    return result;
  }
  function imageMappings(segment){
    const images=segment.node.nodeType===1?[...(segment.node.matches('[data-image-markdown]')?[segment.node]:[]),...segment.node.querySelectorAll('[data-image-markdown]')]:[];
    const result=[];let cursor=0;
    for(const node of images){const markdown=node.dataset.imageMarkdown,index=segment.markdown.indexOf(markdown,cursor);if(index<0)continue;result.push({node,start:segment.start+index,end:segment.start+index+markdown.length});cursor=index+markdown.length;}
    return result;
  }
  function sourceOffset(el, range, atEnd = false) {
    const { body, segments } = compose(el), container = atEnd ? range.endContainer : range.startContainer, offset = atEnd ? range.endOffset : range.startOffset;
    for (const segment of segments) {
      if (segment.node !== container && !segment.node.contains?.(container)) continue;
      const mappings = textMappings(segment), images=imageMappings(segment);
      if(container.nodeType===Node.TEXT_NODE&&!container.nodeValue&&!container.nextSibling){
        const fragment=container.parentElement?.closest('[data-vb-paste-id]'),record=fragment&&el.__vbRich?.pasted?.get(fragment.dataset.vbPasteId);
        if(record&&canonical(fragment)===record.html){
          const first=mappings.find(item=>item.length&&fragment.contains(item.node));
          const found=first?segment.markdown.lastIndexOf(record.raw,first.start-segment.start):-1;
          if(found>=0)return segment.start+found+record.raw.length;
        }
      }
      const insideImage=images.find(item=>item.node===container||item.node.contains(container));
      if(insideImage)return atEnd||offset>0?insideImage.end:insideImage.start;
      const match = mappings.find(item => item.node === container);
      if (match) return Math.min(body.length, match.offsets[Math.min(offset,match.length)]);
      if (container.nodeType === Node.ELEMENT_NODE) {
        const after = container.childNodes[offset];
        if (!after) return segment.end - (segment.markdown.match(/(?:\r?\n)+$/)?.[0].length || 0);
        const atom = after.nodeType === 1 && after.hasAttribute('data-image-markdown') ? after : null;
        if (atom) { const image=images.find(item=>item.node===atom);if(image)return image.start; }
        const next = mappings.find(item => after === item.node || after.contains?.(item.node));
        if (next) return next.start;
      }
      return segment.start;
    }
    if (container === el) {
      const next = el.childNodes[offset];
      const segment = segments.find(item => item.node === next);
      if (segment) return segment.start;
      return body.length;
    }
    return 0;
  }
  function placeCaret(el, offset) {
    const { segments } = compose(el), range = document.createRange();
    let nearest = null;
    for (const segment of segments) for (const mapping of textMappings(segment)) {
      if (!nearest || Math.abs(offset - mapping.start) < Math.abs(offset - nearest.start)) nearest = mapping;
      if (offset >= mapping.start && offset <= mapping.offsets[mapping.length]) { range.setStart(mapping.node, Math.max(0,mapping.offsets.findIndex(position=>position>=offset))); range.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(range); return; }
    }
    if (nearest) range.setStart(nearest.node, offset < nearest.start ? 0 : nearest.length);
    else { range.selectNodeContents(el); range.collapse(false); }
    range.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }
  function touch(el, changed=false) {
    const meta=el.__vbRich;if(!meta)return;
    if(changed)meta.edited=true;
    const selection=getSelection();if(!selection?.rangeCount)return;
    const range=selection.getRangeAt(0);
    if(!el.contains(range.startContainer)||!el.contains(range.endContainer))return;
    for(const record of meta.records)try{if(record.node.isConnected&&range.intersectsNode(record.node))meta.touched.add(record.node);}catch{}
  }
  window.addEventListener('beforeinput',event=>{
    const el=event.target.closest?.('.vb-inline-editor');if(!el)return;
    const span=el.__vbRich?.exitFormatting;
    if(span){
      const context=editableSelection(el);let atExit=false;
      if(context?.range.collapsed&&el.contains(span)&&span.contains(context.range.startContainer)){
        const prefix=context.range.cloneRange();prefix.selectNodeContents(span);prefix.setEnd(context.range.startContainer,context.range.startOffset);atExit=prefix.toString()===span.textContent;
      }
      el.__vbRich.exitFormatting=null;
      if(atExit&&event.inputType==='insertText'&&typeof event.data==='string'&&event.data&&!event.isComposing&&!el.__vbRich.composing&&event.cancelable){
        event.preventDefault();event.stopImmediatePropagation();
        editDOM(el,'insertText',()=>{
          // Empty caret nodes are canonicalized back into the preceding mark by
          // Chromium. The first actual character belongs outside that mark.
          if(/^[ \t]+$/.test(event.data))span.style.whiteSpace='pre-wrap';
          const text=document.createTextNode(event.data);span.append(text);
          const caret=document.createRange();caret.setStart(text,text.nodeValue.length);caret.collapse(true);context.selection.removeAllRanges();context.selection.addRange(caret);
        });
        return;
      }
    }
    touch(el);
  },true);
  window.addEventListener('pointerdown',event=>{const el=event.target.closest?.('.vb-inline-editor');if(el?.__vbRich)el.__vbRich.exitFormatting=null;},true);
  window.addEventListener('input',event=>{const el=event.target.closest?.('.vb-inline-editor');if(el){if(/^history(?:Undo|Redo)$/.test(event.inputType))reconcileOrderedOrdinals(el);touch(el,true);}},true);
  window.addEventListener('compositionstart',event=>{const el=event.target.closest?.('.vb-inline-editor');if(el?.__vbRich){el.__vbRich.exitFormatting=null;el.__vbRich.composing=true;}},true);
  window.addEventListener('compositionend',event=>{const el=event.target.closest?.('.vb-inline-editor');if(el){if(el.__vbRich)el.__vbRich.composing=false;touch(el,true);}},true);
  function mountEditable(el) {
    if (!el.__vbRich) baseline(el, el.__vbRawSource || '');
    el.contentEditable = 'true';
    // Structural pretty-print newlines are invisible, but Chromium interprets
    // them as extra list items when a re-rendered list is toggled or split.
    for (const parent of el.querySelectorAll('ul,ol,table,thead,tbody,tfoot,tr,blockquote')) for (const child of [...parent.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE && /^[\t \r\n]*[\r\n][\t \r\n]*$/.test(child.nodeValue)) child.remove();
    }
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
  }
  function editableSelection(el) {
    const selection=getSelection();if(!selection?.rangeCount)return null;
    const range=selection.getRangeAt(0);
    if(!el.contains(range.startContainer)||!el.contains(range.endContainer))return null;
    const element=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    return {selection,range,element};
  }
  function insertTextRange(context,value) {
    const node=document.createTextNode(value);context.range.deleteContents();context.range.insertNode(node);
    const caret=document.createRange();caret.setStartAfter(node);caret.collapse(true);context.selection.removeAllRanges();context.selection.addRange(caret);
  }
  function preservedSpaces(el,replacement) {
    let context=editableSelection(el);if(!context)return()=>{};
    if(replacement){const start=replacement.startContainer;context={...context,range:replacement,element:start.nodeType===1?start:start.parentElement};}
    const end=context.range.endContainer.nodeType===1?context.range.endContainer:context.range.endContainer.parentElement;
    const block=context.element?.closest('p,div,h1,h2,h3,h4,h5,h6,li');
    if(!block||!el.contains(block)||block!==end?.closest('p,div,h1,h2,h3,h4,h5,h6,li'))return()=>{};
    const left=context.range.cloneRange();left.selectNodeContents(block);left.setEnd(context.range.startContainer,context.range.startOffset);
    const right=context.range.cloneRange();right.selectNodeContents(block);right.setStart(context.range.endContainer,context.range.endOffset);
    const prefix=left.toString(),suffix=right.toString(),spaces=value=>value.replace(/\u00a0/g,' ');
    return()=>{
      if(!el.contains(block))return;
      const value=block.textContent;
      if(value.length<prefix.length+suffix.length||spaces(value.slice(0,prefix.length))!==spaces(prefix)||spaces(value.slice(value.length-suffix.length))!==spaces(suffix))return;
      const fixes=new Set();
      for(let i=0;i<prefix.length;i++)if(prefix[i]===' '&&value[i]==='\u00a0')fixes.add(i);
      for(let i=0;i<suffix.length;i++){const position=value.length-suffix.length+i;if(suffix[i]===' '&&value[position]==='\u00a0')fixes.add(position);}
      if(!fixes.size)return;
      const selection=getSelection(),ranges=selection?[...Array(selection.rangeCount)].map((_,i)=>{const range=selection.getRangeAt(i);return{start:range.startContainer,startOffset:range.startOffset,end:range.endContainer,endOffset:range.endOffset};}):[];
      const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let offset=0;
      while(walker.nextNode()){const node=walker.currentNode,chars=node.nodeValue.split('');for(let i=0;i<node.nodeValue.length;i++)if(fixes.has(offset+i))chars[i]=' ';const length=node.nodeValue.length,next=chars.join('');if(next!==node.nodeValue)node.nodeValue=next;offset+=length;}
      if(selection&&ranges.length){selection.removeAllRanges();for(const saved of ranges){const range=document.createRange();range.setStart(saved.start,saved.startOffset);range.setEnd(saved.end,saved.endOffset);selection.addRange(range);}}
    };
  }
  function editDOM(el,kind,change,replacement) {
    const meta=el.__vbRich;if(!meta||meta.composing)return false;
    const before=structureBefore(el),html=el.innerHTML,restoreSpaces=preservedSpaces(el,replacement);
    window.VBInline?.prepareHistory(el,kind);touch(el);meta.commanding=true;
    try { change();restoreSpaces();structureAfter(el,before);touch(el,true); }
    finally { meta.commanding=false; }
    if(el.innerHTML!==html)el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:kind}));
    return el.innerHTML!==html;
  }
  function markdownFragment(el,value,inline=false,renderedHTML) {
    if(!window.VBMarkdownView?.fragmentHTML)return null;
    const template=document.createElement('template');template.innerHTML=renderedHTML??window.VBMarkdownView.fragmentHTML(value,el.dataset.inlinePath);
    if(!template.content.childElementCount)return null;
    const meta=el.__vbRich;
    if(inline&&template.content.childElementCount===1&&template.content.firstElementChild.tagName==='P'){
      const span=document.createElement('span');span.append(...template.content.firstElementChild.childNodes);
      // Markdown paragraph parsing trims boundary spaces; a clipboard insertion
      // must keep them or the next existing word would join the pasted text.
      const leading=value.match(/^[ \t]*/)[0],trailing=value.match(/[ \t]*$/)[0];
      const currentLeading=span.textContent.match(/^[ \t]*/)[0],currentTrailing=span.textContent.match(/[ \t]*$/)[0];
      if(leading.length>currentLeading.length)span.prepend(document.createTextNode(leading.slice(currentLeading.length)));
      if(trailing.length>currentTrailing.length)span.append(document.createTextNode(trailing.slice(currentTrailing.length)));
      if(leading||trailing)span.style.whiteSpace='pre-wrap';
      const context=editableSelection(el),end=context?.range.endContainer.nodeType===1?context.range.endContainer:context?.range.endContainer.parentElement;
      let normalized=false;
      // The surrounding editor formatting already supplies these markers.
      // Keeping a second identical pair would produce ambiguous **a **b** c**
      // source after save/reopen even though the editing DOM looked correct.
      for(const selector of ['strong,b','em,i','s,del,strike','mark']){
        const ancestor=context?.element?.closest(selector);
        if(!ancestor||!el.contains(ancestor)||ancestor!==end?.closest(selector))continue;
        for(const node of [...span.querySelectorAll(selector)].reverse()){node.replaceWith(...node.childNodes);normalized=true;}
      }
      template.content.replaceChildren(span);
      const raw=normalized?leading+convert(span,'\n',null)+trailing:value;
      span.dataset.vbPasteId=String(++identity);
      meta.pasted.set(span.dataset.vbPasteId,{html:canonical(span),raw});
    }else for(const root of template.content.children){
      const start=Number(root.dataset.vbSourceStart),end=Number(root.dataset.vbSourceEnd);
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue;
      root.dataset.vbPasteId=String(++identity);
      meta.pasted.set(root.dataset.vbPasteId,{html:canonical(root),raw:value.slice(start,end)});
    }
    return template.innerHTML;
  }
  function markdownPaste(el,value) {
    const context=editableSelection(el);
    if(!context||!el.__vbRich)return false;
    if(context.element?.closest('pre,code'))return editDOM(el,'insertFromPaste',()=>{
      // execCommand insertText turns newlines into BR/DIV nodes in Chromium,
      // which lose line separators when code is serialized via textContent.
      const text=context.element.closest('pre')?value.replace(/\r\n?/g,'\n'):value.replace(/\r\n?|\n/g,' ');
      insertTextRange(context,text);
    });
    // HTML source stays literal. Only Markdown tokens can opt into formatting;
    // HTML from the clipboard is never used as editor markup.
    const renderedHTML=window.VBMarkdownView?.fragmentHTML?.(value,el.dataset.inlinePath);
    if(!renderedHTML)return false;
    const probe=document.createElement('template');probe.innerHTML=renderedHTML;
    if(!probe.content.querySelector('h1,h2,h3,h4,h5,h6,strong,b,em,i,s,del,code,pre,ul,ol,blockquote,table,hr,a,mark,.vb-article-image'))return false;
    const inline=!/[\r\n]/.test(value)&&probe.content.childElementCount===1&&probe.content.firstElementChild.tagName==='P';
    const html=markdownFragment(el,value,inline,renderedHTML);if(!html)return false;
    return editDOM(el,'insertFromPaste',()=>document.execCommand('insertHTML',false,html));
  }
  function markdownShortcut(event,el,context) {
    if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing||el.__vbRich?.composing||!context?.range.collapsed||context.element?.closest('pre,code,table,[contenteditable="false"]'))return false;
    const block=context.element?.closest('p,div,h1,h2,h3,h4,h5,h6,li,blockquote');
    if(!block||!el.contains(block)||block.closest('li,blockquote')||block===el&&[...el.children].some(node=>node.tagName!=='BR'))return false;
    const prefix=context.range.cloneRange();prefix.selectNodeContents(block);prefix.setEnd(context.range.startContainer,context.range.startOffset);
    const text=prefix.toString();
    if(event.key===' '&&/^(?:#{1,3}|[-+*]|1\.|>)$/.test(text)&&block.textContent===text){
      const kind=text[0]==='#'?'h'+text.length:text==='>'?'quote':text==='1.'?'ordered-list':'unordered-list';
      event.preventDefault();event.stopImmediatePropagation();
      editDOM(el,'formatMarkdown',()=>{
        const id=String(++identity),attributes=' data-vb-shortcut="'+id+'"';
        const html=kind==='unordered-list'?'<ul><li'+attributes+'><br></li></ul>':kind==='ordered-list'?'<ol><li'+attributes+'><br></li></ol>':kind==='quote'?'<blockquote><p'+attributes+'><br></p></blockquote>':'<'+kind+attributes+'><br></'+kind+'>';
        context.selection.removeAllRanges();context.selection.addRange(prefix);document.execCommand('insertHTML',false,html);
        const target=el.querySelector('[data-vb-shortcut="'+id+'"]');
        if(target){target.removeAttribute('data-vb-shortcut');const caret=document.createRange();caret.selectNodeContents(target);caret.collapse(true);context.selection.removeAllRanges();context.selection.addRange(caret);}
      });
      if(kind==='h1'&&!el.__vbHiddenTitle){const paths=state.visibleArticleHeadings||[];if(!paths.includes(el.dataset.inlinePath)){state.visibleArticleHeadings=[...paths,el.dataset.inlinePath];void save();}}
      return true;
    }
    if(!['*','_','~','`'].includes(event.key))return false;
    const candidate=text+event.key,match=/(^|[ \t([{])(\*\*|__|~~|\*|_|`)(\S(?:[^\r\n]*?\S)?)\2$/.exec(candidate);
    if(!match||match[3].includes(match[2][0])||/^\s|\s$/.test(match[3]))return false;
    const markdown=match[2]+match[3]+match[2],probe=document.createElement('template');probe.innerHTML=window.VBMarkdownView?.fragmentHTML?.(markdown,el.dataset.inlinePath)||'';
    const paragraph=probe.content.firstElementChild;
    if(probe.content.childElementCount!==1||paragraph?.tagName!=='P'||paragraph.childNodes.length!==1||!['STRONG','EM','S','DEL','CODE'].includes(paragraph.firstElementChild?.tagName))return false;
    const start=candidate.length-markdown.length;
    const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let offset=0,startNode=null,startOffset=0;
    while(walker.nextNode()){const node=walker.currentNode;if(offset+node.nodeValue.length>=start){startNode=node;startOffset=start-offset;break;}offset+=node.nodeValue.length;}
    if(!startNode)return false;
    const replacement=context.range.cloneRange();replacement.setStart(startNode,startOffset);
    const html=markdownFragment(el,markdown,true);if(!html)return false;
    const inserted=document.createElement('template');inserted.innerHTML=html;const pasteId=inserted.content.firstElementChild?.dataset.vbPasteId;
    event.preventDefault();event.stopImmediatePropagation();
    editDOM(el,'formatMarkdown',()=>{
      context.selection.removeAllRanges();context.selection.addRange(replacement);document.execCommand('insertHTML',false,html);
      const span=pasteId&&el.querySelector('[data-vb-paste-id="'+pasteId+'"]');
      if(span){const text=document.createTextNode('');span.append(text);const caret=document.createRange();caret.setStart(text,0);caret.collapse(true);context.selection.removeAllRanges();context.selection.addRange(caret);el.__vbRich.exitFormatting=span;}
    },replacement);
    return true;
  }
  function handleKey(event, el) {
    if (el.dataset.inlineReadonly === 'true') { if((event.ctrlKey||event.metaKey)&&['c','a'].includes(event.key.toLowerCase()))return false;event.preventDefault(); return true; }
    const key = event.key.toLowerCase(), cmd = event.ctrlKey || event.metaKey;
    if(el.__vbRich?.exitFormatting&&(cmd||event.altKey||['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Backspace','Delete','Enter','Tab','Escape'].includes(event.key)))el.__vbRich.exitFormatting=null;
    if(cmd&&!event.altKey&&!event.isComposing&&event.keyCode!==229&&(key==='z'||key==='y')){
      event.preventDefault();event.stopImmediatePropagation();
      const selection=getSelection(),doc=state.docs[el.dataset.inlinePath];
      if(selection?.rangeCount&&el.contains(selection.anchorNode)&&el.contains(selection.focusNode)&&doc&&!doc.missing&&!el.__vbRich?.composing&&mode!=='connect'&&!window.VBHistory?.replaying&&!window.VBFolderInteraction?.moving&&!window.VBConnections?.dragging&&!window.VBMultiSelection?.dragging)window.VBInline?.historyUndo(el,key==='y'||event.shiftKey);
      return true;
    }
    if (cmd && (key === 'b' || key === 'i')) { event.preventDefault(); if(!event.isComposing)runCommand(el,key==='b'?'bold':'italic'); return true; }
    if (event.isComposing) return false;
    const selection = getSelection(), anchor = selection?.anchorNode, element = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
    if(markdownShortcut(event,el,editableSelection(el)))return true;
    const cell = element?.closest('th,td');
    if (event.key === 'Tab' && cell && el.contains(cell)) {
      event.preventDefault(); const cells = [...cell.closest('table').querySelectorAll('th,td')], next = cells[cells.indexOf(cell) + (event.shiftKey ? -1 : 1)];
      if (next) { const range = document.createRange(); range.selectNodeContents(next); range.collapse(!event.shiftKey); selection.removeAllRanges(); selection.addRange(range); } return true;
    }
    if (element?.closest('pre') && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();const context=editableSelection(el);
      if(context)editDOM(el,event.key==='Tab'?'insertText':'insertParagraph',()=>insertTextRange(context,event.key==='Tab'?'  ':'\n'));
      return true;
    }
    if (event.key === 'Tab' && element?.closest('li')) { event.preventDefault(); document.execCommand(event.shiftKey ? 'outdent' : 'indent'); return true; }
    return false;
  }
  window.addEventListener('paste', event => {
    const el = event.target.closest?.('.vb-inline-editor'); if (!el) return;
    if(el.__vbRich)el.__vbRich.exitFormatting=null;
    if (el.dataset.inlineReadonly === 'true') { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if ([...(event.clipboardData?.files || [])].some(file => /^image\//.test(file.type))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    let value = event.clipboardData?.getData('text/plain') || '';
    if (!value) {
      // The inert template is never attached. No external markup or attributes enter the editor.
      const template = document.createElement('template'); template.innerHTML = event.clipboardData?.getData('text/html') || '';
      template.content.querySelectorAll('script,style,iframe,object,embed,img,link,meta,svg,math,video,audio,source,form').forEach(node => node.remove());
      value = template.content.textContent || '';
    }
    if (value && !markdownPaste(el,value)) { window.VBInline?.prepareHistory(el, 'paste'); document.execCommand('insertText', false, value); }
  }, true);
  window.addEventListener('dragover',event=>{
    const el=event.target.closest?.('.vb-inline-editor');if(!el)return;
    if([...(event.dataTransfer?.types||[])].includes('Files'))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.dataTransfer)event.dataTransfer.dropEffect=el.dataset.inlineReadonly==='true'?'none':'copy';
  },true);
  window.addEventListener('drop',event=>{
    const el=event.target.closest?.('.vb-inline-editor');if(!el)return;
    if(event.dataTransfer?.files?.length)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(el.dataset.inlineReadonly==='true')return;
    const value=event.dataTransfer?.getData('text/plain')||'';
    if(!value)return;
    const range=document.caretRangeFromPoint?.(event.clientX,event.clientY);
    el.focus({preventScroll:true});
    if(range&&el.contains(range.startContainer)){const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}
    window.VBInline?.prepareHistory(el, 'drop'); document.execCommand('insertText',false,value);
  },true);
  function commandContext(el){
    const selection=getSelection();if(!selection?.rangeCount)return{valid:false};
    const range=selection.getRangeAt(0);if(!el.contains(range.startContainer)||!el.contains(range.endContainer))return{valid:false};
    const intersects=selector=>[...el.querySelectorAll(selector)].some(node=>{try{return range.intersectsNode(node);}catch{return false;}});
    const start=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement,end=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;
    const inline=start?.closest('code');
    const imageSelector='.vb-article-image,[contenteditable="false"]:not([data-vb-decoration])';
    const imageSelection=intersects(imageSelector),imageBlock=rootsOf(el).some(node=>node.nodeType===1&&(node.matches(imageSelector)||node.querySelector(imageSelector))&&(()=>{try{return range.intersectsNode(node);}catch{return false;}})());
    return{valid:true,code:intersects('pre'),inlineCode:!!inline&&inline===end?.closest('code'),table:intersects('table'),imageSelection,imageBlock};
  }
  function paragraphBoundaries(el){
    const breaks=new Set(el.querySelectorAll('br')),boundaries=new Set(),ordered=new Map();let offset=0;
    for(const list of el.querySelectorAll('ol')){let number=Number.isFinite(list.start)?list.start:1;for(const item of list.children)if(item.tagName==='LI')ordered.set(item,number++);}
    const visit=node=>{if(node.nodeType===Node.TEXT_NODE){offset+=node.nodeValue.replace(/\s/g,'').length;return;}for(const child of node.childNodes)visit(child);if(node!==el&&/^(P|DIV|LI|H[1-6])$/.test(node.nodeName))boundaries.add(offset);};
    visit(el);return{breaks,boundaries,ordered};
  }
  function rememberOrderedVersion(el){
    const lists=[...el.querySelectorAll('ol')].map(list=>({list,items:[...list.children],start:list.getAttribute('start')}));
    if(!lists.length)return;
    const parents=[...new Set(lists.map(entry=>entry.list.parentElement))].map(parent=>({parent,children:[...parent.children],text:parent.textContent}));
    const versions=el.__vbRich.orderedVersions;versions.push({roots:rootsOf(el),lists,parents});if(versions.length>200)versions.splice(0,versions.length-200);
  }
  function reconcileOrderedOrdinals(el){
    const versions=el.__vbRich?.orderedVersions;if(!versions)return;
    const same=(a,b)=>a.length===b.length&&a.every((item,index)=>item===b[index]),roots=rootsOf(el),lists=[...el.querySelectorAll('ol')];
    // Attribute adjustments are outside Chromium's native undo transaction.
    // Reapply them only to an exact recorded list structure, never an arbitrary
    // later edit that happens to retain one original LI.
    const version=[...versions].reverse().find(entry=>same(entry.roots,roots)&&same(entry.lists.map(item=>item.list),lists)&&entry.lists.every(item=>same(item.items,[...item.list.children]))&&entry.parents.every(item=>item.parent.textContent===item.text&&same(item.children,[...item.parent.children])));
    if(version)for(const {list,start}of version.lists){if(start===null)list.removeAttribute('start');else list.setAttribute('start',start);}
  }
  function preserveParagraphBreaks(el,before){
    let offset=0;
    const visit=node=>{
      if(node.nodeType===Node.TEXT_NODE){offset+=node.nodeValue.replace(/\s/g,'').length;return;}
      // Chromium represents an unlisted paragraph separator as BR inside its
      // retained P wrapper. Keep its paragraph semantics without rebuilding DOM
      // or introducing another undo transaction. Existing hard line breaks stay.
      if(node.nodeName==='BR'&&!before.breaks.has(node)&&!node.closest('li')&&before.boundaries.has(offset))node.dataset.vbParagraphBreak='true';
      for(const child of node.childNodes)visit(child);
    };visit(el);
    // Native splitting retains LI nodes but resets the new trailing OL to 1.
    // Preserve the ordinal of each existing item without another undo step.
    for(const list of el.querySelectorAll('ol')){const first=[...list.children].find(node=>node.tagName==='LI'),number=before.ordered.get(first);if(Number.isFinite(number)&&list.start!==number)list.setAttribute('start',String(number));}
  }
  function selectionHasListItems(el) {
    const context=editableSelection(el);if(!context)return false;
    if(context.range.collapsed)return !!context.element?.closest('li');
    return [...el.querySelectorAll('li')].some(item=>{try{return context.range.intersectsNode(item);}catch{return false;}});
  }
  function unlistSelection(el) {
    // Outdent operates on only the selected items and retains text-node ranges.
    // Repeating also lets a nested item become a standalone heading, rather than
    // leaving a heading wrapper around its former list container.
    for(let depth=0;depth<24&&selectionHasListItems(el);depth++){
      const before=el.innerHTML;document.execCommand('outdent');if(el.innerHTML===before)break;
    }
  }
  function normalizeBlockContainers(el,before) {
    const selection=getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;
    let retained=null;
    if(range&&!range.collapsed&&el.contains(range.startContainer)&&el.contains(range.endContainer)){
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),texts=[];
      while(walker.nextNode())if(walker.currentNode.nodeValue.length){try{if(range.intersectsNode(walker.currentNode))texts.push(walker.currentNode);}catch{}}
      if(texts.length)retained={start:range.startContainer.nodeType===Node.TEXT_NODE?range.startContainer:texts[0],startOffset:range.startContainer.nodeType===Node.TEXT_NODE?range.startOffset:0,end:range.endContainer.nodeType===Node.TEXT_NODE?range.endContainer:texts.at(-1),endOffset:range.endContainer.nodeType===Node.TEXT_NODE?range.endOffset:texts.at(-1).nodeValue.length};
    }
    const stable=new Set(before.roots.filter((node,index)=>node.isConnected&&canonical(node)===before.html[index]));
    for(const root of rootsOf(el)){
      if(root.nodeType!==Node.ELEMENT_NODE||stable.has(root))continue;
      const wrappers=[...(root.matches('p,h1,h2,h3,h4,h5,h6')?[root]:[]),...root.querySelectorAll('p,h1,h2,h3,h4,h5,h6')];
      for(const wrapper of wrappers.reverse()){
        // Chromium's list commands can leave <p><ol> or <h1><ol>. These
        // containers are invalid HTML and give list markers a heading font.
        if([...wrapper.children].some(child=>/^(?:P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE)$/.test(child.nodeName)))wrapper.replaceWith(...wrapper.childNodes);
      }
    }
    // Native list commands sometimes select a wrapper by child offsets. Moving
    // its children resets that range to a collapsed point; anchor to the actual
    // selected text so the next command and history restore keep every item.
    if(retained&&el.contains(retained.start)&&el.contains(retained.end)){
      const restored=document.createRange();restored.setStart(retained.start,retained.startOffset);restored.setEnd(retained.end,retained.endOffset);selection.removeAllRanges();selection.addRange(restored);
    }
  }
  function runCommand(el,kind){
    if(!el?.isConnected||!el.__vbRich||!state.docs[el.dataset.inlinePath]||state.docs[el.dataset.inlinePath].missing||el.dataset.inlineReadonly==='true'||el.dataset.markdownMode!=='edit'||el.__vbRich?.composing||mode==='connect'||window.VBHistory?.replaying||window.VBFolderInteraction?.moving||window.VBConnections?.dragging||window.VBMultiSelection?.dragging)return false;
    const context=commandContext(el);if(!context.valid||context.code||context.imageSelection||context.imageBlock&&!['bold','italic'].includes(kind)||context.inlineCode&&['bold','italic'].includes(kind)||context.table&&!['bold','italic'].includes(kind))return false;
    const commands={bold:'bold',italic:'italic','unordered-list':'insertUnorderedList','ordered-list':'insertOrderedList'};
    if(!commands[kind]&&!['paragraph','h1','h2','h3','quote'].includes(kind))return false;
    const meta=el.__vbRich,before=structureBefore(el),paragraphs=paragraphBoundaries(el),html=el.innerHTML;
    window.VBInline?.prepareHistory(el, 'format');
    rememberOrderedVersion(el);touch(el);meta.commanding=true;
    try{
      if(kind==='unordered-list'||kind==='ordered-list'){
        const selected=editableSelection(el),hasHeading=[...el.querySelectorAll('h1,h2,h3,h4,h5,h6')].some(heading=>{try{return selected?.range.intersectsNode(heading);}catch{return false;}});
        if(hasHeading)document.execCommand('formatBlock',false,'p');
        document.execCommand(commands[kind]);
      }else if(commands[kind])document.execCommand(commands[kind]);
      else if(kind==='paragraph'){
        const ul=document.queryCommandState('insertUnorderedList'),ol=document.queryCommandState('insertOrderedList'),unlisted=ul||ol;
        if(unlisted)document.execCommand(ul?'insertUnorderedList':'insertOrderedList');
        const selection=getSelection(),element=selection.anchorNode?.nodeType===1?selection.anchorNode:selection.anchorNode?.parentElement;
        if(element?.closest('blockquote'))document.execCommand('outdent');
        if(!unlisted)document.execCommand('formatBlock',false,'p');
      }else if(kind==='quote'){
        const selection=getSelection(),element=selection.anchorNode?.nodeType===1?selection.anchorNode:selection.anchorNode?.parentElement;
        document.execCommand(element?.closest('blockquote')?'outdent':'formatBlock',false,'blockquote');
      }else {
        if(/^h[123]$/.test(kind))unlistSelection(el);
        document.execCommand('formatBlock',false,kind);
      }
      if(el.innerHTML!==html&&!['bold','italic'].includes(kind))normalizeBlockContainers(el,before);
      if(el.innerHTML!==html){preserveParagraphBreaks(el,paragraphs);structureAfter(el,before);rememberOrderedVersion(el);touch(el,true);}
    }finally{meta.commanding=false;}
    if(kind==='h1'&&!el.__vbHiddenTitle){
      const paths=Array.isArray(state.visibleArticleHeadings)?state.visibleArticleHeadings:[];
      if(!paths.includes(el.dataset.inlinePath)){state.visibleArticleHeadings=[...paths,el.dataset.inlinePath];void save();}
    }
    if(el.innerHTML!==html)el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'formatBlock'}));
    return true;
  }
  window.VBRichEditor = { baseline, mountEditable, serialize, sourceOffset, placeCaret, handleKey, runCommand, commandContext };
})();
