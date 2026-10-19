import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness } from './rich-editor-harness.mjs';

const body='# Rich\n\nA **formatted** note that must stay untouched.\n';
const h=await richHarness(body);
const checks=[];
try{
 const {frame,page}=h;
 await frame.waitForFunction(()=>!!window.VBUpdates);
 await page.evaluate(()=>{
  const h=richHost;h.updateCalls=[];h.update={status:'not-configured',currentVersion:'0.1.26',repository:'',autoCheck:true,shouldNotify:false};
  h.componentRPC=m=>{if(!['update-info','check-update','configure-updates','ignore-update','open-update'].includes(m.method))return false;h.updateCalls.push({method:m.method,payload:m.payload});
   let result={...h.update};
   if(m.method==='configure-updates'){h.update={...h.update,repository:m.payload.repository,autoCheck:m.payload.autoCheck,status:m.payload.repository?'up-to-date':'not-configured'};result={...h.update};}
   if(m.method==='check-update'){h.update={...h.update,status:h.nextUpdateStatus||'available',latestVersion:'0.1.27',releaseUrl:'https://github.com/example/visual-board/releases/tag/0.1.27',downloadUrl:'https://github.com/example/visual-board/releases/download/0.1.27/main.js',shouldNotify:false};result={...h.update};}
   if(m.method==='ignore-update')result={...h.update,shouldNotify:false};
   if(m.method==='open-update')result={ok:true};
   document.querySelector('iframe').contentWindow.postMessage({kind:'vb-response',channel:'rich-fixture',id:m.id,result},'*');return true;
  };
  h.layoutBefore=JSON.stringify(h.payload.layout);h.draftsBefore=JSON.stringify(h.recovery);h.baselineCallIndex=h.calls.length;
 });
 await frame.getByTestId('settings').click();
 const panel=frame.getByTestId('update-settings');await panel.waitFor();await frame.getByTestId('update-status').filter({hasText:'尚未设置'}).waitFor();
 assert.equal(await frame.getByTestId('update-repository').inputValue(),'');assert.equal(await frame.getByTestId('update-auto').isChecked(),true);
 await frame.getByTestId('update-repository').fill('example/visual-board');await frame.getByTestId('update-auto').uncheck();await frame.getByTestId('update-save').click();
 await page.waitForFunction(()=>richHost.updateCalls.some(c=>c.method==='configure-updates'));
 assert.deepEqual(await page.evaluate(()=>richHost.updateCalls.find(c=>c.method==='configure-updates').payload),{repository:'example/visual-board',autoCheck:false});
 checks.push('Board settings configure only release source and daily preference, independently of Board data');
 await frame.getByTestId('update-check').focus();await page.keyboard.press('Enter');await frame.getByTestId('update-status').filter({hasText:'有新版本可用'}).waitFor();
 await frame.getByTestId('update-release').click();await frame.getByTestId('update-download').click();
 assert.deepEqual((await page.evaluate(()=>richHost.updateCalls.filter(c=>c.method==='open-update').map(c=>c.payload))),[{kind:'release'},{kind:'download'}]);
 assert.deepEqual(await page.evaluate(()=>richHost.updateCalls.find(c=>c.method==='check-update').payload),{manual:true});
 await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await panel.screenshot({path:new URL('../evidence/update-settings-desktop.png',import.meta.url).pathname});
 checks.push('Keyboard manual check exposes release and download actions via validated host RPC, with no self-install');
 for(const [status,word]of [['offline','无法连接 GitHub'],['rate-limited','请求次数'],['incompatible','更新 Obsidian'],['up-to-date','最新版本'],['invalid-release','发布包不完整'],['not-found','未找到仓库']]){
  await page.evaluate(status=>{richHost.nextUpdateStatus=status;},status);await frame.getByTestId('update-check').click();await frame.getByTestId('update-status').filter({hasText:word}).waitFor();
  if(status==='incompatible')assert.equal(await frame.getByTestId('update-download').isVisible(),false);
 }
 checks.push('Offline, rate limit, incompatible, latest, invalid package and missing release states are distinct');
 await frame.evaluate(()=>VBI18n.setLanguage('en',{persist:false}));assert.equal(await panel.locator('h3').textContent(),'Plugin updates');assert.equal(await frame.getByTestId('update-check').textContent(),'Check for updates');assert.equal(await frame.getByTestId('update-repository').inputValue(),'example/visual-board');
 checks.push('Live English and Chinese labels preserve the repository input and use accessible keyboard controls');
 await frame.evaluate(()=>closeModal(true));
 await h.editor.focus();const activeBefore=await h.editor.evaluate(el=>el===document.activeElement);
 assert.equal(activeBefore,true);
 const emit=async(status,type='update-available')=>page.evaluate(({status,type})=>{richHost.update={...richHost.update,status,latestVersion:'0.1.28',notes:'<img src=x onerror="window.pwned=true">',downloadUrl:'https://github.com/example/visual-board/releases/download/0.1.28/main.js'};document.querySelector('iframe').contentWindow.postMessage({kind:'vb-event',channel:'rich-fixture',type,payload:{...richHost.update}},'*');},{status,type});
 await emit('available');await frame.waitForFunction(()=>VBUpdates.status.latestVersion==='0.1.28');
 assert.equal(await frame.getByTestId('update-notice').isVisible(),false);assert.equal(await frame.locator('.vb-update-dot').isVisible(),true);assert.equal(await h.editor.evaluate(el=>el===document.activeElement),true);
 checks.push('Background update during editing only adds a settings badge and preserves focus');
 await h.editor.evaluate(el=>el.blur());await frame.getByTestId('update-notice').waitFor({state:'visible'});assert.match(await frame.getByTestId('update-notice').textContent(),/A new version is available/);await h.editor.focus();assert.equal(await frame.getByTestId('update-notice').isVisible(),false);await h.editor.evaluate(el=>el.blur());await frame.getByTestId('update-notice').waitFor({state:'visible'});await frame.getByTestId('update-notice-release').focus();await page.keyboard.press('Tab');assert.equal(await frame.getByTestId('update-notice-download').evaluate(el=>el===document.activeElement),true);
 await frame.getByTestId('update-notice-later').click();assert.equal(await frame.getByTestId('update-notice').isVisible(),false);await frame.evaluate(()=>VBI18n.setLanguage('zh',{persist:false}));assert.equal(await frame.getByTestId('update-notice').isVisible(),false);
 checks.push('Polite banner waits until editing ends; Later dismisses it without opening a modal');
 await frame.getByTestId('settings').click();await frame.getByTestId('update-status').filter({hasText:'有新版本'}).waitFor();assert.match(await panel.locator('[data-update-notes]').textContent(),/<img/);assert.equal(await panel.locator('[data-update-notes] img').count(),0);assert.equal(await frame.evaluate(()=>window.pwned),undefined);
 await frame.getByTestId('update-ignore').click();await frame.getByTestId('update-status').filter({hasText:'已忽略'}).waitFor();assert.equal(await frame.locator('.vb-update-dot').isVisible(),false);
 checks.push('Release text remains inert text and ignoring a version clears the local badge');
 assert.equal(await h.body(),body);assert.equal(await page.evaluate(()=>JSON.stringify(richHost.payload.layout)===richHost.layoutBefore),true);assert.equal(await page.evaluate(()=>JSON.stringify(richHost.recovery)===richHost.draftsBefore),true);assert.deepEqual(await page.evaluate(()=>richHost.calls.slice(richHost.baselineCallIndex).filter(c=>['update-note'].includes(c.method)).map(c=>c.method)),[]);assert.deepEqual(h.errors,[]);assert.deepEqual(h.requests,[]);
 checks.push('All update interactions leave article Markdown, Board positions, drafts and outgoing network unchanged');
 await mkdir(new URL('../evidence/',import.meta.url),{recursive:true});await writeFile(new URL('../evidence/update-ui-browser.json',import.meta.url),JSON.stringify({passed:true,checks,userVaultAccessed:false,actualNetwork:false},null,2));console.log('Update UI: '+checks.length+' browser checks passed.');
}finally{await h.close();}
