import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';

// Actual PDF.js and native audio decoder; Vault operations use real MediaService on an in-memory App.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const { buildSync } = require('esbuild');
globalThis.crypto ??= webcrypto;
const compiled = buildSync({ stdin: { contents: "export {stripEphemeral} from './src/model.ts'; export {MediaService} from './src/media.ts';", resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
const modelModule = { exports: {} }; new Function('require', 'module', 'exports', compiled)(require, modelModule, modelModule.exports);
const { stripEphemeral, MediaService } = modelModule.exports;
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
function twoPagePdf() {
  const stream = (label, color) => `q ${color} rg 25 80 270 160 re f Q\nBT /F1 22 Tf 25 355 Td (${label}) Tj ET\nBT /F1 12 Tf 25 325 Td (Valid local two-page PDF fixture) Tj ET\n`;
  const first = stream('PAGE ONE', '0.1 0.3 0.7'), second = stream('PAGE TWO', '0.7 0.2 0.1');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 420] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(first)} >>\nstream\n${first}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 420] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${Buffer.byteLength(second)} >>\nstream\n${second}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n', offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}
function pcmWav() {
  const rate = 8000, seconds = 30, frames = rate * seconds, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) bytes.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 2 * 440) * 2000), 44 + i * 2);
  return bytes;
}
const pdf = twoPagePdf(), wav = pcmWav();
const files = new Map(), bytes = new Map(), created = [], opened = [], imports = [], calls = [];
const app = { vault: {
  getAbstractFileByPath: path => files.get(path) || null,
  createFolder: async path => { files.set(path, { path, name: path.split('/').at(-1), children: [] }); },
  createBinary: async (path, buffer) => { const data = new Uint8Array(buffer).slice(), name = path.split('/').at(-1), file = { path, name, basename: name.replace(/\.[^.]+$/, ''), extension: name.split('.').at(-1), stat: { size: data.length, mtime: 1 } }; files.set(path, file); bytes.set(path, data); created.push(path); return file; },
  readBinary: async file => bytes.get(file.path).slice().buffer,
  getResourcePath: file => 'app://fixture-vault/' + encodeURIComponent(file.path),
  adapter: { exists: async path => files.has(path) },
}, workspace: { getLeaf: () => ({ openFile: async file => { opened.push(file.path); } }) } };
const service = new MediaService(app, () => 'Attachments/Media');
const makeBoard = (id, title, parent, nodes = []) => ({ id, title, parent, theme: 'research', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] });
const payload = { layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: {
  home: makeBoard('home', 'PDF 与音频验收', null, [{ id: 'child-entry', type: 'board', board: 'child', x: 1050, y: 60 }]),
  child: makeBoard('child', '子 Board', 'home', []),
} }, docs: {}, assets: {}, embeds: {}, drafts: [], mediaAssets: {}, settings: { defaultIconMode: 'default', attachmentFolder: 'Attachments/Media' }, vaultName: 'Media Fixture Vault' };
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials', '--mute-audio'] });
const errors = [], consoleErrors = [], externalRequests = [], revealed = [], invalidReveals = [];
let page, clipboard;
try {
  async function initialize() {
    const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('request', request => { if (/^(https?:|app:)/.test(request.url())&&!request.url().startsWith('http://127.0.0.1:')) externalRequests.push(request.url()); });
    await page.route('https://**', route => route.abort());
    await page.exposeFunction('mediaFixturePayload', async () => {
      payload.mediaAssets = await service.mediaAssets(Object.values(payload.layout.boards).flatMap(board => board.nodes.filter(n => n.filePath).map(n => n.filePath)));
      return payload;
    });
    await page.exposeFunction('mediaFixtureRevealed', () => revealed.slice());
    await page.exposeFunction('mediaFixtureClipboard', () => clipboard);
    await page.exposeFunction('mediaFixtureOpened', () => opened.slice());
    await page.exposeFunction('mediaFixtureRPC', async (method, p) => {
      calls.push({ method, payload: method === 'import-media' ? { name: p.name, base64Length: p.base64?.length } : p });
      if (method === 'save-layout') { payload.layout = stripEphemeral(p); return { ok: true }; }
      if (method === 'import-media') { const result = await service.import(p); imports.push(result); return result; }
      if (method === 'media-assets') return service.mediaAssets(p.paths);
      if (method === 'read-pdf') return service.readPdf(p.path);
      if (method === 'read-audio') return service.readAudio(p.path);
      if (method === 'list-media') { const assets = await service.mediaAssets(created); return Object.entries(assets).map(([path, item]) => ({ path, title: imports.find(result => result.path === path)?.title || item.title, kind: item.kind })); }
      if (method === 'reveal-entry') { const file = files.get(p.path); if (!file || typeof file.extension !== 'string' || !file.stat || !created.includes(p.path)) { invalidReveals.push(p.path); throw Error('Reveal target is not an existing imported fixture file.'); } assert.equal(file.path, p.path); assert.equal(file.stat.size, bytes.get(p.path).length); revealed.push(p.path); return { ok: true }; }
      if (method === 'open-media') { await service.open(p.path); return { ok: true }; }
      if (method === 'copy-link') { clipboard = `obsidian://open?vault=${encodeURIComponent(payload.vaultName)}&file=${encodeURIComponent(p.path)}`; return { url: clipboard }; }
      return { ok: true };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(html => {
      const iframe = document.getElementById('frame'); window.mediaReady = false; window.mediaFlushed = false;
      window.mediaSnapshot = snapshot => iframe.contentWindow.postMessage({ kind: 'vb-event', channel: 'media-channel', type: 'snapshot', payload: snapshot }, '*');
      window.mediaFlush = () => { window.mediaFlushed = false; iframe.contentWindow.postMessage({ kind: 'vb-event', channel: 'media-channel', type: 'flush', payload: {} }, '*'); };
      addEventListener('message', async event => {
        if (event.source !== iframe.contentWindow) return; const m = event.data;
        if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'media-channel', payload: await window.mediaFixturePayload() }, '*'); return; }
        if (m.channel !== 'media-channel') return;
        if (m.kind === 'vb-ready') { window.mediaReady = true; return; }
        if (m.kind === 'vb-flushed') { window.mediaFlushed = true; return; }
        if (m.kind !== 'vb-request') return;
        try { const result = await window.mediaFixtureRPC(m.method, m.payload); iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'media-channel', id: m.id, result }, '*'); }
        catch (e) { iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'media-channel', id: m.id, error: String(e.message || e) }, '*'); }
      });
      iframe.srcdoc = html;
    }, html);
    await page.waitForFunction(() => window.mediaReady);
    const frame = page.frames().find(frame => frame.parentFrame()); assert.ok(frame);
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return { page, frame };
  }
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
  await writeFile(new URL('media-test-two-pages.pdf', evidence), pdf); await writeFile(new URL('media-test-30s.wav', evidence), wav);
  const checks = {};
  let initialized = await initialize(); page = initialized.page; let frame = initialized.frame;

  assert.equal(await frame.getByTestId('folder-child').count(), 1);
  assert.equal(await frame.getByTestId('add-image').count(), 1);
  await frame.getByTestId('add-image').click(); assert.equal(await frame.getByTestId('image-file').count(), 1);
  await frame.getByRole('button', { name: '关闭对话框', exact: true }).click();
  checks.originalImageImportEntryStillAvailable = true;
  await frame.getByTestId('add-media').click();
  await frame.getByTestId('media-files').setInputFiles([{ name: 'valid-two-pages.pdf', mimeType: 'application/pdf', buffer: pdf }, { name: 'thirty-seconds.wav', mimeType: 'audio/wav', buffer: wav }]);
  await frame.getByTestId('import-media').click();
  await frame.getByTestId('media-files').waitFor({ state: 'detached' });
  const imported = await frame.evaluate(() => ({ pdf: { ...board().nodes.find(n => n.type === 'pdf') }, audio: { ...board().nodes.find(n => n.type === 'audio') } }));
  assert.ok(imported.pdf.id && imported.audio.id); assert.equal(created.length, 2); assert.equal(imports.length, 2);
  assert.deepEqual(Buffer.from(bytes.get(imported.pdf.filePath)), pdf); assert.deepEqual(Buffer.from(bytes.get(imported.audio.filePath)), wav);
  await frame.evaluate(({ pdfId, audioId }) => { Object.assign(board().nodes.find(n => n.id === pdfId), { x: 80, y: 40 }); Object.assign(board().nodes.find(n => n.id === audioId), { x: 570, y: 40 }); board().view = { x: 0, y: 0, zoom: 1 }; render(); }, { pdfId: imported.pdf.id, audioId: imported.audio.id });
  await page.waitForFunction(async ({pdf,audio}) => { const paths=await window.mediaFixtureRevealed();return paths.includes(pdf)&&paths.includes(audio); }, {pdf:imported.pdf.filePath,audio:imported.audio.filePath});assert.deepEqual(invalidReveals,[]);checks.importRevealsExistingNativeVaultFiles={pdf:imported.pdf.filePath,audio:imported.audio.filePath,revealed:revealed.slice(),fixtureOnly:true};
  checks.realMediaServiceImportsExactPDFAndWAVBytes = { pdf: { path: imported.pdf.filePath, bytes: pdf.length }, wav: { path: imported.audio.filePath, bytes: wav.length, expectedDuration: 30 } };

  try { await frame.getByTestId('pdf-page-' + imported.pdf.id).waitFor({ state: 'visible', timeout: 15000 }); await frame.waitForFunction(id => document.querySelector('[data-testid="pdf-page-' + id + '"]')?.textContent === '1 / 2', imported.pdf.id, { timeout: 15000 }); }
  catch (error) { console.error('Actual opaque-frame PDF.js preview did not load:', await frame.getByTestId('pdf-page-' + imported.pdf.id).textContent()); throw error; }
  const canvas = frame.getByTestId('pdf-canvas-' + imported.pdf.id);
  async function pixels() {
    return canvas.evaluate(canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261, nonWhite = 0, blue = 0, red = 0;
      for (let i = 0; i < data.length; i += 4) {
        hash = Math.imul(hash ^ data[i], 16777619); hash = Math.imul(hash ^ data[i + 1], 16777619); hash = Math.imul(hash ^ data[i + 2], 16777619);
        if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) nonWhite++;
        if (data[i + 2] > data[i] + 50) blue++; if (data[i] > data[i + 2] + 50) red++;
      }
      return { width: canvas.width, height: canvas.height, hash: hash >>> 0, nonWhite, blue, red };
    });
  }
  const pageOne = await pixels(); assert.ok(pageOne.width > 100 && pageOne.height > 100); assert.ok(pageOne.blue > 1000);
  assert.equal(await frame.getByTestId('pdf-prev-' + imported.pdf.id).isDisabled(), true);
  await page.screenshot({ path: new URL('media-pdf-page-one.png', evidence).pathname });
  await frame.getByTestId('pdf-next-' + imported.pdf.id).click();
  await frame.waitForFunction(id => document.querySelector('[data-testid="pdf-page-' + id + '"]')?.textContent === '2 / 2', imported.pdf.id);
  const pageTwo = await pixels(); assert.ok(pageTwo.red > 1000); assert.notEqual(pageTwo.hash, pageOne.hash);
  assert.equal(await frame.getByTestId('pdf-next-' + imported.pdf.id).isDisabled(), true);
  await page.screenshot({ path: new URL('media-pdf-page-two.png', evidence).pathname });
  await frame.getByTestId('pdf-prev-' + imported.pdf.id).click();
  await frame.waitForFunction(id => document.querySelector('[data-testid="pdf-page-' + id + '"]')?.textContent === '1 / 2', imported.pdf.id);
  const returnedPageOne = await pixels();
  assert.equal(returnedPageOne.width, pageOne.width); assert.equal(returnedPageOne.height, pageOne.height);
  assert.ok(returnedPageOne.blue > 1000 && returnedPageOne.red < 100, 'previous must render the blue first page, not keep the red second page');
  checks.realPDFJSRendersTwoPagesAndNativeCanvasChangesOnNextPrevious = { pageOne, pageTwo, returnedPageOne };

  const audio = () => frame.getByTestId('audio-' + imported.audio.id);
  async function nativePlayPause(id=imported.audio.id){await frame.getByTestId('audio-play-'+id).click();}
  await frame.waitForFunction(id => { const audio = document.querySelector('[data-testid="audio-' + id + '"]'); return audio?.readyState >= 1 && Number.isFinite(audio.duration); }, imported.audio.id);
  const metadata = await audio().evaluate(el => ({ duration: el.duration, readyState: el.readyState, paused: el.paused, error: el.error?.message || null }));
  assert.equal(metadata.duration, 30); assert.equal(metadata.paused, true); assert.equal(metadata.error, null);
  const audioSource=await audio().getAttribute('src');assert.match(audioSource,/^blob:/);assert.equal(imported.audio.h,180);assert.equal(imported.audio.w,500);
  const audioCardUI=frame.getByTestId('media-'+imported.audio.id);assert.equal(await audioCardUI.locator('.vb-music-format').textContent(),'WAV');assert.equal(await audioCardUI.locator('.vb-music-title').textContent(),'thirty-seconds');assert.equal(await audioCardUI.locator('.vb-media-source,[data-open-media],.node-actions,.vb-audio-progress,.vb-audio-last,.vb-media-buttons').count(),0);
  async function musicAlignment(){
    const positions=await frame.getByTestId('media-'+imported.audio.id).evaluate(card=>{
      const body=card.querySelector('.vb-audio-player'),details=card.querySelector('.vb-music-details'),record=card.querySelector('.vb-record-art');
      const bounds=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,cx:r.left+r.width/2,cy:r.top+r.height/2};};
      const controls=[...card.querySelectorAll('.vb-music-controls>button')].map(button=>{const c=getComputedStyle(button);return {...bounds(button),border:c.borderTopWidth,shadow:c.boxShadow};});
      return {body:bounds(body),details:bounds(details),record:bounds(record),controls};
    });
    assert.ok(Math.abs(positions.details.cy-positions.body.cy)<.75,'music details must vertically center in the resized card');
    assert.ok(Math.abs(positions.details.cx-(positions.record.right+positions.body.right)/2)<.75,'music details must center in the visible area beside the record');
    assert.equal(positions.controls.length,3);const [previous,play,next]=positions.controls;
    assert.ok(Math.abs(previous.cy-play.cy)<.75&&Math.abs(play.cy-next.cy)<.75);
    assert.ok(Math.abs((play.cx-previous.cx)-(next.cx-play.cx))<.75);
    for(const control of positions.controls){assert.ok(Math.abs(control.width-34)<.75&&Math.abs(control.height-34)<.75);assert.equal(control.border,'0px');assert.equal(control.shadow,'none');}
    return positions;
  }
  const defaultAlignment=await musicAlignment();
  checks.referenceMusicCardAndOpaqueOriginBlobSource={audioSource,format:'WAV',width:imported.audio.w,height:imported.audio.h,directNativeResourceNeverPlayed:true};
  await nativePlayPause();
  await frame.waitForFunction(id => { const a = document.querySelector('[data-testid="audio-' + id + '"]'); return !a.paused && a.currentTime > .15; }, imported.audio.id);
  const beforeRender = await audio().evaluate(el => { window.actualPlayingAudio = el;window.actualRecord=el.closest('.vb-audio-player').querySelector('.vb-record-art'); return { position: el.currentTime, paused: el.paused }; });
  await frame.evaluate(() => render());
  const afterRender = await audio().evaluate(el => ({ sameElement: el === window.actualPlayingAudio, position: el.currentTime, paused: el.paused }));
  assert.equal(afterRender.sameElement, true); assert.equal(afterRender.paused, false); assert.ok(afterRender.position >= beforeRender.position);
  await frame.evaluate(() => VBMedia.flushPlayback());
  const snapshot = { ...(await page.evaluate(() => window.mediaFixturePayload())), preserveView: true };
  await page.evaluate(snapshot => window.mediaSnapshot(snapshot), snapshot);
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const afterSnapshot = await audio().evaluate(el => ({ sameElement: el === window.actualPlayingAudio, position: el.currentTime, paused: el.paused }));
  assert.equal(afterSnapshot.sameElement, true); assert.equal(afterSnapshot.paused, false); assert.ok(afterSnapshot.position >= afterRender.position);
  const spinning=await frame.getByTestId('media-'+imported.audio.id).locator('.vb-record-art').evaluate(el=>({state:getComputedStyle(el).animationPlayState,time:el.getAnimations()[0]?.currentTime,identity:el===window.actualRecord}));assert.equal(spinning.state,'running');assert.ok(spinning.time>0);
  checks.nativeAudioReallyPlaysAndDOMSurvivesRenderAndSnapshot = { metadata, beforeRender, afterRender, afterSnapshot };
  const seekPosition = await audio().evaluate(el => { el.currentTime = 7.5; return el.currentTime; });
  assert.equal(seekPosition, 7.5);
  await nativePlayPause();
  await frame.waitForFunction(id => document.querySelector('[data-testid="audio-' + id + '"]').paused, imported.audio.id);
  await frame.evaluate(() => VBMedia.flushPlayback());
  const paused = await audio().evaluate(el => ({ position: el.currentTime, duration: el.duration, paused: el.paused }));
  assert.ok(paused.position >= 7.5 && paused.position < 8.5, 'real playback continues while the physical pause click becomes actionable'); assert.equal(paused.paused, true);
  const progress = payload.layout.audioPlayback[imported.audio.filePath];
  assert.ok(Math.abs(progress.position - paused.position) < .05); assert.equal(progress.duration, 30); assert.ok(progress.lastPlayedAt > 0);
  checks.realSeekPausePersistsPositionDurationAndLastPlayed = { seekPosition, paused, progress: { ...progress } };
  const record=frame.getByTestId('media-'+imported.audio.id).locator('.vb-record-art');const pausePhase=await record.evaluate(el=>({state:getComputedStyle(el).animationPlayState,time:el.getAnimations()[0].currentTime,same:el===window.actualRecord}));assert.equal(pausePhase.state,'paused');assert.equal(pausePhase.same,true);await frame.evaluate(()=>new Promise(resolve=>setTimeout(resolve,200)));const laterPhase=await record.evaluate(el=>el.getAnimations()[0].currentTime);assert.ok(Math.abs(laterPhase-pausePhase.time)<20);
  await frame.getByTestId('audio-mute-'+imported.audio.id).click();assert.equal(await audio().evaluate(el=>el.muted),true);await frame.getByTestId('audio-mute-'+imported.audio.id).click();assert.equal(await audio().evaluate(el=>el.muted),false);
  await frame.getByTestId('audio-back-'+imported.audio.id).click();await frame.waitForFunction(id=>document.querySelector('[data-testid="audio-'+id+'"]').currentTime<.1,imported.audio.id);await frame.getByTestId('audio-forward-'+imported.audio.id).click();assert.ok(Math.abs(await audio().evaluate(el=>el.currentTime)-10)<.1);
  const seek=frame.getByTestId('audio-seek-'+imported.audio.id);await seek.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');assert.ok((await audio().evaluate(el=>el.currentTime))<.3);
  await audio().evaluate((el,position)=>{el.currentTime=position;},paused.position);await frame.waitForFunction(id=>!document.querySelector('[data-testid="audio-'+id+'"]').seeking,imported.audio.id);await frame.evaluate(()=>VBMedia.flushPlayback());
  await nativePlayPause();await frame.waitForFunction(id=>!document.querySelector('[data-testid="audio-'+id+'"]').paused,imported.audio.id);const resumePhase=await record.evaluate(el=>el.getAnimations()[0].currentTime);assert.ok(resumePhase>=pausePhase.time);await nativePlayPause();await frame.waitForFunction(id=>document.querySelector('[data-testid="audio-'+id+'"]').paused,imported.audio.id);
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await record.evaluate(el=>getComputedStyle(el).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
  await audio().evaluate((el,position)=>{el.currentTime=position;},paused.position);await frame.waitForFunction(id=>!document.querySelector('[data-testid="audio-'+id+'"]').seeking,imported.audio.id);await frame.evaluate(()=>VBMedia.flushPlayback());checks.recordRotationPauseResumeAndAccessibleControls={spinning,pausePhase,laterPhase,resumePhase,reducedMotion:true,mute:true,skipSeconds:10,keyboardSeek:true};

  await page.screenshot({ path: new URL('media-audio-paused-progress.png', evidence).pathname });

  // Board navigation and close/reopen must resume the recorded position, never autoplay.
  await frame.evaluate(() => navigate('child'));
  assert.equal(await frame.evaluate(() => state.currentBoard), 'child');
  await frame.getByTestId('crumb-home').click();
  await frame.waitForFunction(id => document.querySelector('[data-testid="audio-' + id + '"]')?.readyState >= 1, imported.audio.id);
  const returned = await audio().evaluate(el => ({ position: el.currentTime, paused: el.paused }));
  assert.ok(Math.abs(returned.position - paused.position) < .1); assert.equal(returned.paused, true);
  await page.evaluate(() => window.mediaFlush()); await page.waitForFunction(() => window.mediaFlushed);
  await page.close(); initialized = await initialize(); page = initialized.page; frame = initialized.frame;
  await frame.waitForFunction(id => document.querySelector('[data-testid="audio-' + id + '"]')?.readyState >= 1 && document.querySelector('[data-testid="audio-' + id + '"]').currentTime > 7, imported.audio.id);
  const reopened = await audio().evaluate(el => ({ position: el.currentTime, duration: el.duration, paused: el.paused }));
  assert.ok(Math.abs(reopened.position - paused.position) < .1); assert.equal(reopened.duration, 30); assert.equal(reopened.paused, true);
  checks.childParentAndCloseReopenRestorePausedPosition = { returned, reopened };

  const copiesBeforeLibrary = created.length,readsBeforeLibrary=calls.filter(c=>c.method==='read-audio').length;
  await frame.getByTestId('add-media').click();
  await frame.locator('[data-add-media="' + imported.audio.filePath + '"]').click();
  await frame.waitForFunction(path => board().nodes.filter(n => n.type === 'audio' && n.filePath === path).length === 2, imported.audio.filePath);
  const duplicateId = await frame.evaluate(({ path, originalId }) => board().nodes.find(n => n.type === 'audio' && n.filePath === path && n.id !== originalId).id, { path: imported.audio.filePath, originalId: imported.audio.id });
  await frame.waitForFunction(id => document.querySelector('[data-testid="audio-' + id + '"]')?.readyState >= 1 && document.querySelector('[data-testid="audio-' + id + '"]').currentTime > 7, duplicateId);
  assert.equal(created.length, copiesBeforeLibrary); assert.equal(imports.length, 2);assert.equal(calls.filter(c=>c.method==='read-audio').length,readsBeforeLibrary);assert.equal(await frame.getByTestId('audio-'+duplicateId).getAttribute('src'),await audio().getAttribute('src'));
  assert.ok(Math.abs(await frame.getByTestId('audio-' + duplicateId).evaluate(el => el.currentTime) - reopened.position) < .1);
  assert.equal(await frame.getByTestId('audio-' + duplicateId).evaluate(el => el.paused), true);
  assert.equal(Object.keys(await frame.evaluate(() => state.audioPlayback)).length, 1);
  checks.libraryReusesLocalAssetAndTwoCardsShareOnePlaybackRecord = { duplicateId, copiedAttachments: created.length, playbackKeys: Object.keys(payload.layout.audioPlayback) };
  const inactiveDuplicatePosition = await frame.getByTestId('audio-' + duplicateId).evaluate(el => ({ currentTime: el.currentTime, paused: el.paused }));
  await nativePlayPause();
  await frame.waitForFunction(id => !document.querySelector('[data-testid="audio-' + id + '"]').paused, imported.audio.id);
  await audio().evaluate(el => { el.currentTime = 12; });
  await nativePlayPause();
  await frame.waitForFunction(id => document.querySelector('[data-testid="audio-' + id + '"]').paused, imported.audio.id);
  await frame.evaluate(() => VBMedia.flushPlayback());
  const sharedProgress = payload.layout.audioPlayback[imported.audio.filePath];
  assert.ok(sharedProgress.position >= 12 && sharedProgress.position < 13, 'flushing must preserve real 12 second playback, never an inactive earlier duplicate');
  assert.ok(sharedProgress.lastPlayedAt >= progress.lastPlayedAt); assert.equal(sharedProgress.duration, 30);
  assert.equal(await frame.getByTestId('media-'+duplicateId).locator('.vb-audio-progress,.vb-audio-last,.vb-media-buttons,[data-media-restart],[data-open-media],.vb-media-source').count(),0);
  await frame.getByTestId('audio-'+duplicateId).evaluate(el=>{el.dispatchEvent(new Event('pause'));el.dispatchEvent(new Event('timeupdate'));});await frame.evaluate(()=>VBMedia.flushPlayback());assert.ok(payload.layout.audioPlayback[imported.audio.filePath].position>=12);
  checks.pausedDuplicateCannotOverwriteLatestSharedPlaybackPosition = { inactiveDuplicatePosition, sharedProgress: { ...sharedProgress } };

  await frame.evaluate(id => select(id), imported.audio.id);
  await frame.locator('#selection-bar [data-copy-path="' + imported.audio.filePath + '"]').click();
  await page.waitForFunction(async path => {const value=await window.mediaFixtureClipboard();return typeof value==='string'&&value.startsWith('obsidian://open?')&&new URL(value).searchParams.get('file')===path;},imported.audio.filePath);
  assert.ok(clipboard.startsWith('obsidian://open?')); assert.equal(new URL(clipboard).searchParams.get('file'), imported.audio.filePath);
  await frame.getByTestId('media-' + imported.pdf.id).locator('[data-open-media]').click();
  await page.waitForFunction(async path=>(await window.mediaFixtureOpened()).includes(path),imported.pdf.filePath);
  assert.ok(opened.includes(imported.pdf.filePath));
  checks.copyAndNativeOpenReferToOriginalVaultMediaFiles = { clipboard, opened };
  await frame.evaluate(({ pdfId, audioId, duplicateId }) => { board().view = { x: 0, y: 0, zoom: 1 }; Object.assign(board().nodes.find(n => n.id === pdfId), { x: 80, y: 40 }); Object.assign(board().nodes.find(n => n.id === audioId), { x: 570, y: 40 }); Object.assign(board().nodes.find(n => n.id === duplicateId), { x: 570, y: 400 }); render(); }, { pdfId: imported.pdf.id, audioId: imported.audio.id, duplicateId });
  const beforeGeometry = await frame.evaluate(id => ({ ...board().nodes.find(n => n.id === id) }), imported.audio.id);
  const audioCard = frame.getByTestId('media-' + imported.audio.id), cardBox = await audioCard.boundingBox();
  await page.mouse.move(cardBox.x + 40, cardBox.y + 16); await page.mouse.down(); await page.mouse.move(cardBox.x + 80, cardBox.y + 36, { steps: 8 }); await page.mouse.up();
  const dragged = await frame.evaluate(id => ({ ...board().nodes.find(n => n.id === id) }), imported.audio.id);
  assert.notEqual(dragged.x, beforeGeometry.x); assert.equal(dragged.x % 20, 0); assert.equal(dragged.y % 20, 0);
  await frame.evaluate(id => select(id), imported.audio.id);
  const resize = await frame.getByTestId('resize-' + imported.audio.id + '-e').boundingBox(); assert.ok(resize);
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2); await page.mouse.down(); await page.mouse.move(resize.x + resize.width / 2 + 60, resize.y + resize.height / 2, { steps: 8 }); await page.mouse.up();
  const resized = await frame.evaluate(id => ({ ...board().nodes.find(n => n.id === id) }), imported.audio.id);
  assert.equal(resized.w, dragged.w + 60); assert.equal(resized.x, dragged.x);
  const resizedAlignment=await musicAlignment();checks.musicDetailsAndThreeControlsAlignAtDefaultAndResizedWidth={defaultAlignment,resizedAlignment};
  await frame.evaluate(() => VBMedia.flushPlayback());
  assert.equal(payload.layout.boards.home.nodes.find(n => n.id === imported.audio.id).w, resized.w);
  const savedJSON = JSON.stringify(payload.layout);
  assert.equal(payload.layout.docs, undefined); assert.equal(savedJSON.includes('data:audio'), false); assert.equal(savedJSON.includes('base64'), false); assert.equal(savedJSON.includes('%PDF-'), false);
  assert.ok(Object.values(payload.layout.boards).flatMap(b => b.nodes.filter(n => n.type === 'pdf' || n.type === 'audio')).every(n => n.filePath && !n.url && !n.base64 && !n.body));
  checks.mediaGeometryPersistsOnlyLocalFileRefsAndPlaybackMetadata = { beforeGeometry, dragged, resized, savedBytes: savedJSON.length };
  assert.equal(calls.some(call => ['update-note', 'rename-note', 'move-article'].includes(call.method)), false);
  await page.screenshot({ path: new URL('media-library-reuse-and-resize.png', evidence).pathname });
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);assert.deepEqual(invalidReveals,[]);assert.equal(calls.filter(c=>c.method==='read-audio').length>=3,true);
  await writeFile(new URL('media-card-browser.json', evidence), JSON.stringify({ passed: true, checks, pageErrors: errors, consoleErrors, externalRequests, nativeVaultMocked: true, decodersMocked: false, audioMuted: true, userVaultAccessed: false, chromeArgs: ['--disable-site-isolation-trials', '--mute-audio'] }, null, 2));
  console.log('Media card actual PDF/audio frame checks passed.');
} catch (error) {
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
  if (page) await page.screenshot({ path: new URL('media-card-failure.png', evidence).pathname }).catch(() => {});
  await writeFile(new URL('media-card-failure.json', evidence), JSON.stringify({ error: String(error), calls, pageErrors: errors, consoleErrors }, null, 2));
  throw error;
} finally { await browser.close(); server.close(); }
