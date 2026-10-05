import { readVersionProfile } from './versionProfile.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { resolveInside } from './pathSafety.js';
import { directorySize } from './localFiles.js';
export function memoryRecommendations({totalRam,heapMiB,modCount,version,session}) {
    const entries=[];
    const modern=/^(?:1\.(?:1[8-9]|2\d)|2[6-9]\.)/.test(version);
    const recommended=Math.min(Math.floor(totalRam/1024**2*0.5),modCount>150?6144:modCount>50?4096:modern?3072:2048);
    entries.push({name:'Memory allocation',detail:`Maximum Java heap: ${heapMiB} MiB. System RAM: ${(totalRam/1024**3).toFixed(1)} GiB. Approximate starting point: ${Math.max(1024,recommended)} MiB for ${modCount} enabled mods; resource packs and other applications affect needs.`});
    if(heapMiB<recommended*0.75)entries.push({name:'Allocation may be too low',detail:'Consider increasing memory in Memory Settings if logs show memory pressure. More RAM is not always faster.'});
    if(heapMiB>totalRam/1024**2*0.7||heapMiB>12288)entries.push({name:'Excessive allocation',detail:'This heap limit may leave too little RAM for the OS or increase garbage collection pauses. Consider a smaller limit.'});
    if(session){
        entries.push({name:'Latest local session',detail:`Runtime: ${Math.round((session.endedAt||session.updatedAt||session.startedAt)-session.startedAt)/1000}s · peak process memory: ${Math.round((session.peakBytes||0)/1024**2)} MiB · exit: ${session.exitCode??(session.endedAt?'signal / unavailable':'running or interrupted')}. Process memory includes Java heap, native memory and mapped files.`});
        if(session.nearSamples>=4)entries.push({name:'Possible memory pressure',detail:'Process memory repeatedly approached the configured heap limit. RSS is not heap usage; check logs for OutOfMemoryError before changing allocation.'});
        if(session.growthSamples>=8)entries.push({name:'Possible memory growth',detail:'Process memory increased across eight 30-second samples. World loading and caching can also cause this; this is not proof of a memory leak.'});
    }
    return entries;
}
export function jvmRecommendations(args) {
    const strings=args.filter(arg=>typeof arg==='string');
    const entries=[];
    for(const prefix of ['-Xmx','-Xms'])if(strings.filter(arg=>arg.startsWith(prefix)).length>1)entries.push({name:'Conflicting JVM memory arguments',detail:`The launch profile declares multiple ${prefix} values. Novex adds its own memory limits; review custom loader metadata before changing anything.`});
    const collectors=strings.filter(arg=>/^-XX:\+Use(?:G1|Z|Shenandoah|Parallel|Serial|ConcMarkSweep)GC$/.test(arg));
    if(new Set(collectors).size>1)entries.push({name:'Conflicting garbage collectors',detail:'The launch profile enables multiple garbage collectors. Java may reject these arguments. Review the loader profile.'});
    if(strings.some(arg=>/^-XX:(?:MaxPermSize|PermSize)|^-XX:\+UseConcMarkSweepGC/.test(arg)))entries.push({name:'Possibly obsolete JVM arguments',detail:'The launch profile includes flags removed in modern Java. Check the Java error log before editing the profile.'});
    return entries;
}
export async function readMemory(root){try {const data=JSON.parse(await fs.readFile(resolveInside(root,'.novex-memory.json'),'utf8'));return Number.isInteger(data.heapMiB)&&data.heapMiB>=512&&data.heapMiB<=65536?data.heapMiB:4096;}catch{return 4096;}}
export async function saveMemory(root,value){if(!Number.isInteger(value)||value<512||value>Math.min(65536,Math.floor(os.totalmem()/1024**2)))throw new Error('Choose memory between 512 MiB and available system RAM (maximum 65536 MiB).');await fs.writeFile(resolveInside(root,'.novex-memory.json'),JSON.stringify({heapMiB:value}));}
export async function performanceHealth(root,instance) {
    const entries=[],mods=[];
    if(process.env.JAVA_TOOL_OPTIONS||process.env.JDK_JAVA_OPTIONS||process.env._JAVA_OPTIONS)entries.push({name:'Java environment overrides',detail:'Java options are set in the environment and may override or conflict with Novex settings. Review them if startup or memory behavior is unexpected.'});
    try {
        const installation=JSON.parse(await fs.readFile(resolveInside(root,'installation.json'),'utf8'));
        const profile=(await readVersionProfile(root,installation.launchVersion||instance.minecraftVersion)).data;
        const args=(profile.arguments?.jvm||[]).flatMap(arg=>typeof arg==='string'?[arg]:Array.isArray(arg.value)?arg.value:[arg.value]);
        entries.push(...jvmRecommendations([...args,'-Xms1G',`-Xmx${await readMemory(root)}M`]));
    }catch{entries.push({name:'JVM profile',detail:'Profile unavailable; run Check Instance to inspect missing installation files.'});}

    for(const name of (await fs.readdir(resolveInside(root,'mods')).catch(()=>[])).filter(n=>n.endsWith('.jar')).slice(0,1000)) {
        const file=resolveInside(root,`mods/${name}`);
        if((await fs.stat(file)).size>128*1024**2)continue;
        try {
            const zip=new AdmZip(file),fabric=zip.getEntry('fabric.mod.json'),quilt=zip.getEntry('quilt.mod.json');
            let meta;
            if(fabric&&fabric.header.size<1024*1024)meta=JSON.parse(fabric.getData().toString());
            if(quilt&&quilt.header.size<1024*1024){const q=JSON.parse(quilt.getData().toString());meta={id:q.quilt_loader?.id,version:q.quilt_loader?.version};}
            if(meta?.id)mods.push({name,id:meta.id,version:meta.version,depends:meta.depends});
            if((fabric||quilt)&&!['fabric','quilt'].includes(instance.loader)&&!zip.getEntry('META-INF/mods.toml')&&!zip.getEntry('META-INF/neoforge.mods.toml'))entries.push({name:'Possible loader mismatch',detail:`${name} declares ${fabric?'Fabric':'Quilt'} metadata; this instance uses ${instance.loader}. Compatibility bridge mods may affect this.`});
            if(meta?.depends?.minecraft && /^\d+\.\d+(?:\.\d+)?$/.test(meta.depends.minecraft) && meta.depends.minecraft!==instance.minecraftVersion)entries.push({name:'Minecraft version mismatch',detail:`${name} requires Minecraft ${meta.depends.minecraft}.`});
        }catch{/* Unknown JAR format: no guessed identity. */}
    }
    const ids=new Set(mods.map(m=>m.id));
    for(const id of ids){const matching=mods.filter(m=>m.id===id);if(matching.length>1)entries.push({name:'Duplicate mod ID',detail:`${id}: ${matching.map(m=>m.name).join(', ')}. Review Mods; nothing was deleted.`});}
    for(const mod of mods)for(const dependency of Object.keys(mod.depends||{}))if(!['minecraft','java','fabricloader','quilt_loader'].includes(dependency)&&!ids.has(dependency))entries.push({name:'Possible missing dependency',detail:`${mod.name} requires ${dependency}. It may be supplied by a bundled or unrecognized mod; check the game log.`});
    const names=(await fs.readdir(resolveInside(root,'mods')).catch(()=>[])).filter(n=>n.endsWith('.jar'));
    let session;try{session=JSON.parse(await fs.readFile(resolveInside(root,'.novex-performance.json'),'utf8'));}catch{}
    entries.unshift(...memoryRecommendations({totalRam:os.totalmem(),heapMiB:await readMemory(root),modCount:names.length,version:instance.minecraftVersion,session}));
    const options=await fs.readFile(resolveInside(root,'options.txt'),'utf8').catch(()=>'');
    for(const key of ['renderDistance','simulationDistance']){const value=Number(options.match(new RegExp(`^${key}:(\\d+)`,'m'))?.[1]);if(value>24)entries.push({name:'High viewing distance',detail:`${key}: ${value}. Reducing this can lower CPU and memory demand.`});}
    const packs=await directorySize(resolveInside(root,'resourcepacks'));if(packs>2*1024**3)entries.push({name:'Large resource packs',detail:`Resource pack files total ${(packs/1024**3).toFixed(1)} GiB. Only enabled packs affect rendering; high resolution textures can need substantial GPU memory.`});
    return {entries,heapMiB:await readMemory(root),message:'Local diagnostics only. Unknown/bundled mods and memory leaks cannot be fully verified. No settings changed.'};
}
