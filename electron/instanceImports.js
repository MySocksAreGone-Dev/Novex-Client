import { app, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { inspectPack } from './packArchive.js';
import { inspectSource, copyGameContent, detectionRoots } from './importSources.js';
import { installInspectedPack } from './modrinthManager.js';
import { createInstanceDirectory } from './instanceManager.js';
import { installMinecraft } from './minecraftInstaller.js';
import { writeInstallState } from './installationState.js';
import { startActivity, trackedActivity } from './activity.js';
import { transferContext, downloadBytes } from './transfer.js';
import { secureFetch } from './downloads.js';
import { assertNoSymlinks, resolveInside } from './pathSafety.js';
const sources=new Map();
async function readPack(file){if((await fs.stat(assertNoSymlinks(file))).size>512*1024*1024)throw new Error('Pack exceeds 512 MiB.');return inspectPack(await fs.readFile(file));}
export function registerImports(handle,running) {
    const ledger=assertNoSymlinks(path.join(app.getPath('userData'),'import-sources.json'));
    const history=async()=>{try{return JSON.parse(await fs.readFile(ledger,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('Import history is unreadable.');return {};}};
    async function issue(file,pack=false) {
        const info=pack?await readPack(file):await inspectSource(file);
        const fingerprint=pack?info.digest:crypto.createHash('sha256').update(process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file)).digest('hex');
        const id=crypto.randomUUID();
        const data={id,name:pack?String(info.index.name||path.basename(file,'.mrpack')).slice(0,140):info.name,minecraftVersion:info.minecraftVersion,loader:info.loader,loaderVersion:info.loaderVersion,source:pack?'Modrinth Pack':info.source,modCount:pack?info.index.files.filter(f=>f.path.startsWith('mods/')&&f.env?.client!=='unsupported').length:info.modCount,optionalCount:pack?info.index.files.filter(f=>f.env?.client==='optional').length:0,duplicate:!!(await history())[fingerprint]};
        if(sources.size>2000)sources.clear();sources.set(id,{file,pack,fingerprint,data});return data;
    }
    handle('imports:choose',async(_event,kind)=>{
        if(!['folder','pack'].includes(kind))throw new Error('Invalid import type.');
        const result=await dialog.showOpenDialog({properties:[kind==='pack'?'openFile':'openDirectory'],...(kind==='pack'?{filters:[{name:'Modrinth Pack',extensions:['mrpack']}]}:{})});
        return result.canceled?[]:[await issue(result.filePaths[0],kind==='pack')];
    });
    handle('imports:drop',async(_event,file)=>{
        if(typeof file!=='string'||!path.isAbsolute(file)||!file.toLowerCase().endsWith('.mrpack'))throw new Error('Drop a .mrpack file.');
        return [await issue(file,true)];
    });
    handle('imports:detect',async()=>{
        const result=[],seen=new Set();
        for(const [kind,root] of detectionRoots(os.homedir(),app.getPath('appData'),process.platform)) {
            const folders=kind==='Minecraft folder'?[root]:(await fs.readdir(root).catch(()=>[])).slice(0,500).map(name=>path.join(root,name));
            for(const folder of folders) {if(seen.has(folder))continue;seen.add(folder);try {if((await fs.stat(folder)).isDirectory())result.push(await issue(folder));}catch{/* Unavailable or unsupported source; manual selection remains available. */}}
        }
        return result;
    });
    async function start(source,override,allowDuplicate) {
        if(!override||typeof override!=='object'||Array.isArray(override))throw new Error('Invalid import configuration.');
        if(running())throw new Error('Stop Minecraft before importing instances.');
        if(!source)throw new Error('Choose the source again.');
        if(typeof allowDuplicate!=='boolean')throw new Error('Invalid duplicate choice.');
        if((await history())[source.fingerprint]&&!allowDuplicate)throw new Error('This source was already imported. Confirm another copy first.');
        const info=source.pack?await readPack(source.file):await inspectSource(source.file);
        const configurable=!source.pack&&info.source==='Minecraft folder';
        const minecraftVersion=configurable?(override?.minecraftVersion||info.minecraftVersion):info.minecraftVersion;
        const loader=configurable?(override?.loader||info.loader):info.loader;
        const loaderVersion=configurable?(override?.loaderVersion||info.loaderVersion):info.loaderVersion;
        if(!['vanilla','fabric','quilt','forge','neoforge'].includes(loader)||loaderVersion&&!(typeof loaderVersion==='string'&&/^[a-zA-Z0-9._+\-]{1,100}$/.test(loaderVersion)))throw new Error('Invalid loader configuration.');
        if(typeof minecraftVersion!=='string'||!/^[a-zA-Z0-9._+\-]{1,100}$/.test(minecraftVersion))throw new Error('Select the source Minecraft version before importing.');
        if(override.includeOptional!==undefined&&typeof override.includeOptional!=='boolean')throw new Error('Invalid optional file choice.');
        const instance={id:crypto.randomUUID(),name:source.data.name.replace(/[<>:"/\\|?*]/g,'').trim()||'Imported instance',minecraftVersion,loader,loaderVersion,createdAt:Date.now(),status:'installing'};
        const directory=await createInstanceDirectory(instance);
        await writeInstallState(directory,{status:'installing'});
        await fs.writeFile(resolveInside(directory,'.novex-import-pending.json'),JSON.stringify({sourceId:source.fingerprint}));
        const records=await history();records[source.fingerprint]=instance.id;await fs.writeFile(ledger,JSON.stringify(records));
        startActivity({label:`Import ${instance.name}`,directory,instanceId:instance.id,cancellable:true},async(progress,signal)=>{
            try {
                const result=source.pack?await transferContext.run({...transferContext.getStore(),includeOptional:override.includeOptional!==false},async()=>installInspectedPack(await readPack(source.file),directory)):await transferContext.run({...transferContext.getStore(),deferReady:true},async()=>{
                    await copyGameContent(info.root,directory,progress,signal);
                    return installMinecraft({version:minecraftVersion,loader:instance.loader,loaderVersion:instance.loaderVersion,instanceDirectory:directory,onProgress:progress});
                });
                signal.throwIfAborted();await fs.rm(resolveInside(directory,'.novex-import-pending.json'),{force:true});await writeInstallState(directory,{status:'ready'});return result;
            } catch(error){await writeInstallState(directory,{status:signal.aborted?'cancelled':'failed',error:String(error.message).slice(0,500)});throw error;}
        });
        return instance;
    }
    // Sequentialize creation/history updates; actual installs use the existing queue.
    let tail=Promise.resolve();
    handle('imports:start',(_event,id,override={},allowDuplicate=false)=>{const next=tail.catch(()=>{}).then(()=>start(sources.get(id),override,allowDuplicate));tail=next;return next;});
    handle('imports:project',(_event,projectId,versionId)=>trackedActivity({label:'Preparing Modrinth pack',kind:'download',cancellable:true},async()=>{
        if(!/^[a-zA-Z0-9]{1,80}$/.test(projectId)||!/^[a-zA-Z0-9]{1,80}$/.test(versionId))throw new Error('Invalid Modrinth identity.');
        const response=await secureFetch(`https://api.modrinth.com/v2/version/${versionId}`);if(!response.ok)throw new Error('Unable to load pack version.');
        const version=await response.json();if(version.project_id!==projectId)throw new Error('Pack version belongs to another project.');
        const file=version.files.find(f=>f.primary)||version.files[0];if(!file?.filename?.endsWith('.mrpack'))throw new Error('Version has no Modrinth pack.');
        const buffer=await downloadBytes(file.url,file.hashes,{maxBytes:512*1024*1024});inspectPack(buffer);
        const cache=path.join(app.getPath('userData'),'downloads','import-packs');await fs.mkdir(cache,{recursive:true});
        const destination=path.join(cache,`${versionId}.mrpack`);await fs.writeFile(destination,buffer);
        return issue(destination,true);
    }));
}
