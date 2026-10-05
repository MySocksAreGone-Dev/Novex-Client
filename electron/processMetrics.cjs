const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
async function memory(pid){
    if(!Number.isSafeInteger(pid)||pid<=0)return null;
    if(process.platform==='linux'){const text=await fs.readFile(`/proc/${pid}/status`,'utf8');const value=text.match(/^VmRSS:\s+(\d+) kB/m);return value?Number(value[1])*1024:null;}
    if(process.platform==='win32')return new Promise(resolve=>execFile('tasklist.exe',['/FI',`PID eq ${pid}`,'/FO','CSV','/NH'],{windowsHide:true,timeout:5000,maxBuffer:65536},(error,text)=>{if(error)return resolve(null);const columns=text.trim().match(/"([^"]*)"/g);if(!columns||Number(columns[1]?.replaceAll('"',''))!==pid)return resolve(null);const number=columns[4]?.replace(/\D/g,'');resolve(number?Number(number)*1024:null);}));
    return null;
}
// One sample every 30 seconds; only counters are persisted, never command arguments.
exports.monitor=(pid,directory,heapMiB)=>{
    const state={startedAt:Date.now(),updatedAt:Date.now(),peakBytes:0,nearSamples:0,growthSamples:0,samples:0},file=path.join(directory,'.novex-performance.json');
    let last=0,closed=false,tail=Promise.resolve();
    const persist=async()=>{for(const target of [file,file+'.tmp']){const stat=await fs.lstat(target).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});if(stat?.isSymbolicLink())throw new Error('Unsafe metrics path.');}await fs.writeFile(file+'.tmp',JSON.stringify(state));await fs.rename(file+'.tmp',file);};
    const sample=()=>{tail=tail.catch(()=>{}).then(async()=>{if(closed)return;const bytes=await memory(pid).catch(()=>null);state.updatedAt=Date.now();if(bytes!==null){state.samples++;state.currentBytes=bytes;state.peakBytes=Math.max(state.peakBytes,bytes);state.nearSamples=bytes>=heapMiB*1024**2*0.9?state.nearSamples+1:0;state.growthSamples=last&&bytes>last+16*1024**2?state.growthSamples+1:0;last=bytes;}await persist();}).catch(()=>{});};
    sample();const timer=setInterval(sample,30000);timer.unref();
    return async(code,signal)=>{clearInterval(timer);closed=true;await tail;state.endedAt=Date.now();state.exitCode=code;state.signal=signal;await persist().catch(()=>{});};
};
