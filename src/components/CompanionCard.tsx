import {useEffect,useState} from 'react';
import type {MinecraftInstance} from '../services/instances';
import {useDialogs} from './Dialogs';
import {showActivity,useActivity} from '../services/activity';
export type CompanionStatus={installed:{name:string;version:string;enabled:boolean}[];available:{version:string;modVersion:string;minecraft:string;java:number}|null;needsFabricApi?:boolean;reason?:string};
export default function CompanionCard({instance}:{instance:MinecraftInstance}) {
    const [state,setState]=useState<CompanionStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const {confirm}=useDialogs(),jobs=useActivity();
    const active=jobs.some(j=>j.instanceId===instance.id&&['running','queued'].includes(j.status));
    async function load(force=false){try{setState(await window.novex.companion.status(instance,force));}catch(e){setError(e instanceof Error?e.message:'Companion status unavailable.');}}
    useEffect(()=>{void load();},[instance.id,instance.minecraftVersion,instance.loader,active]);
    async function install(){if(!state)return;if(!await confirm(state.needsFabricApi?'Install compatible Fabric API and Novex Companion?':'Install Novex Companion for this instance?','Novex Companion'))return;setBusy(true);try{await window.novex.companion.install(instance,!!state.needsFabricApi);showActivity();}catch(e){setError(e instanceof Error?e.message:'Unable to install Companion.');}finally{setBusy(false);}}
    return <section className="card companion-card"><div className="eyebrow">NOVEX COMPANION</div><h3>Novex inside Minecraft</h3><p>Friends, messages, verified badges and partner servers.</p>{!state?<p>Checking compatibility…</p>:<><p>{state.installed.length?state.installed.map(m=>`${m.version}${m.enabled?'':' · Disabled'}`).join(', '):state.available?'Available for this Fabric instance':state.reason}</p><div className="account-actions">{state.available&&(!state.installed.length||state.installed.some(m=>m.version!==state.available?.modVersion))&&<button className="primary-button" disabled={busy||active} onClick={()=>void install()}>{state.installed.length?'Update Companion':state.needsFabricApi?'Install Fabric API + Novex':'Install Novex Companion'}</button>}<button disabled={busy||active} onClick={()=>void load(true)}>Check for Updates</button>{!!state.installed.length&&<button className="danger-button" disabled={busy||active} onClick={async()=>{if(!await confirm('Remove only Novex Companion? Other mods and Fabric API will stay installed.','Remove Companion'))return;try{await window.novex.companion.remove(instance);await load();}catch(e){setError(e instanceof Error?e.message:'Removal failed.');}}}>Remove</button>}</div></>}{error&&<p className="error">{error}</p>}</section>;
}
