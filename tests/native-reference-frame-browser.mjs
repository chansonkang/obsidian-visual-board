import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness, fixturePath, fixturePNG, selectRendered } from './rich-editor-harness.mjs';
const h=await richHarness('# Rich\n\nParagraph before change.\n\n'+Array.from({length:40},(_,i)=>`Section ${i}: retained content.\n\n`).join(''));
const checks={};
try{
 const {frame,page,editor}=h;
 await frame.evaluate(png=>{
  const b=board();b.nodes.push({id:'keep',type:'note',title:'Keep',text:'Untouched',x:1720,y:70,w:260,h:280,color:'pink'});
  b.nodes.push({id:'photo',type:'photo',imagePath:'Assets/Original.png',title:'Original',x:40,y:900,w:21,h:21,imageWidth:1,imageHeight:1});
  b.edges.push({id:'edge-1',from:'article',to:'keep'},{id:'edge-2',from:'peer',to:'keep'});
  VBHost.registerAsset('Assets/Original.png',png);board().view={x:4,y:12,zoom:.8};render();
 },fixturePNG);
 const original=await frame.evaluate(()=>({keep:structuredClone(board().nodes.find(n=>n.id==='keep')),view:{...board().view},article:structuredClone(board().nodes.find(n=>n.id==='article'))}));
 // Even an untouched focused title must follow a native rename rather than pinning its old label.
 await frame.locator('[data-node="article"] .vb-inline-title').focus();
 await page.evaluate(({oldPath,newPath})=>{
  const p=richHost.payload,d=p.docs[oldPath];delete p.docs[oldPath];p.docs[newPath]={...d,id:newPath,path:newPath,title:'Renamed'};
  document.getElementById('frame').contentWindow.postMessage({kind:'vb-event',channel:'rich-fixture',type:'rename',payload:{oldPath,newPath,nativeRevision:1}},'*');
 },{oldPath:fixturePath,newPath:'Notes/Renamed.md'});
 await frame.waitForFunction(()=>VBHost.nativeRevision===1&&state.docs['Notes/Renamed.md']);
 assert.deepEqual(await frame.locator('.vb-inline-title').allTextContents(),['Renamed','Renamed']);
 await frame.locator('[data-node="article"] .vb-inline-title').blur();
 assert.equal(await frame.evaluate(()=>board().nodes.find(n=>n.id==='article').doc),'Notes/Renamed.md');
 assert.deepEqual(await frame.evaluate(()=>({x:board().nodes[0].x,y:board().nodes[0].y,w:board().nodes[0].w,h:board().nodes[0].h})),{x:original.article.x,y:original.article.y,w:original.article.w,h:original.article.h});
 checks.nativeRenameImmediatelyUpdatesAllTitlesAndPathsWithoutMovingCards=true;
 await page.evaluate(()=>document.getElementById('frame').contentWindow.postMessage({kind:'vb-event',channel:'rich-fixture',type:'rename',payload:{oldPath:'Assets/Original.png',newPath:'Assets/Replaced.png',nativeRevision:2}},'*'));
 await frame.waitForFunction(()=>board().nodes.find(n=>n.id==='photo').title==='Replaced');
 assert.equal(await frame.evaluate(()=>board().nodes.find(n=>n.id==='photo').imagePath),'Assets/Replaced.png');
 checks.attachmentRenameUpdatesItsCaption=true;
 await selectRendered(editor,'Paragraph before change.',true);await page.keyboard.insertText('Unsaved ');
 await page.evaluate(()=>{richHost.fail=true;document.getElementById('frame').contentWindow.postMessage({kind:'vb-event',channel:'rich-fixture',type:'delete',payload:{path:'Notes/Renamed.md',folder:false,nativeRevision:3}},'*');});
 await frame.waitForFunction(()=>!board().nodes.some(n=>n.type==='article'));
 assert.equal(await frame.locator('.paper').count(),0);assert.equal(await frame.evaluate(()=>board().edges.length),0);
 await page.waitForFunction(()=>Object.values(richHost.recovery).some(d=>d.path==='Notes/Renamed.md'&&d.body.includes('Unsaved')));
 checks.nativeDeleteRemovesAllDuplicateCardsAndConnectionsAndKeepsRecovery=true;
 // Delayed old events must not revive old names or undo a later native deletion.
 await page.evaluate(()=>document.getElementById('frame').contentWindow.postMessage({kind:'vb-event',channel:'rich-fixture',type:'snapshot',payload:{...richHost.payload,nativeRevision:1}},'*'));
 await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.equal(await frame.locator('.paper').count(),0);assert.equal(await frame.evaluate(()=>VBHost.nativeRevision),3);
 checks.staleSnapshotCannotRestoreDeletedCards=true;
 await page.evaluate(()=>document.getElementById('frame').contentWindow.postMessage({kind:'vb-event',channel:'rich-fixture',type:'delete',payload:{path:'Assets/Replaced.png',nativeRevision:4}},'*'));
 await frame.waitForFunction(()=>board().nodes.length===1);
 assert.deepEqual(await frame.evaluate(()=>({keep:structuredClone(board().nodes[0]),view:{...board().view}})),{keep:original.keep,view:original.view});
 checks.assetDeletionPreservesUnrelatedComponentAndCamera=true;
 assert.deepEqual(h.errors,[]);await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/native-reference-frame-browser.json',import.meta.url),JSON.stringify({passed:true,count:Object.keys(checks).length,checks,userVaultAccessed:false},null,2));
 console.log(`Native reference frame synchronization passed: ${Object.keys(checks).length} groups.`);
}finally{await h.close();}
