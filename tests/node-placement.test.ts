import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleNodePosition} from '../src/node-placement';
test('creation stays inside a distant current viewport and preserves the old camera and article',()=>{
 const view={x:-49000,y:-39000,zoom:.8},article={x:61500,y:49000,w:420,h:520};
 const before=JSON.stringify({view,article});const p=visibleNodePosition([article],view,{w:1536,h:650},{w:300,h:303},article);
 assert.ok(view.x+p.x*view.zoom>=0&&view.x+(p.x+300)*view.zoom<=1536);
 assert.ok(view.y+p.y*view.zoom>=0&&view.y+(p.y+303)*view.zoom<=650);
 assert.equal(p.x%20,0);assert.equal(p.y%20,0);assert.equal(JSON.stringify({view,article}),before);
 assert.ok(p.x>=article.x+article.w||p.x+300<=article.x||p.y>=article.y+article.h||p.y+303<=article.y);
});
test('crowded narrow viewport still places an entry near the visible camera instead of a fixed origin',()=>{
 const view={x:20000,y:-80000,zoom:1.5};const p=visibleNodePosition([{x:-13300,y:53300,w:800,h:1000}],view,{w:500,h:350},{w:300,h:303});
 assert.ok(Math.abs(view.x+(p.x+150)*view.zoom-250)<220);assert.ok(Math.abs(view.y+(p.y+150)*view.zoom-175)<230);
});
