import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createReadStream} from 'node:fs';
import {contentFolders,contentPath,listContent,toggleContent,replacePackSelection,shaderSupport} from './contentConfig.js';
import {resolveInside,safeSegment} from './pathSafety.js';
import {identifyInstalledMods} from './modIdentity.js';
import {secureFetch} from './downloads.js';
import {downloadToFile,transferContext} from './transfer.js';
import {validateModrinthVersion} from './contentValidation.js';
const plans=new Map(),metadata=new Map();
async function json(route){const response=await secureFetch('https://api.modrinth.com/v2/'+route);if(!response.ok)throw new Error('Modrinth is unavailable. Installed files remain unchanged.');return response.json();}
async function hash(file){const value=crypto.createHash('sha1');for await(const chunk of createReadStream(file))value.update(chunk);return value.digest('hex');}
function key(root,kind){return root+'\0'+kind;}
export async function contentList(root,kind){const result=await listContent(root,kind);const cached=metadata.get(key(root,kind))||[];return {...result,items:result.items.map(item=>({...cached.find(c=>c.name===item.name),...item}))};}
export async function checkContent(root,kind,instance){const local=await listContent(root,kind);const installed=await identifyInstalledMods(root,contentFolders[kind]);const rows=[];
for(const item of local.items){const identity=installed.find(i=>i.name===item.name);if(!identity){rows.push({...item,detail:'Unknown — update check unavailable'});continue;}
const version=identity.version;const project=await json(`project/${encodeURIComponent(version.project_id)}`);if(project.project_type!==kind){rows.push({...item,detail:'Project type differs from this folder; update unavailable.'});continue;}
const query=new URLSearchParams({game_versions:JSON.stringify([instance.minecraftVersion]),...(kind==='mod'?{loaders:JSON.stringify([instance.loader])}:{})});
const available=await json(`project/${encodeURIComponent(version.project_id)}/version?${query}`);const latest=available.find(v=>v.version_type==='release'&&v.game_versions?.includes(instance.minecraftVersion)&&(kind!=='mod'||v.loaders?.includes(instance.loader))&&(kind!=='shader'||!local.supported||v.loaders?.includes('iris')));
const row={...item,title:project.title,icon:typeof project.icon_url==='string'&&project.icon_url.startsWith('https://')?project.icon_url:undefined,projectId:version.project_id,version:version.version_number,versionId:version.id,detail:`${version.game_versions?.join(', ')} · ${version.loaders?.join(', ')}`,incompatible:!version.game_versions?.includes(instance.minecraftVersion)||(kind==='mod'&&!version.loaders?.includes(instance.loader))||(kind==='shader'&&local.supported&&!version.loaders?.includes('iris'))};
if(latest&&latest.id!==version.id&&Date.parse(latest.date_published)>Date.parse(version.date_published)){
 validateModrinthVersion(latest,version.project_id,instance.minecraftVersion,kind==='mod'?instance.loader:undefined);
 if(installed.filter(i=>i.version.project_id===version.project_id).length!==1)row.detail+=' · Resolve duplicate project versions first';
 else {const id=crypto.randomUUID();plans.set(id,{root,kind,instance,filename:item.name,hash:identity.hash,current:version,latest});row.updateId=id;row.nextVersion=latest.version_number;}
}rows.push(row);}
if(plans.size>5000){plans.clear();throw new Error('Too many update plans. Check this instance again.');}metadata.set(key(root,kind),rows);return {...local,items:rows};}
export function getContentPlans(root,kind,ids){if(!Array.isArray(ids)||!ids.length||ids.length>500||new Set(ids).size!==ids.length)throw new Error('Choose unique updates.');return ids.map(id=>{const plan=plans.get(id);if(!plan||plan.root!==root||plan.kind!==kind)throw new Error('Check updates again.');return {...plan,id};});}
export async function applyContentUpdate(plan){const {root,kind,instance,filename,current}=plan;const source=contentPath(root,kind,filename);if(await hash(source)!==plan.hash)throw new Error('Installed content changed. Check updates again.');
 const latest=await json(`version/${encodeURIComponent(plan.latest.id)}`);validateModrinthVersion(latest,current.project_id,instance.minecraftVersion,kind==='mod'?instance.loader:kind==='shader'&&await shaderSupport(root)?'iris':undefined);
 if(kind==='mod'){
 const installed=await identifyInstalledMods(root);if(installed.filter(i=>i.version.project_id===current.project_id).length!==1)throw new Error('Resolve duplicate mod versions first.');
 if(installed.some(i=>i.enabled&&i.version.id!==current.id&&(i.version.dependencies||[]).some(d=>d.dependency_type==='required'&&d.version_id===current.id)))throw new Error('Another enabled mod requires this exact version.');
 for(const dep of (latest.dependencies||[]).filter(d=>d.dependency_type==='required'))if(!installed.some(i=>i.enabled&&(dep.version_id?i.version.id===dep.version_id:i.version.project_id===dep.project_id)&&i.version.game_versions?.includes(instance.minecraftVersion)&&i.version.loaders?.includes(instance.loader)))throw new Error('Install compatible required dependencies first using the project Dependencies tab.');
 }
 const file=latest.files?.find(f=>f.primary)||latest.files?.[0];safeSegment(file?.filename,'download filename');if(!file.filename.toLowerCase().endsWith(kind==='mod'?'.jar':'.zip'))throw new Error('Unexpected content file type.');
 const targetName=file.filename+(kind==='mod'&&filename.endsWith('.disabled')?'.disabled':'');const target=contentPath(root,kind,targetName);if(target!==source&&await fs.stat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;}))throw new Error('Target filename already exists.');
 const temporary=resolveInside(root,`.novex-content-downloads/${crypto.randomUUID()}`),backup=resolveInside(root,`.novex-mod-backups/${crypto.randomUUID()}-${filename}`);await fs.mkdir(path.dirname(backup),{recursive:true});
 try{await downloadToFile(file.url,temporary,{hashes:file.hashes,size:file.size});transferContext.getStore()?.signal?.throwIfAborted();if(await hash(source)!==plan.hash)throw new Error('Installed file changed during download.');await fs.rename(source,backup);let linked=false;try{await fs.link(temporary,target);linked=true;if(kind!=='mod')await replacePackSelection(root,kind,filename,targetName);}catch(error){if(linked)await fs.rm(target,{force:true});await fs.link(backup,source).catch(()=>{});throw error;}}
 finally{await fs.rm(temporary,{force:true});}plans.delete(plan.id);metadata.delete(key(root,kind));
}
export async function changeContent(root,kind,names,enabled){if(!Array.isArray(names)||!names.length||names.length>500||new Set(names).size!==names.length)throw new Error('Select installed content.');if(kind==='shader'&&enabled&&names.length>1)throw new Error('Only one shader can be selected.');for(const name of names)await toggleContent(root,kind,name,enabled);}
export async function deleteContent(root,kind,names){if(!Array.isArray(names)||!names.length||names.length>500||new Set(names).size!==names.length)throw new Error('Select installed content.');const list=await listContent(root,kind);for(const name of names){if(!list.items.some(i=>i.name===name))throw new Error('Content is not installed.');contentPath(root,kind,name);}for(const name of names){const item=list.items.find(i=>i.name===name);if(item.enabled)await toggleContent(root,kind,name,false);await fs.rm(contentPath(root,kind,name),{recursive:!!item.directory});}metadata.delete(key(root,kind));}
