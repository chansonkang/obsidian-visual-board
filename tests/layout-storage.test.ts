import test from 'node:test';
import assert from 'node:assert/strict';
import { LayoutStorage, validatedBoardData } from '../src/layout-storage';
import { initialLayout } from '../src/model';

const dir = '.obsidian/plugins/visual-board', primary = dir + '/data.json';
function payload(x = 77) {
  const layout = JSON.parse(JSON.stringify(initialLayout())) as ReturnType<typeof initialLayout>;
  layout.boards.home.view = { x: -777.25, y: 399.5, zoom: .7 };
  layout.boards.home.nodes.push({ id: 'n', type: 'note', x, y: -78.5, w: 640, h: 520, text: 'private', color: 'purple' });
  layout.boards.home.nodes.push({ id: 'a', type: 'article', doc: 'Folder/A.md', x: -400, y: 699, w: 720, h: 900 });
  layout.boards.home.nodes.push({ id: 'b', type: 'board', board: 'nested', x: 940, y: 199, w: 300, h: 303 });
  layout.boards.nested = { ...JSON.parse(JSON.stringify(layout.boards.home)), id: 'nested', parent: 'home', folderPath: 'Folder', nodes: [
    { id: 'pic', type: 'photo', imagePath: 'Assets/Image.png', x: -200, y: 120, w: 1200, h: 300 },
    { id: 'song', type: 'audio', filePath: 'Assets/Song.mp3', x: 1000, y: 450 },
    { id: 'pdf', type: 'pdf', filePath: 'Assets/Document.pdf', x: 1420, y: 450, w: 800, h: 1200 },
  ], edges: [{ from: 'song', to: 'pdf', lineStyle: 'dashed', width: 2.5 }] };
  layout.audioPlayback = { 'Assets/Song.mp3': { position: 73.5, duration: 200, lastPlayedAt: 1234 } };
  return { schema: 1, layout, settings: { language: 'en', attachmentFolder: 'Assets' }, unknownFutureSetting: { keep: true } };
}
class MemoryAdapter {
  files = new Map<string, string>(); folders = new Set([dir]); windows = false;
  fail: ((op: string, path: string, target?: string) => boolean) | null = null;
  check(op: string, path: string, target?: string) { if (this.fail?.(op, path, target)) throw Error('simulated IO failure'); }
  async exists(path: string) { this.check('exists', path); return this.files.has(path) || this.folders.has(path); }
  async read(path: string) { this.check('read', path); const value = this.files.get(path); if (value === undefined) throw Error('missing'); return value; }
  async write(path: string, text: string) { this.check('write', path); this.files.set(path, text); }
  async rename(path: string, target: string) {
    this.check('rename', path, target);
    if (this.windows && this.files.has(target)) throw Error('already exists');
    const text = await this.read(path); this.files.set(target, text); this.files.delete(path);
  }
  async remove(path: string) { this.check('remove', path); this.files.delete(path); }
  async mkdir(path: string) { this.check('mkdir', path); this.folders.add(path); }
}
function fixture() { const adapter = new MemoryAdapter(); adapter.files.set(primary, JSON.stringify(payload())); return adapter; }

