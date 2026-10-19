import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLayout, sanitizeLayout, stripEphemeral, renameReferences, safeVaultPath } from '../src/model';

const makeBoard = (id: string, parent: string | null = 'home') => ({ id, title: id, parent, theme: 'research', view: { x: 10, y: -20, zoom: 1 }, nodes: [], edges: [], iconMode: 'default' });

test('visible body headings retain only safe Markdown paths across save/reload, including temporarily unreferenced notes', () => {
  const raw = { ...initialLayout(), visibleArticleHeadings: ['Notes/正文.md', 'Notes/正文.md', 'Root.MD', '../outside.md', '/absolute.md', 'https://example.com/file.md', 'Notes\\bad.md', 'Notes/../bad.md', 'Notes//bad.md', 'Notes/file.pdf', '', null, {}, 10] };
  const saved = stripEphemeral(raw);
  assert.deepEqual(saved.visibleArticleHeadings, ['Notes/正文.md', 'Root.MD']);
  assert.deepEqual(sanitizeLayout(JSON.parse(JSON.stringify(saved))).visibleArticleHeadings, saved.visibleArticleHeadings);
  assert.equal(initialLayout().visibleArticleHeadings, undefined, 'old layouts keep their existing title-hiding behavior');
  assert.equal(sanitizeLayout({ ...raw, visibleArticleHeadings: { 'Notes/正文.md': true } }).visibleArticleHeadings, undefined);
});

test('visible body heading paths follow exact note renames without changing geometry or unrelated prefixes', () => {
  const raw = initialLayout();
  raw.visibleArticleHeadings = ['Notes/A.md', 'Notes/A.md-copy.md', 'Renamed/A.md'];
  raw.boards.home.nodes = [{ id: 'ref', type: 'article', doc: 'Notes/A.md', x: -400, y: 820, w: 600, h: 700 }];
  const renamed = renameReferences(raw, 'Notes/A.md', 'Renamed/A.md');
  assert.deepEqual(renamed.visibleArticleHeadings, ['Renamed/A.md', 'Notes/A.md-copy.md']);
  assert.deepEqual(renamed.boards.home.nodes[0], { ...raw.boards.home.nodes[0], doc: 'Renamed/A.md' });
  assert.deepEqual(raw.visibleArticleHeadings, ['Notes/A.md', 'Notes/A.md-copy.md', 'Renamed/A.md']);
  assert.deepEqual(renameReferences(raw, 'Notes/A.md', '../unsafe.md').visibleArticleHeadings, raw.visibleArticleHeadings);
});

test('starts empty and strips article bodies, API credentials, and remote icon URLs at the save boundary', () => {
  assert.equal(initialLayout().boards.home.nodes.length, 0);
  const raw = { ...initialLayout(), docs: { '文章.md': { body: 'private body' } }, apiKey: 'secret', apiConfig: { apiKey: 'secret' } };
  Object.assign(raw.boards.home, { iconMode: 'ai', iconUrl: 'data:image/png;base64,secret', iconPath: 'Visual Board/icons/home.png', apiKey: 'nested-secret' });
  const saved = stripEphemeral(raw), json = JSON.stringify(saved);
  assert.equal(saved.boards.home.iconPath, 'Visual Board/icons/home.png');
  assert.equal(saved.boards.home.iconStatus, 'generated');
  for (const forbidden of ['private body', 'secret', 'iconUrl', 'docs', 'apiKey']) assert.equal(json.includes(forbidden), false, forbidden);
});

test('repairs cyclic nesting and rejects broken or inconsistent Board entries', () => {
  const raw = { ...initialLayout(), boards: { home: makeBoard('home', null), a: makeBoard('a', 'b'), b: makeBoard('b', 'a'), c: makeBoard('c', 'missing') } };
  Object.assign(raw.boards.a, { nodes: [{ id: 'into-b', type: 'board', board: 'b', x: 20, y: 20 }, { id: 'broken', type: 'board', board: 'absent', x: 0, y: 0 }] });
  Object.assign(raw.boards.home, { nodes: [{ id: 'into-home', type: 'board', board: 'home', x: 0, y: 0 }] });
  const saved = sanitizeLayout(raw);
  for (const id of ['a', 'b', 'c']) assert.equal(saved.boards[id].parent, 'home');
  assert.deepEqual(saved.boards.a.nodes, []);
  assert.deepEqual(saved.boards.home.nodes, []);
});

