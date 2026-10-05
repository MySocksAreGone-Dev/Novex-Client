import { transferContext } from './transfer.js';
import { registerLauncherFeatures } from './launcherFeatures.js';
import { activityBusy, trackedActivity } from './activity.js';
import { identifyInstalledMods } from './modIdentity.js';
import launchDiagnostics from './launchDiagnostics.cjs';
import { listInstalledMods, setModEnabled } from './fileManager.js';
import { runUtility, utilitiesBusy } from './utilities.js';
import { checkUpdates, openUpdate, downloadUpdate, openUpdateFolder } from './updates.js';
import { pathToFileURL } from 'node:url';
import { getSettings, chooseJava, resetJava, chooseInstanceStorage, setBackgroundSettings } from './settings.js';
import { safeSegment } from './pathSafety.js';
import { diagnostic, minecraftDiagnostic } from './diagnostics.js';
import { readSecure, writeSecure } from './secureStore.js';
import { AUTH_SCHEME } from './authProtocol.js';
import { loginMicrosoft, cancelMicrosoftLogin, handleMicrosoftCallback, getMinecraftAccounts, selectMinecraftAccount, removeMinecraftAccount, refreshMinecraftAccount, addLocalAccount, getLaunchIdentity } from './minecraftAccounts.js';
import { initializeLifecycle, attachMainWindow, updateLifecycle, openNovex } from './lifecycle.js';
import {
    app,
    BrowserWindow,
    ipcMain,
    shell
} from "electron";

import {
    launchMinecraft,
    stopMinecraft,
    isMinecraftRunning,
    getMinecraftState
} from "./minecraftLauncher.js";

import path from "path";
import { fileURLToPath } from "url";

import {
    createInstanceDirectory,
    deleteInstanceDirectory,
    getInstanceDirectory,
    validateInstanceDirectory
} from "./instanceManager.js";

import {
    installMinecraft,
    cancelMinecraftInstall
} from "./minecraftInstaller.js";

import {
    listFiles,
    createFolder,
    deletePath,
    renamePath,
    readText,
    writeText
} from "./fileManager.js";

import {
    installMod,
    installFavorites,
    installModpack,
    installResourcePack
} from "./modrinthManager.js";


const __filename =
    fileURLToPath(import.meta.url);

const __dirname =
    path.dirname(__filename);


/*
 * MINECRAFT CONSOLE WINDOW
 */

