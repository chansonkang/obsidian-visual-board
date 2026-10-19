import test from 'node:test';
import assert from 'node:assert/strict';
import { plain, primary, dir, arrangement, diskFixture, lifecycle } from './layout-host-harness.mjs';

function savePayload(snapshot, layout = snapshot.layout) { return { layout, layoutRevision: snapshot.layoutRevision, layoutSession: snapshot.layoutSession, nativeRevision: snapshot.nativeRevision }; }
const researchNode = (layout, id) => layout.boards.research.nodes.find(node => node.id === id);
const recoveries = disk => [...disk.files].filter(([path]) => /\/conflicts\/.*\.json$/.test(path)).map(([path, data]) => ({ path, ...JSON.parse(data) }));

test('actual main preserves every arranged component across incomplete index, layout save and cold plugin reopen', async () => {
  const disk = diskFixture(), initialFiles = new Map([...disk.files].filter(([path]) => !path.startsWith('.'))), f = await lifecycle(disk, { markdownIndex: [], unindexedPaths: ['Research/B.md'] });
  assert.equal(f.failure, undefined);
  try {
    const before = plain(f.plugin.layout);
    assert.deepEqual(before, arrangement());
    for (const paths of [[], ['Research/A.md'], []]) {
      f.setIndex(paths); const snapshot = await f.rpc('snapshot', {});
      assert.deepEqual(snapshot.layout, before, 'empty/partial Markdown index must preserve all stored geometry');
      await f.rpc('save-layout', savePayload(snapshot));
      assert.deepEqual(JSON.parse(disk.files.get(primary)).layout, before);
    }
    f.setIndex(['Research/A.md', 'Research/B.md', 'Research/Sub/C.md', 'Research/Hidden.md']);
    assert.deepEqual((await f.rpc('snapshot', {})).layout, before);
    assert.equal(disk.saveCalls, 0, 'full production adapter must use protected layout storage');
    assert.equal(disk.loadCalls, 0, 'primary exists: never replace it with a separate legacy default');
    assert.ok(disk.operations.some(([operation, path]) => operation === 'write' && path === primary + '.pending'));
    f.close();
    const reopened = await lifecycle(disk);
    try { assert.equal(reopened.failure, undefined); assert.deepEqual((await reopened.rpc('snapshot', {})).layout, before); } finally { reopened.close(); }
    assert.deepEqual([...disk.files].filter(([path]) => !path.startsWith('.')), [...initialFiles]);
    assert.deepEqual(disk.articleWrites, []);
  } finally { f.close(); }
});

test('actual main recovers corrupt primary from newest verified backup in its ten-slot history', async () => {
  const disk = diskFixture(), f = await lifecycle(disk);
  let expected;
  try {
    for (let step = 1; step <= 14; step++) {
      const snapshot = await f.rpc('snapshot', {}), previous = plain(snapshot.layout), next = plain(previous);
      next.boards.research.nodes.find(node => node.id === 'sticky').x = 1000 + step * 20;
      await f.rpc('save-layout', savePayload(snapshot, next));
      expected = previous;
    }
  } finally { f.close(); }
  const slots = [...disk.files.keys()].filter(path => /\/layout-backup-\d\d\.json$/.test(path));
  assert.equal(slots.length, 10);
  const newest = slots.map(path => ({ path, ...JSON.parse(disk.files.get(path)) })).sort((a, b) => b.sequence - a.sequence)[0];
  assert.deepEqual(newest.payload.layout, expected);
  // Exercise the older arrangement-ring fallback when the latest mirror is also damaged.
  for(const path of disk.files.keys())if(path.endsWith('/layout-latest.json'))disk.files.set(path,'{invalid latest');
  disk.files.set(primary, '{interrupted JSON');
  const corrupt = disk.files.get(primary), operationsBefore = disk.operations.length, reopened = await lifecycle(disk);
  try {
    assert.equal(reopened.failure, undefined); assert.deepEqual(plain(reopened.plugin.layout), expected);
    assert.ok(reopened.notices.some(message => /备份.*恢复/.test(message)));
    assert.equal(disk.files.get(primary), corrupt, 'opening recovered data does not overwrite corrupt original until explicit save');
    assert.equal(disk.operations.length, operationsBefore);
    const snapshot = await reopened.rpc('snapshot', {}); assert.deepEqual(snapshot.layout, expected);
    await reopened.rpc('save-layout', savePayload(snapshot));
    assert.deepEqual(JSON.parse(disk.files.get(primary)).layout, expected);
  } finally { reopened.close(); }
});

