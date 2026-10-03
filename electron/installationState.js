import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInside } from './pathSafety.js';
export async function writeInstallState(directory,state) {
    await fs.mkdir(directory,{recursive:true});
    const file=resolveInside(directory,'.novex-install.json');
    await fs.writeFile(file+'.tmp',JSON.stringify({...state,updatedAt:Date.now()}));await fs.rename(file+'.tmp',file);
}
export async function readInstallState(directory) {
    try {const state=JSON.parse(await fs.readFile(resolveInside(directory,'.novex-install.json'),'utf8'));return state;}
    catch(error){if(error.code!=='ENOENT')return {status:'repair',error:'Installation status is unreadable. Repair this instance.'};}
    try {await fs.access(path.join(directory,'installation.json'));return {status:'ready'};}
    catch {return {status:'repair',error:'Minecraft installation is incomplete. Repair this instance.'};}
}
