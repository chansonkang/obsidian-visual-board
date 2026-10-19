import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

// Optional actual-frame check. All generation is mocked; never calls a paid provider or user Vault.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const { buildSync } = require('esbuild');
const compiled = buildSync({ entryPoints: [new URL('../src/model.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
const modelModule = { exports: {} }; new Function('require', 'module', 'exports', compiled)(require, modelModule, modelModule.exports);
const { stripEphemeral } = modelModule.exports;
const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
const image = 'data:image/png;base64,' + (await readFile(new URL('../vendor/prototype/assets/default-folder.png', import.meta.url))).toString('base64');
const iconPath = 'Assets/visual-board/APImart-theme.png';
const fixtureKey = 'fixture-apimart-session-key';
const payload = { layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: { home: { id: 'home', title: 'APImart 配置验收', parent: null, theme: 'product', view: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], iconMode: 'default' } } }, docs: {}, assets: {}, embeds: {}, drafts: [], settings: { baseUrl: 'https://example.com/v1', model: 'legacy-compatible-model', defaultIconMode: 'default', attachmentFolder: 'Assets' }, vaultName: 'APImart fixture' };
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="display:block;width:100%;height:100%;border:0"></iframe></body></html>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
const errors = [], externalRequests = [];
try {
  async function initialize(init) {
    const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('request', req => { if (/^https:\/\//.test(req.url())) externalRequests.push(req.url()); });
    await page.route('https://**', route => route.abort());
    // Apply the real layout save sanitizer rather than simulating its security behavior.
    await page.exposeFunction('saveAPIFrameLayout', layout => stripEphemeral(layout));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(({ html, init, image, iconPath }) => {
      const iframe = document.getElementById('frame');
      window.apiHost = { ready: false, payload: init, calls: [], layouts: [], failNextGenerate: false };
      addEventListener('message', async e => {
        if (e.source !== iframe.contentWindow) return;
        const m = e.data;
        if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'api-channel', payload: init }, '*'); return; }
        if (m.channel !== 'api-channel') return;
        if (m.kind === 'vb-ready') { window.apiHost.ready = true; return; }
        if (m.kind !== 'vb-request') return;
        window.apiHost.calls.push({ method: m.method, payload: m.payload });
        let result = { ok: true }, error;
        if (m.method === 'save-layout') { init.layout = await window.saveAPIFrameLayout(m.payload); window.apiHost.layouts.push(init.layout); }
        else if (m.method === 'save-settings') { Object.assign(init.settings, m.payload); result = { ...init.settings }; }
        else if (m.method === 'generate-icon') {
          if (window.apiHost.failNextGenerate) { window.apiHost.failNextGenerate = false; error = '模拟 APImart 服务不可用'; }
          else { result = { url: image, path: iconPath, name: m.payload.name, model: m.payload.service.model }; init.assets[iconPath] = image; }
        }
        iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'api-channel', id: m.id, result, error }, '*');
      });
      iframe.srcdoc = html;
    }, { html, init, image, iconPath });
    await page.waitForFunction(() => window.apiHost.ready);
    const frame = page.frames().find(f => f.parentFrame()); assert.ok(frame);
    return { page, frame };
  }
  const evidence = new URL('../evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
  const checks = [];
  let { page, frame } = await initialize(payload);
  await frame.getByTestId('add-board').click();
  await frame.locator('#new-board-title').fill('海洋研究');
  await frame.locator('[data-icon-mode="ai"]').click();
  await frame.getByTestId('configure-ai').click();
  assert.equal(await frame.getByTestId('ai-provider').inputValue(), 'compatible');
  await frame.getByTestId('ai-provider').selectOption('apimart');
  assert.equal(await frame.getByTestId('ai-base-url').inputValue(), 'https://api.apimart.ai/v1');
  assert.equal(await frame.getByTestId('ai-model').inputValue(), 'gpt-4o-image');
  assert.equal(await frame.getByTestId('ai-api-key').getAttribute('type'), 'password');
  await frame.getByTestId('ai-api-key').fill(fixtureKey);
  await page.screenshot({ path: new URL('apimart-provider-config.png', evidence).pathname });
  await frame.getByTestId('save-ai-config').click();
  await page.waitForFunction(() => window.apiHost.calls.some(c => c.method === 'save-settings'));
  const settingsCall = await page.evaluate(() => window.apiHost.calls.find(c => c.method === 'save-settings').payload);
  assert.deepEqual(settingsCall, { baseUrl: 'https://api.apimart.ai/v1', model: 'gpt-4o-image' });
  assert.equal(JSON.stringify(settingsCall).includes(fixtureKey), false);
  checks.push('APImart preset fills endpoint/model; password field and settings persist no session key');
  await frame.getByTestId('generate-icon').click();
  await frame.waitForFunction(() => previewIcon.status === 'generated');
  const generate = await page.evaluate(() => window.apiHost.calls.find(c => c.method === 'generate-icon').payload);
  assert.equal(generate.name, '海洋研究'); assert.equal(generate.force, true);
  assert.deepEqual(generate.service, { baseUrl: 'https://api.apimart.ai/v1', model: 'gpt-4o-image', apiKey: fixtureKey });
  assert.ok(typeof generate.theme === 'string');
  await frame.getByTestId('create-board').click();
  await frame.waitForFunction(path => Object.values(state.boards).some(b => b.title === '海洋研究' && b.iconPath === path), iconPath);
  const aiBoardId = await frame.evaluate(() => Object.values(state.boards).find(b => b.title === '海洋研究').id);
  await page.waitForFunction(({ id, path }) => window.apiHost.layouts.some(layout => layout.boards[id]?.iconPath === path), { id: aiBoardId, path: iconPath });
  assert.equal(await page.evaluate(() => window.apiHost.calls.filter(c => c.method === 'generate-icon').length), 1, 'cached preview must not trigger a second paid generation');
  const persisted = await page.evaluate(() => ({ settings: window.apiHost.payload.settings, layouts: window.apiHost.layouts }));
  assert.equal(JSON.stringify(persisted).includes(fixtureKey), false);
  assert.equal(persisted.layouts.some(layout => layout.docs || Object.values(layout.boards).some(b => b.iconUrl)), false);
  checks.push('generate RPC contains current session credentials; cached AI preview saves by local iconPath without duplicating generation');
  // Provider failure uses the real default-mode continuation UI.
  await frame.getByTestId('add-board').click(); await frame.locator('#new-board-title').fill('故障回退');
  await frame.locator('[data-icon-mode="ai"]').click();
  await page.evaluate(() => { window.apiHost.failNextGenerate = true; });
  await frame.getByTestId('generate-icon').click();
  await frame.waitForFunction(() => previewIcon.status === 'failed');
  assert.match(await frame.locator('#icon-description').textContent(), /APImart 服务不可用/);
  await frame.getByTestId('use-default').click();
  await frame.waitForFunction(() => Object.values(state.boards).some(b => b.title === '故障回退' && b.iconMode === 'default'));
  const failedFallbackId = await frame.evaluate(() => Object.values(state.boards).find(b => b.title === '故障回退').id);
  assert.equal(await frame.evaluate(id => state.boards[id].iconPath, failedFallbackId), undefined);
  assert.equal(await frame.getByTestId('folder-' + failedFallbackId).locator('.folder-sticker svg').count(), 1);
  assert.equal(await page.evaluate(() => window.apiHost.calls.filter(c => c.method === 'generate-icon').length), 2);
  checks.push('APImart failure preserves actionable error and default icon continuation needs no further generation');
  await frame.evaluate(() => save());
  const reloadPayload = await page.evaluate(() => structuredClone(window.apiHost.payload));
  assert.equal(JSON.stringify({ layout: reloadPayload.layout, settings: reloadPayload.settings }).includes(fixtureKey), false);
  await page.close();
  ({ page, frame } = await initialize(reloadPayload));
  assert.equal(await frame.evaluate(() => sessionApiKey), '');
  const reloadedIcon = await frame.getByTestId('folder-' + aiBoardId).locator('.custom-folder > img').evaluate(img => ({ src: img.src, complete: img.complete, naturalWidth: img.naturalWidth }));
  assert.equal(reloadedIcon.src, image); assert.equal(reloadedIcon.complete, true); assert.ok(reloadedIcon.naturalWidth > 0);
  assert.equal(await frame.evaluate(id => state.boards[id].iconPath, aiBoardId), iconPath);
  assert.equal(await page.evaluate(() => window.apiHost.calls.some(c => c.method === 'generate-icon')), false);
  await frame.getByTestId('add-board').click(); await frame.locator('#new-board-title').fill('离线默认资料');
  await frame.locator('[data-icon-mode="ai"]').click(); await frame.getByTestId('configure-ai').click();
  assert.equal(await frame.getByTestId('ai-provider').inputValue(), 'apimart');
  assert.equal(await frame.getByTestId('ai-api-key').inputValue(), '');
  await frame.getByTestId('save-ai-config').click();
  await frame.getByTestId('create-board').click();
  await frame.getByTestId('use-default').click();
  await frame.waitForFunction(() => Object.values(state.boards).some(b => b.title === '离线默认资料' && b.iconMode === 'default'));
  assert.equal(await page.evaluate(() => window.apiHost.calls.some(c => c.method === 'generate-icon')), false);
  checks.push('reload restores cached local AI icon offline, forgets key, retains provider preset, and permits default creation without credentials');
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  await page.screenshot({ path: new URL('apimart-local-icon-reload.png', evidence).pathname });
  await writeFile(new URL('apimart-config-browser.json', evidence), JSON.stringify({ passed: true, checks, provider: 'APImart', endpoint: generate.service.baseUrl, model: generate.service.model, generation: { name: generate.name, theme: generate.theme, force: generate.force, sessionKeySent: generate.service.apiKey === fixtureKey, callsBeforeReload: 2 }, persistedIconPath: iconPath, cachedPreviewNotRegenerated: true, keyAbsentFromSettingsAndLayouts: true, keyForgottenOnReload: true, restoredLocalIconWidth: reloadedIcon.naturalWidth, defaultFallbackWorks: true, externalRequests, pageErrors: errors, generationMocked: true, userVaultAccessed: false, chromeArgs: ['--disable-site-isolation-trials'] }, null, 2));
  console.log('APImart UI checks passed: preset, session-only credentials, generation RPC, cached local icon persistence/reload, error and no-key default fallback; no paid/network generation.');
} finally { await browser.close(); server.close(); }