test('actual main blocks corrupt or invalid layouts without backup and never replaces them with an empty Board', async () => {
  for (const corrupt of ['{invalid JSON', JSON.stringify({ schema: 1, layout: { version: 2, currentBoard: 'home', boards: {} } })]) {
    const disk = diskFixture(); disk.files.set(primary, corrupt); const before = [...disk.files], f = await lifecycle(disk);
    try {
      assert.match(f.failure?.message || '', /could not be loaded safely/);
      assert.deepEqual([...disk.files], before); assert.deepEqual(disk.operations, []);
      assert.equal(disk.loadCalls, 0); assert.equal(disk.saveCalls, 0);
      await assert.rejects(f.plugin.persist(), /停止写入/);
      assert.deepEqual([...disk.files], before); assert.deepEqual(disk.operations, []);
    } finally { f.close(); }
  }
});

test('actual settings save and cold reopen preserve layout and original Markdown bytes', async () => {
  const disk = diskFixture(), f = await lifecycle(disk);
  const before = plain(f.plugin.layout), articlesBefore = [...disk.files].filter(([path]) => !path.startsWith('.'));
  try {
    await f.rpc('save-settings', { language: 'en', defaultIconMode: 'ai', noteFolder: 'Research', attachmentFolder: 'Research/Assets' });
    const saved = JSON.parse(disk.files.get(primary)); assert.deepEqual(saved.layout, before); assert.equal(saved.settings.language, 'en');
  } finally { f.close(); }
  const reopened = await lifecycle(disk, { markdownIndex: [] });
  try {
    assert.equal(reopened.failure, undefined); assert.deepEqual((await reopened.rpc('snapshot', {})).layout, before); assert.equal(reopened.plugin.settings.language, 'en');
    assert.deepEqual([...disk.files].filter(([path]) => !path.startsWith('.')), articlesBefore); assert.deepEqual(disk.articleWrites, []);
  } finally { reopened.close(); }
});


test('replacing the entire plugin directory restores the latest exact layout from backups outside the install folder', async () => {
  const disk = diskFixture(), f = await lifecycle(disk); let expected, settings;
  try {
    const snapshot = await f.rpc('snapshot', {}), next = plain(snapshot.layout); next.boards.research.nodes.find(n=>n.id==='sticky').x=2460;
    next.boards.research.view={x:380,y:-620,zoom:1.4}; next.audioPlayback['Research/Song.mp3'].position=81;
    await f.rpc('save-layout',savePayload(snapshot, next));
    await f.rpc('save-settings',{language:'en'});
    const saved=JSON.parse(disk.files.get(primary));expected=saved.layout;settings=saved.settings;
  }finally{f.close();}
  const mirrors=[...disk.files.keys()].filter(path=>path.endsWith('/layout-latest.json'));
  assert.equal(mirrors.length,1);assert.ok(!mirrors[0].startsWith(dir+'/'));
  for(const path of [...disk.files.keys()])if(path.startsWith(dir+'/'))disk.files.delete(path);
  // A freshly reinstalled runtime has a plugin directory, but no previous data.json.
  const reopened=await lifecycle(disk,{markdownIndex:[]});
  try{
    assert.equal(reopened.failure,undefined);assert.deepEqual(plain(reopened.plugin.layout),expected);
    assert.deepEqual(plain(reopened.plugin.settings),settings);assert.ok(reopened.notices.some(message=>/备份.*恢复|recovered/.test(message)));
    assert.equal(disk.files.has(primary),false,'recovery does not overwrite before an explicit save');
    const snapshot=await reopened.rpc('snapshot',{});assert.deepEqual(snapshot.layout,expected);
    await reopened.rpc('save-layout',savePayload(snapshot));
    assert.deepEqual(JSON.parse(disk.files.get(primary)).layout,expected);assert.deepEqual(disk.articleWrites,[]);
  }finally{reopened.close();}
});

test('two actual host views merge stale camera/color saves without losing a new sticky or article arrangement', async () => {
  const disk = diskFixture(), host = await lifecycle(disk), peer = host.createFrame();
  try {
    const first = await host.rpc('snapshot', {}), second = await peer.rpc('snapshot', {});
    assert.equal(first.layoutRevision, second.layoutRevision); assert.equal(first.layoutSession, second.layoutSession);
    const edited = plain(first.layout);
    edited.boards.research.nodes.push({ id: 'fresh-sticky', type: 'note', title: 'New sticky', text: 'Must survive old snapshots', color: 'purple', x: 720, y: 1000, w: 460, h: 380 });
    Object.assign(researchNode(edited, 'article-a'), { x: -1880, y: 1240, w: 640, h: 820 });
    const saved = await host.rpc('save-layout', savePayload(first, edited));
    assert.equal(saved.saveStatus, 'saved');
    const stale = plain(second.layout);
    stale.boards.research.view = { x: 200, y: -500, zoom: .9 }; researchNode(stale, 'sticky').color = 'blue';
    const merged = await peer.rpc('save-layout', savePayload(second, stale));
    assert.equal(merged.saveStatus, 'saved');
    assert.deepEqual(researchNode(merged.layout, 'fresh-sticky'), researchNode(edited, 'fresh-sticky'));
    assert.deepEqual(researchNode(merged.layout, 'article-a'), researchNode(edited, 'article-a'));
    assert.equal(researchNode(merged.layout, 'sticky').color, 'blue');
    assert.deepEqual(merged.layout.boards.research.view, stale.boards.research.view);
    assert.deepEqual(JSON.parse(disk.files.get(primary)).layout, merged.layout);
    assert.equal(recoveries(disk).length, 0);
  } finally { host.close(); }
});

