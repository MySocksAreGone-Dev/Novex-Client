import type {MinecraftInstance} from '../services/instances';
import ContentManager from './ContentManager';
export default function InstalledMods({instance,revision}:{instance:MinecraftInstance;revision:number}){return <ContentManager instance={instance} kind="mod" revision={revision}/>;}