let consoleWindow = null;
let mainWindow = null;
let activeLaunch = null;
let launchPending = false;
let recentGameLog = '';
let lastLaunchMessage = '';
const trustedContents = new WeakSet();
const originalHandle = ipcMain.handle.bind(ipcMain);
let activeMutations = 0;
let togglingMod = false;
function handle(channel, listener) {
    originalHandle(channel, async (event, ...args) => {
        const expected = app.isPackaged ? pathToFileURL(path.join(__dirname, '../dist/index.html')).href : 'http://localhost:5173/';
        if (!trustedContents.has(event.sender) || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url.split('#')[0] !== expected) throw new Error('Untrusted IPC sender.');
        const mutation = /^(instances:(create|delete)|minecraft:(launch|install)|fabric:|mods:(install|setEnabled)|modpacks:install|resourcepacks:install|settings:(java|storage)|files:(delete|write|rename|create))/.test(channel);
        if (mutation && channel !== 'instances:create' && activityBusy()) throw new Error('Wait for active background tasks before modifying instance files.');
        if (mutation && togglingMod) throw new Error('Wait for the mod toggle to finish.');
        if (mutation && utilitiesBusy()) throw new Error('Wait for the current instance utility operation to finish.');
        if(mutation) activeMutations++;
        try {
            if (args.some(arg => typeof arg === 'string' && arg.length > 2 * 1024 * 1024)) throw new Error('Input is too large.');
            if (/^(minecraft:install|mods:install|modpacks:install|resourcepacks:install)$/.test(channel)) {
                return await trackedActivity({label:channel==='minecraft:install'?'Minecraft installation':`${args[0]?.name || 'Instance'} · ${channel.split(':')[0]}`,kind:'download'},()=>listener(event,...args));
            }
            return await listener(event, ...args);
        } catch (error) {
            void diagnostic({ stage: channel, serviceCode: error.code || 'operation_failed' });
            const friendly = error.code === 'EACCES' || error.code === 'EPERM' ? 'Permission denied. Choose a writable location and check file permissions.' : error.name === 'AbortError' ? 'Operation cancelled.' : error.message === 'fetch failed' ? 'Network unavailable. Check your connection and try again.' : String(error.message || 'Operation failed.').split('\n')[0].slice(0, 400);
            throw new Error(friendly);
        } finally { if(mutation) activeMutations--; }
    });
}
function broadcast(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}
function gameLog(message) { recentGameLog = (recentGameLog + String(message) + '\n').slice(-256 * 1024); lastLaunchMessage = String(message).slice(-1000); void minecraftDiagnostic(message); broadcast('minecraft:log', message); sendConsoleLog(message); }
function gameState(state) {
    if(state === 'starting') { recentGameLog = ''; lastLaunchMessage = ''; }
    broadcast('minecraft:state', state);
    if (['stopped', 'crashed'].includes(state)) activeLaunch = null;
    updateLifecycle();
}
function launchOptions(options) {
    if (!options || typeof options !== 'object') throw new Error('Invalid Minecraft options.');
    safeSegment(options.version, 'Minecraft version');
    if (!['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].includes(options.loader)) throw new Error('Invalid loader.');
    if (options.loaderVersion) safeSegment(options.loaderVersion, 'loader version');
    return { instanceDirectory: validateInstanceDirectory(options.instanceDirectory), version: options.version, loader: options.loader, loaderVersion: options.loaderVersion };
}

registerLauncherFeatures(handle, broadcast, () => launchPending || isMinecraftRunning() || activeMutations > 0 || utilitiesBusy());

handle('content:installed', async (_event,instance) => {const root=await getInstanceDirectory(instance);const entries=(await Promise.all(['mods','resourcepacks'].map(folder=>identifyInstalledMods(root,folder)))).flat();return entries.map(entry=>({projectId:entry.version.project_id,versionId:entry.version.id,name:entry.version.name}));});
handle('mods:installedProjects', async (_event, instance) => [...new Set((await identifyInstalledMods(await getInstanceDirectory(instance))).map(entry=>entry.version.project_id))]);
handle('mods:list', async (_event, instance) => listInstalledMods(await getInstanceDirectory(instance)));
handle('mods:setEnabled', async (_event, instance, name, enabled) => {
    if(launchPending || isMinecraftRunning() || activeMutations > 1) throw new Error('Stop Minecraft and wait for installations before changing mods.');
    togglingMod = true;
    try { return await setModEnabled(await getInstanceDirectory(instance), name, enabled); }
    finally { togglingMod = false; }
});
handle('utilities:run', (_event, action, instance, input) => {
    if((activityBusy() || activeMutations) && !['servers-list','storage','java','storage-open'].includes(action)) throw new Error('Wait for the current installation or file operation to finish.');
    return runUtility(action, instance, input, { progress: message => broadcast('utilities:progress', message), running: () => launchPending || isMinecraftRunning() });
});
handle('external:open', (_event, value) => {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) throw new Error('Invalid link.');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS links are allowed.');
    return shell.openExternal(url.href);
});
handle('updates:check', () => checkUpdates());
handle('updates:open', () => openUpdate());
handle('updates:download', (_event, format) => downloadUpdate(format));
handle('updates:folder', () => openUpdateFolder());
handle('settings:get', () => getSettings());
handle('settings:java', () => chooseJava());
handle('settings:java-reset', () => resetJava());
handle('settings:storage', () => chooseInstanceStorage());
handle('settings:background', (_event, input) => setBackgroundSettings(input));
handle('minecraft-accounts:list', () => getMinecraftAccounts());
handle('minecraft-accounts:login', () => loginMicrosoft(message => broadcast('minecraft-accounts:progress', message)));
handle('minecraft-accounts:cancel', () => cancelMicrosoftLogin());
for (const [channel, action] of [['select', selectMinecraftAccount], ['remove', removeMinecraftAccount], ['refresh', refreshMinecraftAccount]]) {
    handle('minecraft-accounts:' + channel, (_event, id) => { if (typeof id !== 'string' || !/^(local-)?[a-f0-9]{32}$/i.test(id)) throw new Error('Invalid Minecraft account ID.'); return action(id); });
}
handle('minecraft-accounts:local', (_event, name) => addLocalAccount(name));
handle('minecraft:status', () => ({ state: getMinecraftState(), lastError: lastLaunchMessage, ...activeLaunch }));
// Fixed-purpose Supabase session storage. Minecraft credentials never use this IPC.
handle('social-session:read', () => readSecure('supabase-session'));
handle('social-session:write', (_event, value) => { if (typeof value !== 'string' || value.length > 131072) throw new Error('Invalid social session.'); return writeSecure('supabase-session', value); });

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', (_event, argv) => {
    for (const value of argv) if (value.startsWith(AUTH_SCHEME + '://')) handleMicrosoftCallback(value);
    openNovex();
});
app.on('open-url', (event, url) => { event.preventDefault(); handleMicrosoftCallback(url); });
initializeLifecycle({ createWindow, icon: path.join(__dirname, '../public/novex.png'), log: gameLog, state: gameState });