test('load and reopen preserve exact nested data, dimensions, camera, settings and unknown envelope fields', async () => {
  const adapter = fixture(), store = new LayoutStorage(adapter, dir), result = await store.load();
  assert.equal(result.status, 'loaded'); assert.deepEqual(result.data, payload());
  const next = payload(-899.75); await store.write(next);
  const reopened = await new LayoutStorage(adapter, dir).load();
  assert.deepEqual(reopened.data, next);
  assert.equal(adapter.files.has(primary + '.previous'), false);
});
test('only absent storage starts new; corrupt, unreadable and structurally invalid storage fail closed', async () => {
  const empty = new MemoryAdapter(); assert.equal((await new LayoutStorage(empty, dir).load()).status, 'new');
  for (const text of ['{', '{}', JSON.stringify({ schema: 1, layout: {} }), JSON.stringify({ schema: 9, layout: initialLayout() })]) {
    const adapter = new MemoryAdapter(); adapter.files.set(primary, text);
    const store = new LayoutStorage(adapter, dir); assert.equal((await store.load()).status, 'blocked');
    await assert.rejects(store.write(payload())); assert.equal(adapter.files.get(primary), text);
  }
  const adapter = fixture(); adapter.fail = (op, path) => op === 'read' && path === primary;
  const store = new LayoutStorage(adapter, dir); assert.equal((await store.load()).status, 'blocked');
  await assert.rejects(store.write(payload()));
});
test('validation rejects incomplete boards, unknown versions, duplicate nodes and nonfinite geometry without sanitizing', () => {
  for (const mutate of [
    (p: any) => p.layout.version = 99,
    (p: any) => p.layout.boards.home.nodes[0].x = Infinity,
    (p: any) => p.layout.boards.home.nodes[0].h = -1,
    (p: any) => p.layout.boards.home.view.zoom = 0,
    (p: any) => p.layout.boards.home.nodes.push(p.layout.boards.home.nodes[0]),
    (p: any) => delete p.layout.boards.home.nodes,
  ]) { const p = payload(); mutate(p); assert.equal(validatedBoardData(p), null); }
});
test('legacy raw layout and schema envelope migrate without replacing geometry or losing settings', async () => {
  const legacy = payload().layout; (legacy as any).version = 1;
  const adapter = new MemoryAdapter(); adapter.files.set(primary, JSON.stringify(legacy));
  const store = new LayoutStorage(adapter, dir), result = await store.load();
  assert.deepEqual(result.data, { schema: 1, layout: legacy });
  await store.write(result.data); assert.deepEqual(JSON.parse(adapter.files.get(primary)!), result.data);
  const fallback = await new LayoutStorage(new MemoryAdapter(), dir).load(async () => payload());
  assert.equal(fallback.source, 'legacy'); assert.deepEqual(fallback.data, payload());
});
test('intentional empty Boards are valid and durable', async () => {
  const adapter = fixture(), store = new LayoutStorage(adapter, dir); await store.load();
  const next = payload(); next.layout.boards.home.nodes = []; await store.write(next);
  assert.deepEqual((await new LayoutStorage(adapter, dir).load()).data, next);
});
test('mutating the loaded object cannot mutate known-good backup geometry', async () => {
  const adapter = fixture(), store = new LayoutStorage(adapter, dir), loaded = await store.load();
  (loaded.data!.layout as any).boards.home.nodes[0].x = -1999;
  await store.write(loaded.data);
  adapter.files.set(primary, '{broken');
  const recovered = await new LayoutStorage(adapter, dir).load();
  assert.equal(recovered.status, 'recovered'); assert.deepEqual(recovered.data, payload());
});
test('recovery uses newest valid backup and can restore a missing or corrupt primary', async () => {
  for (const missing of [true, false]) {
    const adapter = fixture(), store = new LayoutStorage(adapter, dir); await store.load();
    await store.write(payload(100)); await store.write(payload(200));
    if (missing) adapter.files.delete(primary); else adapter.files.set(primary, 'broken');
    const next = new LayoutStorage(adapter, dir), recovered = await next.load();
    assert.equal(recovered.status, 'recovered'); assert.deepEqual(recovered.data, payload(100));
    await next.write(recovered.data);
    assert.deepEqual((await new LayoutStorage(adapter, dir).load()).data, payload(100));
  }
});
test('backup ring stays bounded and unchanged layout/settings-only saves do not churn layout backups', async () => {
  const adapter = fixture(), store = new LayoutStorage(adapter, dir); await store.load();
  await store.write(payload(1)); const first = [...adapter.files].filter(([p]) => /layout-backup-\d+\.json$/.test(p));
  const next = payload(1); next.settings.language = 'zh'; await store.write(next); await store.write(next);
  assert.deepEqual([...adapter.files].filter(([p]) => /layout-backup-\d+\.json$/.test(p)), first);
  for (let x = 2; x < 30; x++) await store.write(payload(x));
  const backups = [...adapter.files].filter(([p]) => /layout-backup-\d+\.json$/.test(p));
  assert.equal(backups.length, 10); assert.equal(Math.max(...backups.map(([,text]) => JSON.parse(text).sequence)), 29);
});
test('failure writing or verifying pending data leaves the last valid primary and rejects the save', async () => {
  for (const op of ['write', 'read']) {
    const adapter = fixture(), store = new LayoutStorage(adapter, dir); await store.load();
    adapter.fail = (operation, path) => operation === op && path === primary + '.pending';
    await assert.rejects(store.write(payload(100)));
    assert.deepEqual(JSON.parse(adapter.files.get(primary)!), payload());
  }
});
test('backup write failure never replaces the primary', async () => {
  const adapter = fixture(), store = new LayoutStorage(adapter, dir); await store.load();
  adapter.fail = (op, path) => op === 'write' && path.includes('layout-backup-');
  await assert.rejects(store.write(payload(100))); assert.deepEqual(JSON.parse(adapter.files.get(primary)!), payload());
});
test('Windows rename fallback saves normally and restores primary after interrupted replacement', async () => {
  const adapter = fixture(); adapter.windows = true;
  const store = new LayoutStorage(adapter, dir); await store.load(); await store.write(payload(100));
  assert.deepEqual(JSON.parse(adapter.files.get(primary)!), payload(100));
  adapter.fail = (op, path, target) => op === 'rename' && path === primary + '.pending' && target === primary;
  await assert.rejects(store.write(payload(200)));
  assert.deepEqual(JSON.parse(adapter.files.get(primary)!), payload(100));
});
test('interruption plus failed rollback still recovers previous latest state on restart', async () => {
  const adapter = fixture(); adapter.windows = true;
  const store = new LayoutStorage(adapter, dir); await store.load(); await store.write(payload(100));
  adapter.fail = (op, path, target) => op === 'rename' && target === primary && (path === primary + '.pending' || path === primary + '.previous');
  await assert.rejects(store.write(payload(200))); assert.equal(adapter.files.has(primary), false);
  adapter.fail = null;
  const recovered = await new LayoutStorage(adapter, dir).load();
  assert.equal(recovered.status, 'recovered'); assert.deepEqual(recovered.data, payload(100));
});
test('invalid saves and writes before load are rejected without touching storage', async () => {
  const adapter = fixture(), before = [...adapter.files], store = new LayoutStorage(adapter, dir);
  await assert.rejects(store.write(payload())); await store.load(); await assert.rejects(store.write({}));
  assert.deepEqual([...adapter.files], before);
});
test('a corrupt newest backup is skipped without discarding older valid layouts', async () => {
  const adapter = fixture(), store = new LayoutStorage(adapter, dir); await store.load();
  await store.write(payload(100)); await store.write(payload(200));
  adapter.files.set(primary, 'corrupt'); adapter.files.set(dir + '/layout-backup-01.json', 'corrupt');
  const recovered = await new LayoutStorage(adapter, dir).load();
  assert.equal(recovered.status, 'recovered'); assert.deepEqual(recovered.data, payload());
});
test('concurrent saves use immutable call-time snapshots and a failed save does not poison later writes', async () => {
  const adapter = fixture(), store = new LayoutStorage(adapter, dir); await store.load();
  const a = payload(100), b = payload(200);
  const first = store.write(a), second = store.write(b); b.layout.boards.home.nodes[0].x = 99999;
  await Promise.all([first, second]); assert.deepEqual(JSON.parse(adapter.files.get(primary)!), payload(200));
  adapter.fail = (op, path) => op === 'write' && path === primary + '.pending';
  await assert.rejects(store.write(payload(300))); adapter.fail = null;
  await store.write(payload(400)); assert.deepEqual(JSON.parse(adapter.files.get(primary)!), payload(400));
});
test('camera, current Board, display flags and playback saves retain useful arrangement backups', async () => {
  const adapter = fixture(), store = new LayoutStorage(adapter, dir); await store.load();
  await store.write(payload(100));
  const originalBackups = [...adapter.files].filter(([p]) => /layout-backup-\d+\.json$/.test(p));
  let browsing = payload(100);
  for (let index = 0; index < 30; index++) {
    browsing = payload(100);
    browsing.layout.boards.home.view = { x: index * 50, y: -index * 80, zoom: .3 + index / 20 };
    browsing.layout.currentBoard = index % 2 ? 'home' : 'nested';
    browsing.layout.showKnowledge = index % 2 === 0; browsing.layout.showSpace = index % 2 === 1;
    browsing.layout.audioPlayback!['Assets/Song.mp3'].position = index * 3;
    await store.write(browsing);
  }
  assert.deepEqual([...adapter.files].filter(([p]) => /layout-backup-\d+\.json$/.test(p)), originalBackups);
  assert.deepEqual(JSON.parse(adapter.files.get(primary)!), browsing);
  const moved = JSON.parse(JSON.stringify(browsing)); moved.layout.boards.home.nodes[0].x = 999;
  await store.write(moved);
  const backups = [...adapter.files].filter(([p]) => /layout-backup-\d+\.json$/.test(p));
  assert.equal(backups.length, 2);
  assert.deepEqual(JSON.parse(adapter.files.get(dir + '/layout-backup-00.json')!).payload, payload());
  assert.deepEqual(JSON.parse(adapter.files.get(dir + '/layout-backup-01.json')!).payload, browsing);
  adapter.files.set(primary, 'corrupt');
  const recovered = await new LayoutStorage(adapter, dir).load();
  assert.equal(recovered.status, 'recovered'); assert.deepEqual(recovered.data, browsing);
});

