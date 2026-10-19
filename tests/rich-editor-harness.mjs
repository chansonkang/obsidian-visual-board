import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
export const fixturePath = 'Notes/Rich.md';
export const fixturePNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';

// Isolated parent broker for the actual built iframe; never opens a user's Vault.
export async function richHarness(body, options = {}) {
  const html = await readFile(new URL('../src/frame.html', import.meta.url), 'utf8');
  const doc = { id: fixturePath, path: fixturePath, title: 'Rich', body, outgoing: ['Notes/Other.md'], backlinks: [], mtime: 1 };
  const payload = { layout: { version: 2, articleSizingVersion: 1, currentBoard: 'home', showKnowledge: true, showSpace: true, boards: {
    home: { id: 'home', title: 'Markdown 就地编辑', parent: null, theme: 'research', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes: [
      { id: 'article', type: 'article', doc: fixturePath, x: 80, y: 0, w: 620, h: 780 },
      { id: 'peer', type: 'article', doc: fixturePath, x: 800, y: 0, w: 620, h: 780 },
    ], edges: [] },
    child: { id: 'child', title: '空层级', parent: 'home', theme: 'research', iconMode: 'default', view: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] },
  } }, docs: { [fixturePath]: doc, 'Notes/Other.md': { id: 'Notes/Other.md', path: 'Notes/Other.md', title: 'Other', body: '# Other\n\nTarget', outgoing: [], backlinks: [fixturePath], mtime: 1 } },
  assets: { 'Assets/one.png': fixturePNG }, embeds: { [fixturePath]: [{ path: 'Assets/one.png', link: 'Assets/one.png' }] }, drafts: options.drafts || [], settings: { defaultIconMode: 'default', attachmentFolder: 'Assets', ...options.settings }, vaultName: 'Rich editor isolated fixture' };
  if (options.missing) payload.docs[fixturePath].missing = true;
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html style="height:100%"><body style="margin:0;height:100%;overflow:hidden"><iframe id="frame" sandbox="allow-scripts allow-modals allow-downloads" style="width:100%;height:100%;border:0;display:block"></iframe></body></html>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-site-isolation-trials'] });
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:')) requests.push(request.url()); });
  await page.route('https://**', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(({ html, payload }) => {
    const iframe = document.getElementById('frame');
    window.richHost = { payload, calls: [], ready: false, recovery: {}, fail: false, delay: 0, imported: 0 };
    window.richSnapshot = () => iframe.contentWindow.postMessage({ kind: 'vb-event', channel: 'rich-fixture', type: 'snapshot', payload: { ...payload, layout: undefined } }, '*');
    window.richReopen = () => { window.richHost.ready = false; iframe.srcdoc = html; };
    addEventListener('message', async event => {
      if (event.source !== iframe.contentWindow) return;
      const m = event.data, h = window.richHost;
      if (m.kind === 'vb-boot') { iframe.contentWindow.postMessage({ kind: 'vb-init', channel: 'rich-fixture', payload }, '*'); return; }
      if (m.channel !== 'rich-fixture') return;
      if (m.kind === 'vb-ready') { h.ready = true; return; }
      if (m.kind !== 'vb-request') return;
      if (h.componentRPC?.(m)) return;
      h.calls.push({ method: m.method, payload: m.payload });
      const p = m.payload; let result = { ok: true }, error;
      if (m.method === 'save-layout') payload.layout = p;
      if (m.method === 'save-settings') { if (h.failSettings) error = 'Fixture settings write unavailable'; else { payload.settings = { ...payload.settings, ...p }; result = { ...payload.settings }; } }
      if (m.method === 'save-draft') h.recovery[p.path] = { ...p };
      if (m.method === 'clear-draft' && h.recovery[p.path]?.body === p.body) delete h.recovery[p.path];
      if (m.method === 'update-note') {
        if (h.delay) await new Promise(resolve => setTimeout(resolve, h.delay));
        const d = payload.docs[p.path];
        if (h.fail) error = 'Fixture write unavailable';
        else if (!d || d.missing) result = { ok: false, reason: 'missing' };
        else if (d.body !== p.expectedBody) result = { ok: false, reason: 'conflict', current: d.body };
        else { d.body = p.body; d.mtime++; result = { ok: true, doc: { ...d } }; }
      }
      if (h.rpcErrors?.[m.method]) error = h.rpcErrors[m.method];
      if (m.method === 'import-image') { const path = `Assets/new-${++h.imported}.png`; payload.assets[path] = payload.assets['Assets/one.png']; result = { path, url: payload.assets[path] }; }
      if (m.method === 'rename-note') {
        const next = p.path.slice(0, p.path.lastIndexOf('/') + 1) + p.title + '.md', d = payload.docs[p.path];
        delete payload.docs[p.path]; payload.docs[next] = { ...d, path: next, id: next, title: p.title }; result = payload.docs[next];
      }
      iframe.contentWindow.postMessage({ kind: 'vb-response', channel: 'rich-fixture', id: m.id, result, error }, '*');
    });
    iframe.srcdoc = html;
  }, { html, payload });
  await page.waitForFunction(() => window.richHost.ready);
  const frame = page.frames().find(frame => frame.parentFrame());
  await frame.waitForSelector('[data-node="article"] .vb-inline-editor');
  return {
    browser, page, frame, errors, requests,
    editor: frame.locator('[data-node="article"] .vb-inline-editor'), peer: frame.locator('[data-node="peer"] .vb-inline-editor'),
    body: () => page.evaluate(path => window.richHost.payload.docs[path].body, fixturePath),
    flush: () => frame.evaluate(() => window.VBInline.flushAll()),
    close: async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); },
  };
}

export async function selectRendered(locator, needle, collapse = false) {
  await locator.evaluate((el, { needle, collapse }) => {
    el.focus({ preventScroll: true });
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
    while (node = walker.nextNode()) {
      const index = node.nodeValue.indexOf(needle); if (index < 0) continue;
      const range = document.createRange(); range.setStart(node, index); range.setEnd(node, collapse ? index : index + needle.length);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return;
    }
    throw Error('Rendered selection not found: ' + needle);
  }, { needle, collapse });
}
