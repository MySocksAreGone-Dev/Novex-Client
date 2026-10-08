import { PublicClientApplication } from '@azure/msal-node';
import { app, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { CLIENT_ID, AUTHORITY, REDIRECT_URI, SCOPES, createPkce, parseCallback } from './authProtocol.js';
import { authenticateMinecraft, AuthError } from './minecraftAuth.js';
import { readSecure, writeSecure, secureStorageAvailable } from './secureStore.js';
import { ensureAuthProtocol } from './protocolRegistration.js';
import { diagnostic } from './diagnostics.js';
let model;
let loading;
let operation;
let callback;
const sessions = new Map();
const authenticationStatus = new Map();
const file = () => path.join(app.getPath('userData'), 'minecraft-accounts.json');
const msal = new PublicClientApplication({
    auth: { clientId: CLIENT_ID, authority: AUTHORITY },
    system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } },
    cache: { cachePlugin: {
        beforeCacheAccess: async context => { const cache = await readSecure('msal-cache'); if (cache) context.tokenCache.deserialize(cache); },
        afterCacheAccess: async context => { if (context.cacheHasChanged) await writeSecure('msal-cache', context.tokenCache.serialize()); }
    } }
});
async function load() {
    if (model) return;
    if (loading) return loading;
    loading = loadModel();
    try { await loading; } finally { loading = undefined; }
}
async function loadModel() {
    try { model = JSON.parse(await fs.readFile(file(), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Minecraft account metadata is unreadable. Restore minecraft-accounts.json.'); model = { accounts: [], selectedId: null }; }
    if (!Array.isArray(model.accounts)) throw new Error('Minecraft account metadata is invalid.');
}
async function save() {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(file() + '.tmp', JSON.stringify(model, null, 2), { mode: 0o600 });
    await fs.rename(file() + '.tmp', file());
}
export async function getMinecraftAccounts() {
    await load();
    return { accounts: model.accounts.map(({ id, type, username, uuid, skinUrl }) => ({ id, type, username, uuid, skinUrl, authenticationStatus: type === 'local' ? 'Offline / Local Account' : authenticationStatus.get(id) || 'Refresh required before launch' })), selectedId: model.selectedId, secureStorage: await secureStorageAvailable(), busy: Boolean(operation) };
}
async function exclusive(work) {
    if (operation) throw new Error('Another Minecraft account operation is in progress.');
    const controller = new AbortController();
    operation = controller;
    try { await load(); return await work(controller); }
    catch (error) {
        if (controller.signal.aborted) throw new Error('Microsoft sign-in cancelled.');
        if (error instanceof AuthError) { void diagnostic(error); throw new Error(error.message); }
        // MSAL errors can contain request metadata. Only expose curated error codes.
        if (error.errorCode) {
            void diagnostic({ stage: 'Microsoft', serviceCode: error.errorCode });
            if (error.errorCode === 'invalid_scope') throw new Error('Microsoft rejected Novex’s Xbox sign-in permissions (invalid_scope). Use the latest Novex build and sign in again with the personal Microsoft account that owns Minecraft.');
            throw new Error(['interaction_required', 'invalid_grant', 'no_tokens_found'].includes(error.errorCode) ? 'Microsoft authentication expired. Sign in with Microsoft again.' : 'Microsoft authentication failed. Try again with your personal Microsoft account.');
        }
        throw error;
    } finally { operation = undefined; callback = undefined; }
}
export function cancelMicrosoftLogin() { if (!operation) return false; operation.abort(); return true; }
export function handleMicrosoftCallback(raw) {
    void diagnostic({ stage: callback ? 'callback received' : 'callback without active login' });
    if (!callback) return false;
    return callback(raw);
}
async function verify(result, controller, progress, expectedId) {
    if (controller.signal.aborted) throw new Error('Microsoft sign-in cancelled.');
    if (!result?.accessToken || !result.account) throw new Error('Microsoft did not return an authenticated account.');
    progress('Microsoft account authenticated');
    const session = await authenticateMinecraft(result.accessToken, { signal: controller.signal, progress: message => { void diagnostic({ stage: message }); progress(message); }, diagnostic: data => void diagnostic(data) });
    if (controller.signal.aborted) throw new Error('Microsoft sign-in cancelled.');
    const id = session.uuid;
    if (expectedId && id !== expectedId) throw new Error("Minecraft account identity changed. Sign in again.");
    const metadata = { id, type: 'microsoft', username: session.username, uuid: session.uuid, skinUrl: session.skinUrl, homeAccountId: result.account.homeAccountId };
    model.accounts = [...model.accounts.filter(account => account.id !== id), metadata];
    sessions.set(id, session);
    authenticationStatus.set(id, 'Authenticated');
    return id;
}
export function loginMicrosoft(progress = () => {}) {
    return exclusive(async controller => {
        await diagnostic({ stage: 'login requested' });
        await ensureAuthProtocol(app);
        await diagnostic({ stage: 'callback handler registered' });
        await diagnostic({ stage: 'MSAL initialized' });
        const pkce = createPkce();
        const url = await msal.getAuthCodeUrl({ scopes: SCOPES, redirectUri: REDIRECT_URI, codeChallenge: pkce.challenge, codeChallengeMethod: 'S256', state: pkce.state, prompt: 'select_account' });
        await diagnostic({ stage: 'authorization URL generated' });
        if (controller.signal.aborted) throw new Error('Microsoft sign-in cancelled.');
        progress('Opening Microsoft sign-in...');
        const code = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { callback = undefined; controller.signal.removeEventListener('abort', abort); void diagnostic({ stage: 'callback timeout' }); reject(new Error('Microsoft sign-in timed out. Check whether your browser asked to open Novex, then try again.')); }, 5 * 60 * 1000);
            const abort = () => { clearTimeout(timer); callback = undefined; reject(new Error('Microsoft sign-in cancelled.')); };
            controller.signal.addEventListener('abort', abort, { once: true });
            callback = raw => {
                // Ignore unsolicited callbacks without consuming the active attempt.
                try { if (new URL(raw).searchParams.get('state') !== pkce.state) return false; } catch { return false; }
                clearTimeout(timer); controller.signal.removeEventListener('abort', abort); callback = undefined;
                try { resolve(parseCallback(raw, pkce.state)); } catch (error) { reject(error); }
                return true;
            };
            shell.openExternal(url).then(() => { void diagnostic({ stage: 'browser opened' }); void diagnostic({ stage: 'waiting for callback' }); progress('Waiting for Microsoft...'); }).catch(() => { controller.abort(); });
        });
        await diagnostic({ stage: 'authorization code received' });
        await diagnostic({ stage: 'token exchange started' });
        const result = await msal.acquireTokenByCode({ scopes: SCOPES, redirectUri: REDIRECT_URI, code, codeVerifier: pkce.verifier });
        await diagnostic({ stage: 'token exchange succeeded' });
        const id = await verify(result, controller, progress);
        model.selectedId = id;
        await save();
        progress('Minecraft account ready.');
        return getMinecraftAccounts();
    });
}
async function refresh(id, controller, progress) {
    const metadata = model.accounts.find(account => account.id === id && account.type === 'microsoft');
    if (!metadata) throw new Error('Select a Microsoft Minecraft account.');
    const account = await msal.getTokenCache().getAccountByHomeId(metadata.homeAccountId);
    if (!account) throw new Error('Microsoft authentication expired. Sign in with Microsoft again.');
    const result = await msal.acquireTokenSilent({ account, scopes: SCOPES });
    const freshId = await verify(result, controller, progress, id);
    if (freshId !== id) throw new Error('Minecraft account identity changed. Sign in again.');
    await save();
    return sessions.get(id);
}
export const refreshMinecraftAccount = id => exclusive(async controller => { try { await refresh(id, controller, () => {}); } catch (error) { authenticationStatus.set(id, 'Sign in again or retry refresh'); throw error; } return getMinecraftAccounts(); });
export const selectMinecraftAccount = id => exclusive(async () => {
    if (!model.accounts.some(account => account.id === id)) throw new Error('Minecraft account not found.');
    model.selectedId = id; await save(); return getMinecraftAccounts();
});
export const removeMinecraftAccount = id => exclusive(async () => {
    const account = model.accounts.find(account => account.id === id);
    if (!account) throw new Error('Minecraft account not found.');
    if (account.homeAccountId) { const cached = await msal.getTokenCache().getAccountByHomeId(account.homeAccountId); if (cached) await msal.getTokenCache().removeAccount(cached); }
    sessions.delete(id);
    authenticationStatus.delete(id);
    model.accounts = model.accounts.filter(account => account.id !== id);
    if (model.selectedId === id) model.selectedId = null; // Never silently fall back to a local account.
    await save(); return getMinecraftAccounts();
});
export const addLocalAccount = username => exclusive(async () => {
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(username)) throw new Error('Local usernames need 1–16 letters, digits, or underscores.');
    const hash = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest();
    hash[6] = (hash[6] & 15) | 48; hash[8] = (hash[8] & 63) | 128;
    const uuid = hash.toString('hex'); const id = `local-${uuid}`;
    if (!model.accounts.some(account => account.id === id)) model.accounts.push({ id, type: 'local', username, uuid });
    model.selectedId = id; await save(); return getMinecraftAccounts();
});
export const getLaunchIdentity = () => exclusive(async controller => {
    const account = model.accounts.find(item => item.id === model.selectedId);
    if (!account) throw new Error('Select a Minecraft account in Settings before playing.');
    if (account.type === 'local') return { username: account.username, uuid: account.uuid, accessToken: '0', userType: 'legacy', accountId: account.id };
    // Recheck ownership/profile on every authenticated launch; no offline fallback.
    const session = await refresh(account.id, controller, () => {});
    return { ...session, accountId: account.id };
});

