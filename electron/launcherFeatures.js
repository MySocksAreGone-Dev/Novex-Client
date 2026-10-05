import { registerImports } from './instanceImports.js';
import { app, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { configureDownloads } from './transfer.js';
import { configureActivity, listActivity, startActivity, cancelActivity, retryActivity, activityBusy } from './activity.js';
import { getInstanceDirectory } from './instanceManager.js';
import { installMinecraft } from './minecraftInstaller.js';
import { readInstallState } from './installationState.js';
import { scanJava, requiredJava, resolveJava, installJava, chooseInstanceJava, javaSelection, useDetectedJava } from './javaManager.js';
import { companionStatus, installCompanion, removeCompanion } from './companion.js';
import { setLaunchSettings } from './settings.js';
export function registerLauncherFeatures(handle,broadcast,running) {
    registerImports(handle,running);
    configureDownloads(path.join(app.getPath('userData'),'downloads','verified'));
    configureActivity(jobs=>broadcast('activity:changed',jobs));
    const idle=directory=>{if(running()||activityBusy(directory))throw new Error('Stop Minecraft and wait for this instance’s active task first.');};
    handle('activity:list',()=>listActivity());
    handle('activity:cancel',(_event,id)=>cancelActivity(id));
    handle('activity:retry',(_event,id)=>{if(running())throw new Error('Stop Minecraft before retrying installation.');return retryActivity(id);});
    handle('activity:install',async(_event,instance,withCompanion=false)=>{
        if(typeof withCompanion!=='boolean')throw new Error('Invalid Companion choice.');
        const directory=await getInstanceDirectory(instance);idle(directory);
        return startActivity({label:instance.name,directory,instanceId:instance.id,cancellable:true},async(progress,signal)=>{
            const result=await installMinecraft({version:instance.minecraftVersion,loader:instance.loader,loaderVersion:instance.loaderVersion,instanceDirectory:directory,onProgress:progress});
            signal.throwIfAborted();
            if(withCompanion) {progress({message:'Installing Novex Companion…'});await installCompanion(instance,directory,true);}
            return result;
        });
    });
    handle('instances:states',async(_event,instances)=>{
        if(!Array.isArray(instances)||instances.length>1000)throw new Error('Invalid instance list.');
        return Promise.all(instances.map(async instance=>{const directory=await getInstanceDirectory(instance);const state=await readInstallState(directory);return {id:instance.id,status:activityBusy(directory)?'installing':state.status==='ready'?'ready':'repair'};}));
    });
    handle('instances:overview',async(_event,instance)=>{
        const directory=await getInstanceDirectory(instance);
        const state=await readInstallState(directory);
        if(state.status==='installing'&&!activityBusy(directory))state.status='repair';
        let required,java,error;
        try {required=await requiredJava(instance.minecraftVersion,directory);java=await resolveJava(required,directory);}catch(e){error=e.message;}
        const mods=(await fs.readdir(path.join(directory,'mods')).catch(()=>[])).filter(n=>n.endsWith('.jar')).length;
        return {state,required,java,error,mods,customJava:await javaSelection(directory)};
    });
    handle('java:list',()=>scanJava(true));
    handle('java:requirement',(_event,version)=>requiredJava(version));
    handle('java:install',(_event,major)=>startActivity({label:`Java ${major}`,kind:'java',cancellable:true},()=>installJava(major)));
    handle('java:use',async(_event,instance,selected)=>{const directory=await getInstanceDirectory(instance);idle(directory);return useDetectedJava(directory,selected);});
    handle('java:choose',async(_event,instance,automatic)=>{if(typeof automatic!=='boolean')throw new Error('Invalid Java option.');const directory=await getInstanceDirectory(instance);idle(directory);return chooseInstanceJava(directory,automatic);});
    handle('settings:launch',(_event,input)=>setLaunchSettings(input));
    handle('companion:status',async(_event,instance,force)=>companionStatus(instance,instance.id?await getInstanceDirectory(instance):null,force===true));
    handle('companion:install',async(_event,instance,dependencies)=>{if(typeof dependencies!=='boolean')throw new Error('Invalid dependency choice.');const directory=await getInstanceDirectory(instance);idle(directory);return startActivity({label:`${instance.name} · Novex Companion`,directory,instanceId:instance.id,kind:'companion'},()=>installCompanion(instance,directory,dependencies));});
    handle('companion:remove',async(_event,instance)=>{const directory=await getInstanceDirectory(instance);idle(directory);return removeCompanion(directory);});
    handle('logs:open',()=>shell.openPath(path.join(app.getPath('userData'),'logs')));
}
