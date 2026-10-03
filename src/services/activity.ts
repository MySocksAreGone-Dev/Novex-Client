import { useSyncExternalStore } from 'react';
import { updateInstance, type MinecraftInstance } from './instances';
export type ActivityJob = { id:string; label:string; instanceId?:string; kind:string; status:'queued'|'running'|'complete'|'failed'|'cancelled'; cancellable:boolean; error?:string; progress:{stage?:string;current?:number;total?:number;message?:string;bytes?:number;totalBytes?:number;speed?:number;file?:string}; result?:{loaderVersion?:string} };
let jobs:ActivityJob[]=[];
const listeners=new Set<()=>void>();
const completed=new Set<string>();
let statusSignature='';
const stored=new Map<string,string>();
function receive(next:ActivityJob[]) {
    jobs=next;
    for(const job of jobs) {
        if(job.instanceId&&job.kind==='installation') {
            const status=['running','queued'].includes(job.status)?'installing':job.status==='complete'?'ready':'repair';
            const value=status+':'+(job.result?.loaderVersion||'');
            if(stored.get(job.id)!==value){stored.set(job.id,value);updateInstance(job.instanceId,{status,...(job.result?.loaderVersion?{loaderVersion:job.result.loaderVersion}:{})});}
        }
        if(['complete','failed','cancelled'].includes(job.status)&&!completed.has(job.id)) {completed.add(job.id);window.dispatchEvent(new Event('novex-instances'));}
    }
    const signature=next.map(j=>j.id+':'+j.status).join('|');
    if(signature!==statusSignature){statusSignature=signature;window.dispatchEvent(new Event('novex-instances'));}
    listeners.forEach(listener=>listener());
}
export function initializeActivity() {
    const off=window.novex.activity.onChanged(receive);
    void window.novex.activity.list().then(receive).catch(()=>{});
    return off;
}
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function useActivity() {return useSyncExternalStore(subscribe,()=>jobs);}
export function showActivity() {window.dispatchEvent(new Event('novex-show-activity'));}
export async function startInstallation(instance:MinecraftInstance,companion=false) {
    await window.novex.activity.install(instance,companion);updateInstance(instance.id,{status:'installing'});window.dispatchEvent(new Event('novex-instances'));showActivity();
}
