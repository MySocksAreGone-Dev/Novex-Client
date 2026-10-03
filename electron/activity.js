import crypto from 'node:crypto';
import { transferContext } from './transfer.js';
const jobs=new Map();
let notify=()=>{}, tail=Promise.resolve();
export function configureActivity(callback) {notify=callback;}
export function listActivity() {return [...jobs.values()].map(({task,controller,...job})=>job);}
const emit=()=>notify(listActivity());
export function activityBusy(directory) {return [...jobs.values()].some(j=>['queued','running'].includes(j.status)&&(!directory||j.directory===directory));}
export function startActivity({label,directory,instanceId,kind='installation',cancellable=false},task) {
    if(directory && activityBusy(directory))throw new Error('An operation is already running for this instance.');
    const job={id:crypto.randomUUID(),label,directory,instanceId,kind,status:'queued',cancellable,progress:{},task,controller:new AbortController()};
    jobs.set(job.id,job);
    for(const [id,old] of jobs) if(jobs.size>40&&!['running','queued'].includes(old.status))jobs.delete(id);
    emit();
    tail=tail.catch(()=>{}).then(async()=>{
        if(job.controller.signal.aborted){job.status='cancelled';emit();return;}
        job.status='running';emit();
        let last=0;
        const progress=data=>{job.progress={...(data.stage&&data.stage!==job.progress.stage?{}:job.progress),...data};if(Date.now()-last>150){last=Date.now();emit();}};
        try {
            job.result=await transferContext.run({signal:job.controller.signal,progress},()=>task(progress,job.controller.signal));
            job.status='complete';job.progress={...job.progress,current:1,total:1,message:'Ready'};
        }catch(error){job.status=job.controller.signal.aborted?'cancelled':'failed';job.error=String(error.message||'Operation failed.').slice(0,1000);}
        emit();
    });
    return job.id;
}
export function cancelActivity(id) {const job=jobs.get(id);if(!job||!job.cancellable||!['running','queued'].includes(job.status))throw new Error('This operation cannot be cancelled.');job.controller.abort();return true;}
export function retryActivity(id) {const job=jobs.get(id);if(!job||!['failed','cancelled'].includes(job.status))throw new Error('This operation cannot be retried.');return startActivity(job,job.task);}
export async function trackedActivity(options,task) {
    const id=startActivity(options,task);
    // No polling: the queue promise resolves when this job's work is complete.
    const finished=tail;
    await finished;
    const job=jobs.get(id);
    if(job.status!=='complete')throw new Error(job.error||'Operation cancelled.');
    return job.result;
}
