import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinks, resolveInside } from './pathSafety.js';
import { gameFolders, gameContentPath } from './packArchive.js';
import { walkFiles } from './localFiles.js';
const readJSON=async file=>{try {if((await fs.stat(file)).size>4*1024*1024)return null;return JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}};
export async function inspectSource(folder) {
    folder=assertNoSymlinks(path.resolve(folder));
    if(!(await fs.stat(folder)).isDirectory())throw new Error('Choose an instance folder.');
    let root=folder, name=path.basename(folder), minecraftVersion='',loader='vanilla',loaderVersion,source='Minecraft folder';
    const prism=await readJSON(resolveInside(folder,'mmc-pack.json'));
    const profile=await readJSON(resolveInside(folder,'profile.json'));
    if(prism?.components) {
        source='Prism / MultiMC';
        minecraftVersion=prism.components.find(c=>c.uid==='net.minecraft')?.version||'';
        for(const [uid,kind] of Object.entries({'net.fabricmc.fabric-loader':'fabric','org.quiltmc.quilt-loader':'quilt','net.minecraftforge':'forge','net.neoforged':'neoforge','net.neoforged.neoforge':'neoforge'})) {
            const component=prism.components.find(c=>c.uid===uid);if(component){loader=kind;loaderVersion=component.version;}
        }
        const cfg=await fs.readFile(resolveInside(folder,'instance.cfg'),'utf8').catch(()=>'');
        name=cfg.match(/^name=(.*)$/m)?.[1]?.trim()||name;
        for(const child of ['.minecraft','minecraft'])if((await fs.stat(resolveInside(folder,child)).catch(()=>null))?.isDirectory()){root=resolveInside(folder,child);break;}
    } else if(profile?.metadata?.game_version) {
        source='Modrinth App';name=profile.metadata.name||name;minecraftVersion=profile.metadata.game_version;
        loader=profile.metadata.loader||'vanilla';loaderVersion=profile.metadata.loader_version?.id||profile.metadata.loader_version;
    } else {
        // options.txt supplies a version ID in recent vanilla clients, not an account profile.
        const options=await fs.readFile(resolveInside(root,'options.txt'),'utf8').catch(()=>'');
        const lastVersion=options.match(/^lastServerVersion:(.+)$/m)?.[1];
        const versionFolders=await fs.readdir(resolveInside(root,'versions')).catch(()=>[]);
        const candidates=[];
        for(const version of versionFolders.slice(0,100)) {
            const meta=await readJSON(resolveInside(root,`versions/${version}/${version}.json`));
            if(meta && !meta.inheritsFrom && meta.type==='release')candidates.push(meta.id);
        }
        if(candidates.length===1)minecraftVersion=candidates[0];
        if(lastVersion && /^\d+\.\d+(?:\.\d+)?$/.test(lastVersion))minecraftVersion=lastVersion;
    }
    if(!['vanilla','fabric','quilt','forge','neoforge'].includes(loader))throw new Error('Unsupported source loader.');
    const mods=await fs.readdir(resolveInside(root,'mods')).catch(()=>[]);
    return {root,source,name:String(name).slice(0,140),minecraftVersion,loader,loaderVersion:typeof loaderVersion==='string'?loaderVersion:undefined,modCount:mods.filter(n=>/\.jar(?:\.disabled)?$/i.test(n)).length};
}
export async function copyGameContent(source,destination,progress,signal) {
    source=assertNoSymlinks(source);destination=assertNoSymlinks(destination);
    if(source===destination || destination.startsWith(source+path.sep))throw new Error('Import destination must be outside the original instance.');
    let count=0;
    for(const entry of await fs.readdir(source,{withFileTypes:true})) {
        if(entry.isSymbolicLink())continue;
        if(!gameFolders.has(entry.name) && !['options.txt','optionsof.txt','servers.dat','servers.dat_old','icon.png'].includes(entry.name))continue;
        const copy=async(file,relative)=>{
            signal?.throwIfAborted();
            relative=relative.split(path.sep).join('/');
            try {gameContentPath(relative);}catch{return;} // Exclude credentials even inside config.
            if(/\.(?:json|toml|properties|ya?ml|cfg|conf|txt)$/i.test(relative)) {
                const stat=await fs.stat(file);
                if(stat.size<=2*1024*1024){const text=await fs.readFile(file,'utf8');if(/(?:["']?)(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|password|api[_-]?key|authorization|session[_-]?token)["']?\s*[:=]\s*["']?[^\s"'{}\[\],]+/i.test(text))return;}
            }
            const target=resolveInside(destination,relative);await fs.mkdir(path.dirname(target),{recursive:true});
            await fs.copyFile(file,target);if(++count%50===0)progress?.({message:`Copied ${count} game files…`});
        };
        if(entry.isDirectory())await walkFiles(source,copy,entry.name,{count:0},async relative=>{await fs.mkdir(resolveInside(destination,relative),{recursive:true});},true);
        else if(entry.isFile())await copy(resolveInside(source,entry.name),entry.name);
    }
    return count;
}
export function detectionRoots(home,appData,platform) {
    const data=platform==='win32'?appData:path.join(home,'.local','share');
    const roots=[['Prism / MultiMC',path.join(data,'PrismLauncher','instances')],['Prism / MultiMC',path.join(data,'MultiMC','instances')],['Modrinth App',path.join(appData,'com.modrinth.theseus','profiles')],['Modrinth App',path.join(data,'com.modrinth.theseus','profiles')],['Minecraft folder',platform==='win32'?path.join(appData,'.minecraft'):path.join(home,'.minecraft')]];
    if(platform==='linux')roots.push(['Prism / MultiMC',path.join(home,'.var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/instances')],['Modrinth App',path.join(home,'.var/app/com.modrinth.ModrinthApp/config/com.modrinth.theseus/profiles')]);
    return roots;
}