/*
 * ESCAPE HTML
 */

function escapeHtml(value) {

    return String(value ?? "").replace(
        /[&<>"']/g,
        character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[character])
    );

}


/*
 * CREATE MINECRAFT CONSOLE
 */

function createConsoleWindow(
    instanceName = "Minecraft"
) {

    if (
        consoleWindow &&
        !consoleWindow.isDestroyed()
    ) {

        consoleWindow.focus();

        consoleWindow.webContents
            .executeJavaScript(
                `window.novexConsole?.setInstance(${JSON.stringify(
                    String(instanceName)
                )})`
            )
            .catch(() => {});

        return consoleWindow;

    }


    consoleWindow =
        new BrowserWindow({

            width: 980,

            height: 620,

            minWidth: 700,

            minHeight: 420,

            title:
                `Minecraft Console — ${instanceName}`,

            backgroundColor:
                "#090a0b",

            autoHideMenuBar:
                true,

            webPreferences: {

                contextIsolation:
                    true,

                nodeIntegration:
                    false,

                sandbox:
                    true

            }

        });


    const html =
        `<!doctype html>

<html>

<head>

<meta charset="UTF-8">

<title>
Minecraft Console
</title>

<style>

* {
    box-sizing: border-box;
}

html,
body {

    width: 100%;

    height: 100%;

    margin: 0;

    background: #090a0b;

    color: #e7e8ea;

    font-family:
        Inter,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

    overflow: hidden;

}

body {

    display: flex;

    flex-direction: column;

}

.header {

    height: 68px;

    display: flex;

    align-items: center;

    justify-content: space-between;

    padding: 0 18px;

    border-bottom:
        1px solid #24272b;

    background:
        #101214;

}

.eyebrow {

    font-size: 9px;

    font-weight: 800;

    letter-spacing: .16em;

    color: #666b72;

    text-transform: uppercase;

}

.title {

    margin-top: 3px;

    font-size: 14px;

    font-weight: 750;

}

.actions {

    display: flex;

    gap: 7px;

}

.actions button {

    border:
        1px solid #30343a;

    background:
        #181a1d;

    color:
        #cfd1d4;

    border-radius:
        8px;

    padding:
        8px 11px;

    cursor:
        pointer;

}

.actions button:hover {

    background:
        #202328;

}

.output {

    flex: 1;

    overflow:
        auto;

    padding:
        14px 16px;

    font:
        12px/1.55
        Consolas,
        "Cascadia Mono",
        "Courier New",
        monospace;

    white-space:
        pre-wrap;

    word-break:
        break-word;

    background:
        #070809;

}

.line {

    display:
        block;

}

.normal {

    color:
        #c5c8cc;

}

.warn {

    color:
        #d0bd7c;

}

.error {

    color:
        #df8f8f;

}

.empty {

    color:
        #555a60;

}

.footer {

    height:
        45px;

    display:
        flex;

    align-items:
        center;

    gap:
        12px;

    padding:
        0 16px;

    border-top:
        1px solid #24272b;

    background:
        #101214;

    color:
        #656a70;

    font-size:
        10px;

}

.footer label {

    display:
        flex;

    gap:
        6px;

    align-items:
        center;

}

.count {

    margin-left:
        auto;

}

.output::-webkit-scrollbar {

    width:
        8px;

}

.output::-webkit-scrollbar-thumb {

    background:
        #30343a;

    border-radius:
        99px;

}

</style>

</head>

<body>

<header class="header">

<div>

<div class="eyebrow">

NOVEX CLIENT

</div>

<div
    class="title"
    id="instance"
>

${escapeHtml(instanceName)}

</div>

</div>

<div class="actions">

<button id="clear">

Clear

</button>

<button id="copy">

Copy

</button>

</div>

</header>

<main
    id="output"
    class="output"
>

<span
    id="empty"
    class="empty"
>

Waiting for Minecraft output...

</span>

</main>

<footer class="footer">

<label>

<input
    id="auto"
    type="checkbox"
    checked
>

Auto-scroll

</label>

<span
    id="count"
    class="count"
>

0 lines

</span>

</footer>

<script>

const output =
    document.getElementById("output");

const empty =
    document.getElementById("empty");

const count =
    document.getElementById("count");

const auto =
    document.getElementById("auto");

const instance =
    document.getElementById("instance");

let lines = [];


function add(message) {

    if (empty) {
        empty.remove();
    }

    const parts =
        String(message)
            .split(/(?<=\\\\n)/);

    for (
        const text of parts
    ) {

        if (!text) {
            continue;
        }

        const span =
            document.createElement(
                "span"
            );

        span.className =
            "line " +
            (
                /error|exception|fatal/i
                    .test(text)
                    ? "error"
                    : /warn/i.test(text)
                        ? "warn"
                        : "normal"
            );

        span.textContent =
            text;

        output.appendChild(
            span
        );

        lines.push(text);

    }

    count.textContent =
        lines.length +
        " lines";

    if (
        auto.checked
    ) {

        output.scrollTop =
            output.scrollHeight;

    }

}


document
    .getElementById("clear")
    .onclick = () => {

        lines = [];

        output.innerHTML =
            "";

        count.textContent =
            "0 lines";

    };


document
    .getElementById("copy")
    .onclick = async () => {

        try {

            await navigator.clipboard.writeText(
                lines.join("")
            );

        } catch {}

    };


window.novexConsole = {

    add,

    setInstance:
        name => {

            instance.textContent =
                name;

            document.title =
                "Minecraft Console — " +
                name;

        }

};

</script>

</body>

</html>`;


    consoleWindow.webContents.once('did-finish-load', () => { if(recentGameLog) sendConsoleLog(recentGameLog); });
    consoleWindow.loadURL(
        `data:text/html;charset=UTF-8,${encodeURIComponent(
            html
        )}`
    );


    consoleWindow.on(
        "closed",
        () => {

            consoleWindow =
                null;

            const main =
                BrowserWindow
                    .getAllWindows()
                    .find(
                        window =>
                            !window.isDestroyed()
                    );

            if (
                main &&
                !main.isDestroyed()
            ) {

                main.webContents.send(
                    "minecraft:console-closed"
                );

            }

        }
    );


    return consoleWindow;

}


