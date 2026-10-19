import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const stableVersion=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export async function bumpVersion(root,version) {
  if(!stableVersion.test(String(version)))throw new Error('Version must be x.y.z without a v prefix or prerelease suffix.');
  const names=['manifest.json','package.json','package-lock.json','versions.json'];
  const values=await Promise.all(names.map(async name=>JSON.parse(await readFile(path.join(root,name),'utf8'))));
  const [manifest,pkg,lock,versions]=values;
  if(!stableVersion.test(manifest.minAppVersion))throw new Error('manifest.minAppVersion must be x.y.z.');
  manifest.version=pkg.version=lock.version=version;
  if(!lock.packages?.[''])throw new Error('Expected a modern package-lock.json with packages[""] metadata.');
  lock.packages[''].version=version;
  versions[version]=manifest.minAppVersion;
  for(let i=0;i<names.length;i++)await writeFile(path.join(root,names[i]),JSON.stringify(values[i],null,2)+'\n');
  return version;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log('Version: '+await bumpVersion(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),process.argv[2]));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}
