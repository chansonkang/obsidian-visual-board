import {readFile,writeFile,mkdir,cp,mkdtemp,rm,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stableVersion} from './version-bump.mjs';
import {normalizeRepository} from './configure-repository.mjs';

const execFileAsync=promisify(execFile);
export const runtimeFiles=['main.js','manifest.json','styles.css','LUCIDE-LICENSE.txt','PDFJS-LICENSE.txt','MARKDOWN-IT-LICENSE.txt','TURNDOWN-LICENSE.txt','TURNDOWN-GFM-LICENSE.txt'];
export async function verifyRelease(root,tag) {
  const json=async file=>JSON.parse(await readFile(path.join(root,file),'utf8'));
  const [manifest,pkg,lock,versions,source,built]=await Promise.all(['manifest.json','package.json','package-lock.json','versions.json','update-source.json','dist/manifest.json'].map(json));
  if(!stableVersion.test(manifest.version)||tag!==manifest.version)throw new Error('Release tag must exactly equal manifest.version (x.y.z, no v prefix).');
  if([pkg.version,lock.version,lock.packages?.['']?.version,built.version].some(version=>version!==manifest.version))throw new Error('Manifest, package, lockfile and built versions must match.');
  if(JSON.stringify(built)!==JSON.stringify(manifest))throw new Error('Built manifest is stale; rebuild before packaging.');
  if(versions[manifest.version]!==manifest.minAppVersion)throw new Error('versions.json must map this version to minAppVersion.');
  if(!/^[a-z0-9-]+$/.test(manifest.id))throw new Error('Invalid plugin id.');
  normalizeRepository(source.repository);
  for(const file of runtimeFiles) {
    const info=await stat(path.join(root,'dist',file));
    if(!info.isFile()||info.size===0)throw new Error('Missing or empty runtime asset: '+file);
  }
  return manifest;
}
export async function packageRelease(root,tag,output=path.join(root,'release')) {
  const manifest=await verifyRelease(root,tag);
  await mkdir(output,{recursive:true});
  const stage=await mkdtemp(path.join(os.tmpdir(),'visual-board-release-'));
  try {
    const folder=path.join(stage,manifest.id);
    await mkdir(folder);
    for(const file of runtimeFiles) {
      await cp(path.join(root,'dist',file),path.join(folder,file));
      await cp(path.join(root,'dist',file),path.join(output,file));
    }
    const repository=normalizeRepository(JSON.parse(await readFile(path.join(root,'update-source.json'),'utf8')).repository);
    const readme=(await readFile(path.join(root,'README.md'),'utf8'))
      .replace(/!\[([^\]]*)\]\((docs\/[^)]+)\)/g,(_match,label,file)=>`![${label}](https://raw.githubusercontent.com/${repository}/${tag}/${file})`)
      .replace(/\[([^\]]*)\]\((docs\/[^)]+|APIMART-SETUP\.md|PUBLISHING\.md)\)/g,(_match,label,file)=>`[${label}](https://github.com/${repository}/blob/${tag}/${file})`);
    await writeFile(path.join(folder,'README.md'),readme);
    const name='Visual-Board-v'+manifest.version+'-Chanson.zip';
    const target=path.resolve(output,name);
    await rm(target,{force:true});
    await execFileAsync('zip',['-X','-q','-r',target,manifest.id],{cwd:stage});
    const files=[...runtimeFiles,name];
    const sums=await Promise.all(files.map(async file=>createHash('sha256').update(await readFile(path.join(output,file))).digest('hex')+'  '+file));
    await writeFile(path.join(output,'SHA256SUMS.txt'),sums.join('\n')+'\n');
    return {version:manifest.version,zip:target,files:[...files,'SHA256SUMS.txt']};
  } finally {await rm(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    const tag=process.argv[2]||process.env.GITHUB_REF_NAME;
    if(process.argv.includes('--verify-only')){await verifyRelease(root,tag);console.log('Release metadata and runtime assets verified.');}
    else console.log(JSON.stringify(await packageRelease(root,tag)));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
