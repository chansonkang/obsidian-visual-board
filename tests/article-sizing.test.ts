import test from 'node:test';
import assert from 'node:assert/strict';
import {articleCardSize, fitArticleCards} from '../src/article-sizing';
import {initialLayout, sanitizeLayout} from '../src/model';

test('short, long CJK, English and many-paragraph notes receive bounded reading sizes',()=>{
 const short=articleCardSize({body:'A short note'});
 for(const body of ['这是长文章。'.repeat(3000),'Long article text. '.repeat(5000),'a\n'.repeat(1000)]){
  const long=articleCardSize({body});assert.ok(long.w>short.w);assert.ok(long.h>short.h);assert.ok(long.h<=640);assert.equal(long.w%20,0);assert.equal(long.h%20,0);
 }
});
test('legacy runaway sizes are repaired through the real persistence boundary while manual sizes survive',()=>{
 const raw=initialLayout();raw.boards.home.nodes=[
  {id:'old-narrow',type:'article',doc:'long.md',x:40,y:60,w:200,h:33078},
  {id:'old-wide',type:'article',doc:'long.md',x:500,y:60,w:420,h:33078},
  {id:'manual',type:'article',doc:'long.md',x:900,y:60,w:600,h:900},
  {id:'fresh',type:'article',doc:'long.md',x:1100,y:60}
 ];
 const layout=sanitizeLayout(raw);const docs={'long.md':{body:'文章'.repeat(10000)}};
 assert.equal(fitArticleCards(layout,docs),true);
 for(const n of layout.boards.home.nodes.filter(n=>n.id!=='manual'))assert.deepEqual([n.w,n.h],[480,640]);
 assert.deepEqual(layout.boards.home.nodes[2],raw.boards.home.nodes[2]);
 assert.equal(fitArticleCards(layout,docs),false);assert.equal(docs['long.md'].body.length,20000);
});

test('previously clamped legacy cards migrate once and new deliberate tall manual sizes remain stable',()=>{
 const layout=initialLayout();layout.boards.home.nodes=[{id:'old',type:'article',doc:'long.md',x:10,y:20,w:1200,h:1600}];
 const docs={'long.md':{body:'long article '.repeat(3000)}};fitArticleCards(layout,docs);
 assert.equal(layout.boards.home.nodes[0].h,640);
 Object.assign(layout.boards.home.nodes[0],{w:220,h:1000});
 assert.equal(fitArticleCards(sanitizeLayout(layout),docs),false);
 assert.equal(layout.boards.home.nodes[0].h,1000);
});
