import { activityBusy } from './activity.js';
import { app, BrowserWindow, Tray, Menu, Notification, dialog, nativeImage } from 'electron';
import { isMinecraftRunning, stopMinecraft, releaseMinecraft } from './minecraftLauncher.js';
import { getSettings } from './settings.js';
let tray;
let mainWindow;
let quitting = false;
let notified = false;
let deciding = false;
let callbacks;
export function initializeLifecycle(options) {
    callbacks = options;
    app.on('before-quit', event => { if (!quitting && isMinecraftRunning()) { event.preventDefault(); void explicitQuit(); } });
    app.on('window-all-closed', () => { if (!isMinecraftRunning() && !activityBusy()) app.quit(); });
}
export function attachMainWindow(win) {
    mainWindow = win;
    win.on('close', event => {
        if (quitting || (!isMinecraftRunning() && !activityBusy())) return;
        event.preventDefault();
        if (deciding) return;
        deciding = true;
        void (async () => {
            try {
                const settings = await getSettings();
                if (settings.backgroundMode === 'exit' && !activityBusy()) { quitLeavingGame(); return; }
                ensureTray();
                win.hide();
                for (const other of BrowserWindow.getAllWindows()) if (other !== win) other.hide();
                if (!notified && settings.backgroundNotification && Notification.isSupported()) {
                    notified = true;
                    const notice = new Notification({ title: 'Novex Client', body: 'Novex is still running for Minecraft or active downloads.' });
                    notice.on('click', openNovex); notice.show();
                }
            } catch { win.show(); }
            finally { deciding = false; }
        })();
    });
}
export function openNovex() {
    if (!mainWindow || mainWindow.isDestroyed()) callbacks.createWindow();
    else { mainWindow.show(); if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
}
function ensureTray() {
    if (!tray) {
        try {
            tray = new Tray(nativeImage.createFromPath(callbacks.icon));
            tray.setToolTip('Novex Client');
            tray.on('double-click', openNovex);
            tray.on('click', openNovex);
        } catch { return; }
    }
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Novex Client', enabled: false },
        { label: 'Open Novex', click: openNovex },
        { label: isMinecraftRunning() ? 'Minecraft: Running' : 'Minecraft: Not Running', enabled: false },
        { label: 'Stop Minecraft', enabled: isMinecraftRunning(), click: () => stopMinecraft(callbacks.log, callbacks.state) },
        { type: 'separator' }, { label: 'Quit Novex', click: () => void explicitQuit() }
    ]));
}
export function updateLifecycle() {
    if (isMinecraftRunning() || tray) ensureTray();
    if (!isMinecraftRunning() && !activityBusy() && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) { quitting = true; app.quit(); }
}
function quitLeavingGame() { quitting = true; releaseMinecraft(); tray?.destroy(); app.quit(); }
export async function explicitQuit() {
    if (isMinecraftRunning()) {
        const result = await dialog.showMessageBox({ type: 'warning', title: 'Minecraft is running', message: 'Keep Minecraft running and quit Novex?', detail: 'Novex will stop monitoring the game. Close Minecraft from its own window when you finish.', buttons: ['Cancel', 'Keep Minecraft Running & Quit Novex'], defaultId: 0, cancelId: 0 });
        if (result.response !== 1) return;
    }
    quitLeavingGame();
}