/*
 * SEND LOG TO MINECRAFT CONSOLE
 */

function sendConsoleLog(
    message
) {

    if (
        consoleWindow &&
        !consoleWindow.isDestroyed()
    ) {

        consoleWindow.webContents
            .executeJavaScript(
                `window.novexConsole?.add(${JSON.stringify(
                    String(message)
                )})`
            )
            .catch(() => {});

    }

}


/*
 * CREATE MAIN WINDOW
 */

function createWindow() {

    const win =
        new BrowserWindow({

            width: 1200,

            height: 750,

            icon:
                path.join(
                    __dirname,
                    process.platform === "win32" ? "../public/novex.ico" : "../public/novex.png"
                ),

            webPreferences: {

                preload:
                    path.join(
                        __dirname,
                        "preload.cjs"
                    ),

                contextIsolation:
                    true,

                nodeIntegration:
                    false,

                /*
                 * Required for our
                 * Electron setup.
                 */

                sandbox:
                    true

            }

        });


    /*
     * Remove Electron's default
     * File / Edit / View / Window / Help menu.
     */

    mainWindow = win;
    trustedContents.add(win.webContents);
    attachMainWindow(win);
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(({ url }) => {
        try { if (new URL(url).protocol === 'https:') void shell.openExternal(url).catch(() => {}); } catch {}
        return { action: 'deny' };
    });
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.removeMenu();


    if (app.isPackaged) {

        win.loadFile(

            path.join(
                __dirname,
                "../dist/index.html"
            )

        );

    } else {

        win.loadURL(
            "http://localhost:5173"
        );



    }

}


