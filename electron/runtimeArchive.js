import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import {resolveInside} from './pathSafety.js';
export async function extractRuntime(archive,directory,format) {
    let count=0,total=0,failure;
    const links=[];
    const normalize=name=>name.replace(/^(\.\/)+/,'');
    const inspect=(raw,size,type,linkname)=>{
        const name=normalize(raw);if(!name&&type==='Directory')return;
        if(++count>30000||(total+=size)>2*1024**3)throw new Error('Runtime archive is too large.');
        resolveInside(directory,name,false);
        if(['Link','SymbolicLink'].includes(type)) {
            if(!linkname||path.posix.isAbsolute(linkname)||path.win32.isAbsolute(linkname)||linkname.includes('\\'))throw new Error('Unsafe runtime archive link.');
            const target=path.posix.normalize(type==='Link'?linkname:path.posix.join(path.posix.dirname(name),linkname));
            resolveInside(directory,target,false);links.push({name,target});
        }else if(!['File','Directory','OldFile'].includes(type))throw new Error('Unsupported runtime archive entry.');
    };
    if(format==='zip') {
        const zip=new AdmZip(archive);
        for(const entry of zip.getEntries()) {if(((entry.attr>>>16)&0o170000)===0o120000)throw new Error('Runtime ZIP contains a symbolic link.');inspect(entry.entryName,entry.header.size,entry.isDirectory?'Directory':'File');}
        for(const entry of zip.getEntries()){const target=resolveInside(directory,normalize(entry.entryName),false);if(entry.isDirectory)await fs.mkdir(target,{recursive:true});else{await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,entry.getData(),{flag:'wx'});}}
    }else {
        await tar.t({file:archive,strict:true,onReadEntry:entry=>{try{inspect(entry.path,entry.size,entry.type,entry.linkpath);}catch(error){failure ||= error;}}});
        if(failure)throw failure;
        await tar.x({file:archive,cwd:directory,strict:true,preservePaths:false,filter:(_name,entry)=>['File','Directory','OldFile'].includes(entry.type)});
        // Materialize internal file links only after regular files have been extracted.
        // No archive-controlled symlink can redirect subsequent writes outside the runtime.
        while(links.length) {
            let copied=0;
            for(let i=links.length-1;i>=0;i--){const link=links[i],source=resolveInside(directory,link.target,false),destination=resolveInside(directory,link.name,false);const stat=await fs.stat(source).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!stat)continue;if(!stat.isFile())throw new Error('Runtime link must point to a regular file.');await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(source,destination,fs.constants.COPYFILE_EXCL);links.splice(i,1);copied++;}
            if(!copied)throw new Error('Runtime archive has broken or cyclic links.');
        }
    }
}
