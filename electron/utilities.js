import { identifyInstalledMods } from './modIdentity.js';
import { performanceHealth, saveMemory } from './performance.js';
import { resolveJava, scanJava } from './javaManager.js';
import { checkMinecraftFiles } from './health.js';
import { app, shell, clipboard, nativeImage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { getInstanceDirectory, registeredDirectories } from './instanceManager.js';
import { resolveInside, safeSegment, assertNoSymlinks } from './pathSafety.js';
import { directorySize, copyNewDirectory, crashHints } from './localFiles.js';
import { getSettings, setDetectedJava } from './settings.js';
import { secureFetch, verifyBuffer } from './downloads.js';
import { validateModrinthVersion } from './contentValidation.js';
const plans = new Map();
let detectedJava = [];
let busy = false;
const api = 'https://api.modrinth.com/v2';
async function json(url, options) { const response = await secureFetch(url, options); if (!response.ok) throw new Error('Modrinth is unavailable. Try again later.'); return response.json(); }
async function hash(file) { const digest = crypto.createHash('sha1'); for await (const chunk of createReadStream(file)) digest.update(chunk); return digest.digest('hex'); }
export const utilitiesBusy = () => busy;
async function open(file) { const error = await shell.openPath(file); if (error) throw new Error('The desktop could not open this location.'); }
const backupsRoot = () => assertNoSymlinks(path.join(app.getPath('userData'), 'world-backups'));
async function backup(root, instance, world, progress) {
    safeSegment(world, 'world folder');
    const parent = resolveInside(backupsRoot(), instance.id);
    await fs.mkdir(parent, { recursive: true });
    const id = `${Date.now()}-${crypto.randomUUID()}`;
    const destination = resolveInside(parent, id);
    const staging = destination + '.partial';
    await fs.mkdir(staging);
    try {
        await copyNewDirectory(resolveInside(root, `saves/${world}`), path.join(staging, 'world'), progress);
        await fs.writeFile(path.join(staging, 'backup.json'), JSON.stringify({ format: 'novex-world-v1', world, createdAt: Date.now() }));
        await fs.rename(staging, destination);
    } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
    return { message: 'World backed up. Backups are local folders; the original world was not changed.', entries: [] };
}
async function modUpdates(root, instance) {
    const mods = resolveInside(root, 'mods');
    const files = (await fs.readdir(mods).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).filter(name => name.endsWith('.jar'));
    if (files.length > 500) throw new Error('Check at most 500 mods at a time.');
    const hashes = [];
    for (const name of files) hashes.push(await hash(resolveInside(mods, name)));
    if (!files.length) return { entries: [], message: 'No mod JARs found.' };
    const identified = await json(`${api}/version_files`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({hashes,algorithm:'sha1'}) });
    const versions = hashes.map(value => identified[value]).filter(Boolean);
    const entries = [];
    for (let i=0;i<files.length;i++) {
        const current = identified[hashes[i]];
        if (!current) { entries.push({name:files[i],detail:'Unknown / update check unavailable'}); continue; }
        const duplicate = versions.filter(v => v.project_id === current.project_id).length > 1;
        const query = new URLSearchParams({ game_versions:JSON.stringify([instance.minecraftVersion]),loaders:JSON.stringify([instance.loader]) });
        const available = await json(`${api}/project/${encodeURIComponent(current.project_id)}/version?${query}`);
        const latest = available.find(v => v.version_type === 'release') || available[0];
        let detail = `Modrinth · ${current.version_number} · ${instance.minecraftVersion} / ${instance.loader}`;
        if (!current.game_versions?.includes(instance.minecraftVersion) || !current.loaders?.includes(instance.loader)) detail += ' · Warning: installed file compatibility mismatch';
        const missingCurrent = (current.dependencies || []).filter(d=>d.dependency_type==='required' && !versions.some(v=>d.version_id?v.id===d.version_id:v.project_id===d.project_id));
        if(missingCurrent.length) detail += ` · ${missingCurrent.length} required dependencies not identified`;
        if (duplicate) detail += ' · Possible duplicate project';
        let updateId;
        if (latest && latest.id !== current.id && Date.parse(latest.date_published) > Date.parse(current.date_published)) {
            validateModrinthVersion(latest,current.project_id,instance.minecraftVersion,instance.loader);
            const missing = (latest.dependencies || []).filter(d => d.dependency_type === 'required' && !versions.some(v => d.version_id ? v.id === d.version_id : v.project_id === d.project_id));
            detail += ` → ${latest.version_number}`;
            if (missing.length) detail += ` · ${missing.length} required dependencies need installation first`;
            else if (versions.some(v => (v.dependencies || []).some(d => d.dependency_type === 'required' && d.version_id === current.id))) detail += ' · Another installed mod requires this exact version';
            else if (!duplicate) { updateId=crypto.randomUUID(); plans.set(updateId,{ root,filename:files[i],hash:hashes[i],latest,instance, dependencies: files.map((name,index)=>({name,hash:hashes[index]})).filter((_,index)=>(latest.dependencies || []).some(d=>d.dependency_type === 'required' && (d.version_id ? identified[hashes[index]]?.id === d.version_id : identified[hashes[index]]?.project_id === d.project_id))) }); }
        }
        entries.push({name:files[i],detail,updateId});
    }
    return { entries, message:`${entries.filter(e=>e.updateId).length} compatible updates ready. Unknown files are never guessed from their names.` };
}
async function updateMod(root, id, instance) {
    const plan = plans.get(id);
    if (!plan || plan.root !== root || plan.instance.minecraftVersion !== instance.minecraftVersion || plan.instance.loader !== instance.loader) throw new Error('Check for updates again before updating.');
    for (const dependency of plan.dependencies) { if(await hash(resolveInside(root, `mods/${dependency.name}`)) !== dependency.hash) throw new Error('A required dependency changed. Check updates again.'); }
    const current = resolveInside(root, `mods/${plan.filename}`);
    if (await hash(current) !== plan.hash) throw new Error('The installed mod changed. Check updates again.');
    const latest = await json(`${api}/version/${encodeURIComponent(plan.latest.id)}`);
    validateModrinthVersion(latest,plan.latest.project_id,plan.instance.minecraftVersion,plan.instance.loader);
    if (JSON.stringify(latest.dependencies) !== JSON.stringify(plan.latest.dependencies)) throw new Error('Dependency metadata changed. Check updates again.');
    const file = latest.files.find(f=>f.primary) || latest.files[0];
    safeSegment(file?.filename, 'mod filename');
    if(!file.filename.toLowerCase().endsWith('.jar')) throw new Error('This update is not a mod JAR.');
    if (!file.hashes?.sha512 && !file.hashes?.sha1) throw new Error('This update has no supported integrity hash.');
    const target = resolveInside(root, `mods/${file.filename}`);
    if (target !== current && await fs.stat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;})) throw new Error('The target mod file already exists. Review duplicate mods first.');
    const response=await secureFetch(file.url); if(!response.ok) throw new Error('Mod download failed. The installed mod is unchanged.');
    const data=verifyBuffer(Buffer.from(await response.arrayBuffer()),file.hashes);
    const temporary=resolveInside(root,`mods/.novex-${crypto.randomUUID()}.tmp`);
    const old=resolveInside(root,`.novex-mod-backups/${crypto.randomUUID()}-${plan.filename}`);
    await fs.mkdir(path.dirname(old),{recursive:true});
    await fs.writeFile(temporary,data,{flag:'wx'});
    try {
        // Recheck after the network request, before touching the old file.
        if(await hash(current)!==plan.hash) throw new Error('The installed mod changed during download.');
        await fs.rename(current,old);
        try { await fs.link(temporary,target); } catch(error) { await fs.rename(old,current); throw error; }
    } finally { await fs.rm(temporary,{force:true}); }
    plans.delete(id);
    return {entries:[],message:'Mod updated. The previous file is retained in .novex-mod-backups.'};
}
async function health(root, instance) {
    const entries=[];
    if (!(await fs.stat(root).catch(()=>null))?.isDirectory()) return {entries:[{name:'Instance directory',detail:'Missing — restore or repair this instance.'}]};
    let required=null;
    try {const data=JSON.parse(await fs.readFile(resolveInside(root,`versions/${safeSegment(instance.minecraftVersion)}/${instance.minecraftVersion}.json`),'utf8'));required=data.javaVersion?.majorVersion || 8;entries.push({name:'Minecraft metadata',detail:'Found'});}
    catch {entries.push({name:'Minecraft metadata',detail:'Missing or unreadable. Reinstall/repair the instance.'});}
    try {const java=required ? await resolveJava(required,root) : (await scanJava())[0];if(!java)throw new Error('Java was not found. Select an installation in Settings.');entries.push({name:'Java',detail:`Java ${java.major} detected · ${required ? 'recommended '+required : 'recommendation unavailable until Minecraft metadata is installed'} · ${java.path}`});}catch(error){entries.push({name:'Java',detail:error.message});}
    for(const name of ['installation.json',`versions/${instance.minecraftVersion}/${instance.minecraftVersion}.jar`,'libraries','assets']) entries.push({name,detail:await fs.stat(resolveInside(root,name)).catch(()=>null)?'Found':'Missing — installation may be incomplete.'});
    try {entries.push(...await checkMinecraftFiles(root,instance.minecraftVersion));}catch(error){entries.push({name:'Minecraft integrity',detail:error.message});}
    entries.push(...(await performanceHealth(root,instance)).entries);
    entries.push({name:'Mod compatibility',detail:'Use Check Mod Updates for exact hash identification and duplicate projects. Unknown mods cannot be validated offline.'});
    return {entries};
}
async function crash(root) {
    const directory=resolveInside(root,'crash-reports');
    const reports=await fs.readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    let newest;
    for(const name of reports.filter(n=>n.endsWith('.txt'))) {const file=resolveInside(directory,name),stat=await fs.stat(file);if(!newest||stat.mtimeMs>newest.time)newest={file,time:stat.mtimeMs};}
    let text='';
    for(const file of [resolveInside(root,'logs/latest.log'),newest?.file].filter(Boolean)) {
        const handle=await fs.open(file,'r').catch(()=>null);if(!handle)continue;
        try {const size=(await handle.stat()).size;const buffer=Buffer.alloc(Math.min(size,1024*1024));await handle.read(buffer,0,buffer.length,Math.max(0,size-buffer.length));text+='\n'+buffer.toString();}finally{await handle.close();}
    }
    return {entries:crashHints(text),message:'Possible causes only; no logs are uploaded. View the full log to confirm.'};
}
export async function runUtility(action, instance, input, { progress, running }) {
    if (busy) throw new Error('Another utility operation is running. Please wait.');
    busy=true;
    try {
        if (typeof action!=='string' || !input || typeof input!=='object') throw new Error('Invalid utility request.');
        if(instance){safeSegment(instance.minecraftVersion,'Minecraft version');if(!['vanilla','fabric','forge','neoforge','quilt'].includes(instance.loader))throw new Error('Invalid loader.');}
        const root=instance ? await getInstanceDirectory(instance) : null;
        if (['clone','backup','update','updates','project-update','restore'].includes(action) && running()) throw new Error('Stop Minecraft before copying worlds or changing mods.');
        if(action==='java') {detectedJava=await scanJava(true);return {entries:detectedJava.map(j=>({name:`Java ${j.major}`,detail:j.path,id:j.path}))};}
        if(action==='java-select') {const match=detectedJava.find(j=>j.path===input.id);if(!match)throw new Error('Refresh Java detection first.');await setDetectedJava(match.path);return {entries:[],message:'Java selection saved for the launcher.'};}
        if(action==='storage') {const settings=await getSettings();const dirs=await registeredDirectories();let total=0;const categories={mods:0,saves:0,screenshots:0};for(const dir of dirs){total+=await directorySize(dir);for(const key of Object.keys(categories))categories[key]+=await directorySize(resolveInside(dir,key));}return {entries:[{name:'Instances (total)',detail:settings.instancesDirectory,size:total},...Object.entries(categories).map(([name,size])=>({name,detail:'Included in instance total',size})),{name:'World backups',detail:backupsRoot(),size:await directorySize(backupsRoot())},{name:'Verified download cache',detail:path.join(settings.dataDirectory,'downloads'),size:await directorySize(path.join(settings.dataDirectory,'downloads'))},{name:'Managed Java',detail:path.join(settings.dataDirectory,'runtimes'),size:await directorySize(path.join(settings.dataDirectory,'runtimes'))},{name:'Browser cache',detail:settings.browserCacheDirectory,size:await directorySize(settings.browserCacheDirectory)},{name:'Novex application data',detail:settings.dataDirectory,size:await directorySize(settings.dataDirectory)}],message:'Approximate sizes; categories overlap. Instance downloads remain within instance totals. No cleanup is performed.'};}
        if(action==='storage-open') {const settings=await getSettings();const choices={instances:settings.instancesDirectory,data:settings.dataDirectory,backups:backupsRoot()};if(!Object.hasOwn(choices,input.id))throw new Error('Invalid storage location.');await fs.mkdir(assertNoSymlinks(choices[input.id]),{recursive:true});await open(choices[input.id]);return {entries:[]};}
        if(action==='servers-list'||action==='servers-save') {
            const file=assertNoSymlinks(path.join(app.getPath('userData'),'personal-servers.json'));
            await fs.mkdir(app.getPath('userData'),{recursive:true});
            assertNoSymlinks(file+'.tmp');
            if(action==='servers-save') {if(!Array.isArray(input.entries)||input.entries.length>100)throw new Error('At most 100 servers.');const entries=input.entries.map(row=>{if(typeof row.name!=='string'||!row.name.trim()||row.name.length>100||typeof row.address!=='string'||!/^([a-z0-9.-]+)(:[0-9]{1,5})?$/i.test(row.address)||row.address.length>253||(row.address.includes(':')&&(Number(row.address.split(':')[1])<1||Number(row.address.split(':')[1])>65535))||typeof row.notes!=='string'||row.notes.length>2000)throw new Error('Enter a valid server name, address and notes.');return {name:row.name,address:row.address,notes:row.notes};});await fs.writeFile(file+'.tmp',JSON.stringify(entries),{mode:0o600});await fs.rename(file+'.tmp',file);}
            let entries=[];try{entries=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}return {entries:entries.map((r,i)=>({...r,id:String(i),detail:r.address}))};
        }
        if(!root)throw new Error('Select an instance.');
        if(action==='clone') {const copy={id:crypto.randomUUID(),name:(instance.name+' Copy').slice(0,150),minecraftVersion:instance.minecraftVersion,loader:instance.loader,loaderVersion:instance.loaderVersion,createdAt:Date.now()};const destination=await getInstanceDirectory(copy);await copyNewDirectory(root,destination,progress);await fs.writeFile(resolveInside(destination,'instance.json'),JSON.stringify(copy));return {entries:[],instance:copy,message:'Instance cloned into a new directory.'};}
        if(action==='memory-save'){if(running())throw new Error('Stop Minecraft before changing memory.');await saveMemory(root,input.heapMiB);return {entries:[],message:'Memory saved for the next launch.'};}
        if(action==='performance'){const result=await performanceHealth(root,instance);result.entries.push(...(await crash(root)).entries);return result;}
        if(action==='health')return await health(root,instance);
        if(action==='crash')return await crash(root);
        if(action==='project-update'){
            if(typeof input.projectId!=='string'||typeof input.versionId!=='string'||!/^[a-zA-Z0-9]{1,80}$/.test(input.projectId)||!/^[a-zA-Z0-9]{1,80}$/.test(input.versionId))throw new Error('Invalid project version.');
            const installed=await identifyInstalledMods(root);
            const matches=installed.filter(item=>item.version.project_id===input.projectId);
            if(matches.length!==1||!matches[0].enabled)throw new Error('Enable the mod and resolve duplicate versions before updating.');
            const current=matches[0],latest=await json(`${api}/version/${input.versionId}`);
            validateModrinthVersion(latest,input.projectId,instance.minecraftVersion,instance.loader);
            if(installed.some(item=>(item.version.dependencies||[]).some(d=>d.dependency_type==='required'&&d.version_id===current.version.id)))throw new Error('Another installed mod requires this exact version.');
            const dependencies=(latest.dependencies||[]).filter(d=>d.dependency_type==='required');
            if(dependencies.some(d=>!installed.some(item=>item.enabled&&(d.version_id?item.version.id===d.version_id:item.version.project_id===d.project_id))))throw new Error('Install the required compatible dependencies first using the Dependencies tab.');
            const id=crypto.randomUUID();plans.set(id,{root,filename:current.name,hash:current.hash,latest,instance,dependencies:installed.filter(item=>dependencies.some(d=>d.version_id?item.version.id===d.version_id:item.version.project_id===d.project_id)).map(item=>({name:item.name,hash:item.hash}))});
            return updateMod(root,id,instance);
        }
        if(action==='updates'){plans.clear();return await modUpdates(root,instance);}
        if(action==='update')return await updateMod(root,input.id,instance);
        if(action==='worlds') {const saves=resolveInside(root,'saves');const entries=[];for(const item of await fs.readdir(saves,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){if(!item.isDirectory()||item.isSymbolicLink())continue;const folder=resolveInside(saves,item.name);entries.push({name:item.name,detail:new Date((await fs.stat(folder)).mtimeMs).toLocaleString(),size:await directorySize(folder)});}return {entries};}
        if(action==='backup')return await backup(root,instance,input.name,progress);
        if(action==='world-open') {await open(resolveInside(root,`saves/${safeSegment(input.name)}`));return {entries:[]};}
        if(action==='screenshots') {const directory=resolveInside(root,'screenshots');const names=(await fs.readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;})).filter(n=>/\.(png|jpe?g)$/i.test(n)).sort().reverse();const offset=Number.isSafeInteger(input.offset)&&input.offset>=0?input.offset:0;const entries=[];for(const name of names.slice(offset,offset+20)){const file=resolveInside(directory,name);const stat=await fs.stat(file);if(!stat.isFile())continue;let image=null;if(stat.size<=20*1024*1024){try{image=typeof nativeImage.createThumbnailFromPath==='function'?await nativeImage.createThumbnailFromPath(file,{width:240,height:160}):nativeImage.createFromPath(file).resize({width:240});}catch{/* Show filename if the OS cannot decode this image. */}}entries.push({name,detail:new Date(stat.mtimeMs).toLocaleString(),image:image && !image.isEmpty() ? image.toDataURL() : undefined});}return {entries,total:names.length};}
        if(['screenshot-open','screenshot-delete','screenshot-copy'].includes(action)){safeSegment(input.name);if(!/\.(png|jpe?g)$/i.test(input.name))throw new Error('Invalid screenshot.');const file=resolveInside(root,`screenshots/${input.name}`);if(action==='screenshot-delete')await fs.unlink(file);else if(action==='screenshot-copy')clipboard.writeText(file);else await open(file);return {entries:[]};}
        if(action==='screenshots-open') {await open(resolveInside(root,'screenshots'));return {entries:[]};}
        if(action==='log-open'){await open(resolveInside(root,'logs/latest.log'));return {entries:[]};}
        if(action==='crash-open'){await open(resolveInside(root,'crash-reports'));return {entries:[]};}
        throw new Error('Unknown utility action.');
    } finally {busy=false;}
}