/*
 * CREATE INSTANCE
 */

handle(

    "instances:create",

    async (
        _event,
        instance
    ) => {

        if(activityBusy(await getInstanceDirectory(instance)))throw new Error('This instance is currently installing.');
        return await createInstanceDirectory(
            instance
        );

    }

);


/*
 * DELETE INSTANCE
 */

handle(

    "instances:delete",

    async (
        _event,
        instance
    ) => {

        if (activeLaunch?.instanceDirectory === await getInstanceDirectory(instance)) throw new Error('Stop Minecraft before deleting its instance.');
        await deleteInstanceDirectory(instance);

        return true;

    }

);


/*
 * GET INSTANCE DIRECTORY
 */

handle(

    "instances:getDirectory",

    async (
        _event,
        instance
    ) => {

        return getInstanceDirectory(
            instance
        );

    }

);


/*
 * OPEN INSTANCE FOLDER
 */

handle(

    "instances:openFolder",

    async (
        _event,
        instance
    ) => {

        const directory =
            await getInstanceDirectory(
                instance
            );


        const error =
            await shell.openPath(
                directory
            );


        if (error) {

            throw new Error(
                error
            );

        }


        return true;

    }

);


/*
 * OPEN MINECRAFT CONSOLE
 */

handle(

    "minecraft:console-open",

    async (
        _event,
        instanceName
    ) => {

        createConsoleWindow(
            instanceName ||
            "Minecraft"
        );

        return true;

    }

);


/*
 * CLOSE MINECRAFT CONSOLE
 */

handle(

    "minecraft:console-close",

    () => {

        if (
            consoleWindow &&
            !consoleWindow.isDestroyed()
        ) {

            consoleWindow.close();

        }

        return true;

    }

);


/*
 * INSTALL MINECRAFT
 */

handle(

    "minecraft:install",

    async (
        event,
        options
    ) => {

        const window =
            BrowserWindow.fromWebContents(
                event.sender
            );


        return await installMinecraft({

            ...launchOptions(options),

            onProgress:
                progress => {
                    transferContext.getStore()?.progress?.(progress);
                    sendInstallProgress(
                        window,
                        progress
                    );

                }

        });

    }

);


/*
 * SEND INSTALLATION PROGRESS
 * ELECTRON → REACT
 */

function sendInstallProgress(

    window,

    progress

) {

    if (

        window &&
        !window.isDestroyed()

    ) {

        window.webContents.send(

            "minecraft:install-progress",

            progress

        );

    }

}


/*
 * LAUNCH MINECRAFT
 */

handle('minecraft:launch', async (_event, options) => {
    if (launchPending || isMinecraftRunning()) throw new Error('Minecraft is already starting or running.');
    if (activityBusy()) throw new Error('Wait for active installations to finish before launching Minecraft.');
    launchPending = true;
    let identity;
    let phase = 'validate-instance';
    try {
        const validated = launchOptions(options);
        phase = 'resolve-launch-identity';
        identity = await getLaunchIdentity();
        phase = 'prepare-and-spawn';
        activeLaunch = { instanceDirectory: validated.instanceDirectory, instanceId: typeof options.instanceId === 'string' ? options.instanceId : null, accountId: identity.accountId };
        const result = await launchMinecraft({ ...validated, ...identity, onLog: gameLog, onState: gameState });
        const behavior=(await getSettings()).launchBehavior;
        if(behavior==='minimize')mainWindow?.minimize();
        if(behavior==='hide')mainWindow?.hide();
        return result;
    } catch (error) {
        activeLaunch = null;
        // Account code already converts MSAL response errors to curated messages.
        const safeError = launchDiagnostics.describeError(error,[identity?.accessToken]);
        await minecraftDiagnostic(JSON.stringify({stage:'minecraft:launch',phase,error:safeError}));
        // Return a sanitized, useful message; the full exception stays in the log.
        const safe = new Error(safeError.message || 'Minecraft could not start. See Novex logs.');
        safe.code = error.code;
        throw safe;
    }
    finally { launchPending = false; updateLifecycle(); }
});