// Backend-only appearance access. A valid Minecraft session is reused; renewing
// it uses the same silent MSAL → Xbox → ownership flow as authenticated launch.
export async function assertAppearanceAccount(id) {
    await load();
    if(typeof id!=='string'||!/^[a-f0-9]{32}$/i.test(id)||model.selectedId!==id)throw new Error('Minecraft account changed. Refresh this page.');
    const account=model.accounts.find(item=>item.id===id&&item.type==='microsoft');
    if(!account)throw new Error('Select a Microsoft account that owns Minecraft Java to manage appearance.');
    return account;
}
export const getAppearanceSession = (id,force=false) => exclusive(async controller => {
    await assertAppearanceAccount(id);
    const current=sessions.get(id);
    if(!force&&current?.expiresAt>Date.now()+60000)return current;
    return refresh(id,controller,()=>{});
});
export const rememberMinecraftAppearance = (id,profile) => exclusive(async () => {
    const account=await assertAppearanceAccount(id);
    if(profile.uuid!==account.uuid)throw new Error('Minecraft returned a different profile. Refresh your account.');
    account.username=profile.username;
    account.skinUrl=profile.skins.find(skin=>skin.active)?.url;
    const current=sessions.get(id);
    if(current)sessions.set(id,{...current,username:account.username,skinUrl:account.skinUrl});
    await save();
});
