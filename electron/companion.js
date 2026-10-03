import {validateCompanionManifest} from './companionManifest.js';
import semver from 'semver';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { secureFetch } from './downloads.js';
import { downloadToFile } from './transfer.js';
import { resolveInside } from './pathSafety.js';
import { installMod } from './modrinthManager.js';
import { identifyInstalledMods } from './modIdentity.js';
const REPO='MySocksAreGone-Dev/Novex-Companion-Mod';
let catalogue,expires=0;
async function builds(force=false) {
    if(!force&&catalogue&&Date.now()<expires)return catalogue;
    const response=await secureFetch(`https://api.github.com/repos/${REPO}/releases/latest`,{headers:{Accept:'application/vnd.github+json'}});
    if(!response.ok)throw new Error(`GitHub Companion releases unavailable (HTTP ${response.status}). Local mods are unchanged.`);
    const release=await response.json();
    const manifest=release.assets.find(a=>a.name==='novex-companion-manifest.json');
    if(!manifest||manifest.size>131072)throw new Error('This Companion release has no supported compatibility manifest.');
    const data=await secureFetch(manifest.browser_download_url);if(!data.ok)throw new Error('GitHub compatibility data is unavailable.');
    catalogue=validateCompanionManifest(await data.json(),release);expires=Date.now()+15*60000;return catalogue;
}
export async function inspectFabricMods(directory) {
    const root=resolveInside(directory,'mods');
    const entries=await fs.readdir(root,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
    if(entries.length>2000)throw new Error('Too many files to inspect safely.');
    const mods=[];
    for(const entry of entries) {
        if(!entry.isFile()||! /\.jar(?:\.disabled)?$/i.test(entry.name))continue;
        const file=resolveInside(root,entry.name);
        if((await fs.stat(file)).size>64*1048576)continue;
        try {const zip=new AdmZip(file);const metadata=zip.getEntry('fabric.mod.json');if(!metadata||metadata.header.size>131072)continue;const mod=JSON.parse(metadata.getData());mods.push({name:entry.name,enabled:!entry.name.endsWith('.disabled'),metadata:mod});}
        catch { /* Unrelated/non-Fabric mods are not modified. */ }
    }
    return mods;
}
export async function companionStatus(instance,directory,force=false) {
    const mods=directory?await inspectFabricMods(directory):[];
    const installed=mods.filter(m=>m.metadata.id==='novex_companion').map(m=>({name:m.name,version:m.metadata.version,enabled:m.enabled}));
    if(instance.loader!=='fabric')return {installed,available:null,reason:'Novex Companion currently supports Fabric only.'};
    try {const available=(await builds(force)).find(b=>b.minecraft===instance.minecraftVersion)||null;return {installed,available,needsFabricApi:!mods.some(m=>m.metadata.id==='fabric-api'&&m.enabled),reason:available?'':`Not available for Minecraft ${instance.minecraftVersion}.`};}
    catch(error){return {installed,available:null,reason:error.message};}
}
export async function installCompanion(instance,directory,includeDependencies) {
    const state=await companionStatus(instance,directory,true);
    if(!state.available)throw new Error(state.reason);
    const installation=JSON.parse(await fs.readFile(resolveInside(directory,'installation.json'),'utf8'));
    if(installation.loader!=='fabric'||installation.minecraftVersion!==instance.minecraftVersion||!semver.valid(installation.loaderVersion)||semver.lt(installation.loaderVersion,state.available.loaderMinimum))throw new Error(`Fabric ${state.available.loaderMinimum} or later is required. Repair this instance with a compatible Fabric loader first.`);
    const mods=await inspectFabricMods(directory);
    const api=mods.find(m=>m.metadata.id==='fabric-api');
    const projectResponse=await secureFetch('https://api.modrinth.com/v2/project/fabric-api');
    if(!projectResponse.ok)throw new Error('Modrinth Fabric API metadata is unavailable. Try again later.');
    const fabricApiProject=(await projectResponse.json()).id;
    if(typeof fabricApiProject!=='string'||!/^[A-Za-z0-9]{8}$/.test(fabricApiProject))throw new Error('Invalid Fabric API project metadata.');
    if(api&&!api.enabled)throw new Error('Fabric API is disabled. Enable it before installing Companion.');
    // Exact provider metadata determines compatibility; filenames never do.
    if(api) {
        const identified=(await identifyInstalledMods(directory)).find(m=>m.name===api.name);
        if(identified?.version.project_id!==fabricApiProject||!identified?.version.game_versions?.includes(instance.minecraftVersion)||!identified.version.loaders?.includes('fabric'))throw new Error('The installed Fabric API could not be verified as compatible. Update it before installing Companion.');
    }else {
        if(!includeDependencies)throw new Error('Novex Companion requires Fabric API. Confirm Install Fabric API + Novex.');
        await installMod({instanceDirectory:directory,projectId:fabricApiProject,gameVersion:instance.minecraftVersion,loader:'fabric'});
    }
    const build=state.available;
    const temporary=resolveInside(directory,'.novex/companion-download.jar');
    await downloadToFile(build.url,temporary,{hashes:{sha256:build.sha256},size:build.size});
    const zip=new AdmZip(temporary), entry=zip.getEntry('fabric.mod.json');
    if(!entry||entry.header.size>131072)throw new Error('Companion JAR metadata is invalid.');
    const meta=JSON.parse(entry.getData());
    if(meta.id!=='novex_companion'||meta.version!==build.modVersion||meta.depends?.minecraft!==instance.minecraftVersion)throw new Error('Companion JAR does not match the requested Minecraft version.');
    const destination=resolveInside(directory,'mods/'+build.asset);
    const old=(await inspectFabricMods(directory)).filter(m=>m.metadata.id==='novex_companion');
    if(await fs.stat(destination).catch(()=>null) && !old.some(m=>m.name===build.asset))throw new Error('A different mod already uses this filename.');
    const backup=resolveInside(directory,'.novex/companion-backups/'+Date.now());await fs.mkdir(backup,{recursive:true});
    const moved=[];
    try {
        for(const mod of old) {await fs.rename(resolveInside(directory,'mods/'+mod.name),resolveInside(backup,mod.name));moved.push(mod.name);}
        await fs.mkdir(path.dirname(destination),{recursive:true});await fs.rename(temporary,destination);
    }catch(error){for(const name of moved)await fs.rename(resolveInside(backup,name),resolveInside(directory,'mods/'+name));throw error;}
    return companionStatus(instance,directory);
}
export async function removeCompanion(directory) {
    const recognized=(await inspectFabricMods(directory)).filter(m=>m.metadata.id==='novex_companion');
    for(const mod of recognized)await fs.rm(resolveInside(directory,'mods/'+mod.name));
    return true;
}