test('hidden nested Boards and missing article tombstones survive save and reference removal', () => {
  const raw = { ...initialLayout(), boards: { home: makeBoard('home', null), hidden: makeBoard('hidden'), deep: makeBoard('deep', 'hidden') } };
  Object.assign(raw.boards.deep, { nodes: [{ id: 'missing-note', type: 'article', doc: 'missing/未找到.md', x: 27, y: -44, w: 320, h: 480 }] });
  const saved = sanitizeLayout(raw);
  assert.equal(saved.boards.deep.parent, 'hidden');
  assert.equal(saved.boards.deep.nodes[0].doc, 'missing/未找到.md');
  assert.equal(saved.boards.home.nodes.length, 0);
  saved.boards.deep.nodes = [];
  const afterRemoval = sanitizeLayout(saved);
  assert.ok(afterRemoval.boards.hidden);
  assert.ok(afterRemoval.boards.deep);
  assert.equal(afterRemoval.boards.deep.nodes.length, 0);
});

test('Vault rename migrates exact references in every Board without changing position or source input', () => {
  const raw = { ...initialLayout(), boards: { home: makeBoard('home', null), hidden: makeBoard('hidden') } };
  for (const board of Object.values(raw.boards)) Object.assign(board, { nodes: [
    { id: 'ref', type: 'article', doc: '笔记/原文.md', x: 42, y: -18, w: 360, h: 500 },
    { id: 'other', type: 'article', doc: '笔记/原文二.md', x: 400, y: 200 }
  ], edges: [{ from: 'ref', to: 'other' }] });
  const layout = sanitizeLayout(raw), renamed = renameReferences(layout, '笔记/原文.md', '资料/新名字.md');
  for (const board of Object.values(renamed.boards)) {
    assert.deepEqual(board.nodes[0], { id: 'ref', type: 'article', doc: '资料/新名字.md', x: 42, y: -18, w: 360, h: 500 });
    assert.equal(board.nodes[1].doc, '笔记/原文二.md');
    assert.equal(board.edges.length, 1);
  }
  assert.equal(layout.boards.home.nodes[0].doc, '笔记/原文.md');
});

test('rejects traversal and untrusted paths and constrains non-finite geometry', () => {
  for (const path of ['/absolute.md', '../outside.md', 'a/../b.md', 'a//b.md', 'https://x.md', 'C:\\a.md', 'a\u0000.md']) assert.equal(safeVaultPath(path), null, path);
  assert.equal(safeVaultPath('本地资料/思考 与计划.md'), '本地资料/思考 与计划.md');
  const raw = initialLayout();
  Object.assign(raw.boards.home, { view: { x: Infinity, y: NaN, zoom: 300 }, nodes: [
    { id: 'valid', type: 'article', doc: '真实.md', x: Infinity, y: NaN, w: -1, h: 1e9 },
    { id: 'unsafe', type: 'article', doc: '../secret.md', x: 0, y: 0 },
    { id: '__proto__', type: 'note', title: 'unsafe', x: 0, y: 0 },
  ], edges: [{ from: 'valid', to: 'outside' }] });
  const saved = sanitizeLayout(raw);
  assert.deepEqual(saved.boards.home.view, { x: 0, y: 0, zoom: 2 });
  assert.deepEqual(saved.boards.home.nodes, [{ id: 'valid', type: 'article', doc: '真实.md', x: 0, y: 0 }]);
  assert.deepEqual(saved.boards.home.edges, []);
  assert.equal(saved.boards['__proto__'], undefined);
  assert.equal(saved.boards['constructor'], undefined);
  assert.equal(safeVaultPath('本地资料/含#的名字.md'), '本地资料/含#的名字.md');
});

