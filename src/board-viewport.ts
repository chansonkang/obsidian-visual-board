export interface BoardRect {x:number;y:number;w:number;h:number}
const bounds=(rects:BoardRect[])=>({left:Math.min(...rects.map(n=>n.x)),top:Math.min(...rects.map(n=>n.y)),right:Math.max(...rects.map(n=>n.x+n.w)),bottom:Math.max(...rects.map(n=>n.y+n.h))});
/** Center content in the usable canvas, clear of the top fade and bottom controls. */
export function centeredBoardView(input:BoardRect[],viewport:{w:number;h:number}) {
 const rects=input.filter(n=>[n.x,n.y,n.w,n.h].every(Number.isFinite)&&n.w>0&&n.h>0);
 if(!rects.length)return {x:0,y:0,zoom:1};
 const w=Math.max(160,viewport.w),h=Math.max(160,viewport.h),aw=Math.max(80,w-96),ah=Math.max(80,h-104);
 const fit=(r:ReturnType<typeof bounds>)=>Math.min(1,aw/(r.right-r.left),ah/(r.bottom-r.top));
 let area=bounds(rects);
 // Keep widely separated old layouts readable; use the most populated visible neighborhood.
 if(fit(area)<.3&&rects.length>1){
  let best:BoardRect[]=[];
  for(const anchor of rects){
   const cx=anchor.x+anchor.w/2,cy=anchor.y+anchor.h/2;
   const nearby=rects.filter(n=>Math.abs(n.x+n.w/2-cx)<=aw/.6&&Math.abs(n.y+n.h/2-cy)<=ah/.6);
   if(nearby.length>best.length)best=nearby;
  }
  if(best.length<rects.length)area=bounds(best);
 }
 const zoom=Math.max(.3,Math.floor(fit(area)*20+1e-8)/20);
 return {x:w/2-(area.left+area.right)/2*zoom,y:h/2+20-(area.top+area.bottom)/2*zoom,zoom};
}
