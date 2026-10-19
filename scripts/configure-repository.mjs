import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function normalizeRepository(input) {
  let value=String(input||'').trim();
  if(value.startsWith('https://')) {
    const url=new URL(value);
    if(url.hostname!=='github.com'||url.port||url.username||url.password||url.search||url.hash)throw new Error('Use a public https://github.com/owner/repo URL without credentials, query, or fragment.');
    value=url.pathname.replace(/^\//,'').replace(/\/$/,'');
  }
  value=value.replace(/\.git$/,'');
  const parts=value.split('/');
  if(parts.length!==2||!/[a-z0-9]/i.test(parts[0])||!/[a-z0-9]/i.test(parts[1])||!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(parts[0])||!/^[a-z0-9._-]{1,100}$/i.test(parts[1])||['.','..'].includes(parts[1]))throw new Error('Repository must be owner/repo or https://github.com/owner/repo.');
  return parts.join('/');
}
export async function configureRepository(root,input) {
  const repository=normalizeRepository(input);
  await writeFile(path.join(root,'update-source.json'),JSON.stringify({repository},null,2)+'\n');
  return repository;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    console.log('Update repository: '+await configureRepository(root,process.argv[2]||process.env.GITHUB_REPOSITORY));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
