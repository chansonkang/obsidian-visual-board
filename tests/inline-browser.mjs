import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:8877/prototype.html?v=3');
  await page.evaluate(() => {
    const ids = {}, docs = {};
    Object.values(state.docs).forEach(doc => { ids[doc.id] = doc.path; docs[doc.path] = { ...doc, id: doc.path }; });
    Object.values(state.boards).forEach(b => b.nodes.forEach(n => { if (n.doc) n.doc = ids[n.doc]; }));
    state.docs = docs; state.currentBoard = 'research';
    state.boards.research.nodes.push({ ...state.boards.research.nodes.find(n => n.id === 'hypothesis-card'), id: 'same-note-copy', x: 1300, y: 700 });
    render();
    window.testHostBodies = Object.fromEntries(Object.values(docs).map(d => [d.path, d.body]));
    window.testHostCalls = [];
    window.testRecovery = {};
    window.testDelay = 0;
    window.VBHost = { rpc: async (method, payload) => {
      if (method === 'save-draft') { window.testRecovery[payload.path] = { ...payload }; return true; }
      if (method === 'clear-draft') { if (window.testRecovery[payload.path]?.body === payload.body) delete window.testRecovery[payload.path]; return true; }
      if (method !== 'update-note') throw new Error('Unexpected RPC method');
      window.testHostCalls.push({ ...payload });
      if (window.testFail) throw new Error('Temporary host write failure');
      await new Promise(resolve => setTimeout(resolve, window.testDelay));
      const current = window.testHostBodies[payload.path];
      if (current !== payload.expectedBody) return { ok: false, reason: 'conflict', current };
      window.testHostBodies[payload.path] = payload.body;
      return { ok: true, doc: { ...state.docs[payload.path], body: payload.body } };
    } };
  });
  await page.addStyleTag({ path: fileURLToPath(new URL('../src/frontend-inline.css', import.meta.url)) });
  await page.addScriptTag({ path: fileURLToPath(new URL('../src/frontend-scroll.js', import.meta.url)) });
  await page.addScriptTag({ path: fileURLToPath(new URL('../src/frontend-inline.js', import.meta.url)) });
  const editor = page.locator('[data-inline-node="hypothesis-card"]');
  await editor.click();
  assert.equal(await page.locator('#preview').innerText(), '');
  await editor.fill('# 研究假设\n\n直接写在卡片里。');
  await page.waitForFunction(() => window.testHostBodies['示例库/研究假设.md'] === '# 研究假设\n\n直接写在卡片里。');
  assert.equal(await page.evaluate(() => window.testHostBodies['示例库/研究假设.md']), '# 研究假设\n\n直接写在卡片里。');
  assert.match(await page.locator('[data-inline-node="same-note-copy"]').innerText(), /直接写在卡片里/);
  await editor.press('End');
  await editor.press('Backspace');
  assert.equal(await page.locator('[data-node="hypothesis-card"]').count(), 1);
  await page.evaluate(() => render());
  assert.equal(await editor.evaluate(el => document.activeElement === el), true);
  await page.keyboard.type('再写');
  assert.match(await editor.innerText(), /再写/);
  await page.evaluate(() => window.VBInline.flushAll());
  // Two edits made while the first save is pending must become two ordered writes.
  await page.evaluate(() => { window.testDelay = 120; window.testHostCalls = []; });
  await editor.fill('# 研究假设\n\n第一稿');
  const saving = page.evaluate(() => window.VBInline.flushAll());
  await page.waitForTimeout(30);
  await editor.fill('# 研究假设\n\n第二稿');
  await saving;
  assert.equal(await page.evaluate(() => window.testHostBodies['示例库/研究假设.md']), '# 研究假设\n\n第二稿');
  assert.equal(await page.evaluate(() => window.testHostCalls.length), 2);
  // An external native-editor save must be protected and the local draft kept.
  await page.evaluate(() => { window.testDelay = 0; window.testHostBodies['示例库/研究假设.md'] = '# 研究假设\n\n外部更新'; });
  await editor.fill('# 研究假设\n\n我的草稿');
  assert.equal(await page.evaluate(() => window.VBInline.flushAll()), false);
  assert.equal(await page.evaluate(() => window.testHostBodies['示例库/研究假设.md']), '# 研究假设\n\n外部更新');
  assert.match(await editor.innerText(), /我的草稿/);
  assert.match(await page.locator('[data-node="hypothesis-card"] .vb-inline-status').innerText(), /原文已在别处修改/);
  await page.locator('[data-node="hypothesis-card"] [data-inline-action="reload"]').click();
  assert.match(await editor.innerText(), /外部更新/);
  assert.equal(await page.evaluate(() => window.VBInline.hasDrafts()), false);
  await editor.click(); await editor.fill('# 研究假设\n\n失败后仍保留的草稿');
  await page.evaluate(() => { window.testFail = true; });
  assert.equal(await page.evaluate(() => window.VBInline.flushAll()), false);
  assert.match(await editor.innerText(), /失败后仍保留/);
  await page.evaluate(() => { window.testFail = false; });
  await page.locator('[data-node="hypothesis-card"] [data-inline-action="retry"]').click();
  await page.waitForFunction(() => window.testHostBodies['示例库/研究假设.md'].includes('失败后仍保留'));
  // Refresh does not replace a focused draft with a metadata snapshot.
  await editor.click(); await editor.fill('# 研究假设\n\n保留此草稿');
  await page.evaluate(() => {
    const incoming = { ...state.docs, '示例库/研究假设.md': { ...state.docs['示例库/研究假设.md'], body: '旧快照' } };
    state.docs = window.VBInline.acceptDocs(incoming); render();
  });
  assert.match(await editor.innerText(), /保留此草稿/);
  const recovered = await page.evaluate(() => window.VBInline.exportDrafts());
  assert.equal(recovered[0].body, '# 研究假设\n\n保留此草稿');
  assert.equal(await page.evaluate(() => window.testRecovery['示例库/研究假设.md'].body), '# 研究假设\n\n保留此草稿');
  // Reload the actual frame with persisted drafts; recovery never writes automatically.
  await page.reload();
  await page.evaluate(saved => {
    const ids = {}, docs = {};
    Object.values(state.docs).forEach(doc => { ids[doc.id] = doc.path; docs[doc.path] = { ...doc, id: doc.path }; });
    Object.values(state.boards).forEach(b => b.nodes.forEach(n => { if (n.doc) n.doc = ids[n.doc]; }));
    state.docs = docs; state.currentBoard = 'research'; render();
    const draft = { ...saved[0], expectedBody: docs[saved[0].path].body };
    window.__VB_INIT = { drafts: [draft] };
    window.recoveryNoteWrites = 0;
    window.VBHost = { rpc: async method => { if (method === 'update-note') window.recoveryNoteWrites++; return true; } };
  }, recovered);
  await page.addScriptTag({ path: fileURLToPath(new URL('../src/frontend-scroll.js', import.meta.url)) });
  await page.addScriptTag({ path: fileURLToPath(new URL('../src/frontend-inline.js', import.meta.url)) });
  assert.match(await page.locator('[data-node="hypothesis-card"] .vb-inline-status').innerText(), /已恢复上次未保存草稿/);
  assert.equal(await page.evaluate(() => window.VBInline.flushAll()), false);
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.recoveryNoteWrites), 0);
  assert.match(await editor.innerText(), /保留此草稿/);
  assert.deepEqual(errors, []);
  console.log('Inline browser checks passed: direct editing, debounce save, shared references, deletion key isolation, caret retention, sequential pending saves, conflict preservation/reload, failed write retry, focused draft snapshot protection, persisted recovery with no automatic note overwrite.');
} finally { await browser.close(); }