test('a late full save after restored sticky insertion retains all recovered content and arrangement on cold reopen', async () => {
  const disk = diskFixture(), host = await lifecycle(disk); let expected;
  try {
    const stale = await host.rpc('snapshot', {}), preserved = plain(stale.layout.boards.research.nodes);
    // This is the host-side result of a recycle/backup restore, not a frame edit.
    for (let i = 0; i < 14; i++) host.plugin.layout.boards.research.nodes.push({ id: `recovered-${i}`, type: 'note', title: `Recovered ${i}`, text: `Recovered body ${i}\nSecond line`, color: i % 2 ? 'pink' : 'green', x: i * 320, y: 1600, w: 300, h: 420 });
    await host.plugin.persist(); await host.plugin.flushWrites();
    const response = await host.rpc('save-layout', savePayload(stale));
    assert.equal(response.saveStatus, 'saved');
    assert.equal(response.layout.boards.research.nodes.filter(node => node.type === 'note').length, 15);
    assert.deepEqual(response.layout.boards.research.nodes.filter(node => !node.id.startsWith('recovered-')), preserved);
    expected = response.layout;
  } finally { host.close(); }
  const reopened = await lifecycle(disk);
  try {
    const snapshot = await reopened.rpc('snapshot', {});
    assert.deepEqual(snapshot.layout, expected);
    assert.deepEqual(JSON.parse(disk.files.get(primary)).layout, expected);
  } finally { reopened.close(); }
});

test('concurrent sticky text keeps the already saved edit and persists the losing complete draft outside the plugin directory', async () => {
  const disk = diskFixture(), host = await lifecycle(disk), peer = host.createFrame();
  try {
    const first = await host.rpc('snapshot', {}), second = await peer.rpc('snapshot', {});
    const latest = plain(first.layout), draft = plain(second.layout);
    researchNode(latest, 'sticky').text = 'Window A saved\nFull latest text';
    researchNode(draft, 'sticky').text = 'Window B unsaved\nEntire second draft';
    const saved = await host.rpc('save-layout', savePayload(first, latest)); assert.equal(saved.saveStatus, 'saved');
    const response = await peer.rpc('save-layout', savePayload(second, draft));
    assert.equal(response.saveStatus, 'conflict'); assert.ok(response.recovery);
    assert.equal(researchNode(response.layout, 'sticky').text, researchNode(latest, 'sticky').text);
    const copies = recoveries(disk); assert.equal(copies.length, 1);
    assert.equal(copies[0].reason, 'concurrent-edit');
    assert.equal(copies[0].path.startsWith(dir + '/'), false);
    assert.deepEqual(copies[0].layout, draft); assert.deepEqual(copies[0].base, second.layout);
    assert.equal(researchNode(copies[0].current, 'sticky').text, researchNode(latest, 'sticky').text);
    assert.deepEqual(JSON.parse(disk.files.get(primary)).layout, response.layout);
    const listed = await host.rpc('list-layout-conflicts', {}); assert.ok(listed.includes(response.recovery));
  } finally { host.close(); }
});

test('a snapshot from an earlier plugin session is archived and cannot overwrite cold-reopened data', async () => {
  const disk = diskFixture(), host = await lifecycle(disk); let oldSnapshot, expected;
  try {
    oldSnapshot = await host.rpc('snapshot', {});
    const edited = plain(oldSnapshot.layout); researchNode(edited, 'sticky').text = 'Persist before restarting';
    researchNode(edited, 'article-a').x = 2280;
    expected = (await host.rpc('save-layout', savePayload(oldSnapshot, edited))).layout;
  } finally { host.close(); }
  const reopened = await lifecycle(disk);
  try {
    const fresh = await reopened.rpc('snapshot', {}); assert.notEqual(fresh.layoutSession, oldSnapshot.layoutSession);
    const outdated = plain(oldSnapshot.layout); researchNode(outdated, 'sticky').text = 'Old window last-minute draft';
    const response = await reopened.rpc('save-layout', savePayload(oldSnapshot, outdated));
    assert.equal(response.saveStatus, 'expired'); assert.deepEqual(response.layout, expected);
    assert.deepEqual(JSON.parse(disk.files.get(primary)).layout, expected);
    const copies = recoveries(disk); assert.equal(copies.length, 1); assert.equal(copies[0].reason, 'expired-session');
    assert.deepEqual(copies[0].layout, outdated);
  } finally { reopened.close(); }
});

