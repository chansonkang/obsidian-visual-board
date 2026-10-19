import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stableVersion} from './version-bump.mjs';
import {normalizeRepository} from './configure-repository.mjs';

/** Keep the published description tied to the matching committed history section. */
export function extractReleaseSection(changelog,version) {
  if(!stableVersion.test(String(version)))throw new Error('Release version must be x.y.z without a v prefix.');
  const lines=String(changelog).replace(/\r\n/g,'\n').split('\n'),headings=[];
  let fence=null;
  for(let index=0;index<lines.length;index++) {
    const line=lines[index];
    if(fence) {
      const closing=line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if(closing&&closing[1][0]===fence[0]&&closing[1].length>=fence.length)fence=null;
      continue;
    }
    const opening=line.match(/^ {0,3}(`{3,}|~{3,})/);
    if(opening){fence=opening[1];continue;}
    if(/^##\s+/.test(line))headings.push({index,title:line.trim()});
  }
  const matches=headings.filter(item=>item.title==='## '+version+' 更新');
  if(matches.length!==1)throw new Error('Expected exactly one changelog section for '+version+'.');
  const start=matches[0].index,next=headings.find(item=>item.index>start)?.index??lines.length;
  const body=lines.slice(start+1,next).join('\n').trim();
  if(!body)throw new Error('Release changelog section is empty: '+version+'.');
  return {heading:matches[0].title,body};
}
export function createReleaseNotes(changelog,version,repository) {
  const repo=normalizeRepository(repository),section=extractReleaseSection(changelog,version),base='https://github.com/'+repo+'/blob/'+version+'/';
  // Relative links in CHANGELOG live below docs/. Release descriptions need absolute URLs.
  const body=section.body.replace(/(!?)\[([^\]]*)\]\(([^\s)]+)\)/g,(match,image,label,target)=>{
    if(/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target))return match;
    return image+'['+label+']('+new URL(target,base+'docs/CHANGELOG.md').href+')';
  });
  return section.heading+'\n\n'+body+'\n\n---\n\n'+
    '[产品介绍 / README]('+base+'README.md) · [完整更新记录 / Full changelog]('+base+'docs/CHANGELOG.md)\n';
}
export async function writeReleaseNotes(root,tag,output=path.join(root,'release','RELEASE-NOTES.md')) {
  const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
  if(tag!==manifest.version)throw new Error('Release notes tag must exactly equal manifest.version.');
  const source=JSON.parse(await readFile(path.join(root,'update-source.json'),'utf8'));
  const notes=createReleaseNotes(await readFile(path.join(root,'docs','CHANGELOG.md'),'utf8'),tag,source.repository);
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,notes);
  return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log('Release notes: '+await writeReleaseNotes(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),process.argv[2]||process.env.GITHUB_REF_NAME));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
