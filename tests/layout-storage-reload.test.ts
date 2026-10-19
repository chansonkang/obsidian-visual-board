import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { LayoutStorage } from '../src/layout-storage';
import { initialLayout } from '../src/model';

const dir = '.obsidian/plugins/visual-board', primary = dir + '/data.json';
const backupDir = '.obsidian/visual-board-layout-backups/visual-board';
function payload(text: string, x = 100) {
  const layout = JSON.parse(JSON.stringify(initialLayout())) as ReturnType<typeof initialLayout>;
  layout.boards.home.nodes.push({ id: 'sticky', type: 'note', title: 'Keep', text, x, y: 200, w: 400, h: 300, color: 'pink' });
  return { schema: 1, layout, settings: { language: 'en' } };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
class Adapter {
  files = new Map([[primary, JSON.stringify(payload('original'))]]);
  folders = new Set<string>();
  writes: string[] = [];
  beforeWrite?: (path: string, text: string) => Promise<void>;
  beforeRename?: (from: string, to: string) => Promise<void>;
  async exists(path: string) { return this.files.has(path) || this.folders.has(path); }
  async read(path: string) { const value = this.files.get(path); if (value === undefined) throw Error('missing'); return value; }
  async write(path: string, text: string) { await this.beforeWrite?.(path, text); this.writes.push(text); this.files.set(path, text); }
  async rename(from: string, to: string) {
    await this.beforeRename?.(from, to);
    if (this.files.has(to)) throw Error('Windows destination exists');
    const value = await this.read(from); this.files.set(to, value); this.files.delete(from);
  }
  async remove(path: string) { this.files.delete(path); }
  async mkdir(path: string) { this.folders.add(path); }
}

test('reload drains the active transaction, rejects queued old saves and loads its completed layout', async () => {
  const adapter = new Adapter(), old = new LayoutStorage(adapter, dir, 10, backupDir);
  await old.load();
  const started = deferred(), release = deferred();
  adapter.beforeWrite = async path => { if (path === primary + '.pending') { started.resolve(); await release.promise; } };
  const active = old.write(payload('last active edit', 700));
  await started.promise;
  const stale = old.write(payload('stale queued edit', -999));
  const rejected = assert.rejects(stale, /newer plugin instance/);
  const next = new LayoutStorage(adapter, dir, 10, backupDir);
  let loaded = false;
  const loading = next.load().then(result => { loaded = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loaded, false, 'new load must wait for old pending transaction');
  release.resolve(); await active; await rejected;
  assert.deepEqual((await loading).data, payload('last active edit', 700));
  assert.equal(adapter.writes.some(text => text.includes('stale queued edit')), false);
  await next.write(payload('new instance edit', 900));
  await assert.rejects(old.write(payload('late old callback')), /newer plugin instance/);
  assert.deepEqual(JSON.parse(adapter.files.get(primary)!), payload('new instance edit', 900));
  assert.deepEqual(JSON.parse(adapter.files.get(backupDir + '/layout-latest.json')!).payload, payload('new instance edit', 900));
  assert.equal(adapter.files.has(primary + '.previous'), false);
});

test('new load waits for a failing old replacement to roll back without interrupting its transaction', async () => {
  const adapter = new Adapter(), old = new LayoutStorage(adapter, dir, 10, backupDir);
  await old.load();
  const started = deferred(), release = deferred(); let fail = true;
  adapter.beforeRename = async (from, to) => {
    if (fail && from === primary + '.pending' && to === primary && !adapter.files.has(primary)) {
      started.resolve(); await release.promise; fail = false; throw Error('simulated replacement failure');
    }
  };
  const pending = old.write(payload('interrupted edit'));
  const rejected = assert.rejects(pending, /simulated replacement failure/);
  await started.promise;
  const next = new LayoutStorage(adapter, dir, 10, backupDir), loading = next.load();
  release.resolve(); await rejected;
  assert.deepEqual((await loading).data, payload('original'));
  await next.write(payload('safe new edit'));
  assert.deepEqual(JSON.parse(adapter.files.get(primary)!), payload('safe new edit'));
});

test('ownership survives independently evaluated plugin modules sharing the same adapter', async () => {
  const result = await build({ entryPoints: [new URL('../src/layout-storage.ts', import.meta.url).pathname], bundle: true, platform: 'browser', format: 'cjs', write: false });
  function moduleClass(): typeof LayoutStorage {
    const module = { exports: {} as { LayoutStorage: typeof LayoutStorage } };
    runInNewContext(result.outputFiles[0].text, { module, exports: module.exports });
    return module.exports.LayoutStorage;
  }
  const First = moduleClass(), Second = moduleClass(), adapter = new Adapter();
  assert.notEqual(First, Second);
  const first = new First(adapter, dir); await first.load();
  const second = new Second(adapter, dir); await second.load();
  await assert.rejects(first.write(payload('old module callback')), /newer plugin instance/);
  await second.write(payload('new module edit'));
  assert.deepEqual(JSON.parse(adapter.files.get(primary)!), payload('new module edit'));
});

test('separate plugin directories do not revoke each other and obsolete loads are rejected', async () => {
  const adapter = new Adapter(), first = new LayoutStorage(adapter, dir);
  await first.load();
  const other = new LayoutStorage(adapter, '.obsidian/plugins/another-board');
  await other.load(); await first.write(payload('first directory')); await other.write(payload('second directory'));
  assert.deepEqual(JSON.parse(adapter.files.get(primary)!), payload('first directory'));
  const obsolete = new LayoutStorage(adapter, dir), newest = new LayoutStorage(adapter, dir);
  await assert.rejects(obsolete.load(), /newer plugin instance/);
  assert.deepEqual((await newest.load()).data, payload('first directory'));
});
