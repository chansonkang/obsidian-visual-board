import test from 'node:test';
import assert from 'node:assert/strict';
import {centeredBoardView} from '../src/board-viewport';

test('a remote article becomes centered within the usable canvas without moving it',()=>{
 const rect={x:160,y:33060,w:480,h:640},original={...rect};const v=centeredBoardView([rect],{w:1100,h:760});
 assert.equal(v.x+(rect.x+rect.w/2)*v.zoom,550);assert.equal(v.y+(rect.y+rect.h/2)*v.zoom,400);assert.deepEqual(rect,original);
 assert.ok(v.y+rect.y*v.zoom>=72);assert.ok(v.y+(rect.y+rect.h)*v.zoom<=728);
});
test('fitting several cards preserves readable zoom and empty boards reset the camera',()=>{
 const rects=[{x:-180,y:-20,w:300,h:303},{x:150,y:35,w:320,h:440},{x:560,y:35,w:200,h:279}];
 const v=centeredBoardView(rects,{w:826,h:754});assert.ok(v.zoom>=.3&&v.zoom<=1);
 for(const r of rects){assert.ok(v.x+r.x*v.zoom>=48);assert.ok(v.x+(r.x+r.w)*v.zoom<=778);assert.ok(v.y+r.y*v.zoom>=72);assert.ok(v.y+(r.y+r.h)*v.zoom<=722);}
 assert.deepEqual(centeredBoardView([],{w:826,h:754}),{x:0,y:0,zoom:1});
});
test('extremely scattered old layouts center a populated area instead of empty space',()=>{
 const near=[{x:100,y:100,w:280,h:260},{x:420,y:100,w:280,h:260},{x:100,y:400,w:280,h:260}];
 const v=centeredBoardView([...near,{x:100,y:33000,w:480,h:640}],{w:1200,h:900});
 for(const r of near){assert.ok(v.x+r.x*v.zoom>=0);assert.ok(v.y+r.y*v.zoom>=56);assert.ok(v.y+(r.y+r.h)*v.zoom<=900);}
 assert.ok(v.zoom>=.5,'nearby notes stay readable');
});