test('local photo attachments retain their original HTTP attribution without executable URLs or authority credentials', () => {
  const raw = initialLayout();
  Object.assign(raw.boards.home, { nodes: [
    { id: 'https-photo', type: 'photo', title: '灵感.png', x: 20, y: 40, imagePath: '附件/灵感.png', sourceUrl: 'https://example.com/image.png' },
    { id: 'http-photo', type: 'photo', x: 300, y: 40, sourceUrl: 'http://example.com/image.jpg' },
    { id: 'credential-photo', type: 'photo', x: 0, y: 0, sourceUrl: 'https://user:secret@example.com/image.png' },
    { id: 'executable-photo', type: 'photo', x: 0, y: 0, sourceUrl: 'javascript:alert(1)' },
    { id: 'embedded-photo', type: 'photo', x: 0, y: 0, sourceUrl: 'data:image/png;base64,secret' },
    { id: 'file-photo', type: 'photo', x: 0, y: 0, sourceUrl: 'file:///private/image.png' },
  ] });
  const saved = sanitizeLayout(raw);
  assert.equal(saved.boards.home.nodes[0].imagePath, '附件/灵感.png');
  assert.equal(saved.boards.home.nodes[0].title, '灵感.png');
  assert.equal(saved.boards.home.nodes[0].sourceUrl, 'https://example.com/image.png');
  assert.equal(saved.boards.home.nodes[1].sourceUrl, 'http://example.com/image.jpg');
  for (const node of saved.boards.home.nodes.slice(2)) assert.equal(node.sourceUrl, undefined);
});

test('folder color persists independently of its sticker and rejects invalid colors to the existing default', () => {
  for (const color of ['lavender', 'rose', 'peach', 'mint', 'sky', 'sand', 'slate']) {
    const raw = initialLayout(); raw.boards.home.folderColor = color; raw.boards.home.iconId = 'leaf';
    const saved = stripEphemeral(raw), reloaded = sanitizeLayout(JSON.parse(JSON.stringify(saved)));
    assert.equal(saved.boards.home.folderColor, color); assert.equal(reloaded.boards.home.folderColor, color);
    assert.equal(reloaded.boards.home.iconId, 'leaf', 'color must not change the independent sticker choice');
    assert.equal(raw.boards.home.folderColor, color);
  }
  assert.equal(sanitizeLayout(initialLayout()).boards.home.folderColor, undefined, 'legacy Boards keep their existing lavender default');
  for (const color of ['purple', 'Lavender', ' lavender ', '', '#fff', 'url(https://example.com)', '__proto__', 42, null, { id: 'rose' }]) {
    const raw = initialLayout(); Object.assign(raw.boards.home, { folderColor: color, iconId: 'cat' });
    const saved = stripEphemeral(raw);
    assert.equal(saved.boards.home.folderColor, undefined, String(color));
    assert.equal(Object.prototype.hasOwnProperty.call(saved.boards.home, 'folderColor'), false);
    assert.equal(saved.boards.home.iconId, 'cat');
  }
});

function edgeFixture() {
  const layout = initialLayout();
  layout.boards.home.nodes = [
    { id: 'a', type: 'article', doc: 'Notes/A.md', x: 10, y: 20 },
    { id: 'b', type: 'article', doc: 'Notes/B.md', x: 320, y: 20 },
    { id: 'c', type: 'article', doc: 'Notes/C.md', x: 640, y: 20 },
    { id: 'sticky', type: 'note', title: 'A note', text: '', x: 960, y: 20 },
  ];
  return layout;
}

test('manual and knowledge appearance survive layout import/save and Markdown rename without creating knowledge links', () => {
  const raw = edgeFixture();
  raw.boards.home.edges = [{ from: 'a', to: 'sticky', lineStyle: 'dashed', width: 2.5 }, { from: 'a', to: 'b', lineStyle: 'solid', width: 4 }];
  raw.boards.home.knowledgeEdgeStyles = [{ from: 'a', to: 'c', lineStyle: 'solid', width: 1.5 }];
  const saved = stripEphemeral(raw), imported = sanitizeLayout(JSON.parse(JSON.stringify(saved))), renamed = renameReferences(imported, 'Notes/A.md', 'Renamed/A.md');
  for (const result of [saved, imported, renamed]) {
    assert.deepEqual(result.boards.home.edges, raw.boards.home.edges);
    assert.deepEqual(result.boards.home.knowledgeEdgeStyles, raw.boards.home.knowledgeEdgeStyles);
    assert.equal(result.boards.home.edges.some(edge => edge.from === 'a' && edge.to === 'c'), false, 'a style override must not create an actual knowledge edge');
  }
  assert.equal(renamed.boards.home.nodes.find(node => node.id === 'a')!.doc, 'Renamed/A.md');
  assert.equal(raw.boards.home.nodes[0].doc, 'Notes/A.md');
  const legacy = edgeFixture(); legacy.boards.home.edges = [{ from: 'a', to: 'b' }];
  const old = sanitizeLayout(legacy);
  assert.deepEqual(old.boards.home.edges, [{ from: 'a', to: 'b' }]);
  assert.equal(old.boards.home.edges[0].lineStyle, undefined); assert.equal(old.boards.home.edges[0].width, undefined);
  assert.equal(old.boards.home.knowledgeEdgeStyles, undefined, 'old layouts must not gain overrides or change defaults');
});