/*
 * STOP MINECRAFT
 */

handle('minecraft:stop', () => stopMinecraft(gameLog, gameState));

/*
 * CANCEL MINECRAFT INSTALLATION
 */

handle(

    "minecraft:cancel-install",

    () => {

        return cancelMinecraftInstall();

    }

);


/*
 * CHECK IF MINECRAFT IS RUNNING
 */

handle(

    "minecraft:is-running",

    () => {

        return isMinecraftRunning();

    }

);


/*
 * FILE MANAGER
 */

handle(

    "files:list",

    async (
        _event,
        instance,
        relativePath = ""
    ) => {

        const root =
            await getInstanceDirectory(
                instance
            );


        return listFiles(
            root,
            relativePath
        );

    }

);


handle(

    "files:createFolder",

    async (
        _event,
        instance,
        relativePath
    ) => {

        const root =
            await getInstanceDirectory(
                instance
            );


        await createFolder(
            root,
            relativePath
        );


        return true;

    }

);


handle(

    "files:delete",

    async (
        _event,
        instance,
        relativePath
    ) => {

        const root =
            await getInstanceDirectory(
                instance
            );


        await deletePath(
            root,
            relativePath
        );


        return true;

    }

);


handle(

    "files:rename",

    async (
        _event,
        instance,
        relativePath,
        newName
    ) => {

        const root =
            await getInstanceDirectory(
                instance
            );


        await renamePath(
            root,
            relativePath,
            newName
        );


        return true;

    }

);


handle(

    "files:readText",

    async (
        _event,
        instance,
        relativePath
    ) => {

        const root =
            await getInstanceDirectory(
                instance
            );


        return readText(
            root,
            relativePath
        );

    }

);


handle(

    "files:writeText",

    async (
        _event,
        instance,
        relativePath,
        content
    ) => {

        const root =
            await getInstanceDirectory(
                instance
            );


        await writeText(
            root,
            relativePath,
            content
        );


        return true;

    }

);


/*
 * MODRINTH MOD INSTALLATION
 */

handle(

    "mods:install",

    async (
        _event,
        instance,
        projectId,
        versionId
    ) => {

        const root =
            await getInstanceDirectory(
                instance
            );


        return installMod({

            instanceDirectory:
                root,

            projectId,

            versionId,

            gameVersion:
                instance.minecraftVersion,

            loader:
                instance.loader

        });

    }

);


/*
 * INSTALL FAVORITE MODS
 */

handle(

    "mods:installFavorites",

    async (
        _event,
        instance,
        projectIds
    ) => {

        const root =
            await getInstanceDirectory(
                instance
            );


        return installFavorites({

            instanceDirectory:
                root,

            gameVersion:
                instance.minecraftVersion,

            loader:
                instance.loader,

            projectIds

        });

    }

);


/*
 * MODPACK INSTALLATION
 */

handle(

    "modpacks:install",

    async (
        _event,
        instance,
        projectId,
        versionId
    ) => {

        const root =
            await getInstanceDirectory(
                instance
            );


        return installModpack({

            instanceDirectory:
                root,

            projectId,

            versionId,
            gameVersion: instance.minecraftVersion,
            loader: instance.loader

        });

    }

);


/*
 * RESOURCE PACK INSTALLATION
 */

handle(

    "resourcepacks:install",

    async (
        _event,
        instance,
        projectId,
        versionId
    ) => {

        const root =
            await getInstanceDirectory(
                instance
            );


        return installResourcePack({

            instanceDirectory:
                root,

            projectId,

            versionId,

            gameVersion:
                instance.minecraftVersion

        });

    }

);


/*
 * APP READY
 */

app.whenReady().then(() => {
    if (!primaryInstance) return;
    // Register and verify the callback handler immediately before interactive login.

    createWindow();


    app.on(

        "activate",

        () => {

            if (

                BrowserWindow
                    .getAllWindows()
                    .length === 0

            ) {

                createWindow();

            }

        }

    );

});
