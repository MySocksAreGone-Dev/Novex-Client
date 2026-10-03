import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as tar from 'tar';
import AdmZip from 'adm-zip';
import {extractRuntime} from '../electron/runtimeArchive.js';
test('runtime extraction materializes safe file links and rejects escaping links before writing',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'novex-runtime-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=path.join(root,'source'),out=path.join(root,'out');await fs.mkdir(source);await fs.mkdir(out);await fs.writeFile(path.join(source,'java'),'executable');await fs.symlink('java',path.join(source,'link'));const archive=path.join(root,'runtime.tgz');await tar.c({gzip:true,file:archive,cwd:source},['java','link']);await extractRuntime(archive,out,'tar');assert.equal(await fs.readFile(path.join(out,'link'),'utf8'),'executable');assert.equal((await fs.lstat(path.join(out,'link'))).isSymbolicLink(),false);
 await fs.symlink('../../outside',path.join(source,'escape'));await tar.c({gzip:true,file:archive,cwd:source},['java','escape']);const bad=path.join(root,'bad');await fs.mkdir(bad);await assert.rejects(extractRuntime(archive,bad,'tar'),/Invalid/);assert.deepEqual(await fs.readdir(bad),[]);
});
test('runtime zip retains executable layout without arbitrary overwrite',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'novex-zip-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const archive=path.join(root,'runtime.zip'),out=path.join(root,'out');await fs.mkdir(out);const zip=new AdmZip();zip.addFile('jre/bin/java.exe',Buffer.from('runtime'));zip.writeZip(archive);await extractRuntime(archive,out,'zip');assert.equal(await fs.readFile(path.join(out,'jre/bin/java.exe'),'utf8'),'runtime');await assert.rejects(extractRuntime(archive,out,'zip'),/EEXIST/);
});
