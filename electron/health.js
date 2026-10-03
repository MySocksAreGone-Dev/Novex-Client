import fs from 'node:fs/promises';
import path from 'node:path';
import {readVersionProfile} from './versionProfile.js';
import {applicableLibraries,nativeArtifact} from './natives.js';
import {resolveInside} from './pathSafety.js';
import {validFile,parallelFiles} from './transfer.js';
export async function checkMinecraftFiles(directory,version) {
    const entries=[];
    let installation={};try{installation=JSON.parse(await fs.readFile(resolveInside(directory,'installation.json'),'utf8'));}catch{/* Report missing profile below. */}
    let profile;
    try {profile=(await readVersionProfile(directory,installation.launchVersion||version)).data;if(!profile.mainClass)throw new Error('Missing main class.');entries.push({name:'Launch profile / loader',detail:'Found'});}
    catch(error){return [{name:'Launch profile / loader',detail:error.message,failed:true}];}
    const vanilla=JSON.parse(await fs.readFile(resolveInside(directory,`versions/${version}/${version}.json`),'utf8'));
    const client=vanilla.downloads?.client;
    const clientValid=await validFile(resolveInside(directory,`versions/${version}/${version}.jar`),{sha1:client?.sha1},client?.size);
    entries.push({name:'Minecraft client',detail:clientValid?'Verified':'Missing or damaged — Repair downloads only invalid files.',failed:!clientValid});
    const libraries=applicableLibraries(profile.libraries||[]).flatMap(library=>[library.downloads?.artifact,nativeArtifact(library)].filter(Boolean));
    let missing=0;
    await parallelFiles(libraries,async artifact=>{if(!await validFile(resolveInside(directory,path.join('libraries',artifact.path)),{sha1:artifact.sha1},artifact.size))missing++;});
    entries.push({name:'Libraries / platform natives',detail:missing?`${missing} missing or invalid libraries. Select Repair.`:`${libraries.length} library artifacts verified for ${process.platform}.`,failed:missing>0});
    if(vanilla.assetIndex) {
        const index=resolveInside(directory,`assets/indexes/${vanilla.assetIndex.id}.json`);
        if(!await validFile(index,{sha1:vanilla.assetIndex.sha1}))entries.push({name:'Assets',detail:'Asset index missing or damaged. Select Repair.',failed:true});
        else {let invalid=0;const assets=Object.values(JSON.parse(await fs.readFile(index,'utf8')).objects||{});await parallelFiles(assets,async asset=>{if(!/^[a-f0-9]{40}$/.test(asset.hash)||!await validFile(resolveInside(directory,`assets/objects/${asset.hash.slice(0,2)}/${asset.hash}`),{sha1:asset.hash},asset.size))invalid++;});entries.push({name:'Assets',detail:invalid?`${invalid} assets missing or damaged. Select Repair.`:`${assets.length} assets verified.`,failed:invalid>0});}
    }
    return entries;
}