test('two simultaneous RPC saves serialize, retain both nonconflicting changes and survive reopening', async () => {
  const disk = diskFixture(), host = await lifecycle(disk), peer = host.createFrame(); let expected;
  try {
    const first = await host.rpc('snapshot', {}), second = await peer.rpc('snapshot', {});
    const left = plain(first.layout), right = plain(second.layout);
    researchNode(left, 'sticky').text = 'Both simultaneous saves kept';
    researchNode(right, 'article-a').x = -2220;
    const responses = await Promise.all([host.rpc('save-layout', savePayload(first, left)), peer.rpc('save-layout', savePayload(second, right))]);
    assert.ok(responses.every(response => response.saveStatus === 'saved'));
    expected = JSON.parse(disk.files.get(primary)).layout;
    assert.equal(researchNode(expected, 'sticky').text, 'Both simultaneous saves kept');
    assert.equal(researchNode(expected, 'article-a').x, -2220);
  } finally { host.close(); }
  const reopened = await lifecycle(disk);
  try { assert.deepEqual((await reopened.rpc('snapshot', {})).layout, expected); } finally { reopened.close(); }
});

test('a native file rename remains authoritative when an older frame saves geometry and sticky edits', async () => {
  const disk = diskFixture(), host = await lifecycle(disk), peer = host.createFrame();
  try {
    const old = await peer.rpc('snapshot', {});
    await host.nativeRename('Research/A.md', 'Research/Renamed.md');
    const stale = plain(old.layout); researchNode(stale, 'article-a').x = 2660; researchNode(stale, 'sticky').text = 'Keep editing after rename';
    const response = await peer.rpc('save-layout', savePayload(old, stale));
    assert.equal(response.saveStatus, 'saved');
    assert.equal(researchNode(response.layout, 'article-a').doc, 'Research/Renamed.md');
    assert.equal(researchNode(response.layout, 'article-a').x, 2660);
    assert.equal(researchNode(response.layout, 'sticky').text, 'Keep editing after rename');
    assert.equal(disk.files.has('Research/A.md'), false);
    assert.ok(disk.files.has('Research/Renamed.md'));
    assert.deepEqual(JSON.parse(disk.files.get(primary)).layout, response.layout);
    assert.deepEqual(disk.articleWrites, []);
  } finally { host.close(); }
});

test('legacy unstamped full save and evicted baselines preserve current data and retain recoverable submissions', async () => {
  const disk = diskFixture(), host = await lifecycle(disk);
  try {
    const oldest = await host.rpc('snapshot', {});
    for (let index = 0; index < 66; index++) {
      const snapshot = await host.rpc('snapshot', {}), next = plain(snapshot.layout);
      researchNode(next, 'article-a').x = index * 20;
      assert.equal((await host.rpc('save-layout', savePayload(snapshot, next))).saveStatus, 'saved');
    }
    const before = plain(host.plugin.layout), diskBefore = disk.files.get(primary);
    const expired = await host.rpc('save-layout', savePayload(oldest)); assert.equal(expired.saveStatus, 'expired');
    const legacy = await host.rpc('save-layout', { layout: oldest.layout, nativeRevision: oldest.nativeRevision }); assert.equal(legacy.saveStatus, 'expired');
    assert.deepEqual(plain(host.plugin.layout), before); assert.equal(disk.files.get(primary), diskBefore);
    const copies = recoveries(disk); assert.equal(copies.length, 2);
    assert.ok(copies.every(copy => copy.reason === 'expired-session'));
    assert.ok(copies.every(copy => JSON.stringify(copy.layout) === JSON.stringify(oldest.layout)));
  } finally { host.close(); }
});

test('conflicting save fails safely when its recovery copy cannot be written', async () => {
  const disk = diskFixture(), host = await lifecycle(disk);
  try {
    const old = await host.rpc('snapshot', {}), first = plain(old.layout), late = plain(old.layout);
    researchNode(first, 'sticky').text = 'First saved edit'; researchNode(late, 'sticky').text = 'Late text still in frame';
    await host.rpc('save-layout', savePayload(old, first));
    const before = plain(host.plugin.layout), diskBefore = disk.files.get(primary), write = host.app.vault.adapter.write;
    host.app.vault.adapter.write = async (path, text) => { if (path.includes('/conflicts/')) throw Error('Recovery storage full'); return write(path, text); };
    await assert.rejects(host.rpc('save-layout', savePayload(old, late)), /操作失败|Recovery storage full/);
    assert.deepEqual(plain(host.plugin.layout), before); assert.equal(disk.files.get(primary), diskBefore);
    assert.equal(recoveries(disk).length, 0);
  } finally { host.close(); }
});
