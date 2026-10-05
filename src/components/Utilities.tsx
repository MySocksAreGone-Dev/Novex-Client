import { useEffect, useRef, useState } from 'react';
import { useDialogs } from './Dialogs';
import { updateInstance, type MinecraftInstance } from '../services/instances';

export type UtilityEntry = { name: string; detail: string; id?: string; size?: number; image?: string; updateId?: string; address?: string; notes?: string };
export type UtilityResult = { heapMiB?:number; entries: UtilityEntry[]; message?: string; total?: number; instance?: MinecraftInstance };
const sizeLabel = (bytes: number) => bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MiB` : `${(bytes / 1073741824).toFixed(2)} GiB`;
const errorMessage = (error: unknown) => String(error instanceof Error ? error.message : 'Unable to complete this operation.').replace(/^Error invoking remote method '[^']+': Error: /, '');

export default function Utilities({ instance, mode = 'tools', initialSection='', onInstancesChanged }: { instance?: MinecraftInstance; initialSection?:string; mode?: 'tools' | 'worlds' | 'screenshots'; onInstancesChanged?: () => void }) {
    const { confirm } = useDialogs();
    const loaded = useRef('');
    const [result, setResult] = useState<UtilityResult>({ entries: [] });
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [heapMiB,setHeapMiB]=useState(4096);
    const [section, setSection] = useState('');
    const [offset, setOffset] = useState(0);
    const [notes, setNotes] = useState(instance?.notes || '');
    const [group, setGroup] = useState(instance?.group || '');
    const [serverName, setServerName] = useState('');
    const [address, setAddress] = useState('');
    const [serverNotes, setServerNotes] = useState('');
    const [editIndex, setEditIndex] = useState<number | null>(null);
    useEffect(() => window.novex.utilities.onProgress(setMessage), []);
    async function run(action: string, input: Record<string, unknown> = {}, replace = true) {
        setBusy(action); setError(''); setMessage('Working…');
        try {
            const value = await window.novex.utilities.run(action, instance || null, input);
            if(value.heapMiB)setHeapMiB(value.heapMiB);
            if (replace) { setResult(value); setSection(action); }
            setMessage(value.message || 'Done.'); return value;
        } catch (error) { setError(errorMessage(error)); setMessage(''); return null; }
        finally { setBusy(''); }
    }
    useEffect(() => { const key=mode+instance?.id; if(loaded.current===key)return; loaded.current=key; if(mode === 'worlds' || mode === 'screenshots') void run(mode); }, [mode, instance?.id]);
    async function updateAll() {
        setBusy('update-all'); setError('');
        try {
            for(const entry of result.entries.filter(row => row.updateId)) {
                setMessage(`Updating ${entry.name}…`);
                await window.novex.utilities.run('update', instance, { id: entry.updateId });
            }
            setResult(await window.novex.utilities.run('updates', instance)); setMessage('Updates complete.');
        } catch(error) {setError(errorMessage(error));setMessage('Stopped. Check updates again before retrying.');}
        finally {setBusy('');}
    }
    async function saveServer() {
        const entries = [...result.entries];
        const entry = {name:serverName.trim(),address:address.trim(),notes:serverNotes.trim(),detail:address.trim()};
        if(editIndex === null) entries.push(entry); else entries[editIndex] = entry;
        if(await run('servers-save', {entries})) {setServerName('');setAddress('');setServerNotes('');setEditIndex(null);setSection('servers-list');}
    }
    const button = (label: string, action: string, input = {}) => <button className="secondary-button" disabled={!!busy} onClick={() => void run(action, input, !action.endsWith('-open'))}>{busy === action ? 'Working…' : label}</button>;
    useEffect(()=>{if(initialSection)void run(initialSection);},[initialSection]);
    return <section className="card utility-panel">
        <h2>{instance ? mode === 'worlds' ? 'Worlds & backups' : mode === 'screenshots' ? 'Screenshots' : 'Instance utilities' : 'Launcher utilities'}</h2>
        <p className="utility-muted">{instance ? 'Local tools for this instance. Stop Minecraft before copying worlds or changing mods.' : 'Java selection applies to all instances. Personal servers stay local and separate from sponsored Home content.'}</p>
        <div className="utility-actions">
            {instance && mode === 'tools' && <>{button('Check Instance', 'health')}{button('Performance Health', 'performance')}{button('Check Mod Updates', 'updates')}{button('Inspect Crash Logs', 'crash')}</>}
            {mode === 'worlds' && <>{button('Refresh Worlds', 'worlds')}{button('Open Backups', 'storage-open', {id:'backups'})}</>}
            {mode === 'screenshots' && <>{button('Refresh', 'screenshots', {offset})}{button('Open Folder', 'screenshots-open')}</>}
            {!instance && <>{button('Detect Java', 'java')}{button('Storage Usage', 'storage')}{button('Personal Servers', 'servers-list')}</>}
            {section === 'updates' && result.entries.some(row=>row.updateId) && <button className="primary-button" disabled={!!busy} onClick={() => void updateAll()}>Update All</button>}
            {section === 'crash' && <>{button('View Full Log', 'log-open')}{button('Open Reports Folder', 'crash-open')}</>}
            {section === 'storage' && <>{button('Open Instances', 'storage-open', {id:'instances'})}{button('Open Novex Data', 'storage-open', {id:'data'})}{button('Open Backups', 'storage-open', {id:'backups'})}</>}
        </div>
        {section==='performance'&&<div className="utility-actions"><label>Memory Settings (MiB)<input type="number" min={512} max={65536} step={512} value={heapMiB} onChange={e=>setHeapMiB(Number(e.target.value))}/></label><button disabled={!!busy} onClick={async()=>{if(await confirm(`Set the Java heap limit to ${heapMiB} MiB for future launches?`,'Memory Settings'))void run('memory-save',{heapMiB},false);}}>Save Memory Limit</button>{button('View Full Log','log-open')}</div>}
        {message && <p role="status" className="utility-muted">{message}</p>}
        {error && <p role="alert" className="utility-error">{error}</p>}
        <div className={mode === 'screenshots' ? 'utility-gallery' : 'utility-list'}>
            {result.entries.map((entry,index) => <article className="utility-row" key={entry.id || entry.name + index}>
                {entry.image && <img loading="lazy" src={entry.image} alt={entry.name} width="240" height="160" />}
                <div className="utility-description"><strong>{entry.name}</strong><p>{entry.detail}{entry.size !== undefined && ` · ${sizeLabel(entry.size)}`}</p>{entry.notes && <p>{entry.notes}</p>}</div>
                <div className="utility-actions">
                    {section === 'java' && <button className="secondary-button" disabled={!!busy} onClick={() => void run('java-select', {id:entry.id}, false)}>Use Java {entry.name.replace('Java ','')}</button>}
                    {section === 'updates' && entry.updateId && <button className="secondary-button" disabled={!!busy} onClick={async () => {if(await run('update',{id:entry.updateId},false)) void run('updates');}}>Update</button>}
                    {mode === 'worlds' && <><button className="secondary-button" disabled={!!busy} onClick={() => void run('world-open',{name:entry.name},false)}>Open Folder</button><button className="secondary-button" disabled={!!busy} onClick={() => void run('backup',{name:entry.name},false)}>Backup</button></>}
                    {mode === 'screenshots' && <><button className="secondary-button" disabled={!!busy} onClick={() => void run('screenshot-open',{name:entry.name},false)}>Open</button><button className="secondary-button" disabled={!!busy} onClick={() => void run('screenshot-copy',{name:entry.name},false)}>Copy Path</button><button className="danger-button" disabled={!!busy} onClick={async () => {if(await confirm(`Permanently delete ${entry.name}?`, 'Delete screenshot')) if(await run('screenshot-delete',{name:entry.name},false)) void run('screenshots',{offset});}}>Delete</button></>}
                    {section === 'servers-list' && <><button className="secondary-button" disabled={!!busy} onClick={async () => {try {await navigator.clipboard.writeText(entry.address || '');setMessage('Server address copied.');}catch{setError('Unable to copy the address.');}}}>Copy IP</button><button className="secondary-button" disabled={!!busy} onClick={() => {setEditIndex(index);setServerName(entry.name);setAddress(entry.address || '');setServerNotes(entry.notes || '');}}>Edit</button><button className="danger-button" disabled={!!busy} onClick={async () => {if(await confirm(`Remove ${entry.name} from personal servers?`)) {await run('servers-save',{entries:result.entries.filter((_,i)=>i!==index)});setSection('servers-list');setEditIndex(null);}}}>Remove</button></>}
                </div>
            </article>)}
        </div>
        {section && !busy && !result.entries.length && !error && <p className="utility-muted">No items to show.</p>}
        {mode === 'screenshots' && <div className="utility-actions"><button className="secondary-button" disabled={!!busy || offset === 0} onClick={() => {setOffset(Math.max(0,offset-20));void run('screenshots',{offset:Math.max(0,offset-20)});}}>Previous</button><span>{result.total || 0} screenshots · Page {offset/20+1}</span><button className="secondary-button" disabled={!!busy || offset+20 >= (result.total || 0)} onClick={() => {setOffset(offset+20);void run('screenshots',{offset:offset+20});}}>Next</button></div>}
        {instance && mode === 'tools' && <div className="utility-form"><h3>Personal organization</h3><label>Group<input maxLength={80} value={group} onChange={event=>setGroup(event.target.value)} placeholder="Vanilla, Modded, Servers…" /></label><label>Instance notes<textarea maxLength={4000} rows={3} value={notes} onChange={event=>setNotes(event.target.value)} /></label><button className="secondary-button" disabled={!!busy} onClick={() => {try {updateInstance(instance.id,{notes,group});onInstancesChanged?.();setMessage('Notes and group saved.');}catch{setError('Unable to save instance details. Local storage may be full.');}}}>Save Details</button></div>}
        {section === 'servers-list' && <div className="utility-form"><h3>{editIndex === null ? 'Add personal server' : 'Edit personal server'}</h3><label>Server name<input maxLength={100} value={serverName} onChange={event=>setServerName(event.target.value)} /></label><label>Address<input maxLength={253} value={address} onChange={event=>setAddress(event.target.value)} placeholder="play.example.com:25565" /></label><label>Notes<textarea maxLength={2000} rows={2} value={serverNotes} onChange={event=>setServerNotes(event.target.value)} /></label><div className="utility-actions"><button className="secondary-button" disabled={!!busy || !serverName.trim() || !address.trim()} onClick={() => void saveServer()}>Save Server</button>{editIndex !== null && <button className="secondary-button" onClick={()=>{setEditIndex(null);setServerName('');setAddress('');setServerNotes('');}}>Cancel Edit</button>}</div></div>}
    </section>;
}
