import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {createMinecraftAppearance,textureUrl} from '../electron/minecraftAppearance.js';
import {validateSkinPng,validateSkinModel} from '../electron/skinPng.js';
const id='1234567890abcdef1234567890abcdef',other='abcdef1234567890abcdef1234567890';
const cape='12345678-1234-1234-1234-123456789012';
const texture='https://textures.minecraft.net/texture/'+'a'.repeat(64);
const profile=()=>({id,name:'RealPlayer',skins:[{id:'aabbccdd',url:texture,variant:'CLASSIC',state:'ACTIVE'}],capes:[{id:cape,alias:'Owned cape',url:texture,state:'INACTIVE'}]});
function crc32(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
function chunk(type,data){const body=Buffer.concat([Buffer.from(type),data]),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(body));return Buffer.concat([len,body,crc]);}
function png(width=64,height=64){const h=Buffer.alloc(13);h.writeUInt32BE(width,0);h.writeUInt32BE(height,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))]);}
async function fixture(t){
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'novex-appearance-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
    const calls=[],refreshes=[],saved=[];let time=100000,selected=id,data=profile(),handler;
    const service=createMinecraftAppearance({directory,now:()=>time,assertAccount:async value=>{if(value!==selected)throw new Error('Account changed');},session:async(value,force)=>{refreshes.push(force);return {accessToken:force?'renewed-secret':'minecraft-secret'};},rememberProfile:async(value,p)=>saved.push(p),fetcher:async(url,options)=>{
        calls.push({url,options});if(handler)return handler(url,options);
        if(url===texture)return new Response(png());
        if(options.method==='POST'){data.skins[0].variant=options.body.get('variant').toUpperCase();}
        if(options.method==='PUT'){data.capes[0].state='ACTIVE';}
        if(options.method==='DELETE'&&url.endsWith('/capes/active'))data.capes[0].state='INACTIVE';
        if(options.method==='DELETE'&&url.endsWith('/skins/active'))data.skins=[];
        return new Response(JSON.stringify(data));
    }});
    return {service,calls,refreshes,saved,directory,advance:()=>time+=61000,select:value=>selected=value,respond:fn=>handler=fn};
}
test('appearance profile is cached, account-scoped, token-free and can explicitly refresh',async t=>{
    const f=await fixture(t);const [a,b]=await Promise.all([f.service.get(id),f.service.get(id)]);assert.deepEqual(a,b);assert.equal(a.capes.length,1);assert.equal(a.skins[0].active,true);assert.equal(f.calls.length,1);assert.equal(JSON.stringify(a).includes('secret'),false);assert.equal(f.calls[0].options.headers.Authorization,'Bearer minecraft-secret');assert.equal(f.calls[0].options.redirect,'error');await f.service.get(id,true);assert.equal(f.calls.length,1);f.advance();await f.service.get(id,true);assert.equal(f.calls.length,2);f.select(other);await assert.rejects(f.service.get(id),/changed/);
});
test('Classic and Slim uploads use multipart, save local copies, and require explicit apply',async t=>{
    const f=await fixture(t);const draft=await f.service.prepare(id,png(),'Test skin');assert.equal(f.calls.length,0);
    let result=await f.service.applyUpload(id,draft.draftId,'classic');assert.equal(result.skins[0].model,'classic');assert.equal(result.saved.length,1);assert.equal(f.calls[0].url,'https://api.minecraftservices.com/minecraft/profile/skins');assert.equal(f.calls[0].options.body.get('file').type,'image/png');assert.equal(f.calls[0].options.body.get('variant'),'classic');assert.equal(f.calls[0].options.headers['Content-Type'],undefined);
    f.advance();const next=await f.service.prepare(id,png(),'Slim skin');result=await f.service.applyUpload(id,next.draftId,'slim');assert.equal(result.skins[0].model,'slim');assert.equal(result.saved.length,2);
    f.advance();result=await f.service.setSkin(id,result.saved[0].id,'classic');assert.equal(result.skins[0].model,'classic');
    const mutations=f.calls.length;result=await f.service.deleteSaved(id,result.saved[0].id);assert.equal(result.saved.length,1);assert.equal(f.calls.length,mutations);assert.equal(result.skins[0].active,true);
    const stored=await fs.readFile(path.join(f.directory,id+'.json'),'utf8');assert.equal(stored.includes('minecraft-secret'),false);
});
test('owned capes can be selected/disabled, invented capes are blocked, and custom skin can reset',async t=>{
    const f=await fixture(t);let result=await f.service.get(id);assert.equal(result.capes[0].active,false);
    await assert.rejects(f.service.setCape(id,'not-owned'),/owned/);assert.equal(f.calls.some(c=>c.options.method==='PUT'),false);
    f.advance();result=await f.service.setCape(id,cape);assert.equal(result.capes[0].active,true);const call=f.calls.find(c=>c.options.method==='PUT');assert.equal(call.url.endsWith('/capes/active'),true);assert.deepEqual(JSON.parse(call.options.body),{capeId:cape});
    f.advance();result=await f.service.disableCape(id);assert.equal(result.capes[0].active,false);assert.equal(result.capes.length,1);
    f.advance();result=await f.service.resetSkin(id);assert.equal(result.skins.length,0);assert.equal(f.calls.at(-1).url.endsWith('/skins/active'),true);
});
test('401 refreshes the existing Minecraft session once; persistent errors never expose response credentials',async t=>{
    const f=await fixture(t);f.respond((_url,options)=>options.headers.Authorization.includes('renewed')?new Response(JSON.stringify(profile())):new Response('private-response-token',{status:401}));await f.service.get(id);assert.deepEqual(f.refreshes,[false,true]);
    for(const status of [401,403,404,429,500]){const g=await fixture(t);g.respond(()=>new Response('minecraft-secret password private-response-token',{status}));await assert.rejects(g.service.get(id),error=>!error.message.includes('secret')&&!error.message.includes('private-response-token'));assert.equal(g.calls.length,status===401?2:1);if(status===429){await assert.rejects(g.service.get(id),/rate limiting/);assert.equal(g.calls.length,1);}}
    const broken=await fixture(t);broken.respond(()=>{throw Error('secret-token');});await assert.rejects(broken.service.get(id),e=>/network/.test(e.message)&&!e.message.includes('secret'));
});
test('account switching drops stale responses and invalidates upload previews',async t=>{
    const f=await fixture(t);let finish;f.respond(()=>new Promise(resolve=>finish=resolve));const draft=await f.service.prepare(id,png(),'Draft');const pending=f.service.get(id);await new Promise(resolve=>setImmediate(resolve));f.select(other);f.service.cancel();finish(new Response(JSON.stringify(profile())));await assert.rejects(pending,/changed/);assert.equal(f.saved.length,0);
    f.select(id);await assert.rejects(f.service.applyUpload(id,draft.draftId,'classic'),/expired|changed/);
});
test('mutation without a returned profile refreshes once and signals accepted-but-refresh-failed clearly',async t=>{
    const f=await fixture(t);f.respond((_url,options)=>options.method==='DELETE'?new Response(null,{status:204}):new Response(JSON.stringify(profile())));const r=await f.service.disableCape(id);assert.equal(r.accountId,id);assert.equal(f.calls.length,2);
    f.advance();f.respond((_url,options)=>options.method==='DELETE'?new Response(null,{status:204}):new Response(null,{status:503}));const result=await f.service.disableCape(id);assert.match(result.warning,/accepted.*refresh failed/);assert.equal(result.capes.length,0);
});
test('invalid, corrupt, oversized and wrong-dimension PNGs are rejected before a request',async t=>{
    assert.deepEqual(validateSkinPng(png()),{width:64,height:64});assert.deepEqual(validateSkinPng(png(64,32)),{width:64,height:32});assert.throws(()=>validateSkinPng(png(128,64)),/64/);assert.throws(()=>validateSkinPng(Buffer.from('fake.png')),/corrupt/);assert.throws(()=>validateSkinPng(Buffer.alloc(1024*1024+1)),/MiB/);const damaged=png();damaged[damaged.length-1]^=1;assert.throws(()=>validateSkinPng(damaged),/corrupt/);assert.throws(()=>validateSkinPng(png().subarray(0,-12)),/corrupt/);assert.throws(()=>validateSkinModel('slim',32),/Classic/);
    const f=await fixture(t);await assert.rejects(f.service.prepare(id,Buffer.from('bad'),'Bad'),/corrupt/);assert.equal(f.calls.length,0);
});
test('untrusted texture hosts and mismatched profile identities cannot be used',async t=>{
    for(const url of ['javascript:alert(1)','https://evil.example/a.png','https://textures.minecraft.net@evil.example/a','https://textures.minecraft.net/texture/'+ 'a'.repeat(64)+'?token=x'])assert.equal(textureUrl(url),undefined);
    const f=await fixture(t);f.respond(()=>new Response(JSON.stringify({...profile(),id:other})));await assert.rejects(f.service.get(id),/different/);assert.equal(f.saved.length,0);
});
test('current skin can change model without sending auth to texture URLs; malformed refresh fails safely',async t=>{
    const f=await fixture(t);const result=await f.service.setSkin(id,'aabbccdd','slim');assert.equal(result.skins[0].model,'slim');const textureCall=f.calls.find(c=>c.url===texture);assert.equal(textureCall.options.headers,undefined);assert.equal(textureCall.options.redirect,'error');assert.equal(f.calls.at(-1).options.body.get('variant'),'slim');
    const broken=await fixture(t);broken.respond(()=>new Response(JSON.stringify({id,name:'RealPlayer'})));await assert.rejects(broken.service.get(id),/missing/);
});
test('saved skins persist per account and expired drafts never mutate Minecraft',async t=>{
    const f=await fixture(t);const draft=await f.service.prepare(id,png(),'Account A');await f.service.applyUpload(id,draft.draftId,'classic');assert.equal((await f.service.get(id)).saved.length,1);f.select(other);f.respond(()=>new Response(JSON.stringify({...profile(),id:other,name:'OtherPlayer'})));assert.equal((await f.service.get(other)).saved.length,0);
    const pending=await f.service.prepare(other,png(),'Expired');for(let i=0;i<11;i++)f.advance();const count=f.calls.length;await assert.rejects(f.service.applyUpload(other,pending.draftId,'classic'),/expired/);assert.equal(f.calls.length,count);
});
test('damaged local skin library does not misreport a successful Minecraft change',async t=>{
    const f=await fixture(t);await fs.writeFile(path.join(f.directory,id+'.json'),'{broken');
    const result=await f.service.setCape(id,cape);assert.equal(result.capes[0].active,true);assert.deepEqual(result.saved,[]);assert.match(result.warning,/local saved-skin library/);assert.equal(await fs.readFile(path.join(f.directory,id+'.json'),'utf8'),'{broken');
});
