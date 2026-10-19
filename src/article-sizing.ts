/** Initial reading sizes in Board units. Full text stays in the scrollable card. */
export function articleCardSize(doc?: {body?:string;title?:string}) {
 const body=doc?.body||'', title=doc?.title||'';
 const wide=(body.match(/[\u2e80-\u9fff\uf900-\ufaff]/g)||[]).length;
 const length=body.length+wide;
 const lines=body.split('\n').filter(line=>line.trim()).length;
 const tier=Math.max(length>5000?3:length>1800?2:length>500?1:0,lines>80?3:lines>32?2:lines>12?1:0);
 const widths=[280,340,420,480], heights=[260,360,520,640];
 // Keep long filenames readable without expanding a short note vertically.
 return {w:Math.max(widths[tier],title.length>24?340:280),h:heights[tier]};
}

/** Repair missing/legacy natural-height sizes; retain valid manually resized cards. */
export function fitArticleCards(layout:{articleSizingVersion?:number;boards:Record<string,{nodes:Array<{type:string;doc?:string;w?:number;h?:number}>}>},docs:Record<string,{body?:string;title?:string}>) {
 const legacy=layout.articleSizingVersion!==1;let changed=legacy;
 for(const b of Object.values(layout.boards))for(const n of b.nodes){
  if(n.type!=='article')continue;
  const missing=!(n.w&&n.h), runaway=(n.h||0)>1600 || legacy&&((n.h||0)>=1600 || (n.w||200)<=240&&(n.h||0)>=800);
  if(!missing&&!runaway)continue;
  const size=articleCardSize(docs[n.doc||'']);
  if(runaway){n.w=size.w;n.h=size.h;}
  else{if(!n.w)n.w=size.w;if(!n.h)n.h=size.h;}
  changed=true;
 }
 layout.articleSizingVersion=1;
 return changed;
}
