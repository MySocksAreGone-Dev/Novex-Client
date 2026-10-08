import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {resolveInside} from './pathSafety.js';
import {validateSkinPng,validateSkinModel} from './skinPng.js';
const API='https://api.minecraftservices.com/minecraft/profile';
const UUID=/^[a-f0-9]{32}$/i;
export function textureUrl(value){
    try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.hostname!=='textures.minecraft.net'||url.port||url.username||url.password||url.search||url.hash||!/^\/texture\/[a-f0-9]{32,64}$/i.test(url.pathname))return undefined;url.protocol='https:';return url.href;}catch{return undefined;}
}
export function appearanceProfile(data,accountId){
    if(!data||!Array.isArray(data.skins)||!Array.isArray(data.capes)||!UUID.test(data.id)||data.id.toLowerCase()!==accountId.toLowerCase()||!/^[A-Za-z0-9_]{1,16}$/.test(data.name))throw new Error('Minecraft returned a missing or different Java profile. Refresh your account.');
    const skins=(Array.isArray(data.skins)?data.skins:[]).slice(0,50).map(s=>({id:String(s.id||'').slice(0,80),name:typeof s.alias==='string'?s.alias.slice(0,80):'Minecraft skin',url:textureUrl(s.url),model:s.variant==='SLIM'?'slim':'classic',active:s.state==='ACTIVE'})).filter(s=>s.url&&/^[a-f0-9-]{1,80}$/i.test(s.id));
    const capes=(Array.isArray(data.capes)?data.capes:[]).slice(0,100).map(c=>({id:String(c.id||''),name:typeof c.alias==='string'?c.alias.slice(0,80):'Minecraft cape',url:textureUrl(c.url),active:c.state==='ACTIVE'})).filter(c=>c.url&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(c.id));
    return {accountId,uuid:data.id,username:data.name,skins,capes};
}
async function bytes(response,limit){
    if(!response.body)throw new Error('Minecraft returned an empty response.');const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new Error('Minecraft returned an oversized response.');chunks.push(chunk);}return Buffer.concat(chunks);
}
// All credentials and network mutations remain here in Electron. The renderer
// can only choose IDs from this account's profile, local library or native picker.
export function createMinecraftAppearance({session,assertAccount,rememberProfile,directory,fetcher=fetch,now=Date.now}){
    const cache=new Map(),pending=new Map(),mutating=new Set(),cooldowns=new Map(),lastMutation=new Map(),controllers=new Set(),drafts=new Map();
    const check=async id=>{if(typeof id!=='string'||!UUID.test(id))throw new Error('Select a Microsoft Minecraft account.');await assertAccount(id);};
    async function request(id,suffix='',method='GET',body){
        await check(id);if((cooldowns.get(id)||0)>now())throw new Error('Minecraft is rate limiting requests. Wait a moment before trying again.');
        const controller=new AbortController();controllers.add(controller);
        try{
            for(let attempt=0;attempt<2;attempt++){
                const auth=await session(id,attempt===1);await check(id);controller.signal.throwIfAborted();let response;
                try{response=await fetcher(API+suffix,{method,redirect:'error',headers:{Authorization:`Bearer ${auth.accessToken}`,Accept:'application/json',...(body?.json?{'Content-Type':'application/json'}:{})},body:body?.json?JSON.stringify(body.json):body?.form?.(),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});}
                catch{throw new Error(controller.signal.aborted?'Minecraft account changed. Refresh this page.':'Unable to reach Minecraft Services. Check your network and try again.');}
                await check(id);
                if(response.status===401&&attempt===0){await response.body?.cancel();continue;}
                if(!response.ok){
                    let wait=Number(response.headers.get('retry-after'));if(!Number.isFinite(wait))wait=(Date.parse(response.headers.get('retry-after'))-now())/1000;
                    if(response.status===429)cooldowns.set(id,now()+Math.min(600,Math.max(30,wait||60))*1000);
                    await response.body?.cancel();
                    throw new Error(({400:'Minecraft rejected this appearance. Check the skin PNG and model.',401:'Minecraft authentication expired. Refresh your Minecraft account, or sign in again.',403:'Minecraft Services denied this change. Check that this account owns Java Edition and is permitted to change its appearance.',404:'Minecraft profile or appearance was not found. Refresh your account and try again.',429:'Minecraft is rate limiting requests. Wait a moment before trying again.'})[response.status]||`Minecraft Services is unavailable (HTTP ${response.status}). Try again later.`);
                }
                if(response.status===204)return null;
                const data=await bytes(response,256*1024);if(!data.length)return null;
                try{return JSON.parse(data.toString('utf8'));}catch{return null;}
            }
        }finally{controllers.delete(controller);}
    }
    async function library(id){
        const file=resolveInside(directory,`${id}.json`);let data;
        try{if((await fs.stat(file)).size>10*1024*1024)throw new Error('Saved skin library is too large.');data=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw new Error('Saved skin library is unreadable. Your Minecraft appearance is unchanged.');}
        if(!Array.isArray(data)||data.length>50)throw new Error('Saved skin library is invalid.');
        return data.filter(s=>typeof s.id==='string'&&/^saved-[a-f0-9]{64}$/.test(s.id)&&typeof s.name==='string'&&s.name.length<=80&&['classic','slim'].includes(s.model)&&typeof s.image==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s.image)&&s.image.length<180000);
    }
    async function saveLibrary(id,items){await fs.mkdir(directory,{recursive:true});const file=resolveInside(directory,`${id}.json`),temp=resolveInside(directory,`${id}.${crypto.randomUUID()}.tmp`);try{await fs.writeFile(temp,JSON.stringify(items),{flag:'wx',mode:0o600});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}}
    async function storeProfile(id,data){const profile=appearanceProfile(data,id);await check(id);await rememberProfile(id,profile);cache.set(id,{at:now(),profile});return profile;}
    async function readProfile(id,force=false){await check(id);const old=cache.get(id);if(old&&now()-old.at<(force?3000:60000))return old.profile;return storeProfile(id,await request(id));}
    async function snapshot(id,profile,warning=''){await check(id);let saved=[];try{saved=await library(id);}catch{warning=(warning+' Your local saved-skin library could not be read. Refresh or restore its backup.').trim();}return {...profile,saved,warning};}
    async function afterMutation(id,data){cache.delete(id);let profile,warning='';
        try{profile=data?.id&&Array.isArray(data.skins)&&Array.isArray(data.capes)?await storeProfile(id,data):await readProfile(id,true);}catch{await check(id);warning='Minecraft accepted the change, but profile refresh failed. Press Refresh to confirm its current appearance.';profile={accountId:id,uuid:id,username:'',skins:[],capes:[]};}
        return {profile,warning};
    }
    async function mutate(id,work){await check(id);if(mutating.has(id)||pending.has(id))throw new Error('Wait for the current appearance request to finish.');if(now()-(lastMutation.get(id)||0)<5000)throw new Error('Wait a few seconds before changing appearance again.');mutating.add(id);lastMutation.set(id,now());try{return await work();}finally{mutating.delete(id);}}
    async function upload(id,png,model,name){
        const size=validateSkinPng(png);validateSkinModel(model,size.height);
        const data=await request(id,'/skins','POST',{form:()=>{const form=new FormData();form.append('variant',model);form.append('file',new Blob([png],{type:'image/png'}),'skin.png');return form;}});
        const result=await afterMutation(id,data);
        try{if(png.length<=128*1024){const items=await library(id),hash=crypto.createHash('sha256').update(png).update(model).digest('hex'),key='saved-'+hash;const existing=items.find(item=>item.id===key);if(existing||items.length<50)await saveLibrary(id,[...items.filter(item=>item.id!==key),{id:key,name:name.slice(0,80),model,image:'data:image/png;base64,'+png.toString('base64')}]);else result.warning+=' Skin applied; the local library is full (50 skins).';}}
        catch{result.warning+=' Skin applied, but saving the local copy failed.';}
        return snapshot(id,result.profile,result.warning.trim());
    }
    return {
        cancel(){for(const c of controllers)c.abort();drafts.clear();},
        async get(id,force=false){if(typeof force!=='boolean')throw new Error('Invalid refresh option.');await check(id);if(pending.has(id))return pending.get(id);if(mutating.has(id))throw new Error('Wait for the appearance change to finish.');const task=readProfile(id,force).then(p=>snapshot(id,p)).finally(()=>pending.delete(id));pending.set(id,task);return task;},
        async prepare(id,png,name){await check(id);const dimensions=validateSkinPng(png);const draftId=crypto.randomUUID();drafts.set(id,{draftId,png:Buffer.from(png),name:String(name).slice(0,80),expires:now()+10*60000});return {draftId,name:String(name).slice(0,80),image:'data:image/png;base64,'+Buffer.from(png).toString('base64'),...dimensions};},
        applyUpload(id,draftId,model){return mutate(id,async()=>{const draft=drafts.get(id);if(!draft||draft.draftId!==draftId||draft.expires<now())throw new Error('Choose your skin PNG again; the preview expired or the account changed.');const result=await upload(id,draft.png,model,draft.name);drafts.delete(id);return result;});},
        setSkin(id,skinId,model){return mutate(id,async()=>{
            validateSkinModel(model);let png,name;
            if(typeof skinId!=='string')throw new Error('Select an available skin.');
            const saved=(await library(id)).find(s=>s.id===skinId);
            if(saved){png=Buffer.from(saved.image.split(',')[1],'base64');name=saved.name;}
            else{const profile=await readProfile(id);const skin=profile.skins.find(s=>s.id===skinId);if(!skin)throw new Error('This skin is not available for the selected account.');let response;
                try{response=await fetcher(skin.url,{redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new Error('Unable to load the skin texture. Check your network.');}
                if(!response.ok)throw new Error('Unable to load the skin texture. Try Refresh.');png=await bytes(response,1024*1024);name=skin.name;
            }
            await check(id);return upload(id,png,model,name);
        });},
        resetSkin(id){return mutate(id,async()=>{const {profile,warning}=await afterMutation(id,await request(id,'/skins/active','DELETE'));return snapshot(id,profile,warning);});},
        setCape(id,capeId){return mutate(id,async()=>{const profile=await readProfile(id);if(typeof capeId!=='string'||!profile.capes.some(c=>c.id===capeId))throw new Error('Select a cape owned by this Minecraft account.');const result=await afterMutation(id,await request(id,'/capes/active','PUT',{json:{capeId}}));return snapshot(id,result.profile,result.warning);});},
        disableCape(id){return mutate(id,async()=>{const result=await afterMutation(id,await request(id,'/capes/active','DELETE'));return snapshot(id,result.profile,result.warning);});},
        async deleteSaved(id,skinId){await check(id);if(mutating.has(id)||pending.has(id))throw new Error('Wait for the appearance request to finish.');mutating.add(id);try{const items=await library(id);if(!items.some(s=>s.id===skinId))throw new Error('Saved skin not found.');await saveLibrary(id,items.filter(s=>s.id!==skinId));return snapshot(id,await readProfile(id));}finally{mutating.delete(id);}}
    };
}
