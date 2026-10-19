import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {extractReleaseSection,createReleaseNotes,writeReleaseNotes} from '../scripts/release-notes.mjs';

test('release descriptions use only the exact matching version and preserve its full text',()=>{
  const history='# History\n\n## 0.1.27 更新\n\nCurrent first paragraph.\n\n- Every detail is retained.\n- [配置](../PUBLISHING.md)\n\n## 0.1.26 更新\n\nPrevious version details.\n';
  const result=createReleaseNotes(history,'0.1.27','example/visual-board');
  assert.ok(result.includes('Current first paragraph.\n\n- Every detail is retained.'));
  assert.ok(!result.includes('Previous version details.'));
  assert.ok(result.includes('[配置](https://github.com/example/visual-board/blob/0.1.27/PUBLISHING.md)'));
  assert.ok(result.includes('[完整更新记录 / Full changelog](https://github.com/example/visual-board/blob/0.1.27/docs/CHANGELOG.md)'));
  assert.ok(result.includes('[产品介绍 / README](https://github.com/example/visual-board/blob/0.1.27/README.md)'));
});
test('fenced examples cannot create fake version boundaries',()=>{
  const history='## 0.1.27 更新\n\nBefore.\n\n```md\n## 0.1.27 更新\n## 0.1.1 更新\n```\n\nAfter.\n\n## 0.1.26 更新\n\nOld.';
  assert.ok(extractReleaseSection(history,'0.1.27').body.endsWith('After.'));
});
test('missing, duplicate and empty changelog sections stop a release instead of publishing the wrong notes',()=>{
  assert.throws(()=>extractReleaseSection('## 0.1.26 更新\nold','0.1.27'),/exactly one/);
  assert.throws(()=>extractReleaseSection('## 0.1.27 更新\none\n## 0.1.27 更新\ntwo','0.1.27'),/exactly one/);
  assert.throws(()=>extractReleaseSection('## 0.1.27 更新\n\n## 0.1.26 更新\nold','0.1.27'),/empty/);
  assert.throws(()=>extractReleaseSection('## 0.1.27 更新\ncurrent','v0.1.27'),/x.y.z/);
});
test('notes writer validates manifest version and leaves committed history unchanged',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vb-notes-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'docs'));
  await writeFile(path.join(root,'manifest.json'),JSON.stringify({version:'0.1.27'}));
  await writeFile(path.join(root,'update-source.json'),JSON.stringify({repository:'example/visual-board'}));
  const history='## 0.1.27 更新\n\nActual notes.\n';await writeFile(path.join(root,'docs','CHANGELOG.md'),history);
  await assert.rejects(writeReleaseNotes(root,'0.1.26'),/manifest/);
  const file=await writeReleaseNotes(root,'0.1.27');assert.ok((await readFile(file,'utf8')).includes('Actual notes.'));
  assert.equal(await readFile(path.join(root,'docs','CHANGELOG.md'),'utf8'),history);
});
