import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import {inspectPack,installPackContent,gameContentPath} from '../electron/packArchive.js';
import {inspectSource,copyGameContent,detectionRoots} from '../electron/importSources.js';
import {memoryRecommendations,performanceHealth,saveMemory,readMemory} from '../electron/performance.js';
import {crashHints} from '../electron/localFiles.js';
const fixture=(files=[],overrides={})=>{const zip=new AdmZip();zip.addFile('modrinth.index.json',Buffer.from(JSON.stringify({formatVersion:1,game:'minecraft',name:'Test pack',versionId:'1',dependencies:{minecraft:'1.21.11','fabric-loader':'0.18.4'},files})));for(const [name,body]of Object.entries(overrides))zip.addFile(name,Buffer.from(body));return zip.toBuffer();};
const temporary=async t=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'novex-import-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;};
const file=(name,body,env)=>({path:name,hashes:{sha1:crypto.createHash('sha1').update(body).digest('hex')},fileSize:Buffer.byteLength(body),downloads:['https://cdn.modrinth.com/test-fixture'],env});
test('pack import verifies files, excludes server-only files and layers client overrides last',async t=>{
 const root=await temporary(t);const original=global.fetch;t.after(()=>global.fetch=original);let requests=0;global.fetch=async()=>{requests++;return new Response('mod');};
 const pack=inspectPack(fixture([file('mods/client.jar','mod',{client:'required'}),file('mods/server.jar','server',{client:'unsupported'})],{'client-overrides/config/test.txt':'client','overrides/config/test.txt':'common'}));
 assert.equal(pack.loader,'fabric');assert.equal(pack.loaderVersion,'0.18.4');assert.equal(pack.minecraftVersion,'1.21.11');
 await installPackContent(pack,root);assert.equal(requests,1);assert.equal(await fs.readFile(path.join(root,'config/test.txt'),'utf8'),'client');assert.equal(await fs.readFile(path.join(root,'mods/client.jar'),'utf8'),'mod');await assert.rejects(fs.stat(path.join(root,'mods/server.jar')));
});
test('pack preflight blocks traversal, protected paths, duplicates and missing hashes',()=>{
 for(const name of ['../outside','mods/../../outside','C:/outside','mods\\bad.jar','.novex-memory.json','versions/test.json','config/accounts.json','config/.env'])assert.throws(()=>gameContentPath(name));
 assert.throws(()=>inspectPack(fixture([{...file('mods/a.jar','a'),hashes:{}}])),/hash/);
 assert.throws(()=>inspectPack(fixture([file('mods/a.jar','a'),file('mods/A.jar','a')])),/duplicate/);
 assert.throws(()=>inspectPack(fixture([],{'overrides/instance.json':'{}'})),/protected/);
});
test('copy-only folder import preserves game data and excludes credentials and symlinks',async t=>{
 const root=await temporary(t),source=path.join(root,'source'),target=path.join(root,'target');await fs.mkdir(path.join(source,'config'),{recursive:true});await fs.mkdir(path.join(source,'saves','World'),{recursive:true});await fs.mkdir(target);
 await fs.writeFile(path.join(source,'config','settings.json'),'game configuration');await fs.writeFile(path.join(source,'config','accounts.json'),'private-test');await fs.writeFile(path.join(source,'accounts.json'),'private-test');await fs.writeFile(path.join(source,'saves','World','level.dat'),'world');
 await copyGameContent(source,target);assert.equal(await fs.readFile(path.join(target,'saves','World','level.dat'),'utf8'),'world');assert.equal(await fs.readFile(path.join(source,'accounts.json'),'utf8'),'private-test');await assert.rejects(fs.stat(path.join(target,'accounts.json')));await assert.rejects(fs.stat(path.join(target,'config','accounts.json')));
 await assert.rejects(copyGameContent(source,path.join(source,'nested')),/outside/);
});
test('Prism and Modrinth metadata detect exact loader and version without account databases',async t=>{
 const root=await temporary(t);await fs.mkdir(path.join(root,'.minecraft','mods'),{recursive:true});await fs.writeFile(path.join(root,'mmc-pack.json'),JSON.stringify({components:[{uid:'net.minecraft',version:'1.21.11'},{uid:'net.fabricmc.fabric-loader',version:'0.18.4'}]}));await fs.writeFile(path.join(root,'instance.cfg'),'name=Prism fixture\n');await fs.writeFile(path.join(root,'.minecraft','mods','a.jar'),'a');
 const prism=await inspectSource(root);assert.equal(prism.name,'Prism fixture');assert.equal(prism.modCount,1);assert.equal(prism.loader,'fabric');assert.equal(prism.minecraftVersion,'1.21.11');
 await fs.unlink(path.join(root,'mmc-pack.json'));await fs.writeFile(path.join(root,'profile.json'),JSON.stringify({metadata:{name:'Modrinth fixture',game_version:'1.21.11',loader:'neoforge',loader_version:{id:'21.11.1'}}}));const modrinth=await inspectSource(root);assert.equal(modrinth.source,'Modrinth App');assert.equal(modrinth.loaderVersion,'21.11.1');
 assert.ok(detectionRoots('/home/test','/home/test/.config','linux').some(([,p])=>p.includes('PrismLauncher')));assert.ok(detectionRoots('C:/Users/Test','C:/Users/Test/AppData/Roaming','win32').some(([,p])=>p.endsWith('.minecraft')));
});
test('memory guidance and crash patterns avoid claiming a proven memory leak',()=>{
 const entries=memoryRecommendations({totalRam:8*1024**3,heapMiB:7168,modCount:200,version:'1.21.11',session:{startedAt:0,updatedAt:240000,peakBytes:7*1024**3,nearSamples:5,growthSamples:8}});
 assert.ok(entries.some(e=>e.name==='Excessive allocation'));assert.ok(entries.some(e=>e.detail.includes('not proof of a memory leak')));assert.ok(entries.some(e=>e.detail.includes('RSS is not heap usage')));assert.ok(crashHints('GC overhead limit exceeded').some(e=>e.detail.includes('memory')));
});
test('health detects local duplicate IDs, wrong loader and explicit version requirements',async t=>{
 const root=await temporary(t);await fs.mkdir(path.join(root,'mods'),{recursive:true});
 for(const name of ['first.jar','second.jar']){const zip=new AdmZip();zip.addFile('fabric.mod.json',Buffer.from(JSON.stringify({id:'fixture',version:'1',depends:{minecraft:'1.20.1','missing-library':'*'}})));await fs.writeFile(path.join(root,'mods',name),zip.toBuffer());}
 const result=await performanceHealth(root,{minecraftVersion:'1.21.11',loader:'forge'});assert.ok(result.entries.some(e=>e.name==='Duplicate mod ID'));assert.ok(result.entries.some(e=>e.name==='Possible loader mismatch'));assert.ok(result.entries.some(e=>e.name==='Minecraft version mismatch'));assert.ok(result.entries.some(e=>e.name==='Possible missing dependency'));
 await saveMemory(root,2048);assert.equal(await readMemory(root),2048);await assert.rejects(saveMemory(root,1));
});
test('archive traversal and symlink entries fail before extraction',()=>{
 const safe='overrides/aa/bb/x.txt',unsafe='overrides/../../x.txt';assert.equal(safe.length,unsafe.length);
 const bytes=fixture([],{[safe]:'bad'});let offset=0;while((offset=bytes.indexOf(safe,offset))!==-1){bytes.write(unsafe,offset);offset+=unsafe.length;}assert.throws(()=>inspectPack(bytes));
 const zip=new AdmZip(fixture([],{'overrides/config/link':'target'}));zip.getEntry('overrides/config/link').attr=(0o120777<<16)>>>0;assert.throws(()=>inspectPack(zip.toBuffer()),/symbolic/);
});
test('optional client files can be excluded without excluding required files',async t=>{
 const {transferContext}=await import('../electron/transfer.js');const root=await temporary(t);const original=global.fetch;t.after(()=>global.fetch=original);global.fetch=async()=>new Response('a');
 const pack=inspectPack(fixture([file('mods/optional.jar','a',{client:'optional'}),file('mods/required.jar','a',{client:'required'})]));
 await transferContext.run({includeOptional:false},()=>installPackContent(pack,root));await assert.rejects(fs.stat(path.join(root,'mods/optional.jar')));assert.equal(await fs.readFile(path.join(root,'mods/required.jar'),'utf8'),'a');
});
test('JVM diagnostics find memory and collector conflicts without changing arguments',async()=>{
 const {jvmRecommendations}=await import('../electron/performance.js');const args=['-Xmx2G','-Xmx4G','-XX:+UseG1GC','-XX:+UseZGC'];const copy=[...args];const result=jvmRecommendations(args);assert.ok(result.some(e=>e.name==='Conflicting JVM memory arguments'));assert.ok(result.some(e=>e.name==='Conflicting garbage collectors'));assert.deepEqual(args,copy);
});