const externalDir = '.obsidian/visual-board-layout-backups/visual-board';
test('replacing the whole plugin folder restores exact latest committed layout, settings and playback from external mirror', async () => {
  const adapter = fixture(), store = new LayoutStorage(adapter, dir, 10, externalDir); await store.load();
  await store.write(payload(100));
  const latest = payload(100);
  latest.layout.currentBoard = 'nested'; latest.layout.boards.nested.view = { x: 900, y: 300, zoom: .5 };
  latest.layout.audioPlayback!['Assets/Song.mp3'].position = 199; latest.settings.language = 'zh';
  await store.write(latest);
  const ringCount = [...adapter.files.keys()].filter(p => p.startsWith(externalDir + '/layout-backup-') && p.endsWith('.json')).length;
  assert.equal(ringCount, 1);
  for (const path of [...adapter.files.keys()]) if (path.startsWith(dir + '/')) adapter.files.delete(path);
  adapter.folders.delete(dir);
  const reopened = new LayoutStorage(adapter, dir, 10, externalDir), recovered = await reopened.load();
  assert.equal(recovered.status, 'recovered'); assert.equal(recovered.source, externalDir + '/layout-latest.json');
  assert.deepEqual(recovered.data, latest);
  await reopened.write(recovered.data); assert.deepEqual(JSON.parse(adapter.files.get(primary)!), latest);
  assert.ok(adapter.folders.has(dir)); assert.ok(adapter.folders.has(externalDir));
});
test('an invalid external latest mirror falls back to valid arrangement ring and never creates an empty layout', async () => {
  const adapter = fixture(), store = new LayoutStorage(adapter, dir, 10, externalDir); await store.load();
  await store.write(payload(100)); await store.write(payload(200));
  adapter.files.delete(primary); adapter.files.set(externalDir + '/layout-latest.json', '{broken');
  const recovered = await new LayoutStorage(adapter, dir, 10, externalDir).load();
  assert.equal(recovered.status, 'recovered'); assert.deepEqual(recovered.data, payload(100));
});
test('old internal ring is read during external-backup migration and subsequent saves use external paths', async () => {
  const adapter = fixture(), old = new LayoutStorage(adapter, dir); await old.load(); await old.write(payload(100));
  adapter.files.delete(primary);
  const next = new LayoutStorage(adapter, dir, 10, externalDir), recovered = await next.load();
  assert.equal(recovered.status, 'recovered'); assert.equal(recovered.source, dir + '/layout-backup-00.json');
  assert.deepEqual(recovered.data, payload());
  await next.write(payload(200));
  assert.deepEqual(JSON.parse(adapter.files.get(externalDir + '/layout-latest.json')!).payload, payload(200));
  assert.ok(adapter.files.has(externalDir + '/layout-backup-01.json'));
});
test('external directory or backup failures preserve existing valid primary', async () => {
  for (const phase of ['mkdir', 'write']) {
    const adapter = fixture(), store = new LayoutStorage(adapter, dir, 10, externalDir); await store.load();
    adapter.fail = (op, path) => phase === 'mkdir' ? op === 'mkdir' && path.startsWith('.obsidian/visual-board-layout-backups') : op === 'write' && path.startsWith(externalDir + '/layout-backup-');
    await assert.rejects(store.write(payload(100)));
    assert.deepEqual(JSON.parse(adapter.files.get(primary)!), payload());
  }
});
test('mirror failure preserves the new valid primary and a repeated save repairs its external mirror', async () => {
  const adapter = fixture(), store = new LayoutStorage(adapter, dir, 10, externalDir); await store.load();
  await store.write(payload(100));
  adapter.fail = (op, path) => op === 'write' && path === externalDir + '/layout-latest.json.pending';
  await assert.rejects(store.write(payload(200)));
  assert.deepEqual(JSON.parse(adapter.files.get(primary)!), payload(200));
  adapter.fail = null; await store.write(payload(200));
  adapter.files.delete(primary);
  assert.deepEqual((await new LayoutStorage(adapter, dir, 10, externalDir).load()).data, payload(200));
});
test('unchanged primary is mirrored without rewriting it; interrupted Windows primary swap takes priority over older mirror', async () => {
  const adapter = fixture(), store = new LayoutStorage(adapter, dir, 10, externalDir); await store.load();
  await store.write(payload()); assert.ok(adapter.files.has(externalDir + '/layout-latest.json'));
  adapter.files.set(primary + '.previous', JSON.stringify(payload(777))); adapter.files.delete(primary);
  const recovered = await new LayoutStorage(adapter, dir, 10, externalDir).load();
  assert.deepEqual(recovered.data, payload(777)); assert.equal(recovered.source, primary + '.previous');
});
