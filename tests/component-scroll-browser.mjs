import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { richHarness, fixturePath, selectRendered } from './rich-editor-harness.mjs';

const longBody = title => [
  '# ' + title, '', 'Editable opening marker.', '',
  '```text', 'horizontal-code-' + '0123456789'.repeat(140), '```', '',
  ...Array.from({ length: 100 }, (_, i) => `## Section ${i + 1}\n\nParagraph ${i + 1}: ${'Long local article reading position. '.repeat(9)}`),
].join('\n');
function tallPdf() {
  const stream = 'q 0.1 0.3 0.7 rg 25 80 270 300 re f Q\nBT /F1 22 Tf 25 1355 Td (SCROLLABLE LOCAL PDF) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 1400] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'ascii').toString('base64');
}
const evidence = new URL('../evidence/', import.meta.url);
await mkdir(evidence, { recursive: true });
const h = await richHarness(longBody('Rich'));
const { page, frame, editor, peer } = h;
const checks = {};
const selectors = {
  peer: '[data-node="peer"] .vb-inline-editor',
  peerCode: '[data-node="peer"] .vb-inline-editor pre',
  other: '[data-node="other"] .vb-inline-editor',
  otherCode: '[data-node="other"] .vb-inline-editor pre',
  sticky: '[data-node="sticky"] [data-sticky-field="text"]',
  pdf: '[data-node="pdf"] .vb-pdf-pages',
};
const readPositions = () => frame.evaluate(selectors => Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
  const el = document.querySelector(selector);
  return [name, { top: el.scrollTop, left: el.scrollLeft }];
})), selectors);
function samePositions(actual, expected, label) {
  for (const [name, value] of Object.entries(expected)) for (const axis of ['top', 'left']) {
    assert.ok(Math.abs(actual[name][axis] - value[axis]) < 1, `${label}: ${name}.${axis}: ${actual[name][axis]} should remain ${value[axis]}`);
  }
}
const settle = () => frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  const otherBody = longBody('Other');
  await page.evaluate(body => { richHost.payload.docs['Notes/Other.md'].body = body; richSnapshot(); }, otherBody);
  await frame.evaluate(base64 => {
    const originalRPC = VBHost.rpc;
    VBHost.rpc = (method, payload) => method === 'read-pdf' && payload.path === 'Assets/scroll.pdf' ? Promise.resolve({ base64 }) : originalRPC(method, payload);
    VBMedia.assets['Assets/scroll.pdf'] = { kind: 'pdf', title: 'Scrolling PDF' };
    const home = board();
    home.nodes.push({ id: 'other', type: 'article', doc: 'Notes/Other.md', x: 1520, y: 0, w: 620, h: 780 });
    home.nodes.push({ id: 'pdf', type: 'pdf', filePath: 'Assets/scroll.pdf', title: 'Scrolling PDF', x: 2650, y: 0, w: 360, h: 360 });
    home.nodes.push({ id: 'sticky', type: 'note', title: 'Sticky', text: 'Long sticky paragraph.\n'.repeat(100), x: 2240, y: 0, w: 280, h: 300, color: 'green' });
    state.boards.child.nodes.push({ id: 'peer', type: 'article', doc: 'Notes/Rich.md', x: 100, y: 0, w: 620, h: 780 });
    render();
  }, tallPdf());
  await frame.locator('[data-node="other"] pre').waitFor();
  await frame.waitForFunction(() => document.querySelector('[data-node="pdf"] .vb-pdf-page')?.textContent === '1 / 1');
  const pdfPixels = await frame.locator('[data-node="pdf"] canvas').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let blue = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 2] > data[i] + 50) blue++;
    return { width: canvas.width, height: canvas.height, blue };
  });
  assert.ok(pdfPixels.height > 1000 && pdfPixels.blue > 1000, 'actual bundled PDF.js paints a tall valid local PDF');
  checks.actualPDFJSReadsAndPaintsTheScrollableFixture = true;
  await selectRendered(editor, 'Editable opening marker.', true);
  const geometry = await frame.evaluate(() => ({ nodes: structuredClone(board().nodes), camera: structuredClone(board().view) }));
  await frame.evaluate(selectors => {
    const values = { peer: [714, 0], peerCode: [0, 283], other: [1137, 0], otherCode: [0, 451], sticky: [493, 0], pdf: [337, 0] };
    for (const [name, selector] of Object.entries(selectors)) {
      const el = document.querySelector(selector), [top, left] = values[name];
      el.scrollTop = top; el.scrollLeft = left;
    }
  }, selectors);
  const expected = await readPositions();
  assert.ok(expected.peer.top > 600 && expected.other.top > 1000 && expected.sticky.top > 400, 'fixture has independently scrollable article and sticky bodies');
  assert.ok(expected.pdf.top > 300, 'actual rendered PDF page has a distinct internal reading offset');
  assert.ok(expected.peerCode.left > 200 && expected.otherCode.left > 400, 'wide code blocks have actual horizontal overflow');

  await page.keyboard.insertText('Inserted text. ');
  samePositions(await readPositions(), expected, 'typing and same-document peer updates');
  await h.flush(); await settle();
  samePositions(await readPositions(), expected, 'saving an article');
  assert.match(await peer.innerText(), /Inserted text\. Editable opening marker\./, 'duplicate card receives saved content without losing its own position');
  checks.typingAndSavePreserveIndependentDuplicateAndDifferentNoteReaders = true;

  await page.evaluate(() => richSnapshot());
  await settle();
  samePositions(await readPositions(), expected, 'background host snapshot');
  checks.snapshotRetainsArticleStickyAndNestedHorizontalPositions = true;

  await frame.evaluate(() => {
    window.__scrollActiveEditor = document.querySelector('[data-node="article"] .vb-inline-editor');
    const s = getSelection();
    window.__scrollSelection = { anchorNode: s.anchorNode, anchorOffset: s.anchorOffset, focusNode: s.focusNode, focusOffset: s.focusOffset };
    render();
  });
  await settle();
  samePositions(await readPositions(), expected, 'ordinary card render');
  assert.equal(await editor.evaluate(el => {
    const s = getSelection(), saved = window.__scrollSelection;
    return el === window.__scrollActiveEditor && document.activeElement === el &&
      s.anchorNode === saved.anchorNode && s.anchorOffset === saved.anchorOffset &&
      s.focusNode === saved.focusNode && s.focusOffset === saved.focusOffset;
  }), true, 'active editor DOM, focus and native range survive full card rendering');
  checks.fullRenderPreservesCurrentEditorDOMSelectionAndPeerPositions = true;
  assert.deepEqual(await frame.evaluate(() => ({ nodes: structuredClone(board().nodes), camera: structuredClone(board().view) })), geometry, 'reading retention must not alter component layout or zoom');
  checks.layoutAndCameraRemainUnchanged = true;

  // A reader may scroll again after a redraw; no queued restoration may override it.
  await frame.evaluate(() => {
    render();
    const el = document.querySelector('[data-node="other"] .vb-inline-editor');
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 80 }));
    el.scrollTop = 1377;
  });
  await settle();
  assert.equal((await readPositions()).other.top, 1377);
  checks.newReaderScrollWinsOverQueuedRestoration = true;

  // A decoded local image can make an offset reachable after the synchronous render.
  const delayed = await frame.evaluate(async () => {
    const el = document.querySelector('[data-node="peer"] .vb-inline-editor');
    el.scrollTop = 744;
    VBComponentScroll.preserve(el, () => { el.innerHTML = '<img class="delayed-scroll-fixture" style="display:block;width:100%;height:0">'; });
    const clamped = el.scrollTop;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const image = el.querySelector('img'); image.style.height = '4000px'; image.dispatchEvent(new Event('load'));
    const recovered = el.scrollTop;
    VBComponentScroll.preserve(el, () => { el.innerHTML = '<img class="delayed-scroll-fixture" style="display:block;width:100%;height:0">'; });
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -80 }));
    const next = el.querySelector('img'); next.style.height = '4000px'; next.dispatchEvent(new Event('load'));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const afterReaderInteraction = el.scrollTop;
    render();
    return { clamped, recovered, afterReaderInteraction };
  });
  assert.deepEqual(delayed, { clamped: 0, recovered: 744, afterReaderInteraction: 0 }, 'delayed decoding restores an unreachable offset, and user wheel input cancels the pending restoration');
  checks.delayedContentRestoresUnreachableOffsetUnlessReaderInteracts = true;

  await editor.blur(); await h.flush();
  await frame.evaluate(() => navigate('child'));
  await frame.waitForFunction(() => board().id === 'child'); await settle();
  assert.equal(await frame.locator('[data-node="peer"] .vb-inline-editor').evaluate(el => el.scrollTop), 0, 'same node ID and note in another Board must not inherit the previous Board scroll');
  await frame.locator('[data-node="peer"] .vb-inline-editor').evaluate(el => { el.scrollTop = 333; });
  await frame.evaluate(() => navigate('home'));
  await frame.waitForFunction(() => board().id === 'home'); await settle();
  assert.notEqual(await peer.evaluate(el => el.scrollTop), 333, 'returning does not copy a different Board component position');
  checks.boardNavigationDoesNotTransferScrollBetweenMatchingNodeIDs = true;

  // Rebinding a node ID to another resource creates a fresh reader, not an inherited one.
  await frame.evaluate(() => {
    const el = document.querySelector('[data-node="peer"] .vb-inline-editor'); el.scrollTop = 655;
    board().nodes.find(n => n.id === 'peer').doc = 'Notes/Other.md'; render();
  });
  assert.equal(await peer.evaluate(el => el.scrollTop), 0);
  checks.replacingResourceDoesNotReuseUnrelatedReadingPosition = true;
  assert.deepEqual(h.errors, []); assert.deepEqual(h.requests, []);
  await page.screenshot({ path: new URL('component-scroll-browser.png', evidence).pathname });
  await writeFile(new URL('component-scroll-browser.json', evidence), JSON.stringify({ passed: true, count: Object.keys(checks).length, checks, positions: expected, pdfPixels, errors: h.errors, remoteRequests: h.requests, mode: 'actual bundled sandbox frame; isolated local host; no user Vault access' }, null, 2));
  console.log(`Component reading positions passed: ${Object.keys(checks).length} functional groups.`);
} catch (error) {
  await page.screenshot({ path: new URL('component-scroll-failure.png', evidence).pathname });
  throw error;
} finally { await h.close(); }
