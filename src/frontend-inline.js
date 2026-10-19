/* Inline Markdown editing; actual note writes remain in the Obsidian host. */
(function () {
  'use strict';
  const drafts = new Map();
  const recoveryWrites = new Set();
  // Markdown snapshots belong to a note, not to disposable rendered DOM nodes.
  // This also makes programmatic image inserts undoable without deleting assets.
  const histories = new Map();
  let historyApplying = false;
  const historyLimit = 120;
  const historyBytes = 8 * 1024 * 1024;
  const delay = 700;
  let rendering = false;
  let stamp = Date.now();
  function recoveryRPC(method, payload) {
    const pending = window.VBHost.rpc(method, payload).then(result => {
      const d = drafts.get(payload.path);
      if (d?.recoveryError) { d.recoveryError = null; updateStatus(payload.path); }
      return result;
    }).catch(error => {
      const d = drafts.get(payload.path);
      if (d) { d.recoveryError = String(error?.message || error); updateStatus(payload.path); }
      return false;
    });
    recoveryWrites.add(pending); pending.finally(() => recoveryWrites.delete(pending));
    return pending;
  }
  function persistDraft(d) {
    d.updatedAt = stamp = Math.max(Date.now(), stamp + 1);
    return recoveryRPC('save-draft', { path: d.path, body: d.body, expectedBody: d.expectedBody, updatedAt: d.updatedAt, blocked: d.blocked });
  }
  function clearRecovery(path, body) {
    return recoveryRPC('clear-draft', { path, body });
  }
  const currentEditor = () => { const el = document.activeElement?.closest?.('.vb-inline-editor') || (document.activeElement?.closest?.('#vb-format-toolbar,.vb-table-panel') ? window.VBFormatToolbar?.editor : null); return el?.dataset.markdownMode === 'edit' ? el : null; };
  const pathFor = el => el?.dataset.inlinePath;
  function entry(path) {
    if (!drafts.has(path)) {
      const doc = state.docs[path];
      if (!doc) return null;
      drafts.set(path, { path, body: doc.body, expectedBody: doc.body, focused: false, timer: null, pending: null, blocked: null, latest: doc, composing: false });
    }
    return drafts.get(path);
  }
  function text(el) {
    if(el?.__vbRich && window.VBRichEditor) return VBRichEditor.serialize(el);
    if (el?.dataset?.markdownMode === 'read' && typeof el.__vbRawSource === 'string') return el.__vbRawSource;
    // Chromium uses DIV + BR paragraphs even in plaintext-only editables.
    // innerText adds an extra blank line for DIV<BR>, corrupting Markdown spacing.
    const read = parent => {
      let result = '';
      [...parent.childNodes].forEach((child, index) => {
        if (child.nodeType === Node.TEXT_NODE) result += child.nodeValue;
        else if (child.dataset?.imageMarkdown) result += child.dataset.imageMarkdown;
        else if (child.nodeName === 'BR') result += '\n';
        else {
          const block = /^(DIV|P|LI)$/.test(child.nodeName);
          if (block && index > 0 && parent.childNodes[index - 1]?.nodeName !== 'BR') result += '\n';
          const placeholder = block && child.childNodes.length === 1 && child.firstChild.nodeName === 'BR';
          if (!placeholder) result += read(child);
        }
      });
      return result;
    };
    const value = read(el).replace(/\r\n?/g, '\n');
    if (typeof el?.__vbRawSource === 'string') {
      if (value === el.__vbRawSource.replace(/\r\n?/g, '\n')) return el.__vbRawSource;
      if (el.__vbRawSource.includes('\r\n')) return value.replace(/\n/g, '\r\n');
    }
    return value;
  }
  function historySnapshot(el, body) {
    return { body, selection: el ? selectionOffsets(el) : null, top: el?.scrollTop || 0, left: el?.scrollLeft || 0 };
  }
  function historyFor(path, body, el) {
    let h = histories.get(path);
    if (!h || h.entries[h.cursor].body !== body) {
      h = { entries: [historySnapshot(el, body)], cursor: 0, group: null, prepared: null };
      histories.set(path, h);
    }
    return h;
  }
  function prepareHistory(el, kind = '') {
    if (historyApplying || !el) return;
    const path = pathFor(el), body = text(el);
    if (!path || !state.docs[path]) return;
    const h = historyFor(path, body, el);
    h.entries[h.cursor] = historySnapshot(el, body);
    h.prepared = { ...h.entries[h.cursor], kind };
    if (kind !== 'insertText' && kind !== 'deleteContentBackward' && kind !== 'deleteContentForward') h.group = null;
  }
  function recordHistory(path, body, el, kind = '') {
    if (historyApplying) return;
    let h = histories.get(path);
    if (!h) { historyFor(path, body, el); return; }
    const previous = h.entries[h.cursor], after = historySnapshot(el, body), before = h.prepared || previous;
    h.prepared = null;
    if (previous.body === body) return;
    const now = Date.now(), typing = /^(?:insertText|deleteContentBackward|deleteContentForward)$/.test(kind);
    const adjacent = before.selection && h.group?.selection && before.selection.start === before.selection.end && before.selection.start === h.group.selection.start && h.group.selection.start === h.group.selection.end;
    const merge = typing && h.group?.kind === kind && now - h.group.at < 1200 && adjacent && h.cursor === h.entries.length - 1;
    h.entries.splice(h.cursor + 1);
    if (merge) h.entries[h.cursor] = after;
    else { h.entries.push(after); h.cursor++; }
    h.group = typing ? { kind, at: now, selection: after.selection } : null;
    let bytes = h.entries.reduce((sum, item) => sum + item.body.length * 2, 0);
    while (h.entries.length > 2 && (h.entries.length > historyLimit || bytes > historyBytes)) {
      bytes -= h.entries.shift().body.length * 2; h.cursor--;
    }
  }
  function restoreSelection(el, saved) {
    if (!saved) return;
    placeCaret(el, saved.start);
    if (saved.end === saved.start) return;
    const selection = getSelection(), start = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    placeCaret(el, saved.end);
    if (!start || !selection?.rangeCount) return;
    const end = selection.getRangeAt(0);
    start.setEnd(end.startContainer, end.startOffset); selection.removeAllRanges(); selection.addRange(start);
  }
  function historyUndo(el, redo = false) {
    if (!el || historyApplying || el.__vbRich?.composing) return false;
    const path = pathFor(el), doc = state.docs[path];
    if (!doc || doc.missing || el.dataset.inlineReadonly === 'true') return false;
    const d = entry(path), body = text(el), h = historyFor(path, body, el), next = h.cursor + (redo ? 1 : -1);
    // An empty per-note history must never fall through to another editor's stack.
    if (next < 0 || next >= h.entries.length) return true;
    clearTimeout(d.timer); h.group = null; h.prepared = null; h.cursor = next;
    const saved = h.entries[next];
    historyApplying = true;
    try {
      d.body = saved.body; state.docs[path].body = d.body;
      renderArticle(el, saved.body, path, true); el.focus({ preventScroll: true });
      restoreSelection(el, saved.selection); el.scrollTop = saved.top; el.scrollLeft = saved.left;
      void persistDraft(d); syncPeers(path, el); schedule(d);
    } finally { historyApplying = false; }
    return true;
  }
  function focusArticle(path, nodeId, offset) {
    const el = [...document.querySelectorAll('.vb-inline-editor')].find(el => pathFor(el) === path && (!nodeId || el.dataset.inlineNode === nodeId));
    if (!el || el.dataset.inlineReadonly === 'true') return false;
    el.focus({ preventScroll: true });
    if (Number.isFinite(offset)) placeCaret(el, offset);
    return true;
  }
  async function applyEdit(path, body, options = {}) {
    const doc = state.docs[path], d = doc && entry(path);
    if (!d || doc.missing || typeof body !== 'string') return { ok: false, reason: 'missing' };
    if (d.blocked || d.composing) return { ok: false, reason: 'blocked' };
    const el = [...document.querySelectorAll('.vb-inline-editor')].find(el => pathFor(el) === path && (!options.node || el.dataset.inlineNode === options.node));
    if (options.expectedBody !== undefined && d.body !== options.expectedBody) return { ok: false, reason: 'conflict' };
    const h = historyFor(path, d.body, el);
    h.entries[h.cursor] = historySnapshot(el, d.body);
    if (Number.isFinite(options.start)) h.entries[h.cursor].selection = { start: options.start, end: Number.isFinite(options.end) ? options.end : options.start };
    h.group = null; h.prepared = null;
    recordHistory(path, body, el, options.kind || 'insertImage');
    if (Number.isFinite(options.start)) h.entries[h.cursor].selection = { start: options.start, end: options.start };
    d.body = body; state.docs[path].body = body;
    if (el) renderArticle(el, body, path, el === currentEditor());
    syncPeers(path, el); await persistDraft(d);
    return { ok: await flush(path), doc: state.docs[path] };
  }
  let lastInsertion=null;
  function renderArticle(el,body,path,editing){
    return window.VBComponentScroll.preserve(el, () => {
    el.dataset.markdownMode=editing?'edit':'read';
    el.classList.add('vb-markdown-read');el.classList.toggle('vb-markdown-edit',editing);
    el.setAttribute('contenteditable',editing?'true':'false');el.setAttribute('tabindex','0');el.dataset.rawPrefix='';
    if(editing && el.__vbRich && el.__vbRawSource===body && text(el)===body) {window.VBRichEditor?.mountEditable(el);return;}
    el.__vbRawSource=body;
    if(window.VBMarkdownView?.render(el,body,path)) {if(editing)window.VBRichEditor?.mountEditable(el);return;}
    el.textContent=body;
    });
  }
  function selectionOffsets(el){
    const selection=getSelection();if(!selection?.rangeCount)return null;
    const range=selection.getRangeAt(0);if(!el.contains(range.startContainer)||!el.contains(range.endContainer))return null;
    if(el.__vbRich&&window.VBRichEditor)return {start:VBRichEditor.sourceOffset(el,range),end:VBRichEditor.sourceOffset(el,range,true)};
    if(el.dataset.markdownMode==='read'&&window.VBMarkdownView)return {start:VBMarkdownView.sourceOffset(el,range),end:VBMarkdownView.sourceOffset(el,range,true)};
    const prefix=el.dataset.rawPrefix?.length||0;
    const before=range.cloneRange();before.selectNodeContents(el);before.setEnd(range.startContainer,range.startOffset);
    const through=range.cloneRange();through.selectNodeContents(el);through.setEnd(range.endContainer,range.endOffset);
    return {start:prefix+text(before.cloneContents()).length,end:prefix+text(through.cloneContents()).length};
  }
  function placeCaret(el,offset){
    if(el.__vbRich&&window.VBRichEditor){VBRichEditor.placeCaret(el,offset);return;}
    let remaining=offset;const range=document.createRange();
    for(const child of el.childNodes){const length=child.nodeType===Node.TEXT_NODE?child.nodeValue.length:(child.dataset?.imageMarkdown?.length||0);
      if(remaining<=length){if(child.nodeType===Node.TEXT_NODE)range.setStart(child,remaining);else if(!remaining)range.setStartBefore(child);else range.setStartAfter(child);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return;}
      remaining-=length;
    }
    range.selectNodeContents(el);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  }
  function captureImageInsertion(el=currentEditor()){
    if(!el)return;const offsets=selectionOffsets(el);if(!offsets)return;
    lastInsertion={path:pathFor(el),node:el.dataset.inlineNode,body:(el.dataset.rawPrefix||'')+text(el),...offsets};
  }
  document.addEventListener('selectionchange',()=>captureImageInsertion());
  window.addEventListener('pointerdown',event=>{if(event.target.closest?.('[data-action="image"]'))captureImageInsertion();},true);
  function dirty(d) { return d.body !== d.expectedBody; }
  function label(d) {
    if (d?.recoveryError) return '草稿恢复副本保存失败，请保持此页打开';
    if (d?.blocked?.kind === 'recovery') return '已恢复上次未保存草稿，请确认后保存';
    if (d?.blocked?.kind === 'conflict') return '原文已在别处修改，草稿已保留';
    if (d?.blocked?.kind === 'missing') return '原文已删除，草稿已保留';
    if (d?.blocked) return '保存失败，草稿已保留';
    if (d?.pending) return '正在保存到本地…';
    if (d && dirty(d)) return '待保存…';
    return '已保存 · 点击正文直接编辑';
  }
  function updateStatus(path) {
    for (const card of document.querySelectorAll('#nodes > .paper')) {
      const n = board().nodes.find(n => n.id === card.dataset.node);
      if (n?.doc !== path) continue;
      const d = drafts.get(path);
      let status = card.querySelector('.vb-inline-status');
      if (!status) { status = document.createElement('div'); status.className = 'vb-inline-status'; card.append(status); }
      status.dataset.inlineStatus = path;
      status.classList.toggle('vb-inline-warning', !!d?.blocked);
      status.replaceChildren();
      const message = document.createElement('span');
      message.textContent = label(d);
      status.append(message);
      if (!d?.blocked) continue;
      const button = (label, action) => {
        const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = label;
        btn.dataset.inlineAction = action; btn.dataset.inlinePath = path; status.append(btn);
      };
      if (d.blocked.kind === 'conflict') {
        const details = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = '查看当前文件内容并合并';
        const pre = document.createElement('pre'); pre.textContent = d.blocked.current;
        details.append(summary, pre); status.append(details);
        button('重新载入当前原文', 'reload');
        button('我已合并，保存草稿', 'merge');
      } else if (d.blocked.kind === 'recovery') {
        button('保存恢复的草稿', 'retry');
        button('放弃草稿并载入原文', 'reload');
      } else if (d.blocked.kind === 'error') button('重试保存', 'retry');
    }
  }
  function syncPeers(path, except) {
    const d = drafts.get(path), doc = state.docs[path];
    if (!doc) return;
    const body = d ? d.body : doc.body;
    doc.body = body;
    for (const el of document.querySelectorAll('.vb-inline-editor')) {
      if (pathFor(el) === path && el !== except && el !== currentEditor()) renderArticle(el, body, path, false);
    }
    renderEdges();
    updateStatus(path);
  }
  function schedule(d) {
    clearTimeout(d.timer);
    if (!d.blocked && !d.composing) d.timer = setTimeout(() => { void flush(d.path); }, delay);
  }
  async function flush(path) {
    const d = drafts.get(path);
    if (!d) return true;
    clearTimeout(d.timer);
    if (d.pending) { await d.pending; return d.blocked ? false : dirty(d) ? flush(path) : true; }
    if (d.composing) return false;
    if (d.blocked) return false;
    if (!dirty(d)) { if (d.updatedAt) await clearRecovery(d.path, d.body); return true; }
    const submitted = d.body, expected = d.expectedBody;
    d.pending = (async () => {
      try {
        const result = await window.VBHost.rpc('update-note', { path, body: submitted, expectedBody: expected });
        if (!result.ok) {
          d.blocked = result.reason === 'conflict' ? { kind: 'conflict', current: result.current } : d.path === path ? { kind: 'missing' } : null;
          return;
        }
        if (result.doc.body !== submitted) {
          d.blocked = { kind: 'conflict', current: result.doc.body };
          return;
        }
        const changedDuringSave = d.body !== submitted;
        d.expectedBody = result.doc.body;
        d.latest = result.doc;
        if (!changedDuringSave) d.body = result.doc.body;
        state.docs[d.path] = { ...result.doc, id: d.path, path: d.path, body: d.body };
        d.blocked = null;
      } catch (error) {
        d.blocked = { kind: 'error', message: String(error?.message || error) };
      }
    })();
    updateStatus(path);
    await d.pending;
    d.pending = null;
    if (!d.blocked && !dirty(d)) await clearRecovery(d.path, submitted);
    else await persistDraft(d);
    syncPeers(d.path);
    if (!d.blocked && dirty(d)) return flush(d.path);
    if (!d.focused && !dirty(d) && !d.blocked) drafts.delete(d.path);
    updateStatus(d.path);
    return !d.blocked && !dirty(d);
  }
  function decorate() {
    for (const card of document.querySelectorAll('#nodes > .paper')) {
      const n = board().nodes.find(n => n.id === card.dataset.node), doc = n && state.docs[n.doc];
      const el = card.querySelector('.excerpt');
      if (!doc || !el) continue;
      el.classList.add('vb-inline-editor');
      el.dataset.inlinePath = doc.path || doc.id;
      el.dataset.inlineNode = n.id;
      el.dataset.inlineBoard = board().id;
      el.setAttribute('role', 'textbox');
      el.setAttribute('aria-label', `${doc.title} Markdown 正文`);
      el.setAttribute('aria-multiline', 'true');
      el.dataset.inlineReadonly=doc.missing?'true':'false';
      el.spellcheck = false;
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', `文章 ${doc.title}，点击正文直接编辑`);
      const d = drafts.get(el.dataset.inlinePath);
      renderArticle(el, d ? d.body : doc.body, el.dataset.inlinePath, false);
      updateStatus(el.dataset.inlinePath);
    }
  }
  function acceptDocs(incoming) {
    const merged = { ...incoming };
    for (const [path, d] of drafts) {
      const latest = incoming[path];
      if (latest) d.latest = latest;
      if (d.focused || dirty(d) || d.pending || d.blocked) {
        merged[path] = { ...(latest || state.docs[path]), body: d.body };
      } else drafts.delete(path);
    }
    return merged;
  }
  const baseRender = render;
  render = function () {
    const active = currentEditor();
    const saved = active ? { el: active, focus: document.activeElement, board: active.dataset.inlineBoard, node: active.dataset.inlineNode, path: pathFor(active), scrollTop: active.scrollTop, scrollLeft: active.scrollLeft, ranges: [...Array(window.getSelection()?.rangeCount || 0)].map((_, i) => {
      const range = window.getSelection().getRangeAt(i);
      return { startNode: range.startContainer, startOffset: range.startOffset, endNode: range.endContainer, endOffset: range.endOffset };
    }) } : null;
    rendering = true;
    try {
      baseRender(); decorate();
      if (saved) {
        const replacement = board().id === saved.board && [...document.querySelectorAll('.vb-inline-editor')].find(el => el.dataset.inlineNode === saved.node && pathFor(el) === saved.path);
        if (replacement) {
          replacement.replaceWith(saved.el);
          const focus = saved.focus?.isConnected ? saved.focus : saved.el;
          const selection = window.getSelection(); selection?.removeAllRanges();
          saved.ranges.forEach(savedRange => {
            if (!saved.el.contains(savedRange.startNode) || !saved.el.contains(savedRange.endNode)) return;
            const range = document.createRange();
            range.setStart(savedRange.startNode, savedRange.startOffset); range.setEnd(savedRange.endNode, savedRange.endOffset);
            selection?.addRange(range);
          });
          // Chromium may focus contenteditable when a native range is added.
          // Restore the actual focused toolbar control after restoring ranges.
          focus.focus({ preventScroll: true });
          saved.el.scrollTop = saved.scrollTop;
          saved.el.scrollLeft = saved.scrollLeft;
        } else {
          const d = drafts.get(saved.path); if (d) { d.focused = false; void flush(saved.path); }
        }
      }
    } finally { rendering = false; }
  };
  // Window capture runs before the existing document geometry handlers.
  window.addEventListener('pointerdown', event => {
    if(window.VBMultiSelection?.intercepts(event))return;
    const reading = event.target.closest?.('.vb-markdown-read');
    if (reading && mode !== 'connect' && reading.dataset.inlineReadonly !== 'true') {
      if(reading.dataset.markdownMode==='edit'){event.stopImmediatePropagation();return;}
      // The rendered DOM is already the editor: let Chromium place the native
      // caret/word anchor, including first-click dragging and Shift selection.
      event.stopImmediatePropagation();
      reading.focus({ preventScroll: true });
      return;
    }
    if (event.target.closest?.('.vb-inline-editor,.vb-inline-status') && mode !== 'connect') event.stopImmediatePropagation();
  }, true);
  window.addEventListener('click', event => {
    if(window.VBMultiSelection?.blocksClick?.(event)){event.preventDefault();event.stopImmediatePropagation();return;}
    if(window.VBMultiSelection?.intercepts(event))return;
    const button = event.target.closest?.('[data-inline-action]');
    if (button) {
      event.stopImmediatePropagation();
      const path = button.dataset.inlinePath, d = drafts.get(path);
      if (!d || d.pending) return;
      if (button.dataset.inlineAction === 'reload') {
        const discarded = d.body;
        d.body = d.blocked.current; d.expectedBody = d.blocked.current;
        d.blocked = null; d.latest = { ...d.latest, body: d.body }; state.docs[path].body = d.body;
        void clearRecovery(path, discarded);
        document.querySelectorAll('.vb-inline-editor').forEach(el => { if (pathFor(el) === path) renderArticle(el, d.body, path, el === currentEditor()); });
        syncPeers(path);
      } else {
        if (button.dataset.inlineAction === 'merge' && d.blocked.kind === 'conflict') d.expectedBody = d.blocked.current;
        d.blocked = null; void persistDraft(d); void flush(path);
      }
      return;
    }
    if (event.target.closest?.('.vb-inline-title')) return;
    const card = event.target.closest?.('#nodes > .paper');
    if (!card || mode === 'connect' || event.target.closest('button,[data-resize]')) return;
    event.stopImmediatePropagation();
    select(card.dataset.node);
  }, true);
  window.addEventListener('dblclick', event => {
    if (event.target.closest?.('#nodes > .paper') && !event.target.closest('button')) event.stopImmediatePropagation();
  }, true);
  window.addEventListener('keydown', event => {
    if (!event.target.closest?.('.vb-inline-editor')) return;
    event.stopImmediatePropagation();
    const editor=event.target.closest('.vb-inline-editor');
    if(event.altKey&&event.key==='F10'&&!event.isComposing&&!editor.__vbRich?.composing){event.preventDefault();window.VBFormatToolbar?.focus();return;}
    if(window.VBRichEditor?.handleKey(event,editor))return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void flush(pathFor(event.target)); }
    if (event.key === 'Escape') { event.preventDefault(); event.target.blur(); }
  }, true);
  document.addEventListener('focusin', event => {
    const el = event.target.closest?.('.vb-inline-editor');
    if (!el || rendering || mode === 'connect' || el.dataset.inlineReadonly === 'true') return;
    const d = entry(pathFor(el)); if (!d) return;
    const caret = selectionOffsets(el), selection=getSelection();
    const ranges=selection?[...Array(selection.rangeCount)].map((_,i)=>{const r=selection.getRangeAt(i);return el.contains(r.startContainer)&&el.contains(r.endContainer)?{start:r.startContainer,startOffset:r.startOffset,end:r.endContainer,endOffset:r.endOffset}:null;}).filter(Boolean):[];
    historyFor(d.path, d.body, el).group = null;
    d.focused = true; renderArticle(el, d.body, d.path, true);
    // Accessibility selection and keyboard focus may arrive separately. Focusing an
    // unchanged rendered DOM must retain both ends, not collapse a selected phrase.
    const retained=ranges.filter(r=>el.contains(r.start)&&el.contains(r.end));
    if(retained.length){selection.removeAllRanges();for(const saved of retained){const r=document.createRange();r.setStart(saved.start,saved.startOffset);r.setEnd(saved.end,saved.endOffset);selection.addRange(r);}}
    else if (caret) placeCaret(el, caret.start);
    select(el.dataset.inlineNode);
    updateStatus(d.path);
  });
  function finishEdit(el, relatedTarget) {
    if (!el || rendering || el.dataset.markdownMode !== 'edit') return;
    const d = drafts.get(pathFor(el)); if (!d) return;
    captureImageInsertion(el);
    d.body = text(el); recordHistory(d.path, d.body, el);
    const history = histories.get(d.path); if (history) history.group = null;
    d.focused = false;
    if (dirty(d) || d.pending || d.blocked) void persistDraft(d);
    // Keep conflict action buttons in the DOM between pointerdown and click.
    if (relatedTarget?.closest?.('.vb-inline-status')) return;
    if (!dirty(d) && !d.pending && !d.blocked && d.latest.body !== d.expectedBody) {
      state.docs[d.path] = d.latest; d.body = d.latest.body; drafts.delete(d.path);
    } else void flush(d.path);
    renderArticle(el, d.body, d.path, false);
    syncPeers(d.path, el);
  }
  document.addEventListener('focusout', event => {
    if(event.relatedTarget?.closest?.('#vb-format-toolbar,.vb-table-panel'))return;
    finishEdit(event.target.closest?.('.vb-inline-editor'),event.relatedTarget);
  });
  window.addEventListener('beforeinput', event => {
    const el = event.target.closest?.('.vb-inline-editor');
    if (!el) return;
    if (/^history(?:Undo|Redo)$/.test(event.inputType) && event.cancelable) { event.preventDefault(); historyUndo(el, event.inputType === 'historyRedo'); return; }
    if (!event.isComposing && !el.__vbRich?.composing) prepareHistory(el, event.inputType || '');
  }, true);
  document.addEventListener('input', event => {
    const el = event.target.closest?.('.vb-inline-editor'); if (!el) return;
    const d = entry(pathFor(el)); if (!d || d.composing || event.isComposing || el.__vbRich?.commanding) return;
    d.body = text(el); recordHistory(d.path, d.body, el, event.inputType || ''); void persistDraft(d); syncPeers(d.path, el); schedule(d);
  });
  document.addEventListener('compositionstart', event => {
    const el = event.target.closest?.('.vb-inline-editor'); if (el) { prepareHistory(el, 'composition'); const d = entry(pathFor(el)); d.composing = true; clearTimeout(d.timer); }
  });
  document.addEventListener('compositionend', event => {
    const el = event.target.closest?.('.vb-inline-editor'); if (el) { const d = entry(pathFor(el)); d.composing = false; d.body = text(el); recordHistory(d.path, d.body, el, 'composition'); void persistDraft(d); syncPeers(d.path,el); schedule(d); }
  });
  function exportDrafts() {
    return [...drafts.values()].filter(d => dirty(d) || d.pending || d.blocked).map(d => ({ path: d.path, body: d.body, expectedBody: d.expectedBody, updatedAt: d.updatedAt || Date.now(), blocked: d.blocked }));
  }
  function restoreDrafts(payload) {
    let restored = 0;
    for (const saved of Array.isArray(payload) ? payload : []) {
      if (!saved || typeof saved.path !== 'string' || typeof saved.body !== 'string' || typeof saved.expectedBody !== 'string') continue;
      stamp = Math.max(stamp, Number(saved.updatedAt) || 0);
      if (drafts.has(saved.path)) continue;
      const doc = state.docs[saved.path];
      if (doc && !doc.missing && doc.body === saved.body) { void clearRecovery(saved.path, saved.body); continue; }
      const latest = doc || { id: saved.path, path: saved.path, title: saved.path.split('/').pop().replace(/\.md$/i, ''), body: '', mtime: 0, outgoing: [], backlinks: [], missing: true };
      const blocked = latest.missing ? { kind: 'missing' } : latest.body !== saved.expectedBody ? { kind: 'conflict', current: latest.body } : { kind: 'recovery', current: latest.body };
      drafts.set(saved.path, { path: saved.path, body: saved.body, expectedBody: saved.expectedBody, updatedAt: saved.updatedAt, latest, blocked, focused: false, timer: null, pending: null, composing: false });
      state.docs[saved.path] = { ...latest, body: saved.body }; restored++;
    }
    decorate();
    return restored;
  }
  window.VBInline = {
    decorate, acceptDocs, exportDrafts, restoreDrafts, captureImageInsertion, prepareHistory, historyUndo, applyEdit, finishEdit, focus: focusArticle,
    imageInsertion(path) {const el=currentEditor();if(el&&pathFor(el)===path)captureImageInsertion(el);return lastInsertion?.path===path?{...lastInsertion}:null;},
    flushAll: async () => {
      const saved = (await Promise.all([...drafts.keys()].map(flush))).every(Boolean);
      await Promise.all([...recoveryWrites]);
      return saved;
    },
    hasDrafts: () => [...drafts.values()].some(d => dirty(d) || d.pending || d.blocked),
    rename(oldPath, newPath) {
      const h = histories.get(oldPath); if (h) { histories.delete(oldPath); histories.set(newPath, h); }
      const d = drafts.get(oldPath); if (d) { clearTimeout(d.timer); drafts.delete(oldPath); d.path = newPath; drafts.set(newPath, d); void persistDraft(d); void clearRecovery(oldPath, d.body); }
      document.querySelectorAll('.vb-inline-editor').forEach(el => { if (pathFor(el) === oldPath) el.dataset.inlinePath = newPath; });
      if(lastInsertion?.path===oldPath)lastInsertion.path=newPath;
    },
  };
  window.addEventListener('beforeunload', () => { void window.VBInline.flushAll(); });
  restoreDrafts(window.__VB_INIT?.drafts);
})();
