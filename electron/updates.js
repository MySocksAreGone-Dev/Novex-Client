import path from 'node:path';
import fs from 'node:fs/promises';
import { downloadToFile } from './transfer.js';
import { startActivity } from './activity.js';
import { safeSegment } from './pathSafety.js';
import { app, shell } from 'electron';
import { RELEASE_API, RELEASES_URL, RELEASE_REPOSITORY, releaseVersion } from './updateSource.js';
let cached;
let releaseData;
let lastCheck = 0;
let pending;
export function checkUpdates() {
    // No renderer URL, credentials, Supabase data, or private repository token.
    if (pending) return pending;
    if (cached && Date.now() - lastCheck < 60000) return Promise.resolve(cached);
    pending = query().finally(() => { pending = undefined; });
    return pending;
}
async function query() {
    const current = app.getVersion();
    try {
        const response = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(response.status === 404 ? 'No public release is available yet. Private repositories need a public release channel.' : 'Release information is unavailable. Try again later.');
        const body = await response.text();
        if (body.length > 2 * 1024 * 1024) throw new Error('Release information was too large.');
        const release = JSON.parse(body);
        releaseData = release;
        const newer = releaseVersion(current, release);
        const formats = process.platform === 'win32' ? ['.exe'] : ['.AppImage', '.rpm', '.deb'];
        const available = newer && newer.formats.some(format => formats.includes(format));
        cached = { formats: newer?.formats.filter(format=>formats.includes(format)) || [], current, latest: newer?.latest || current, available: Boolean(available), releasesUrl: RELEASES_URL, message: newer && !available ? 'A newer release exists, but an installer for this platform is not available yet.' : '', checkedAt: Date.now() };
        lastCheck = Date.now();
        return cached;
    } catch (error) {
        return { current, latest: null, available: false, releasesUrl: RELEASES_URL, message: error?.message?.startsWith('No public release') ? error.message : 'Could not check for updates. Check your network or try again later.', checkedAt: null };
    }
}
export async function openUpdate() {
    const result = await checkUpdates();
    if (!result.available) throw new Error(result.message || 'No newer release is available.');
    // The trusted page shows package choices and checksums. Nothing is executed.
    return shell.openExternal(`${RELEASES_URL}/tag/v${result.latest}`);
}

export async function downloadUpdate(format) {
    const status=await checkUpdates();
    if(!status.available || !status.formats?.includes(format))throw new Error('No verified update in this format is available.');
    if(process.arch!=='x64')throw new Error('Use the release page to choose a supported architecture.');
    const asset=releaseData.assets.find(a=>a.name.endsWith(format)&&/(?:x64|x86_64)/.test(a.name));
    if(!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) || !Number.isSafeInteger(asset.size))throw new Error('The update has no verified checksum. Use the official release page.');
    safeSegment(asset.name,'update filename');
    const expected=`https://github.com/${RELEASE_REPOSITORY}/releases/download/${releaseData.tag_name}/${asset.name}`;
    if(asset.browser_download_url!==expected)throw new Error('Unexpected update source.');
    return startActivity({label:`Novex ${status.latest} · ${format}`,kind:'update',cancellable:true},async()=>{
        const directory=path.join(app.getPath('userData'),'updates');await fs.mkdir(directory,{recursive:true});
        await downloadToFile(expected,path.join(directory,asset.name),{hashes:{sha256:asset.digest.slice(7)},size:asset.size,cache:false});
        return {downloaded:true};
    });
}
export const openUpdateFolder=()=>shell.openPath(path.join(app.getPath('userData'),'updates'));
