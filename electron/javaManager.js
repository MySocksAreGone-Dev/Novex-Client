import { app, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractRuntime } from './runtimeArchive.js';
import { listJava, discoverJava } from './platform.js';
import { secureFetch } from './downloads.js';
import { downloadToFile, checkSpace, transferContext } from './transfer.js';
import { getSettings } from './settings.js';
import { resolveInside, safeSegment } from './pathSafety.js';
const runtimeRoot = () => path.join(app.getPath('userData'), 'runtimes');
let scanned, scanTime=0;
const pending=new Map();
export async function scanJava(force=false) {
    if (!force && scanned && Date.now()-scanTime<300000) return scanned;
    const managed=[];
    for (const dir of await fs.readdir(runtimeRoot()).catch(()=>[])) {
        if (!/^java-\d+$/.test(dir)) continue;
        const root=path.join(runtimeRoot(),dir);
        for (const home of await fs.readdir(root).catch(()=>[])) {
            const binary=path.join(root,home,'bin',process.platform==='win32'?'java.exe':'java');
            managed.push(...(await listJava(binary,true)).map(j=>({...j,source:'Novex Managed'})));
        }
    }
    scanned=[...managed,...(await listJava((await getSettings()).javaPath)).map(j=>({...j,source:'System'}))];
    scanTime=Date.now(); return scanned;
}
export async function requiredJava(version, directory) {
    safeSegment(version,'Minecraft version');
    if(directory) {
        try {const data=JSON.parse(await fs.readFile(resolveInside(directory,`versions/${version}/${version}.json`),'utf8'));return data.javaVersion?.majorVersion || 8;}
        catch(error) { if(error.code!=='ENOENT' && !(error instanceof SyntaxError)) throw error; }
    }
    const manifest=await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const entry=manifest.versions.find(v=>v.id===version);
    if(!entry)throw new Error('Minecraft version not found in the official manifest.');
    const response=await secureFetch(entry.url,{signal:AbortSignal.timeout(15000)}); if(!response.ok)throw new Error('Minecraft metadata is unavailable.');
    const buffer=Buffer.from(await response.arrayBuffer());
    if(crypto.createHash('sha1').update(buffer).digest('hex')!==entry.sha1)throw new Error('Minecraft metadata verification failed.');
    return JSON.parse(buffer).javaVersion?.majorVersion || 8;
}
async function json(url) {const response=await secureFetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`${new URL(url).hostname}: HTTP ${response.status}. Try again when the service is available.`);return response.json();}
export async function javaSelection(directory) {
    try { return JSON.parse(await fs.readFile(resolveInside(directory,'.novex-java.json'),'utf8')).path || ''; }
    catch(error) {if(error.code==='ENOENT')return '';throw new Error('Instance Java settings are unreadable. Choose Java again.');}
}
export async function chooseInstanceJava(directory, automatic) {
    let selected='';
    if(!automatic) {
        const result=await dialog.showOpenDialog({title:'Choose Java',properties:['openFile']});
        if(result.canceled)return;
        selected=result.filePaths[0];
        if(!/^(java|javaw\.exe|java\.exe)$/i.test(path.basename(selected)) || !(await listJava(selected,true)).length)throw new Error('Choose a working 64-bit Java executable.');
    }
    await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(resolveInside(directory,'.novex-java.json'),JSON.stringify({path:selected}));
}
export async function resolveJava(required, directory, allowDownload=false) {
    const settings=await getSettings();
    const custom=directory ? await javaSelection(directory) : '';
    if(custom || settings.javaPath) return {...await discoverJava(custom || settings.javaPath,required),source:'Custom'};
    const found=(await scanJava()).find(j=>j.major===required);
    if(found)return found;
    if(allowDownload && settings.automaticJava) return installJava(required);
    const error=new Error(`Java ${required} (64-bit) is required. Install Java ${required} or choose a compatible runtime.`);error.code='JAVA_REQUIRED';throw error;
}
export function installJava(major) {
    if(!Number.isInteger(major)||major<8||major>99)throw new Error('Invalid Java major version.');
    if(!pending.has(major)) pending.set(major,downloadJava(major).finally(()=>pending.delete(major)));
    return pending.get(major);
}
async function downloadJava(major) {
    if(process.arch!=='x64'||!['win32','linux'].includes(process.platform))throw new Error('Managed Java currently supports Windows and Linux x64. Choose a custom runtime.');
    const existing=(await scanJava(true)).find(j=>j.major===major && j.source==='Novex Managed');if(existing)return existing;
    const os=process.platform==='win32'?'windows':'linux';
    const assets=await json(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&image_type=jre&os=${os}&vendor=eclipse`);
    const asset=assets.find(a=>a.binary?.os===os&&a.binary?.architecture==='x64'&&a.version?.major===major);
    const pkg=asset?.binary?.package;
    if(!pkg || !/^[a-f0-9]{64}$/i.test(pkg.checksum)||!Number.isSafeInteger(pkg.size)||pkg.size>512*1048576)throw new Error(`A trusted Java ${major} runtime is not available for this system.`);
    const url=new URL(pkg.link);
    if(url.protocol!=='https:'||url.hostname!=='github.com'||!url.pathname.startsWith('/adoptium/'))throw new Error('Unexpected Java download source.');
    const base=runtimeRoot();await fs.mkdir(base,{recursive:true});await checkSpace(base,pkg.size*5);
    const temporary=await fs.mkdtemp(path.join(base,'.install-'));
    try {
        const archive=path.join(temporary,os==='windows'?'runtime.zip':'runtime.tar.gz');
        await downloadToFile(pkg.link,archive,{hashes:{sha256:pkg.checksum},size:pkg.size});
        const extracted=path.join(temporary,'runtime');await fs.mkdir(extracted);
        await extractRuntime(archive,extracted,os==='windows'?'zip':'tar');
        const homes=await fs.readdir(extracted);
        if(homes.length!==1)throw new Error('Unexpected Java runtime layout.');
        const binary=resolveInside(extracted,`${homes[0]}/bin/${os==='windows'?'java.exe':'java'}`);
        const validated=await discoverJava(binary,major);
        transferContext.getStore()?.signal?.throwIfAborted();
        const destination=path.join(base,`java-${major}`);
        // Never replace an existing runtime tree silently.
        if(await fs.stat(destination).catch(()=>null))await fs.rename(destination,path.join(base,`.replaced-${major}-${crypto.randomUUID()}`));
        await fs.rename(extracted,destination);
        scanned=null;
        return {...validated,path:path.join(destination,homes[0],'bin',os==='windows'?'java.exe':'java'),source:'Novex Managed'};
    } finally {await fs.rm(temporary,{recursive:true,force:true});}
}
export async function useDetectedJava(directory,selected) {
    if(typeof selected!=='string'||selected.length>4096)throw new Error('Invalid Java selection.');
    if(selected && !(await scanJava()).some(java=>java.path===selected))throw new Error('Choose a detected Java runtime. Scan again if it moved.');
    await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(resolveInside(directory,'.novex-java.json'),JSON.stringify({path:selected}));
}
