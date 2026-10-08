import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),asar=require('@electron/asar');
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const packages=['release/win-unpacked/resources/app.asar','release/linux-unpacked/resources/app.asar'].filter(p=>fs.existsSync(p));
assert.ok(packages.length,'No packaged application found');
let checked=0;
for(const archive of packages){
 const metadata=JSON.parse(asar.extractFile(archive,'package.json'));
 assert.equal(metadata.version,version,'Packaged version must match release source');
 for(const entry of asar.listPackage(archive)){
  const name=entry.replaceAll('\\','/').replace(/^\//,'');const stat=asar.statFile(archive,name);if(stat.files)continue;
  assert.ok(!/(^|\/)(?:\.env(?:\..*)?|minecraft-accounts\.json|launcher-settings\.json|instance-paths\.json|supabase-session.*|.*\.encrypted|.*\.(?:pfx|p12|pem|key))$/i.test(name),`Private file in package: ${name}`);
  if(!/\.(?:js|cjs|mjs|json|html|css|txt|md)$/i.test(name)||stat.size>4*1024*1024)continue;
  const data=asar.extractFile(archive,name).toString('utf8');
  assert.ok(!/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(data),`Credential candidate in package: ${name}`);
  for(const match of data.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)){
   let payload;try{payload=JSON.parse(Buffer.from(match[1],'base64url'));}catch{continue;}
   assert.equal(payload.role,'anon',`Non-public JWT in package: ${name}`);
  }
  checked++;
 }
 for(const name of fs.readdirSync('electron'))if(/\.(?:js|cjs)$/.test(name))assert.deepEqual(asar.extractFile(archive,'electron/'+name),fs.readFileSync(path.join('electron',name)),`Stale packaged source: ${name}`);
}
console.log(`Package audit passed: ${packages.length} application archive(s), ${checked} text files; version and backend source match.`);
