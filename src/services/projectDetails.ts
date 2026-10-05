import type { ModrinthProject, ModrinthVersion } from './modrinth';
export type ProjectDetails=ModrinthProject & {body:string;team:string;followers:number;updated:string;game_versions:string[];client_side?:string;server_side?:string;environment?:string[];license:{id:string;name:string;url?:string};gallery:{url:string;title?:string;description?:string;featured:boolean}[]};
const cache=new Map<string,{at:number;value:unknown}>(), pending=new Map<string,Promise<unknown>>();
export async function projectRequest<T>(route:string):Promise<T>{
    const cached=cache.get(route);if(cached&&Date.now()-cached.at<5*60*1000)return cached.value as T;
    if(pending.has(route))return pending.get(route) as Promise<T>;
    const task=(async()=>{const response=await fetch(`https://api.modrinth.com/v2/${route}`,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Modrinth information is temporarily unavailable.');const value=await response.json();if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(route,{at:Date.now(),value});return value;})().finally(()=>pending.delete(route));pending.set(route,task);return task;
}
export async function projectData(id:string){
    const project=await projectRequest<ProjectDetails>(`project/${encodeURIComponent(id)}`);
    const [versions,team]=await Promise.all([projectRequest<ModrinthVersion[]>(`project/${encodeURIComponent(id)}/version`),projectRequest<{user:{username:string};role:string}[]>(`team/${encodeURIComponent(project.team)}/members`).catch(()=>[])]);
    return {project,versions,team};
}
export function safeProjectURL(value:string|undefined){try{const url=new URL(value||'');return url.protocol==='https:'&&!url.username&&!url.password?url.href:undefined;}catch{return undefined;}}