test('edge import sanitizes style/width and de-duplicates unordered node pairs', () => {
  const raw = edgeFixture();
  Object.assign(raw.boards.home, { edges: [
    { from: 'a', to: 'b', lineStyle: 'dashed', width: 2.5, color: 'unsafe', apiKey: 'secret' },
    { from: 'b', to: 'a', lineStyle: 'solid', width: 8 },
    { from: 'a', to: 'c', lineStyle: 'dots', width: '4' },
    { from: 'b', to: 'sticky', lineStyle: 'solid', width: 100 },
    { from: 'c', to: 'sticky', width: -2 },
    { from: 'a', to: 'sticky', width: 1.26 },
  ] });
  assert.deepEqual(sanitizeLayout(raw).boards.home.edges, [
    { from: 'a', to: 'b', lineStyle: 'dashed', width: 2.5 }, { from: 'a', to: 'c' },
    { from: 'b', to: 'sticky', lineStyle: 'solid', width: 8 }, { from: 'c', to: 'sticky', width: 1 }, { from: 'a', to: 'sticky', width: 1.5 },
  ]);
  for (const width of [NaN, Infinity, -Infinity, null, undefined, '2.5', {}, true]) {
    Object.assign(raw.boards.home, { edges: [{ from: 'a', to: 'b', width, lineStyle: 'broken' }] });
    assert.deepEqual(sanitizeLayout(raw).boards.home.edges, [{ from: 'a', to: 'b' }]);
  }
});

test('knowledge styles only retain distinct article endpoints in the same Board and disappear when nodes are removed', () => {
  const raw = edgeFixture();
  raw.boards.other = { ...edgeFixture().boards.home, id: 'other', parent: 'home', nodes: [{ id: 'external', type: 'article', doc: 'Other.md', x: 0, y: 0 }] };
  Object.assign(raw.boards.home, { knowledgeEdgeStyles: [
    { from: 'a', to: 'b', lineStyle: 'dashed', width: 3.5 }, { from: 'b', to: 'a', lineStyle: 'solid', width: 7 },
    { from: 'b', to: 'c', width: 999 }, { from: 'a', to: 'c', lineStyle: 'unknown', width: NaN },
    { from: 'a', to: 'sticky', lineStyle: 'solid' }, { from: 'sticky', to: 'b', width: 3 },
    { from: 'a', to: 'a', width: 3 }, { from: 'a', to: 'missing', width: 3 }, { from: 'a', to: 'external', width: 3 },
    { from: '__proto__', to: 'a', width: 3 }, { from: 42, to: 'a', width: 3 },
  ] });
  const saved = stripEphemeral(raw);
  assert.deepEqual(saved.boards.home.knowledgeEdgeStyles, [
    { from: 'a', to: 'b', lineStyle: 'dashed', width: 3.5 }, { from: 'b', to: 'c', width: 8 }, { from: 'a', to: 'c' },
  ]);
  assert.deepEqual(saved.boards.home.edges, []);
  saved.boards.home.nodes = saved.boards.home.nodes.filter(node => node.id !== 'b');
  assert.deepEqual(sanitizeLayout(saved).boards.home.knowledgeEdgeStyles, [{ from: 'a', to: 'c' }]);
  saved.boards.home.nodes = saved.boards.home.nodes.filter(node => node.id !== 'a');
  assert.deepEqual(sanitizeLayout(saved).boards.home.knowledgeEdgeStyles, []);
});

