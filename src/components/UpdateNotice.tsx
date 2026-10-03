import {showActivity} from '../services/activity';
import { useEffect, useState } from 'react';
export interface UpdateStatus { formats?:string[]; current: string; latest: string | null; available: boolean; releasesUrl: string; message: string; checkedAt: number | null; }
export default function UpdateNotice({ settings = false }: { settings?: boolean }) {
    const [status, setStatus] = useState<UpdateStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function check() {
        setBusy(true); setError('');
        try { setStatus(await window.novex.updates.check()); } catch { setError('Update check is unavailable. Try again later.'); } finally { setBusy(false); }
    }
    useEffect(() => { void check(); }, []);
    if (!settings && !status?.available) return null;
    return <section className={status?.available ? 'update-card' : 'card launcher-settings'}>
        <h2>{status?.available ? 'Novex Update Available' : 'Novex updates'}</h2>
        <p>Current: v{status?.current || '…'}{status?.available && <> · Latest: v{status.latest}</>}</p>
        {status?.available && <><p>Download the installer for your system from the official release page. Installing an update preserves Novex’s data directory and existing instance folders.</p><button className="primary-button" onClick={() => void window.novex.updates.open().catch(() => setError('The update page could not be opened. Try checking again.'))}>Release Page ↗</button>{status.formats?.map(format=><button key={format} className="primary-button" onClick={async()=>{try{await window.novex.updates.download(format);showActivity();}catch(e){setError(e instanceof Error?e.message:'Unable to download update.');}}}>Download {format}</button>)}<p>Linux: use the same package format as your current installation. Windows: run the new NSIS installer. Verify SHA256SUMS from the release before installing.</p></>}
        {settings && <><button className="secondary-button" disabled={busy} onClick={() => void check()}>{busy ? 'Checking…' : 'Check for Updates'}</button><p role="status">{status?.message || (status && !status.available ? 'Novex is up to date.' : '')}</p></>}
        {error && <p role="alert">{error}</p>}
    </section>;
}
