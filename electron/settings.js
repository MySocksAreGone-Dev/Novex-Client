import { app, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinks } from './pathSafety.js';
let settings;
const file = () => path.join(app.getPath('userData'), 'launcher-settings.json');
export async function getSettings() {
    if (!settings) {
        try { settings = JSON.parse(await fs.readFile(file(), 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw new Error('Launcher settings are unreadable. Restore launcher-settings.json from backup.'); settings = {}; }
    }
    return { automaticJava: settings.automaticJava !== false, launchBehavior: ['keep','minimize','hide'].includes(settings.launchBehavior) ? settings.launchBehavior : 'keep', backgroundMode: settings.backgroundMode === 'exit' ? 'exit' : 'background', backgroundNotification: settings.backgroundNotification !== false, javaPath: settings.javaPath || '', instancesDirectory: settings.instancesDirectory || path.join(app.getPath('userData'), 'instances'), dataDirectory: app.getPath('userData'), browserCacheDirectory: path.join(app.getPath('sessionData'), 'Cache'), platform: process.platform };
}
async function save(patch) {
    await getSettings();
    const next = { ...settings, ...patch };
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(file() + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
    await fs.rename(file() + '.tmp', file());
    settings = next;
    return getSettings();
}
export async function chooseJava() {
    const result = await dialog.showOpenDialog({ title: 'Select Java executable', properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Java executable', extensions: ['exe'] }] } : {}) });
    if (result.canceled) return getSettings();
    const chosen = result.filePaths[0];
    if (!/^(java|javaw\.exe|java\.exe)$/.test(path.basename(chosen))) throw new Error('Select java, java.exe, or javaw.exe.');
    return save({ javaPath: chosen });
}
export const resetJava = () => save({ javaPath: '' });
export async function chooseInstanceStorage() {
    const result = await dialog.showOpenDialog({ title: 'Choose instance storage (existing files are not moved)', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return getSettings();
    const directory = assertNoSymlinks(result.filePaths[0]);
    await fs.access(directory, fs.constants.W_OK);
    return save({ instancesDirectory: directory });
}

export async function setBackgroundSettings(input) {
    if (!input || !['background', 'exit'].includes(input.backgroundMode) || typeof input.backgroundNotification !== 'boolean') throw new Error('Invalid background settings.');
    return save({ backgroundMode: input.backgroundMode, backgroundNotification: input.backgroundNotification });
}

export const setDetectedJava = javaPath => save({ javaPath });

export async function setLaunchSettings(input) {
    if (!input || typeof input.automaticJava !== 'boolean' || !['keep','minimize','hide'].includes(input.launchBehavior)) throw new Error('Invalid launcher preferences.');
    return save({automaticJava:input.automaticJava,launchBehavior:input.launchBehavior});
}