test('only valid knowledge pairs retain boolean Board-local visibility, including save and rename', () => {
  const raw = edgeFixture();
  Object.assign(raw.boards.home, { edges: [{ from: 'a', to: 'b', hidden: true }], knowledgeEdgeStyles: [
    { from: 'a', to: 'b', hidden: true, width: 3.5 }, { from: 'b', to: 'a', hidden: false },
    { from: 'b', to: 'c', hidden: false }, { from: 'a', to: 'c', hidden: 'true' },
    { from: 'a', to: 'sticky', hidden: true }, { from: 'a', to: 'a', hidden: true },
    { from: 'a', to: 'missing', hidden: true },
  ] });
  const saved = stripEphemeral(raw);
  assert.deepEqual(saved.boards.home.edges, [{ from: 'a', to: 'b' }]);
  const expected = [{ from: 'a', to: 'b', width: 3.5, hidden: true }, { from: 'b', to: 'c', hidden: false }, { from: 'a', to: 'c' }];
  assert.deepEqual(saved.boards.home.knowledgeEdgeStyles, expected);
  assert.deepEqual(stripEphemeral(JSON.parse(JSON.stringify(saved))).boards.home.knowledgeEdgeStyles, expected);
  assert.deepEqual(renameReferences(saved, 'Notes/A.md', 'Other/A.md').boards.home.knowledgeEdgeStyles, expected);
  assert.equal(saved.boards.home.nodes[0].doc, 'Notes/A.md');
  saved.boards.home.nodes = saved.boards.home.nodes.filter(n => n.id !== 'b');
  assert.deepEqual(stripEphemeral(saved).boards.home.knowledgeEdgeStyles, [{ from: 'a', to: 'c' }]);
});

test('PDF and audio cards persist safe source paths and geometry while rejecting missing or mismatched media files', () => {
  const raw = initialLayout();
  Object.assign(raw.boards.home, { nodes: [
    { id: 'pdf', type: 'pdf', title: '研究资料', filePath: '资料/中文 研究.PDF', x: 80, y: -20, w: 540, h: 720, angle: 2, body: 'never store PDF bytes', doc: 'Wrong.md', imagePath: 'Wrong.png', sourceUrl: 'https://example.com/remote.pdf', folderManaged: true },
    ...['mp3', 'm4a', 'wav', 'ogg', 'flac', 'aac', 'opus', 'webm'].map((extension, index) => ({ id: 'audio-' + index, type: 'audio', title: '录音 ' + index, filePath: '录音/会议.' + extension.toUpperCase(), x: index * 320, y: 740, w: 300, h: 180 })),
    { id: 'wrong-pdf', type: 'pdf', filePath: 'Document.md', x: 0, y: 0 },
    { id: 'wrong-audio', type: 'audio', filePath: 'Recording.pdf', x: 0, y: 0 },
    { id: 'unsupported-audio', type: 'audio', filePath: 'Recording.mp4', x: 0, y: 0 },
    { id: 'missing-path', type: 'audio', x: 0, y: 0 },
    { id: 'unsafe-pdf', type: 'pdf', filePath: '../private.pdf', x: 0, y: 0 },
    { id: 'remote-audio', type: 'audio', filePath: 'https://example.com/recording.mp3', x: 0, y: 0 },
  ] });
  const saved = stripEphemeral(raw), reloaded = sanitizeLayout(JSON.parse(JSON.stringify(saved)));
  assert.equal(saved.boards.home.nodes.length, 9);
  assert.deepEqual(saved.boards.home.nodes[0], { id: 'pdf', type: 'pdf', title: '研究资料', filePath: '资料/中文 研究.PDF', x: 80, y: -20, w: 540, h: 720, angle: 2 });
  assert.deepEqual(reloaded.boards.home.nodes, saved.boards.home.nodes);
  assert.equal(JSON.stringify(saved).includes('never store PDF bytes'), false);
  assert.equal(JSON.stringify(saved).includes('remote.pdf'), false);
  assert.equal(reloaded.audioPlayback, undefined);
});

