import { Layout, sanitizeLayout } from './model';

export interface LayoutStamp { layout: Layout; layoutRevision: number; layoutSession: string }
/** Session-scoped immutable baselines. Expired/foreign frames must refresh, never overwrite. */
export class LayoutSync {
 readonly session = crypto.randomUUID();
 private revision = 0;
 private signature = '';
 private snapshots = new Map<number, { layout: Layout; nativeRevision: number; bytes: number }>();
 private bytes = 0;
 observe(layout: Layout, nativeRevision: number): LayoutStamp {
  const clean = sanitizeLayout(layout), signature = JSON.stringify(clean);
  if (signature !== this.signature) {
   this.signature = signature; this.revision++;
   this.snapshots.set(this.revision, { layout: clean, nativeRevision, bytes: signature.length * 2 });
   this.bytes += signature.length * 2;
   while (this.snapshots.size > 64 || this.bytes > 24 * 1024 * 1024 && this.snapshots.size > 2) {
    const key = this.snapshots.keys().next().value!; this.bytes -= this.snapshots.get(key)!.bytes; this.snapshots.delete(key);
   }
  }
  return { layout: JSON.parse(signature), layoutRevision: this.revision, layoutSession: this.session };
 }
 base(session: unknown, revision: unknown) {
  if (session !== this.session || typeof revision !== 'number' || !Number.isSafeInteger(revision)) return undefined;
  const saved = this.snapshots.get(revision);
  return saved ? { layout: sanitizeLayout(saved.layout), nativeRevision: saved.nativeRevision } : undefined;
 }
}
