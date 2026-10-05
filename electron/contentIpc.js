import {shell} from 'electron';
import {getInstanceDirectory} from './instanceManager.js';
import {contentPath} from './contentConfig.js';
import {contentList,checkContent,changeContent,deleteContent,getContentPlans,applyContentUpdate} from './contentManager.js';
import {startActivity,activityBusy} from './activity.js';
let busy=false;
export const contentBusy=()=>busy;
export function registerContent(handle,running){
 const idle=root=>{if(busy||running()||activityBusy(root))throw new Error('Stop Minecraft and wait for active operations before changing content.');};
 handle('content:list',async(_e,instance,kind)=>contentList(await getInstanceDirectory(instance),kind));
 handle('content:check',async(_e,instance,kind)=>{const root=await getInstanceDirectory(instance);idle(root);busy=true;try{return await checkContent(root,kind,instance);}finally{busy=false;}});
 handle('content:change',async(_e,instance,kind,names,enabled)=>{const root=await getInstanceDirectory(instance);idle(root);busy=true;try{await changeContent(root,kind,names,enabled);return await contentList(root,kind);}finally{busy=false;}});
 handle('content:delete',async(_e,instance,kind,names)=>{const root=await getInstanceDirectory(instance);idle(root);busy=true;try{await deleteContent(root,kind,names);return await contentList(root,kind);}finally{busy=false;}});
 handle('content:open',async(_e,instance,kind,name)=>shell.showItemInFolder(contentPath(await getInstanceDirectory(instance),kind,name)));
 handle('content:update',async(_e,instance,kind,ids)=>{const root=await getInstanceDirectory(instance);idle(root);const plans=getContentPlans(root,kind,ids);if(plans.some(p=>p.instance.minecraftVersion!==instance.minecraftVersion||p.instance.loader!==instance.loader))throw new Error('Instance compatibility changed. Check updates again.');const completed=new Set();return startActivity({label:`${instance.name} · ${plans.length} content updates`,directory:root,instanceId:instance.id,kind:'content',cancellable:true},async(progress,signal)=>{for(let i=0;i<plans.length;i++){signal.throwIfAborted();if(completed.has(plans[i].id))continue;progress({bytes:0,totalBytes:0,speed:0,message:`Updating ${plans[i].filename} (${i+1}/${plans.length})`});await applyContentUpdate(plans[i]);completed.add(plans[i].id);}return {updated:plans.length};});});
}