test('audio progress is keyed by real audio references, survives reload, and excludes orphan or unsafe records', () => {
  const raw = initialLayout();
  raw.boards.home.nodes = [{ id: 'recording', type: 'audio', filePath: 'Audio/会议.mp3', x: 0, y: 0 }];
  raw.boards.hidden = { ...initialLayout().boards.home, id: 'hidden', parent: 'home', nodes: [{ id: 'deep-recording', type: 'audio', filePath: 'Audio/深层.wav', x: 300, y: 0 }] };
  Object.assign(raw, { audioPlayback: JSON.parse('{"Audio/会议.mp3":{"position":37.125,"duration":180.25,"lastPlayedAt":1791741600123,"body":"private"},"Audio/深层.wav":{"position":0,"duration":0,"lastPlayedAt":0},"Audio/unused.mp3":{"position":42},"../private.mp3":{"position":3},"https://example.com/audio.mp3":{"position":3},"__proto__":{"position":3},"constructor":{"position":3}}') });
  const saved = stripEphemeral(raw), reloaded = sanitizeLayout(JSON.parse(JSON.stringify(saved)));
  assert.equal(Object.getPrototypeOf(saved.audioPlayback), null); assert.equal(Object.getPrototypeOf(reloaded.audioPlayback), null);
  assert.deepEqual(Object.keys(saved.audioPlayback!).sort(), ['Audio/会议.mp3', 'Audio/深层.wav']);
  assert.deepEqual(saved.audioPlayback!['Audio/会议.mp3'], { position: 37.125, duration: 180.25, lastPlayedAt: 1791741600123 });
  assert.deepEqual(saved.audioPlayback!['Audio/深层.wav'], { position: 0, duration: 0, lastPlayedAt: 0 });
  assert.deepEqual(reloaded.audioPlayback, saved.audioPlayback);
  assert.equal(JSON.stringify(saved).includes('private'), false);
  saved.boards.home.nodes = [];
  assert.deepEqual(Object.keys(sanitizeLayout(saved).audioPlayback!), ['Audio/深层.wav']);
  saved.boards.hidden.nodes = [];
  assert.deepEqual(Object.keys(sanitizeLayout(saved).audioPlayback!), []);
  assert.equal(sanitizeLayout(initialLayout()).audioPlayback, undefined);
});

test('audio progress numeric bounds reject invalid positions and omit invalid optional fields without coercion', () => {
  const raw = initialLayout(); raw.boards.home.nodes = [{ id: 'recording', type: 'audio', filePath: 'Audio/Test.mp3', x: 0, y: 0 }];
  for (const position of [-1, 1e8 + 1, NaN, Infinity, -Infinity, '12', null, {}, undefined]) {
    Object.assign(raw, { audioPlayback: { 'Audio/Test.mp3': { position, duration: 40, lastPlayedAt: 100 } } });
    assert.deepEqual(Object.keys(sanitizeLayout(raw).audioPlayback!), []);
  }
  for (const invalid of [-1, Infinity, NaN, '20', {}, null]) {
    Object.assign(raw, { audioPlayback: { 'Audio/Test.mp3': { position: 12.75, duration: invalid, lastPlayedAt: invalid } } });
    assert.deepEqual(sanitizeLayout(raw).audioPlayback!['Audio/Test.mp3'], { position: 12.75 });
  }
  Object.assign(raw, { audioPlayback: { 'Audio/Test.mp3': { position: 1e8, duration: 1e8, lastPlayedAt: 1e15 } } });
  assert.deepEqual(sanitizeLayout(raw).audioPlayback!['Audio/Test.mp3'], { position: 1e8, duration: 1e8, lastPlayedAt: 1e15 });
  Object.assign(raw, { audioPlayback: { 'Audio/Test.mp3': { position: 1, duration: 1e8 + 1, lastPlayedAt: 1e15 + 1 } } });
  assert.deepEqual(sanitizeLayout(raw).audioPlayback!['Audio/Test.mp3'], { position: 1 });
});

