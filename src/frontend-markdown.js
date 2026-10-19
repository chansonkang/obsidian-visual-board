/* Safe reading DOM. Markdown source and native Vault assets remain the source of truth. */
(() => {
  const md = window.VBMarkdown;
  if (!md?.render || !md.inline?.ruler) return;
  md.set({ html: false, linkify: false, typographer: false });
  const escape = value => md.utils.escapeHtml(String(value ?? ''));
  const normalize = value => value.replace(/\r\n?/g, '\n');
  const safeImage = value => typeof value === 'string' && (/^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(value) || /^blob:/.test(value));
  const decode = value => { try { return decodeURIComponent(value); } catch { return value; } };

  // Obsidian highlights use the same delimiter balancing as emphasis. Escapes,
  // code spans and unmatched equals remain ordinary literal Markdown text.
  md.inline.ruler.before('emphasis', 'vb_highlight', (state, silent) => {
    if (silent || state.src.charCodeAt(state.pos) !== 61) return false;
    const scanned = state.scanDelims(state.pos, true);
    let length = scanned.length;
    if (length < 2) return false;
    if (length % 2) { state.push('text', '', 0).content = '='; length--; }
    for (let i = 0; i < length; i += 2) {
      state.push('text', '', 0).content = '==';
      state.delimiters.push({ marker: 61, length: 0, token: state.tokens.length - 1, end: -1, open: scanned.can_open, close: scanned.can_close });
    }
    state.pos += scanned.length;
    return true;
  });
  md.inline.ruler2.before('fragments_join', 'vb_highlight', state => {
    const apply = delimiters => {
      const trailingLiterals = [];
      for (const opening of delimiters) {
        if (opening.marker !== 61 || opening.end < 0) continue;
        const closing = delimiters[opening.end];
        for (const [delimiter, type, nesting] of [[opening, 'mark_open', 1], [closing, 'mark_close', -1]]) {
          const token = state.tokens[delimiter.token];
          token.type = type; token.tag = 'mark'; token.nesting = nesting; token.markup = '=='; token.content = '';
          if (nesting === 1) token.attrSet('data-vb-inline-markup', '==');
        }
        if (state.tokens[closing.token - 1]?.type === 'text' && state.tokens[closing.token - 1].content === '=') trailingLiterals.push(closing.token - 1);
      }
      // With odd-length runs, leave the extra equals outside the highlight.
      for (const index of trailingLiterals.reverse()) {
        let end = index + 1;
        while (state.tokens[end]?.type === 'mark_close') end++;
        end--;
        if (end !== index) [state.tokens[index], state.tokens[end]] = [state.tokens[end], state.tokens[index]];
      }
    };
    apply(state.delimiters);
    for (const meta of state.tokens_meta) if (meta?.delimiters) apply(meta.delimiters);
  });

  md.inline.ruler.before('image', 'vb_source_image', (state, silent) => {
    if (state.src.slice(state.pos, state.pos + 2) !== '![') return false;
    const image = window.VBImages.articleImageTokens(state.src.slice(state.pos))[0];
    if (!image || image.start !== 0) return false;
    if (!silent) { const token = state.push('vb_source_image', 'span', 0); token.meta = image; }
    state.pos += image.end;
    return true;
  });
  md.inline.ruler.before('link', 'vb_wikilink', (state, silent) => {
    if (state.src.slice(state.pos, state.pos + 2) !== '[[') return false;
    const match = /^\[\[([^\]\r\n]+)\]\]/.exec(state.src.slice(state.pos));
    if (!match) return false;
    const parts = match[1].split('|'), link = parts.shift().trim();
    if (!link) return false;
    if (!silent) { const token = state.push('vb_wikilink', 'a', 0); token.meta = { link, label: parts.join('|').trim() || link, markdown: match[0] }; }
    state.pos += match[0].length;
    return true;
  });
  md.renderer.rules.vb_wikilink = (tokens, index) => {
    const { link, label, markdown } = tokens[index].meta;
    return `<a href="#" data-vb-note-link="${escape(link)}" data-vb-source-markdown="${escape(markdown)}" data-vb-original-label="${escape(label)}" class="vb-wikilink">${escape(label)}</a>`;
  };

  function imageHTML(meta, env) {
    const original = env.vbImages.find(image => !env.vbUsedImages.has(image.start) && normalize(image.markdown) === normalize(meta.markdown || ''));
    if (original) env.vbUsedImages.add(original.start);
    const resolved = original && env.vbResolvedImages.get(original.start);
    const image = { ...meta, ...original, ...resolved };
    const markdown = image.markdown || `![${image.alt || ''}](${image.link || ''})`;
    const source = original ? ` data-vb-source-start="${original.start}" data-vb-source-end="${original.end}"` : '';
    const attributes = `class="vb-article-image" contenteditable="false" data-image-markdown="${escape(markdown)}"${source}`;
    if (!safeImage(image.url)) return `<span ${attributes}><span class="vb-image-placeholder">图片未加载 · ${escape(image.alt || image.link || '本地图片')}</span></span>`;
    const size = [];
    if (Number.isFinite(image.width) && image.width > 0) size.push(`width:${Math.min(10000, image.width)}px`);
    if (Number.isFinite(image.height) && image.height > 0) size.push(`height:${Math.min(10000, image.height)}px`);
    return `<span ${attributes}><img src="${escape(image.url)}" alt="${escape(image.alt || image.path || '')}" data-image-path="${escape(image.path || '')}" draggable="false"${size.length ? ` style="${size.join(';')}"` : ''}></span>`;
  }
  md.renderer.rules.vb_source_image = (tokens, index, _options, env) => imageHTML(tokens[index].meta, env);
  // Reference-style images also use a local placeholder, never an unrestricted network URL.
  md.renderer.rules.image = (tokens, index, _options, env) => {
    const token = tokens[index];
    return imageHTML({ link: token.attrGet('src'), alt: token.content }, env);
  };
  const baseLink = md.renderer.rules.link_open || ((tokens, index, options, _env, renderer) => renderer.renderToken(tokens, index, options));
  md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const token = tokens[index], href = token.attrGet('href') || '';
    token.attrSet('data-vb-markdown-link', href); token.attrSet('href', '#');
    return baseLink(tokens, index, options, env, renderer);
  };
  const baseToken = md.renderer.renderToken;
  md.renderer.renderToken = function (tokens, index, options) {
    const token = tokens[index], env = token.__vbEnv;
    if(token.type==='em_open'||token.type==='strong_open')token.attrSet('data-vb-inline-markup',token.markup);
    if (token.map && token.nesting >= 0 && env) {
      token.attrSet('data-vb-source-start', String(env.vbLines[token.map[0]] ?? env.vbPrefix));
      token.attrSet('data-vb-source-end', String(env.vbLines[token.map[1]] ?? env.vbSource.length));
    }
    return baseToken.call(this, tokens, index, options);
  };
  md.core.ruler.push('vb_source_maps', state => {
    const visit = tokens => { for (const token of tokens) { token.__vbEnv = state.env; if (token.children) visit(token.children); } };
    visit(state.tokens);
  });
  md.core.ruler.before('vb_source_maps', 'vb_obsidian_blocks', state => {
    const tokens = state.tokens;
    const replaceInline = (token, content) => {
      token.content = content; token.children = [];
      md.inline.parse(content, md, state.env, token.children);
    };
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === 'list_item_open' && tokens[i + 1]?.type === 'paragraph_open' && tokens[i + 2]?.type === 'inline') {
        const inline = tokens[i + 2], task = /^(\[([ xX])\])([ \t]+)/.exec(inline.content);
        if (!task) continue;
        token.attrSet('data-vb-task-markup', task[1]); token.attrSet('data-vb-task-space', task[3]); token.attrJoin('class', 'vb-task-item');
        replaceInline(inline, inline.content.slice(task[0].length));
        const marker = new state.Token('vb_task_marker', 'span', 0); marker.meta = { checked: task[2] !== ' ' };
        inline.children.unshift(marker);
      }
      if (token.type === 'blockquote_open' && tokens[i + 1]?.type === 'paragraph_open' && tokens[i + 2]?.type === 'inline') {
        const inline = tokens[i + 2], callout = /^\[!([a-z][\w-]*)\]([+-]?)(?:[ \t]+([^\n]*))?(?:\n|$)/i.exec(inline.content);
        if (!callout) continue;
        const header = callout[0].replace(/\n$/, ''), type = callout[1].toLowerCase();
        token.attrSet('data-vb-callout-header', header); token.attrSet('data-vb-callout-type', type); token.attrJoin('class', 'vb-callout');
        const title = new state.Token('vb_callout_title', 'div', 0);
        title.content = md.renderInline(callout[3] || type.charAt(0).toUpperCase() + type.slice(1), state.env);
        const remainder = inline.content.slice(callout[0].length);
        if (remainder) { replaceInline(inline, remainder); tokens.splice(i + 1, 0, title); }
        else tokens.splice(i + 1, 3, title);
      }
    }
  });
  // These are visual decorations, never disabled controls that look editable.
  md.renderer.rules.vb_task_marker = (tokens, index) => `<span class="vb-task-marker" contenteditable="false" data-vb-decoration="task" data-vb-task-checked="${tokens[index].meta.checked}" aria-hidden="true"></span>`;
  md.renderer.rules.vb_callout_title = (tokens, index) => `<div class="vb-callout-title" contenteditable="false" data-vb-decoration="callout-title">${tokens[index].content}</div>\n`;
  for (const type of ['fence', 'code_block']) md.renderer.rules[type] = (tokens, index, _options, env) => {
    const token = tokens[index], start = env.vbLines[token.map?.[0]] ?? env.vbPrefix, end = env.vbLines[token.map?.[1]] ?? env.vbSource.length;
    const language = (token.info || '').trim().split(/\s+/)[0];
    return `<pre data-vb-source-start="${start}" data-vb-source-end="${end}" data-vb-code-kind="${type}" data-vb-code-markup="${escape(token.markup || '')}" data-vb-code-info="${escape(token.info || '')}"><code${language ? ` class="language-${escape(language)}"` : ''}>${escape(token.content)}</code></pre>\n`;
  };

  function prefixInfo(body,path) {
    let end = body.charCodeAt(0) === 0xFEFF ? 1 : 0;
    const rest = body.slice(end), front = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(rest);
    if (front) end += front[0].length;
    // Explicit body headings are presentation metadata in the layout, never a
    // private marker in the note. Legacy title prefixes keep their old behavior.
    if(path&&Array.isArray(state.visibleArticleHeadings)&&state.visibleArticleHeadings.includes(path))return{prefix:body.slice(0,end),hiddenTitle:false};
    const leading = /^(?:[ \t]*\r?\n)*/.exec(body.slice(end))[0];
    const after = end + leading.length;
    const h1 = /^(?:#(?!#)[ \t]+[^\r\n]*(?:\r?\n|$)|[^\r\n]+\r?\n=+[ \t]*(?:\r?\n|$))(?:[ \t]*\r?\n)*/.exec(body.slice(after));
    return {prefix:body.slice(0,h1?after+h1[0].length:end),hiddenTitle:!!h1};
  }
  const hiddenPrefix=(body,path)=>prefixInfo(body,path).prefix;
  function fragmentHTML(body, path, prefixLength = 0) {
    const reading=body.slice(prefixLength),lines=[prefixLength];
    for(let i=0;i<reading.length;i++)if(reading[i]==='\n')lines.push(prefixLength+i+1);
    const env={vbSource:body,vbPrefix:prefixLength,vbLines:lines,vbImages:window.VBImages.articleImageTokens(body),vbUsedImages:new Set(),vbResolvedImages:new Map(window.VBHost.articleImages(body,path).map(image=>[image.start,image]))};
    return md.render(reading,env);
  }
  function render(el, body, path) {
    const info=prefixInfo(body,path),prefix=info.prefix;el.__vbHiddenTitle=info.hiddenTitle;
    el.innerHTML = fragmentHTML(body,path,prefix.length);
    el.__vbRawSource = body; el.__vbHiddenPrefix = prefix.length;
    window.VBRichEditor?.baseline(el, body);
    return true;
  }
  function sourceOffset(el, range, atEnd = false) {
    const source = el.__vbRawSource || '', container = atEnd ? range.endContainer : range.startContainer, offset = atEnd ? range.endOffset : range.startOffset;
    const element = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
    const image = element?.closest('.vb-article-image');
    if (image && el.contains(image)) return Number(image.dataset.vbSourceStart) || 0;
    const block = element?.closest('[data-vb-source-start]');
    const root = block && el.contains(block) ? block : el;
    const start = Number(root.dataset.vbSourceStart) || 0, end = Number(root.dataset.vbSourceEnd) || source.length;
    let cursor = start;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('.vb-article-image')) continue;
      const value = node.nodeValue;
      const found = source.indexOf(value, cursor);
      if (found >= cursor && found < end) {
        if (node === container) return Math.min(source.length, found + Math.min(offset, value.length));
        cursor = found + value.length;
      }
    }
    return Math.min(source.length, start);
  }
  function resolveNote(link, path) {
    const decoded = decode(link), raw = decoded.split('#')[0];
    if (!raw) return path;
    const candidates = [];
    const add = value => { candidates.push(value); if (!/\.md$/i.test(value)) candidates.push(value + '.md'); };
    const parts = path.split('/').slice(0, -1);
    let safe = true;
    for (const part of raw.split('/')) { if (part === '..') { if (!parts.length) { safe = false; break; } parts.pop(); } else if (part && part !== '.') parts.push(part); }
    if (safe) add(parts.join('/'));
    add(raw);
    const exact = candidates.find(candidate => state.docs[candidate] && !state.docs[candidate].missing);
    if (exact) return exact;
    const basename = raw.split('/').pop().replace(/\.md$/i, '');
    const linked = (state.docs[path]?.outgoing || []).filter(candidate => candidate.split('/').pop().replace(/\.md$/i, '') === basename);
    if (linked.length === 1) return linked[0];
    const unique = Object.keys(state.docs).filter(candidate => !state.docs[candidate].missing && candidate.split('/').pop().replace(/\.md$/i, '') === basename);
    return unique.length === 1 ? unique[0] : null;
  }
  const readingLink = target => target.closest?.('.vb-markdown-read a[data-vb-note-link],.vb-markdown-read a[data-vb-markdown-link]');
  const editingLink = (link,event) => !!link?.closest('.vb-inline-editor') && !event.metaKey && !event.ctrlKey;
  window.addEventListener('pointerdown', event => { if(window.VBMultiSelection?.intercepts(event))return; if (readingLink(event.target) && !editingLink(readingLink(event.target),event)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  window.addEventListener('click', event => {
    if(window.VBMultiSelection?.blocksClick?.(event)){event.preventDefault();event.stopImmediatePropagation();return;}
    if(window.VBMultiSelection?.intercepts(event))return;
    const link = readingLink(event.target); if (!link) return;
    if(editingLink(link,event)) {event.preventDefault();return;}
    event.preventDefault(); event.stopImmediatePropagation();
    const value = link.dataset.vbNoteLink || link.dataset.vbMarkdownLink || '', path = link.closest('.vb-inline-editor')?.dataset.inlinePath || link.closest('[data-preview-path]')?.dataset.previewPath;
    if (/^(https?:|mailto:)/i.test(value)) {
      window.VBHost.rpc('open-external', { url: value }).catch(error => toast(error.message)); return;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(value)) { toast('此链接类型无法在画板中打开'); return; }
    const target = resolveNote(value, path || '');
    if (!target) { toast('未找到对应的本地文章'); return; }
    window.VBHost.rpc('open-note', { path: target, linktext: value }).catch(error => toast(error.message));
  }, true);
  window.VBMarkdownView = { render, fragmentHTML, sourceOffset, hiddenPrefix };
})();
