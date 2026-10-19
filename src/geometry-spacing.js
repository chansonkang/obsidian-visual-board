  function paintSpacingGuides(items) {
    const scale = board().view.zoom * sceneScale, tick = 5 / scale, font = 11 / scale;
    const NS = 'http://www.w3.org/2000/svg';
    const make = (name, attrs, parent) => {
      const el = document.createElementNS(NS, name);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
      parent.append(el); return el;
    };
    for (const gap of items) {
      const group = make('g', {class:'spacing-guide', 'data-axis':gap.axis, 'data-gap':gap.gap}, guides);
      const style = {stroke:'#9876cc', 'stroke-width':1.5, 'vector-effect':'non-scaling-stroke'};
      make('line', {...style, x1:gap.x1, y1:gap.y1, x2:gap.x2, y2:gap.y2}, group);
      for (const [x,y] of [[gap.x1,gap.y1],[gap.x2,gap.y2]]) make('line', {...style,
        x1:x-(gap.axis==='y'?tick:0), x2:x+(gap.axis==='y'?tick:0),
        y1:y-(gap.axis==='x'?tick:0), y2:y+(gap.axis==='x'?tick:0)}, group);
      const label = String(Math.round(gap.gap * 10) / 10), width = (label.length * 7 + 16) / scale;
      const x = (gap.x1+gap.x2)/2, y = (gap.y1+gap.y2)/2;
      make('rect', {x:x-width/2,y:y-9/scale,width,height:18/scale,rx:9/scale,fill:'#f0e9fb',stroke:'none'}, group);
      const text = make('text', {x,y,fill:'#8665b9',stroke:'none','font-size':font,'font-family':'system-ui,sans-serif','text-anchor':'middle','dominant-baseline':'central'}, group);
      text.textContent = label;
    }
  }
  function place(n, x, y, free) {
    if (free) { n.x = x; n.y = y; paintGuides(); return; }
    const s = size(n), tolerance = 8 / (board().view.zoom * sceneScale);
    const sx = closest([x,x+s.w/2,x+s.w], peers(n,'x'), tolerance);
    const sy = closest([y,y+s.h/2,y+s.h], peers(n,'y'), tolerance);
    const rects = board().nodes.filter(p=>p.id!==n.id).map(p=>({id:p.id,x:p.x,y:p.y,...size(p)}));
    const equal = VBSpacing.equalSpacingSnap({id:n.id,x,y,...s},rects,{x,y},tolerance);
    const useX = equal.x != null && (!sx || Math.abs(equal.x-x)<=Math.abs(sx.delta));
    const useY = equal.y != null && (!sy || Math.abs(equal.y-y)<=Math.abs(sy.delta));
    n.x = useX ? equal.x : sx ? x+sx.delta : quantize(x);
    n.y = useY ? equal.y : sy ? y+sy.delta : quantize(y);
    paintGuides(useX ? undefined : sx?.target, useY ? undefined : sy?.target);
    paintSpacingGuides(equal.guides.filter(g=>g.axis==='x'?useX:useY));
  }