test('single media rename migrates every matching source path and audio progress without changing Markdown semantics or geometry', () => {
  const raw = edgeFixture();
  raw.boards.home.hiddenFolderDocs = ['Notes/A.md'];
  raw.boards.home.edges = [{ from: 'a', to: 'b', lineStyle: 'dashed', width: 2.5 }];
  raw.boards.home.knowledgeEdgeStyles = [{ from: 'a', to: 'c', lineStyle: 'solid', width: 4.5 }];
  raw.boards.home.nodes.push({ id: 'pdf', type: 'pdf', filePath: 'Docs/Old.pdf', title: '资料', x: 10, y: 820, w: 600, h: 740 }, { id: 'audio', type: 'audio', filePath: 'Audio/Old.mp3', title: '录音', x: 680, y: 820, w: 340, h: 180 });
  raw.boards.hidden = { ...initialLayout().boards.home, id: 'hidden', parent: 'home', nodes: [{ id: 'audio-copy', type: 'audio', filePath: 'Audio/Old.mp3', x: -780, y: 300, w: 480, h: 180 }] };
  raw.audioPlayback = { 'Audio/Old.mp3': { position: 72.5, duration: 140, lastPlayedAt: 1791741600000 } };
  const renamedAudio = renameReferences(raw, 'Audio/Old.mp3', 'Recordings/新录音.m4a');
  assert.equal(renamedAudio.boards.home.nodes.find(node => node.id === 'audio')!.filePath, 'Recordings/新录音.m4a');
  assert.deepEqual(renamedAudio.boards.hidden.nodes[0], { ...raw.boards.hidden.nodes[0], filePath: 'Recordings/新录音.m4a' });
  assert.deepEqual(renamedAudio.audioPlayback!['Recordings/新录音.m4a'], raw.audioPlayback['Audio/Old.mp3']);
  assert.equal(renamedAudio.audioPlayback!['Audio/Old.mp3'], undefined);
  assert.deepEqual(sanitizeLayout(JSON.parse(JSON.stringify(renamedAudio))).audioPlayback, renamedAudio.audioPlayback);
  const renamedPDF = renameReferences(renamedAudio, 'Docs/Old.pdf', '资料/改名.PDF');
  assert.deepEqual(renamedPDF.boards.home.nodes.find(node => node.id === 'pdf'), { ...raw.boards.home.nodes.find(node => node.id === 'pdf')!, filePath: '资料/改名.PDF' });
  assert.deepEqual(renamedPDF.boards.home.edges, raw.boards.home.edges); assert.deepEqual(renamedPDF.boards.home.knowledgeEdgeStyles, raw.boards.home.knowledgeEdgeStyles);
  for (const [oldPath, newPath] of [['Notes/A.md', 'Audio/Wrong.mp3'], ['Audio/Old.mp3', 'Wrong.pdf'], ['Docs/Old.pdf', 'Wrong.md'], ['Audio/Old.mp3', '../unsafe.mp3']]) {
    const unchanged = renameReferences(raw, oldPath, newPath);
    assert.deepEqual(unchanged.boards.home.nodes, sanitizeLayout(raw).boards.home.nodes);
    assert.deepEqual(unchanged.boards.home.hiddenFolderDocs, ['Notes/A.md']); assert.deepEqual(unchanged.audioPlayback, sanitizeLayout(raw).audioPlayback);
  }
  const markdown = renameReferences(raw, 'Notes/A.md', 'Renamed/A.md');
  assert.equal(markdown.boards.home.nodes.find(node => node.id === 'a')!.doc, 'Renamed/A.md');
  assert.deepEqual(markdown.boards.home.hiddenFolderDocs, ['Renamed/A.md']);
  assert.equal(raw.boards.home.nodes.find(node => node.id === 'audio')!.filePath, 'Audio/Old.mp3', 'rename must not mutate the source layout');
});

// Wide and tiny photos retain their actual aspect after persistence and Vault renames.
test('photo pixel dimensions and intrinsic ratio survive save without article-card limits', () => {
 const raw=initialLayout();raw.boards.home.nodes=[
 {id:'wide',type:'photo',x:10,y:20,w:1412,h:184,imageWidth:1412,imageHeight:184,imagePath:'Assets/wide.png'},
 {id:'small',type:'photo',x:0,y:0,w:40,h:20,imageWidth:1200,imageHeight:600,imagePath:'Assets/small.png'},
 {id:'bad',type:'photo',x:0,y:0,w:300,h:200,imageWidth:Infinity,imageHeight:-1,imagePath:'Assets/bad.png'}
 ];
 const saved=stripEphemeral(raw);assert.deepEqual(saved.boards.home.nodes.slice(0,2),raw.boards.home.nodes.slice(0,2));
 assert.equal(saved.boards.home.nodes[2].imageWidth,undefined);assert.equal(saved.boards.home.nodes[2].imageHeight,undefined);
 const moved=renameReferences(saved,'Assets/wide.png','Media/wide.png');assert.equal(moved.boards.home.nodes[0].w,1412);assert.equal(moved.boards.home.nodes[0].imageHeight,184);
});
