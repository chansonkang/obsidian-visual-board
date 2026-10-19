import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {normalizeRepository,configureRepository} from '../scripts/configure-repository.mjs';
import {bumpVersion} from '../scripts/version-bump.mjs';
import {verifyRelease,packageRelease,runtimeFiles} from '../scripts/release-package.mjs';

const run=promisify(execFile);
async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'vb-release-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'dist'));
  const manifest={id:'visual-board-test',version:'1.2.3',minAppVersion:'1.5.0',author:'Chanson'};
  const files={'manifest.json':manifest,'package.json':{version:'1.2.3'},'package-lock.json':{version:'1.2.3',packages:{'':{version:'1.2.3'}}},'versions.json':{'1.2.3':'1.5.0'},'update-source.json':{repository:'example/visual-board-test'}};
  for(const [name,value]of Object.entries(files))await writeFile(path.join(root,name),JSON.stringify(value));
  for(const file of runtimeFiles)await writeFile(path.join(root,'dist',file),file==='manifest.json'?JSON.stringify(manifest):'built '+file+'\n');
  await writeFile(path.join(root,'README.md'),'Installation: keep existing user data.');
  return root;
}
test('repository setup accepts GitHub repository URLs without accepting third-party or credential URLs',async t=>{
  assert.equal(normalizeRepository('https://github.com/Chanson/Visual-Board.git/'),'Chanson/Visual-Board');
  assert.equal(normalizeRepository('Chanson/Visual-Board'),'Chanson/Visual-Board');
  for(const bad of ['','https://github.com.evil.invalid/a/b','https://user:secret@github.com/a/b','http://github.com/a/b','a/b/../../c','https://github.com/a/b?token=secret','a/..'])assert.throws(()=>normalizeRepository(bad));
  const root=await fixture(t);
  await configureRepository(root,'https://github.com/Owner/NewRepo');
  assert.deepEqual(JSON.parse(await readFile(path.join(root,'update-source.json'))),{repository:'Owner/NewRepo'});
});
test('version preparation keeps existing compatibility history and updates all package metadata',async t=>{
  const root=await fixture(t);
  await bumpVersion(root,'1.2.4');
  const read=async name=>JSON.parse(await readFile(path.join(root,name),'utf8'));
  assert.equal((await read('manifest.json')).version,'1.2.4');
  assert.equal((await read('package.json')).version,'1.2.4');
  const lock=await read('package-lock.json');assert.equal(lock.version,'1.2.4');assert.equal(lock.packages[''].version,'1.2.4');
  assert.deepEqual(await read('versions.json'),{'1.2.3':'1.5.0','1.2.4':'1.5.0'});
  await assert.rejects(bumpVersion(root,'v1.2.5'),/x.y.z/);
});
test('release refuses v-prefixed tags, mismatched builds and incomplete runtime assets',async t=>{
  const root=await fixture(t);
  await verifyRelease(root,'1.2.3');
  await assert.rejects(verifyRelease(root,'v1.2.3'),/exactly/);
  await writeFile(path.join(root,'dist','manifest.json'),JSON.stringify({version:'1.2.2'}));
  await assert.rejects(verifyRelease(root,'1.2.3'),/versions must match/);
  await writeFile(path.join(root,'dist','manifest.json'),await readFile(path.join(root,'manifest.json')));
  await rm(path.join(root,'dist','LUCIDE-LICENSE.txt'));
  await assert.rejects(verifyRelease(root,'1.2.3'));
});
test('release ZIP is runtime-only and never carries local layouts, recovered drafts, keys or evidence',async t=>{
  const root=await fixture(t);
  for(const name of ['data.json','draft-recovery.json','.env','verification.json'])await writeFile(path.join(root,'dist',name),'PRIVATE_SENTINEL_DO_NOT_PUBLISH');
  await mkdir(path.join(root,'evidence'));await writeFile(path.join(root,'evidence','private.txt'),'PRIVATE_SENTINEL_DO_NOT_PUBLISH');
  const result=await packageRelease(root,'1.2.3');
  const entries=(await run('unzip',['-Z1',result.zip])).stdout.trim().split('\n').filter(name=>!name.endsWith('/'));
  assert.deepEqual(entries.sort(),[...runtimeFiles,'README.md'].map(file=>'visual-board-test/'+file).sort());
  for(const name of entries){const content=(await run('unzip',['-p',result.zip,name])).stdout;assert.ok(!content.includes('PRIVATE_SENTINEL'));}
  assert.match(await readFile(path.join(root,'release','SHA256SUMS.txt'),'utf8'),/Visual-Board-v1\.2\.3-Chanson\.zip/);
});
