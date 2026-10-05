import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInside } from './pathSafety.js';
import { downloadToFile, parallelFiles, transferContext } from './transfer.js';

// Only game content crosses the import boundary, never launcher configuration.
export const packDownloadHosts=['cdn.modrinth.com','github.com','raw.githubusercontent.com','gitlab.com','release-assets.githubusercontent.com','objects.githubusercontent.com'];
export const gameFolders = new Set(['mods','config','saves','resourcepacks','shaderpacks','screenshots','defaultconfigs','kubejs','scripts','datapacks']);
export function gameContentPath(relative,pack=false) {
    if(typeof relative !== 'string' || relative.includes('\\')) throw new Error('Invalid game content path.');
    resolveInside(path.resolve('import-validation'),relative,false);
    if(relative.startsWith('/')||relative.includes('//'))throw new Error('Invalid game content path.');
    const parts=relative.split('/');
    if(parts.some(p=>/\.(?:key|pem|p12|pfx|jks|keystore)$/i.test(p)))throw new Error('Import contains signing or private key material.');
    if(parts.some(p=> /^(?:\.env(?:\..*)?|.*(?:auth.?cache|access.?token|refresh.?token|session.?token|msal|credentials)|accounts?(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?)$/i.test(p))) throw new Error('Import contains private account/configuration data.');
    if(pack){if(/^(?:\.novex.*|versions|libraries|natives|assets|runtimes|instance\.json|installation\.json|launcher.*)$/i.test(parts[0]))throw new Error('Pack contains a protected launcher path.');return relative;}
    if(!gameFolders.has(parts[0]) && !['options.txt','optionsof.txt','servers.dat','servers.dat_old','icon.png'].includes(relative)) throw new Error(`Unsupported or protected game path: ${relative}`);
    return relative;
}
export function inspectPack(buffer) {
    if(buffer.length>512*1024*1024)throw new Error('Pack archive exceeds 512 MiB.');
    const archive=new AdmZip(buffer), entries=archive.getEntries();
    if(entries.length>100000)throw new Error('Pack contains too many files.');
    let expanded=0;
    const seen=new Set();
    for(const entry of entries) {
        resolveInside(path.resolve('import-validation'),entry.entryName.replace(/\/$/,''),false);
        if(((entry.attr>>>16)&0o170000)===0o120000)throw new Error('Pack contains a symbolic link.');
        const key=entry.entryName.toLowerCase();
        if(seen.has(key))throw new Error('Pack contains duplicate paths.');seen.add(key);
        expanded+=entry.header.size;
        if(entry.header.size>512*1024*1024 || expanded>4*1024**3)throw new Error('Pack expanded size exceeds safe limits.');
        const relative=entry.entryName.replace(/^(client-overrides|overrides)\//,'');
        if(!entry.isDirectory && relative!==entry.entryName)gameContentPath(relative,true);
    }
    const indexEntry=archive.getEntry('modrinth.index.json');
    if(!indexEntry || indexEntry.header.size>8*1024*1024)throw new Error('Invalid or missing modrinth.index.json.');
    const index=JSON.parse(indexEntry.getData().toString('utf8'));
    if(index.formatVersion!==1 || index.game!=='minecraft' || !Array.isArray(index.files) || index.files.length>100000)throw new Error('Unsupported Modrinth pack format.');
    const validVersion=value=>typeof value==='string' && /^[a-zA-Z0-9._+\-]{1,100}$/.test(value);
    if(!validVersion(index.dependencies?.minecraft))throw new Error('Pack Minecraft version is missing or invalid.');
    const loaders={'fabric-loader':'fabric','quilt-loader':'quilt',forge:'forge',neoforge:'neoforge'};
    if(Object.keys(index.dependencies).some(key=>key!=='minecraft'&&!Object.hasOwn(loaders,key)))throw new Error('This pack requires an unsupported dependency type.');
    const keys=Object.keys(loaders).filter(key=>index.dependencies[key]);
    if(keys.length>1 || keys.some(key=>!validVersion(index.dependencies[key])))throw new Error('Invalid pack loader dependencies.');
    const filePaths=new Set();
    for(const file of index.files) {
        gameContentPath(file.path,true);
        if(filePaths.has(file.path.toLowerCase()))throw new Error('Pack contains duplicate file paths.');filePaths.add(file.path.toLowerCase());
        if(file.env?.client && !['required','optional','unsupported'].includes(file.env.client))throw new Error('Invalid client environment.');
        if(!Number.isSafeInteger(file.fileSize)||file.fileSize<0||!Array.isArray(file.downloads)||!file.downloads.length)throw new Error('Pack file has no valid size/download.');
        if(!/^[a-f\d]{40}$/i.test(file.hashes?.sha1||'') && !/^[a-f\d]{128}$/i.test(file.hashes?.sha512||''))throw new Error('Pack file has no valid integrity hash.');
        for(const url of file.downloads) {const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||!packDownloadHosts.includes(parsed.hostname)||/[\u0000-\u0020\u007f]/.test(url))throw new Error('Pack downloads require HTTPS on Modrinth, GitHub or GitLab.');}
    }
    return {archive,index,digest:crypto.createHash('sha256').update(buffer).digest('hex'),minecraftVersion:index.dependencies.minecraft,loader:keys.length?loaders[keys[0]]:'vanilla',loaderVersion:keys.length?index.dependencies[keys[0]]:undefined};
}
export async function installPackContent(pack,directory) {
    const context=transferContext.getStore();
    await parallelFiles(pack.index.files.filter(file=>file.env?.client!=='unsupported' && (context?.includeOptional!==false||file.env?.client!=='optional')),async file=>{
        context?.signal?.throwIfAborted();
        let failure;
        for(const url of file.downloads) {
            try {await downloadToFile(url,resolveInside(directory,gameContentPath(file.path,true)),{hashes:file.hashes,size:file.fileSize,allowedHosts:packDownloadHosts});return;}
            catch(error){failure=error;context?.signal?.throwIfAborted();}
        }
        throw failure;
    });
    // Explicit precedence: client-overrides always win over common overrides.
    for(const prefix of ['overrides/','client-overrides/']) for(const entry of pack.archive.getEntries()) {
        if(entry.isDirectory||!entry.entryName.startsWith(prefix))continue;
        context?.signal?.throwIfAborted();
        const target=resolveInside(directory,gameContentPath(entry.entryName.slice(prefix.length),true));
        await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,entry.getData());
    }
}
