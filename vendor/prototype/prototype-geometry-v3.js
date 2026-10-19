/* Grid and alignment work in board coordinates, independently of scene scale. */
(() => {
  const UNIT = 20, MIN_W = 160, MIN_H = 160;
  let active = null;
  const grid = document.createElement('div');
  grid.id = 'grid-layer'; grid.setAttribute('aria-hidden', 'true');
  $('scene').prepend(grid);
  const guides = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  guides.id = 'snap-guides'; guides.setAttribute('width', '1800'); guides.setAttribute('height', '1200');
  guides.setAttribute('aria-hidden', 'true'); $('world').append(guides);
  const quantize = value => Math.round(value / UNIT) * UNIT;
  const element = id => [...$('nodes').children].find(el => el.dataset.node === id);
  const size = n => {
    const el = element(n.id);
    return {w: n.w || el?.offsetWidth || (n.type === 'board' ? 300 : 200), h: n.h || el?.offsetHeight || (n.type === 'board' ? 303 : 240)};
  };
  function updateGrid() {
    const v = board().view, major = UNIT * 4 * v.zoom, minor = UNIT * v.zoom;
    grid.style.backgroundSize = `${major}px ${major}px, ${minor}px ${minor}px`;
    grid.style.backgroundPosition = `${v.x}px ${210 + v.y}px, ${v.x}px ${210 + v.y}px`;
  }
  function decorate() {
    for (const n of board().nodes) {
      const el = element(n.id); if (!el || n.type !== 'article') continue;
      n.w ||= el.offsetWidth; n.h ||= el.offsetHeight;
      el.style.width = n.w + 'px'; el.style.height = n.h + 'px';
      if (!el.querySelector('.resize-handle')) {
        for (const dir of ['n','e','s','w','ne','se','sw','nw']) {
          const handle = document.createElement('span');
          handle.className = 'resize-handle resize-' + dir; handle.dataset.resize = dir;
          handle.dataset.testid = 'resize-' + n.id + '-' + dir;
          handle.setAttribute('role', 'button'); handle.tabIndex = 0;
          handle.setAttribute('aria-label', ({n:'上边',e:'右边',s:'下边',w:'左边',ne:'右上角',se:'右下角',sw:'左下角',nw:'左上角'})[dir] + '拉伸文章卡片');
          el.append(handle);
        }
        const badge = document.createElement('span'); badge.className = 'size-badge';
        badge.dataset.testid = 'size-' + n.id; el.append(badge);
      }
      el.querySelector('.size-badge').textContent = Math.round(n.w) + ' × ' + Math.round(n.h);
    }
    updateGrid();
  }
  const baseRender = render, baseSelect = select, baseView = applyView;
  render = function () { baseRender(); decorate(); renderEdges(); guides.innerHTML = ''; };
  select = function (id) { baseSelect(id); decorate(); };
  applyView = function () { baseView(); updateGrid(); };
  function peers(n, axis) {
    return board().nodes.filter(p => p.id !== n.id).flatMap(p => {
      const s = size(p), start = axis === 'x' ? p.x : p.y, extent = axis === 'x' ? s.w : s.h;
      return [start, start + extent / 2, start + extent];
    });
  }
  function closest(values, targets, tolerance) {
    let best = null;
    for (const value of values) for (const target of targets) {
      const delta = target - value;
      if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta))) best = {delta, target};
    }
    return best;
  }
  function paintGuides(x, y) {
    guides.innerHTML = (x == null ? '' : `<line data-axis="x" x1="${x}" x2="${x}" y1="-5000" y2="5000"/>`) +
      (y == null ? '' : `<line data-axis="y" y1="${y}" y2="${y}" x1="-5000" x2="5000"/>`);
  }
  function place(n, x, y, free) {
    if (free) { n.x = x; n.y = y; paintGuides(); return; }
    const s = size(n), tolerance = 8 / board().view.zoom;
    const sx = closest([x,x+s.w/2,x+s.w], peers(n,'x'), tolerance);
    const sy = closest([y,y+s.h/2,y+s.h], peers(n,'y'), tolerance);
    n.x = sx ? x + sx.delta : quantize(x); n.y = sy ? y + sy.delta : quantize(y);
    paintGuides(sx?.target, sy?.target);
  }
  function resize(n, start, dir, dx, dy, free) {
    let left = start.x, top = start.y, right = start.x + start.w, bottom = start.y + start.h;
    const tolerance = 8 / board().view.zoom;
    let gx, gy;
    if (dir.includes('e') || dir.includes('w')) {
      let w = Math.max(MIN_W, Math.min(1200, start.w + (dir.includes('e') ? dx : -dx)));
      if (!free) w = quantize(w);
      if (dir.includes('e')) right = left + w; else left = right - w;
      if (!free) {
        const edge = dir.includes('e') ? right : left, snap = closest([edge], peers(n,'x'), tolerance);
        if (snap && (dir.includes('e') ? edge + snap.delta - left : right - edge - snap.delta) >= MIN_W) {
          if (dir.includes('e')) right += snap.delta; else left += snap.delta; gx = snap.target;
        }
      }
    }
    if (dir.includes('s') || dir.includes('n')) {
      let h = Math.max(MIN_H, Math.min(1600, start.h + (dir.includes('s') ? dy : -dy)));
      if (!free) h = quantize(h);
      if (dir.includes('s')) bottom = top + h; else top = bottom - h;
      if (!free) {
        const edge = dir.includes('s') ? bottom : top, snap = closest([edge], peers(n,'y'), tolerance);
        if (snap && (dir.includes('s') ? edge + snap.delta - top : bottom - edge - snap.delta) >= MIN_H) {
          if (dir.includes('s')) bottom += snap.delta; else top += snap.delta; gy = snap.target;
        }
      }
    }
    n.x = left; n.y = top; n.w = right - left; n.h = bottom - top; paintGuides(gx,gy);
  }
  function draw(n, el) {
    el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    if (n.type === 'article') {el.style.width = n.w + 'px'; el.style.height = n.h + 'px';}
    const badge = el.querySelector('.size-badge'); if (badge) badge.textContent = Math.round(n.w) + ' × ' + Math.round(n.h);
    renderEdges();
  }
  // Use capture only after a real drag begins; ordinary click and double-click retain their target.
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || mode === 'connect' || event.target.closest('#modal-root,#preview,#selection-bar')) return;
    const el = event.target.closest('#nodes > .node'); if (!el) return;
    const handle = event.target.closest('[data-resize]');
    if (!handle && event.target.closest('button')) return;
    const n = board().nodes.find(item => item.id === el.dataset.node); if (!n) return;
    const s = size(n);
    active = {n, el, dir:handle?.dataset.resize, start:{x:n.x,y:n.y,w:s.w,h:s.h}, sx:event.clientX,sy:event.clientY,pointer:event.pointerId,moved:false};
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('pointermove', event => {
    if (!active || event.pointerId !== active.pointer) return;
    const g = active, dx = (event.clientX-g.sx)/sceneScale/board().view.zoom, dy=(event.clientY-g.sy)/sceneScale/board().view.zoom;
    if (!g.moved && Math.abs(event.clientX-g.sx)+Math.abs(event.clientY-g.sy) <= 5) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!g.moved) {
      g.moved = true; $('canvas').setPointerCapture(g.pointer); selected = g.n.id;
      document.querySelectorAll('#nodes > .node').forEach(el => el.classList.toggle('selected',el === g.el));
      renderSelection(); decorate(); g.el.classList.add('dragging');
    }
    if (g.dir) resize(g.n,g.start,g.dir,dx,dy,event.altKey); else place(g.n,g.start.x+dx,g.start.y+dy,event.altKey);
    draw(g.n,g.el);
    document.querySelectorAll('.folder').forEach(el => el.classList.remove('drop-target'));
    if (!g.dir) {const target = dropTarget(g.n); if (target) element(target.id)?.classList.add('drop-target');}
  }, {capture:true,passive:false});
  function end(event, cancelled) {
    if (!active || event.pointerId !== active.pointer) return;
    const g = active; active = null;
    if (!g.moved) return;
    event.stopImmediatePropagation();
    if ($('canvas').hasPointerCapture(g.pointer)) $('canvas').releasePointerCapture(g.pointer);
    suppressClick = true;
    if (cancelled) Object.assign(g.n,g.start);
    else if (!g.dir) {
      const target = dropTarget(g.n);
      if (target && !moveNode(g.n,target.board)) Object.assign(g.n,g.start);
    }
    save(); render(); setTimeout(() => {suppressClick=false;},180);
  }
  document.addEventListener('pointerup', event => end(event,false),true);
  document.addEventListener('pointercancel', event => end(event,true),true);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-resize]')) {event.preventDefault();event.stopImmediatePropagation();}
  },true);
  document.addEventListener('keydown', event => {
    const handle = event.target.closest('[data-resize]');
    if (!handle || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    const el=handle.closest('[data-node]'), n=board().nodes.find(item=>item.id===el.dataset.node),s=size(n),dir=handle.dataset.resize;
    const dx=event.key==='ArrowLeft'?-UNIT:event.key==='ArrowRight'?UNIT:0,dy=event.key==='ArrowUp'?-UNIT:event.key==='ArrowDown'?UNIT:0;
    event.preventDefault();event.stopImmediatePropagation();
    resize(n,{x:n.x,y:n.y,w:s.w,h:s.h},dir,dx,dy,event.altKey);draw(n,el);save();decorate();
    paintGuides();
  },true);
  dropTarget = function (n) {
    const s=size(n),cx=n.x+s.w/2,cy=n.y+s.h/2;
    return [...board().nodes].reverse().find(t=>t.type==='board'&&t.id!==n.id&&cx>t.x+20&&cx<t.x+280&&cy>t.y+20&&cy<t.y+230);
  };
  render();
})();
