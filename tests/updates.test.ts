import test from 'node:test';
import assert from 'node:assert/strict';
import { UpdateService, normalizeUpdateRepository, compareVersions, type UpdateConfig, type UpdateResponse, type UpdateCache } from '../src/updates';
const repo = 'Chanson/visual-board';
const response = (json: unknown, status = 200, headers = {}): UpdateResponse => ({ status, text: JSON.stringify(json), headers });
function release(v = '0.1.26') {
  const tag = 'v' + v;
  return { tag_name: tag, draft: false, prerelease: false, html_url: `https://github.com/${repo}/releases/tag/${tag}`, assets: ['main.js', 'manifest.json', 'styles.css', 'Visual-Board.zip'].map(name => ({ name, size: 100, browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${name}` })) };
}
function fixture(options: { config?: Partial<UpdateConfig>; cache?: unknown; first?: UpdateResponse | Error; manifest?: unknown } = {}) {
  const config: UpdateConfig = { repository: repo, currentVersion: '0.1.25', appVersion: '1.9.0', pluginId: 'obsidian-visual-board', autoCheck: true, ...options.config };
  let now = 100_000_000, stored = options.cache;
  const requests: string[] = [], saves: UpdateCache[] = [];
  let first = options.first || response(release());
  const manifest = options.manifest || { id: config.pluginId, version: '0.1.26', minAppVersion: '1.5.0' };
  const service = new UpdateService(() => config, async () => stored, async cache => { saves.push(cache); stored = cache; }, async request => {
    requests.push(request.url); assert.equal(request.method, 'GET'); assert.equal(request.throw, false); assert.equal('Authorization' in request.headers, false);
    if (request.url.includes('api.github.com')) { if (first instanceof Error) throw first; return first; }
    assert.equal(request.url, `https://github.com/${repo}/releases/download/v0.1.26/manifest.json`);
    return response(manifest);
  }, () => now);
  return { service, config, requests, saves, stored: () => stored, advance: (ms: number) => now += ms, setFirst: (v: UpdateResponse | Error) => first = v };
}
test('repository accepts only owner/repo or exact public GitHub repository URL', () => {
  for (const value of [repo, `https://github.com/${repo}`, `https://github.com/${repo}/`, `https://github.com/${repo}.git`]) assert.equal(normalizeUpdateRepository(value), repo);
  assert.equal(normalizeUpdateRepository('  '), '');
  for (const value of ['https://evil.test/a/b', 'http://github.com/a/b', 'https://secret@github.com/a/b', 'https://github.com/a/b?token=secret', 'https://github.com/a/b#x', 'https://github.com/a/b/releases', 'a/../b', '/a/b', 'a/b%2f..', 'a/.hidden', 'a--b/repo']) assert.equal(normalizeUpdateRepository(value), null, value);
});
test('semver comparison handles numerical versions and prerelease precedence without lexicographic mistakes', () => {
  for (const [a, b, n] of [['0.1.10', '0.1.9', 1], ['1.0.0', '1.0.0', 0], ['1.0.0', '1.0.0-beta.10', 1], ['1.0.0-beta.2', '1.0.0-beta.10', -1], ['1.0.0+foo', '1.0.0+bar', 0]] as const) assert.equal(compareVersions(a, b), n);
  for (const value of ['1.2', 'v1.2.3', '01.2.3', '1.2.3-01', 'garbage']) assert.equal(compareVersions(value, '1.2.3'), null);
});
test('empty repository, invalid config, and disabled automatic checks make zero network requests', async () => {
  for (const [config, status] of [[{ repository: '' }, 'not-configured'], [{ repository: 'https://evil.test/a/b' }, 'invalid-config'], [{ autoCheck: false }, 'disabled']] as const) {
    const f = fixture({ config }); assert.equal((await f.service.check()).status, status); assert.deepEqual(f.requests, []);
  }
  const f = fixture({ config: { autoCheck: false } }); assert.equal((await f.service.check({ manual: true })).status, 'available');
});
test('valid stable release checks metadata and manifest only and notifies once across reloads', async () => {
  const f = fixture(), first = await f.service.check();
  assert.equal(first.status, 'available'); assert.equal(first.shouldNotify, true); assert.equal(first.latestVersion, '0.1.26');
  assert.equal(first.downloadUrl, `https://github.com/${repo}/releases/download/v0.1.26/Visual-Board.zip`);
  assert.deepEqual(f.requests, [`https://api.github.com/repos/${repo}/releases/latest`, `https://github.com/${repo}/releases/download/v0.1.26/manifest.json`]);
  assert.equal((await f.service.check()).cached, true); assert.equal(f.requests.length, 2);
  assert.equal((await f.service.check({ manual: true })).shouldNotify, false); assert.equal(f.requests.length, 4);
  const reopened = fixture({ cache: f.stored() }); assert.equal((await reopened.service.check()).shouldNotify, false); assert.equal(reopened.requests.length, 0);
  reopened.advance(24 * 3600000 + 1); assert.equal((await reopened.service.check()).shouldNotify, false); assert.equal(reopened.requests.length, 2);
});
test('manual checks bypass daily throttle and simultaneous checks share one request chain', async () => {
  const f = fixture(); const results = await Promise.all([f.service.check(), f.service.check({ manual: true }), f.service.check()]);
  assert.equal(f.requests.length, 2); assert.equal(results[0], results[1]);
  await f.service.check({ manual: true }); assert.equal(f.requests.length, 4);
});
test('ignored version remains available manually but never repeats automatic prompt', async () => {
  const f = fixture(); await f.service.ignore('0.1.26'); const result = await f.service.check({ manual: true });
  assert.equal(result.status, 'available'); assert.equal(result.shouldNotify, false); assert.equal(f.saves.at(-1)?.ignoredVersion, '0.1.26');
});
test('equal/older releases cannot offer downgrade and incompatible Obsidian is identified', async () => {
  for (const currentVersion of ['0.1.26', '0.1.27']) { const f = fixture({ config: { currentVersion } }); const result = await f.service.check(); assert.equal(result.status, 'up-to-date'); assert.equal(result.shouldNotify, false); }
  const f = fixture({ manifest: { id: 'obsidian-visual-board', version: '0.1.26', minAppVersion: '1.10.0' } });
  const result = await f.service.check(); assert.equal(result.status, 'incompatible'); assert.equal(result.minAppVersion, '1.10.0'); assert.equal(result.shouldNotify, false);
});
test('draft, prerelease, malformed/mismatched tags, foreign release URLs and missing assets fail closed', async () => {
  const cases = [
    (r: any) => r.draft = true, (r: any) => r.prerelease = true, (r: any) => r.tag_name = 'v0.1.26-beta.1',
    (r: any) => r.tag_name = 'release-0.1.26', (r: any) => r.html_url = 'https://evil.test/a',
    (r: any) => r.html_url = 'https://github.com/Another/repo/releases/tag/v0.1.26',
    (r: any) => r.assets.pop() && r.assets.pop(), (r: any) => r.assets[0].browser_download_url = 'https://evil.test/main.js',
    (r: any) => r.assets[0].browser_download_url = `https://github.com/${repo}/releases/download/v0.1.26/%2e%2e/main.js`,
    (r: any) => r.assets[1].size = 1000000, (r: any) => r.assets.push(r.assets[0]),
  ];
  for (const mutate of cases) { const r = release(); mutate(r); const f = fixture({ first: response(r) }); assert.equal((await f.service.check()).status, 'invalid-release'); assert.equal(f.requests.length, 1); }
});
test('released manifest must be bounded valid JSON with matching plugin id and exact tag version', async () => {
  for (const manifest of [ { id: 'other', version: '0.1.26', minAppVersion: '1.5.0' }, { id: 'obsidian-visual-board', version: '0.1.27', minAppVersion: '1.5.0' }, { id: 'obsidian-visual-board', version: '0.1.26', minAppVersion: '1.5' }, { id: 'obsidian-visual-board', version: '0.1.26', minAppVersion: '1.5.0', padding: 'x'.repeat(65537) } ]) {
    const f = fixture({ manifest }); assert.equal((await f.service.check()).status, 'invalid-release');
  }
});
test('offline, not found and rate limited are never reported up-to-date; automatic failures back off', async () => {
  for (const [first, status] of [[Error('offline'), 'offline'], [response({}, 404), 'not-found'], [response({}, 429, { 'retry-after': '3600' }), 'rate-limited']] as const) {
    const f = fixture({ first }); const r = await f.service.check(); assert.equal(r.status, status); assert.equal(r.shouldNotify, false);
    assert.equal((await f.service.check()).cached, true); assert.equal(f.requests.length, 1);
    if (status === 'rate-limited') { await f.service.check({ manual: true }); assert.equal(f.requests.length, 1); f.advance(3600001); }
    else f.advance(15 * 60000 + 1);
    await f.service.check(); assert.equal(f.requests.length, 2);
  }
});
test('unload and repository changes suppress late results and further manifest requests', async () => {
  for (const action of ['dispose', 'reconfigure', 'disable']) {
    let resolve!: (r: UpdateResponse) => void; let calls = 0; const config: UpdateConfig = { repository: repo, currentVersion: '0.1.25', appVersion: '1.9.0', pluginId: 'obsidian-visual-board', autoCheck: true };
    const service = new UpdateService(() => config, async () => null, async () => { throw Error('must not save late'); }, async () => { calls++; return new Promise(r => resolve = r); });
    const promise = service.check(); await new Promise(r => setImmediate(r));
    if (action === 'dispose') service.dispose(); else if (action === 'reconfigure') { config.repository = 'Another/repo'; service.reset(); } else config.autoCheck = false;
    resolve(response(release())); const result = await promise; assert.equal(result.status, 'disabled'); assert.equal(result.shouldNotify, false); assert.equal(calls, 1);
  }
});
test('corrupt or hostile cached URLs never reach UI and caches cannot suppress requests across repositories', async () => {
  const f = fixture(); await f.service.check(); const raw = structuredClone(f.stored()) as UpdateCache;
  for (const status of ['available', 'up-to-date'] as const) {
    const hostile = structuredClone(raw); hostile.result!.status = status; hostile.result!.releaseUrl = 'javascript:alert(1)';
    const g = fixture({ cache: hostile }); const result = await g.service.check(); assert.equal(result.status, 'available'); assert.equal(g.requests.length, 2); assert.ok(result.releaseUrl?.startsWith('https://github.com/'));
  }
  const other = fixture({ config: { repository: 'Another/repo' }, cache: raw, first: response({}, 404) }); assert.equal((await other.service.check()).status, 'not-found'); assert.equal(other.requests.length, 1);
});
