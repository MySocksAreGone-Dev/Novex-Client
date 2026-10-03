import JavaSettings from "./JavaSettings";
import NovexSelect from "./NovexSelect";
import { useEffect, useState } from 'react';
import type { LauncherSettings as Settings } from '../services/minecraftAccounts';
export default function LauncherSettings() {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { void window.novex.settings.get().then(setSettings).catch(err => setError(err.message)); }, []);
    async function change(action: () => Promise<Settings>) {
        setBusy(true); setError('');
        try { setSettings(await action()); } catch (err) { setError(err instanceof Error ? err.message : 'Settings could not be saved.'); } finally { setBusy(false); }
    }
    return <><JavaSettings /><section className="card launcher-settings"><h2>Java, storage and background behavior</h2>
        <p>Java: <code>{settings?.javaPath || 'Automatic discovery (PATH and common system locations)'}</code></p>
        <div className="account-actions"><button disabled={busy} onClick={() => void change(window.novex.settings.chooseJava)}>Select Java</button><button disabled={busy} onClick={() => void change(window.novex.settings.resetJava)}>Use automatic discovery</button></div>
        <p>New instances: <code>{settings?.instancesDirectory}</code></p><button disabled={busy} onClick={() => void change(window.novex.settings.chooseStorage)}>Choose instance storage</button><p>Existing instances keep their current folders. This does not move files.</p>
        <p>Verified downloads are reused through the Novex shared cache. Each instance retains its own installed files.</p>
        <p>Browser cache: <code>{settings?.browserCacheDirectory}</code></p>
        <p>Novex data and logs: <code>{settings?.dataDirectory}</code></p>
        <div className="settings-field"><span>When I close Novex while Minecraft is running</span><NovexSelect label="Background behavior" disabled={busy || !settings} value={settings?.backgroundMode || 'background'} options={[{value:'background',label:'Keep Novex running in background'},{value:'exit',label:'Keep Minecraft running and exit Novex'}]} onChange={value => { if (settings) void change(() => window.novex.settings.setBackground({ backgroundMode: value as Settings['backgroundMode'], backgroundNotification: settings.backgroundNotification })); }} /></div>
        <label><input type="checkbox" disabled={busy || !settings} checked={settings?.backgroundNotification ?? true} onChange={event => { if (settings) void change(() => window.novex.settings.setBackground({ backgroundMode: settings.backgroundMode, backgroundNotification: event.target.checked })); }} /> Show background notification</label>
        <p>On Linux desktops without a visible tray, launch Novex again to reopen its window.</p>
        {error && <p className="error" role="alert">{error}</p>}
    </section></>;
}
