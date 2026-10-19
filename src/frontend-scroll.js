/* Reading positions belong to individual components, not to the selected note. */
(() => {
  const panes = ['.vb-inline-editor', '.vb-sticky-editor', '.vb-media-body', '.vb-pdf-pages', 'pre'];
  const pending = new WeakMap();
  function elements(root, selector) {
    return [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  }
  function capture(root) {
    return panes.flatMap(selector => elements(root, selector).map((el, index) => {
      const deferred = pending.get(el);
      const entry = { selector, index, top: deferred?.top ?? el.scrollTop, left: deferred?.left ?? el.scrollLeft };
      deferred?.cancel();
      return entry;
    }));
  }
  function position(el, entry) {
    pending.get(el)?.cancel();
    el.scrollTop = entry.top; el.scrollLeft = entry.left;
    // Local images can finish decoding after the synchronous card rebuild. Keep
    // an unreachable offset until their load, unless the reader interacts again.
    if (Math.abs(el.scrollTop - entry.top) < 1 && Math.abs(el.scrollLeft - entry.left) < 1) return;
    let timer, frame, lastTop = el.scrollTop, lastLeft = el.scrollLeft;
    const card = el.closest('#nodes > [data-node]') || el;
    const cancel = () => {
      clearTimeout(timer); cancelAnimationFrame(frame);
      el.removeEventListener('load', retry, true); el.removeEventListener('scroll', scrolled);
      for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown', 'beforeinput']) card.removeEventListener(type, cancel, true);
      if (pending.get(el)?.cancel === cancel) pending.delete(el);
    };
    const retry = () => {
      if (!el.isConnected) { cancel(); return; }
      el.scrollTop = entry.top; el.scrollLeft = entry.left;
      lastTop = el.scrollTop; lastLeft = el.scrollLeft;
      if (Math.abs(lastTop - entry.top) < 1 && Math.abs(lastLeft - entry.left) < 1) cancel();
    };
    const scrolled = () => {
      if (Math.abs(el.scrollTop - lastTop) >= 1 || Math.abs(el.scrollLeft - lastLeft) >= 1) cancel();
    };
    pending.set(el, { top: entry.top, left: entry.left, cancel });
    el.addEventListener('load', retry, true); el.addEventListener('scroll', scrolled, { passive: true });
    for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown', 'beforeinput']) card.addEventListener(type, cancel, { capture: true, passive: true });
    frame = requestAnimationFrame(retry); timer = setTimeout(cancel, 5000);
  }
  function restore(root, entries) {
    for (const entry of entries) {
      const el = elements(root, entry.selector)[entry.index];
      if (el) position(el, entry);
    }
  }
  function preserve(root, update) {
    const entries = capture(root);
    try { return update(); } finally { restore(root, entries); }
  }
  function identity(card) {
    const article = card.querySelector('.vb-inline-editor');
    return JSON.stringify([card.classList.contains('paper') ? 'article' : card.classList.contains('sticky') ? 'note' : card.classList.contains('vb-media-pdf') ? 'pdf' : card.classList.contains('vb-media-audio') ? 'audio' : 'other', article?.dataset.inlinePath || card.dataset.filePath || '']);
  }
  function install() {
    let renderedBoard = board().id;
    const baseRender = render;
    render = function () {
      const destination = board().id, saved = new Map();
      if (renderedBoard === destination) for (const card of document.querySelectorAll('#nodes > [data-node]')) {
        saved.set(card.dataset.node, { identity: identity(card), entries: capture(card) });
      }
      baseRender(); renderedBoard = board().id;
      if (renderedBoard !== destination) return;
      for (const card of document.querySelectorAll('#nodes > [data-node]')) {
        const old = saved.get(card.dataset.node);
        if (old?.identity === identity(card)) restore(card, old.entries);
      }
    };
  }
  window.VBComponentScroll = { preserve, install };
})();
