import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import crypto from 'node:crypto';
import {resolveInside} from './pathSafety.js';
import {secureFetch} from './downloads.js';

// Identify enabled AND disabled JARs by content, never by guessed project names.
export async function identifyInstalledMods(root,folder='mods') {
    if(!['mods','resourcepacks'].includes(folder))throw new Error('Invalid content folder.');
    const directory=resolveInside(root,folder);
    const files=(await fs.readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;}))
        .filter(item=>item.isFile() && (folder==='mods'?/\.jar(?:\.disabled)?$/i:/\.zip$/i).test(item.name));
    if(files.length>500)throw new Error('Too many mod files for a single duplicate check (maximum 500).');
    const entries=[];
    for(const file of files) {
        const hash=crypto.createHash('sha1');
        for await(const chunk of createReadStream(resolveInside(directory,file.name))) hash.update(chunk);
        entries.push({name:file.name,hash:hash.digest('hex'),enabled:!file.name.toLowerCase().endsWith('.disabled')});
    }
    if(!entries.length)return [];
    const response=await secureFetch('https://api.modrinth.com/v2/version_files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({algorithm:'sha1',hashes:entries.map(entry=>entry.hash)})});
    if(!response.ok)throw new Error('Unable to check installed mods with Modrinth. Try again before installing.');
    const versions=await response.json();
    return entries.filter(entry=>versions[entry.hash]).map(entry=>({...entry,version:versions[entry.hash]}));
}
