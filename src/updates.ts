/** Metadata-only GitHub release checks. This module never installs or executes a release. */
export interface UpdateConfig {
  repository: string; currentVersion: string; appVersion: string; pluginId: string; autoCheck: boolean;
}
export type UpdateStatus = 'not-configured' | 'invalid-config' | 'disabled' | 'available' | 'up-to-date' | 'offline' | 'not-found' | 'rate-limited' | 'incompatible' | 'invalid-release';
export interface UpdateResult {
  status: UpdateStatus; currentVersion: string; latestVersion?: string; releaseUrl?: string; downloadUrl?: string;
  minAppVersion?: string; checkedAt?: number; shouldNotify: boolean; cached?: boolean; message?: string;
}
export interface UpdateCache {
  schema: 1; key: string; checkedAt: number; retryAt: number; failures: number;
  ignoredVersion?: string; notifiedVersion?: string; result?: UpdateResult;
}
export interface UpdateRequest { url: string; method: 'GET'; headers: Record<string, string>; throw: false }
export interface UpdateResponse { status: number; text: string; headers?: Record<string, string> }
export type UpdateRequester = (request: UpdateRequest) => Promise<UpdateResponse>;
const DAY = 24 * 60 * 60 * 1000, MINUTE = 60 * 1000, MAX_MANIFEST = 64 * 1024, MAX_RELEASE = 512 * 1024;
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** Accept only a public GitHub repository, never credentials, local paths, queries or subpages. */
export function normalizeUpdateRepository(input: string): string | null {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value) return '';
  if (/^https:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) return null;
      value = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    } catch { return null; }
  }
  value = value.replace(/\.git$/, '');
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?\/[a-zA-Z0-9_.-]{1,100}$/.test(value)) return null;
  const [owner, repo] = value.split('/');
  if (owner.includes('--') || repo === '.' || repo === '..' || repo.startsWith('.')) return null;
  return `${owner}/${repo}`;
}
interface Version { core: bigint[]; pre: string[] }
function version(value: string): Version | null {
  if (typeof value !== 'string' || value.length > 120) return null;
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!m) return null;
  const pre = m[4]?.split('.') || [];
  if (pre.some(p => /^\d+$/.test(p) && p.length > 1 && p.startsWith('0'))) return null;
  return { core: m.slice(1, 4).map(BigInt), pre };
}
export function compareVersions(a: string, b: string): number | null {
  const x = version(a), y = version(b); if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i] ? 1 : -1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (x.pre[i] === undefined || y.pre[i] === undefined) return x.pre[i] === undefined ? -1 : 1;
    const l = x.pre[i], r = y.pre[i]; if (l === r) continue;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    if (ln && rn) return BigInt(l) > BigInt(r) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return l > r ? 1 : -1;
  }
  return 0;
}
const stable = (value: unknown): value is string => typeof value === 'string' && !!version(value) && !version(value)!.pre.length;
function releaseURL(value: unknown, repo: string, tag: string): string | null {
  const expected = `https://github.com/${repo}/releases/tag/${tag}`;
  return typeof value === 'string' && value.toLowerCase() === expected.toLowerCase() ? expected : null;
}
function assetURL(value: unknown, repo: string, tag: string, name: string): string | null {
  const expected = `https://github.com/${repo}/releases/download/${tag}/${name}`;
  // Names are deliberately restricted; no traversal, credentials or encoded redirects.
  return /^[a-zA-Z0-9_.-]{1,160}$/.test(name) && name !== '.' && name !== '..' && typeof value === 'string' && value.toLowerCase() === expected.toLowerCase() ? expected : null;
}
function cacheKey(config: UpdateConfig, repo: string) { return [repo.toLowerCase(), config.currentVersion, config.appVersion, config.pluginId].join('|'); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

export class UpdateService {
  private cache: UpdateCache | null = null;
  private cacheLoaded = false;
  private pending: { key: string; promise: Promise<UpdateResult> } | null = null;
  private disposed = false;
  private generation = 0;
  constructor(
    private getConfig: () => UpdateConfig,
    private loadCache: () => Promise<unknown>,
    private saveCache: (cache: UpdateCache) => Promise<void>,
    private requester: UpdateRequester,
    private now: () => number = Date.now,
  ) {}
  dispose() { this.disposed = true; this.generation++; }
  /** Reconfiguration invalidates in-flight checks; it does not clear Board data. */
  reset() { this.generation++; this.cache = null; this.cacheLoaded = false; this.pending = null; }
  private base(status: UpdateStatus, config: UpdateConfig, message?: string): UpdateResult {
    return { status, currentVersion: config.currentVersion, shouldNotify: false, ...(message ? { message } : {}) };
  }
  private alive(generation: number, key: string) {
    const config = this.getConfig(), repo = normalizeUpdateRepository(config.repository);
    return !this.disposed && generation === this.generation && repo !== null && cacheKey(config, repo) === key;
  }
  private async load(key: string) {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    try {
      const raw = await this.loadCache();
      if (!record(raw) || raw.schema !== 1 || raw.key !== key || !finite(raw.checkedAt) || raw.checkedAt > this.now() + MINUTE * 5 || !finite(raw.retryAt) || !finite(raw.failures)) return;
      this.cache = { schema: 1, key, checkedAt: raw.checkedAt, retryAt: Math.min(raw.retryAt, this.now() + DAY), failures: Math.min(10, Math.floor(raw.failures)),
        ...(stable(raw.ignoredVersion) ? { ignoredVersion: raw.ignoredVersion } : {}), ...(stable(raw.notifiedVersion) ? { notifiedVersion: raw.notifiedVersion } : {}) };
      // Persisted results are validated again before they can reach the UI.
      if (record(raw.result)) this.cache.result = raw.result as unknown as UpdateResult;
    } catch { /* A lost check cache must not affect plugin or Vault loading. */ }
  }
  private cached(config: UpdateConfig, repo: string): UpdateResult | null {
    const result = this.cache?.result;
    if (!result || result.currentVersion !== config.currentVersion || !['available', 'up-to-date', 'offline', 'not-found', 'rate-limited', 'incompatible', 'invalid-release'].includes(result.status)) return null;
    const hasRelease = ['available', 'incompatible', 'up-to-date'].includes(result.status);
    if (hasRelease) {
      if (!stable(result.latestVersion) || !stable(result.minAppVersion) || !result.releaseUrl) return null;
      const newer = compareVersions(result.latestVersion, config.currentVersion) === 1;
      if ((result.status === 'up-to-date') === newer || (result.status === 'available' && compareVersions(config.appVersion, result.minAppVersion)! < 0) || (result.status === 'incompatible' && compareVersions(config.appVersion, result.minAppVersion)! >= 0)) return null;
      const tag = result.releaseUrl.split('/').pop() || '';
      if (tag.replace(/^v/, '') !== result.latestVersion || !releaseURL(result.releaseUrl, repo, tag)) return null;
      if (result.downloadUrl) { const name = result.downloadUrl.split('/').pop() || ''; if (!assetURL(result.downloadUrl, repo, tag, name) || !/\.zip$/i.test(name)) return null; }
    }
    return { status: result.status, currentVersion: config.currentVersion, checkedAt: this.cache!.checkedAt, shouldNotify: false, cached: true,
      ...(hasRelease ? { latestVersion: result.latestVersion, releaseUrl: result.releaseUrl, minAppVersion: result.minAppVersion, ...(result.downloadUrl ? { downloadUrl: result.downloadUrl } : {}) } : {}) };
  }
  async ignore(value: string): Promise<void> {
    if (!stable(value) || this.disposed) return;
    const config = this.getConfig(), repo = normalizeUpdateRepository(config.repository);
    if (!repo) return;
    const key = cacheKey(config, repo); await this.load(key);
    if (!this.cache || this.cache.key !== key) this.cache = { schema: 1, key, checkedAt: 0, retryAt: 0, failures: 0 };
    this.cache.ignoredVersion = value;
    try { await this.saveCache(clone(this.cache)); } catch { /* Only notification preferences are affected. */ }
  }
  check(options: { manual?: boolean } = {}): Promise<UpdateResult> {
    const config = this.getConfig(), repo = normalizeUpdateRepository(config.repository);
    if (this.disposed || (!options.manual && !config.autoCheck)) return Promise.resolve(this.base('disabled', config));
    if (repo === '') return Promise.resolve(this.base('not-configured', config));
    if (repo === null || !version(config.currentVersion) || !version(config.appVersion) || !/^[a-zA-Z0-9_-]{1,100}$/.test(config.pluginId)) return Promise.resolve(this.base('invalid-config', config));
    const key = cacheKey(config, repo);
    if (this.pending?.key === key) return this.pending.promise;
    const generation = this.generation;
    const promise = this.run(config, repo, key, generation, !!options.manual).finally(() => { if (this.pending?.promise === promise) this.pending = null; });
    this.pending = { key, promise }; return promise;
  }
  private async get(url: string, limit: number): Promise<UpdateResponse> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = this.requester({ url, method: 'GET', headers: { Accept: url.startsWith('https://api.github.com/') ? 'application/vnd.github+json' : 'application/json', 'X-GitHub-Api-Version': '2022-11-28' }, throw: false });
    const response = await Promise.race([request, new Promise<UpdateResponse>((_resolve, reject) => { timer = setTimeout(() => reject(Error('request-timeout')), 20_000); })]).finally(() => { if (timer) clearTimeout(timer); });
    if (typeof response.text !== 'string' || response.text.length > limit) throw Error('invalid-response-size');
    return response;
  }
  private httpFailure(response: UpdateResponse, config: UpdateConfig): UpdateResult | null {
    const headers = Object.fromEntries(Object.entries(response.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (response.status === 429 || (response.status === 403 && (headers['x-ratelimit-remaining'] === '0' || !!headers['retry-after']))) {
      let retry = this.now() + MINUTE * 15;
      if (/^\d+$/.test(headers['retry-after'] || '')) retry = this.now() + Number(headers['retry-after']) * 1000;
      if (/^\d+$/.test(headers['x-ratelimit-reset'] || '')) retry = Math.max(retry, Number(headers['x-ratelimit-reset']) * 1000);
      this.serverRetryAt = Math.min(this.now() + DAY, Math.max(this.now() + MINUTE, retry));
      return this.base('rate-limited', config);
    }
    if (response.status === 404) return this.base('not-found', config);
    if (response.status < 200 || response.status >= 300) return this.base('offline', config);
    return null;
  }
  private serverRetryAt = 0;
  private async run(config: UpdateConfig, repo: string, key: string, generation: number, manual: boolean): Promise<UpdateResult> {
    await this.load(key);
    if (!this.alive(generation, key) || (!manual && !this.getConfig().autoCheck)) return this.base('disabled', config);
    if (this.cache?.key !== key) this.cache = { schema: 1, key, checkedAt: 0, retryAt: 0, failures: 0 };
    const cached = this.cached(config, repo), now = this.now();
    if (cached && ((cached.status === 'rate-limited' && this.cache.retryAt > now) || (!manual && (this.cache.retryAt > now || (['available', 'up-to-date', 'incompatible'].includes(cached.status) && this.cache.checkedAt > 0 && now - this.cache.checkedAt < DAY))))) return cached;
    let result: UpdateResult;
    this.serverRetryAt = 0;
    try {
      const response = await this.get(`https://api.github.com/repos/${repo}/releases/latest`, MAX_RELEASE);
      if (!this.alive(generation, key) || (!manual && !this.getConfig().autoCheck)) return this.base('disabled', config);
      const failure = this.httpFailure(response, config);
      if (failure) result = failure;
      else result = await this.readRelease(JSON.parse(response.text), config, repo);
    } catch (error) {
      result = this.base(error instanceof SyntaxError || (error instanceof Error && error.message === 'invalid-response-size') ? 'invalid-release' : 'offline', config);
    }
    if (!this.alive(generation, key) || (!manual && !this.getConfig().autoCheck)) return this.base('disabled', config);
    const checkedAt = this.now(), success = ['available', 'up-to-date', 'incompatible'].includes(result.status), failures = success ? 0 : Math.min(10, this.cache.failures + 1);
    const retryAt = success ? 0 : result.status === 'rate-limited' ? this.serverRetryAt : checkedAt + Math.min(DAY, MINUTE * 15 * 2 ** (failures - 1));
    result.checkedAt = checkedAt;
    result.shouldNotify = result.status === 'available' && this.cache.ignoredVersion !== result.latestVersion && this.cache.notifiedVersion !== result.latestVersion;
    this.cache = { ...this.cache, checkedAt, failures, retryAt, result: { ...result, shouldNotify: false } };
    if (result.shouldNotify) this.cache.notifiedVersion = result.latestVersion;
    try { await this.saveCache(clone(this.cache)); } catch { /* Check/cache failures must never prevent editing. */ }
    if (!this.alive(generation, key) || (!manual && !this.getConfig().autoCheck)) return this.base('disabled', config);
    return result;
  }
  private async readRelease(raw: unknown, config: UpdateConfig, repo: string): Promise<UpdateResult> {
    const invalid = () => this.base('invalid-release', config);
    if (!record(raw) || raw.draft !== false || raw.prerelease !== false || typeof raw.tag_name !== 'string' || !Array.isArray(raw.assets) || raw.assets.length > 100) return invalid();
    const tag = raw.tag_name, latest = tag.replace(/^v/, '');
    if (!stable(latest) || !/^(?:v)?\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?$/.test(tag)) return invalid();
    const url = releaseURL(raw.html_url, repo, tag); if (!url) return invalid();
    const assets = new Map<string, Record<string, unknown>>();
    for (const asset of raw.assets) {
      if (!record(asset) || typeof asset.name !== 'string' || assets.has(asset.name) || !assetURL(asset.browser_download_url, repo, tag, asset.name)) return invalid();
      assets.set(asset.name, asset);
    }
    if (!assets.has('main.js') || !assets.has('manifest.json') || !assets.has('styles.css')) return invalid();
    const manifestAsset = assets.get('manifest.json')!;
    if (!finite(manifestAsset.size) || manifestAsset.size < 2 || manifestAsset.size > MAX_MANIFEST) return invalid();
    const manifestResponse = await this.get(assetURL(manifestAsset.browser_download_url, repo, tag, 'manifest.json')!, MAX_MANIFEST);
    const failure = this.httpFailure(manifestResponse, config); if (failure) return failure;
    const manifest: unknown = JSON.parse(manifestResponse.text);
    if (!record(manifest) || manifest.id !== config.pluginId || manifest.version !== latest || !stable(manifest.minAppVersion)) return invalid();
    const details = { latestVersion: latest, releaseUrl: url, minAppVersion: manifest.minAppVersion };
    const zip = [...assets.values()].find(asset => typeof asset.name === 'string' && /\.zip$/i.test(asset.name));
    const downloadUrl = zip ? assetURL(zip.browser_download_url, repo, tag, zip.name as string)! : undefined;
    if (compareVersions(latest, config.currentVersion)! <= 0) return { ...this.base('up-to-date', config), ...details };
    return { ...this.base(compareVersions(config.appVersion, manifest.minAppVersion)! < 0 ? 'incompatible' : 'available', config), ...details, ...(downloadUrl ? { downloadUrl } : {}) };
  }
}
