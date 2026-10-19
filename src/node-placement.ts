export interface PlacementRect {x:number;y:number;w:number;h:number}
/** New content is placed in the current camera, without changing that camera. */
export function visibleNodePosition(nodes:PlacementRect[],view:{x:number;y:number;zoom:number},viewport:{w:number;h:number},size:{w:number;h:number},selected?:PlacementRect){
 const z=Math.max(.3,view.zoom),left=(32-view.x)/z,top=(24-view.y)/z;
 const right=(Math.max(160,viewport.w)-32-view.x)/z,bottom=(Math.max(160,viewport.h)-24-view.y)/z;
 const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(Math.max(a,b),v));
 const snap=(v:number)=>Math.round(v/20)*20;
 const maxX=right-size.w,maxY=bottom-size.h;
 const anchor=selected?{x:selected.x+selected.w+40,y:selected.y}:{x:(left+right-size.w)/2,y:(top+bottom-size.h)/2};
 const candidates=[anchor,{x:anchor.x-size.w-80,y:anchor.y+40}];
 for(let row=0;row<12;row++)for(let column=0;column<18;column++)candidates.push({x:left+column*(size.w+40),y:top+row*(size.h+40)});
 let best={x:snap(clamp(anchor.x,left,maxX)),y:snap(clamp(anchor.y,top,maxY))},score=Infinity;
 for(const p of candidates){const x=snap(clamp(p.x,left,maxX)),y=snap(clamp(p.y,top,maxY));
  const overlap=nodes.reduce((sum,n)=>sum+Math.max(0,Math.min(x+size.w+20,n.x+n.w+20)-Math.max(x-20,n.x-20))*Math.max(0,Math.min(y+size.h+20,n.y+n.h+20)-Math.max(y-20,n.y-20)),0);
  const cost=overlap*1000+Math.hypot(x-anchor.x,y-anchor.y);
  if(cost<score){score=cost;best={x,y};}
 }
 return best;
}
