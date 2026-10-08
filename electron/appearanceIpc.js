import {app,dialog,nativeImage} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {assertAppearanceAccount,getAppearanceSession,rememberMinecraftAppearance} from './minecraftAccounts.js';
import {createMinecraftAppearance} from './minecraftAppearance.js';
import {MAX_SKIN_BYTES,validateSkinPng} from './skinPng.js';
export function registerAppearance(handle){
    const service=createMinecraftAppearance({session:getAppearanceSession,assertAccount:assertAppearanceAccount,rememberProfile:rememberMinecraftAppearance,directory:path.join(app.getPath('userData'),'appearance','skins')});
    handle('minecraft-appearance:get',(_event,id,force=false)=>service.get(id,force));
    handle('minecraft-appearance:choose',async(_event,id)=>{
        await assertAppearanceAccount(id);
        const result=await dialog.showOpenDialog({title:'Choose Minecraft skin PNG',properties:['openFile'],filters:[{name:'Minecraft skin PNG',extensions:['png']}]});
        if(result.canceled)return null;await assertAppearanceAccount(id);
        const file=result.filePaths[0],stat=await fs.stat(file);
        if(!stat.isFile()||path.extname(file).toLowerCase()!=='.png'||stat.size>MAX_SKIN_BYTES)throw new Error('Choose a PNG skin file no larger than 1 MiB.');
        const raw=await fs.readFile(file);validateSkinPng(raw);
        const decoded=nativeImage.createFromBuffer(raw);
        if(decoded.isEmpty())throw new Error('This PNG could not be decoded. Choose another skin image.');
        // Normalize through Electron's image decoder: strips metadata and keeps
        // saved public texture files small, without touching the original file.
        return service.prepare(id,decoded.toPNG(),path.basename(file,'.png'));
    });
    handle('minecraft-appearance:upload',(_event,id,draft,model)=>service.applyUpload(id,draft,model));
    handle('minecraft-appearance:skin',(_event,id,skin,model)=>service.setSkin(id,skin,model));
    handle('minecraft-appearance:reset-skin',(_event,id)=>service.resetSkin(id));
    handle('minecraft-appearance:cape',(_event,id,cape)=>service.setCape(id,cape));
    handle('minecraft-appearance:disable-cape',(_event,id)=>service.disableCape(id));
    handle('minecraft-appearance:delete-saved',(_event,id,skin)=>service.deleteSaved(id,skin));
    return service;
}
