import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {downloadToFile,configureDownloads,parallelFiles} from '../electron/transfer.js';
import {startActivity,listActivity,cancelActivity,retryActivity,configureActivity} from '../electron/activity.js';
import {readInstallState,writeInstallState} from '../electron/installationState.js';
const hash=bytes=>({sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
test('verified transfers reuse cache, repair corruption and never replace good files on failure',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'novex-transfer-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 configureDownloads(path.join(root,'cache'));
 const original=global.fetch;t.after(()=>global.fetch=original);
 let calls=0;const bytes=Buffer.from('verified library');
 global.fetch=async()=>{calls++;return new Response(bytes);};
 const first=path.join(root,'first.jar'),second=path.join(root,'second.jar');
 await downloadToFile('https://example.invalid/library',first,{hashes:hash(bytes),size:bytes.length});
 await downloadToFile('https://example.invalid/library',second,{hashes:hash(bytes),size:bytes.length});assert.equal(calls,1);
 await fs.writeFile(second,'corrupted');await downloadToFile('https://example.invalid/library',second,{hashes:hash(bytes),size:bytes.length});assert.equal(calls,1);assert.deepEqual(await fs.readFile(second),bytes);
 global.fetch=async()=>new Response('bad');
 await assert.rejects(downloadToFile('https://example.invalid/new',first,{hashes:hash(Buffer.from('new')),cache:false}),/integrity/);
 assert.deepEqual(await fs.readFile(first),bytes);assert.equal((await fs.readdir(root)).some(n=>n.endsWith('.part')),false);
 const abort=new AbortController();abort.abort();await assert.rejects(downloadToFile('https://example.invalid/x',second,{hashes:hash(bytes),signal:abort.signal}),{name:'AbortError'});
});
test('parallel transfers respect concurrency limit and await running tasks after failure',async()=>{
 let active=0,peak=0,finished=0;
 await parallelFiles(Array.from({length:20}),async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;finished++;},4);
 assert.equal(finished,20);assert.equal(peak,4);
 await assert.rejects(parallelFiles([1,2,3],async n=>{active++;await new Promise(r=>setTimeout(r,2));active--;if(n===1)throw new Error('interrupted');},2),/interrupted/);assert.equal(active,0);
});
const terminal=id=>new Promise(resolve=>{const interval=setInterval(()=>{const job=listActivity().find(j=>j.id===id);if(job&&!['queued','running'].includes(job.status)){clearInterval(interval);resolve(job);}},5);});
test('background jobs survive view unsubscribe, cancel safely, and retry with a new controller',async()=>{
 configureActivity(()=>{});let release;const gate=new Promise(r=>release=r);
 const id=startActivity({label:'Instance',directory:'/test-only/instance',cancellable:true},async(_p,signal)=>{await gate;signal.throwIfAborted();return 'ready';});
 assert.throws(()=>startActivity({label:'duplicate',directory:'/test-only/instance'},async()=>{}),/already running/);
 configureActivity(()=>{});cancelActivity(id);release();assert.equal((await terminal(id)).status,'cancelled');
 const retried=retryActivity(id);assert.equal((await terminal(retried)).status,'complete');
});
test('interrupted instance state stays incomplete and ready is explicit',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'novex-state-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 assert.equal((await readInstallState(root)).status,'repair');await writeInstallState(root,{status:'installing'});assert.equal((await readInstallState(root)).status,'installing');await writeInstallState(root,{status:'ready'});assert.equal((await readInstallState(root)).status,'ready');
});
