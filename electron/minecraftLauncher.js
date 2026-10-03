import { resolveJava } from './javaManager.js';
import { readInstallState } from './installationState.js';
import { repairMinecraftLibraries } from './minecraftInstaller.js';
import { readVersionProfile } from './versionProfile.js';
import launchDiagnostics from './launchDiagnostics.cjs';
const { redact, describeError } = launchDiagnostics;
import { fileURLToPath } from "node:url";
import { rulesAllowed, launchClasspath } from "./platform.js";
import { getSettings } from "./settings.js";
import { resolveInside, safeSegment } from "./pathSafety.js";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

let minecraftProcess = null;
let preparing = false;
let lastState = "stopped";
export function getMinecraftState() { return lastState; }
export function releaseMinecraft() { if (minecraftProcess) { minecraftProcess.unref(); if (minecraftProcess.connected) minecraftProcess.disconnect(); } }


/*
 * ============================================================
 * JAVA
 * ============================================================
 */




/*
 * ============================================================
 * INSTALLATION INFO
 * ============================================================
 *
 * Novex stores information about what is installed in:
 *
 * instance/
 *   installation.json
 *
 * Example:
 *
 * {
 *   "minecraftVersion": "1.21.11",
 *   "loader": "fabric",
 *   "loaderVersion": "0.19.3",
 *   "launchVersion": "fabric-loader-0.19.3-1.21.11"
 * }
 *
 * Vanilla simply uses the Minecraft version as launchVersion.
 *
 * ============================================================
 */

async function readInstallationInfo(instanceDirectory) {
    const installationFile = path.join(
        instanceDirectory,
        "installation.json"
    );

    try {
        const raw = await fs.readFile(
            installationFile,
            "utf8"
        );

        return JSON.parse(raw);
    } catch (cause) {
        if(cause.code === "ENOENT") return null;
        throw new Error("Instance installation metadata is unreadable. Repair this instance.", {cause});
    }
}


/*
 * ============================================================
 * LIBRARY RULES
 * ============================================================
 */

const isLibraryAllowed = rulesAllowed;


function getMavenLibraryPath(
    name
) {

    if (
        typeof name !== "string" ||
        !name.trim()
    ) {

        return null;

    }


    let coordinate =
        name.trim();

    let extension =
        "jar";


    const atIndex =
        coordinate.lastIndexOf(
            "@"
        );


    if (
        atIndex !== -1
    ) {

        extension =
            coordinate.slice(
                atIndex + 1
            ) ||
            "jar";

        coordinate =
            coordinate.slice(
                0,
                atIndex
            );

    }


    const parts =
        coordinate.split(":");


    if (
        parts.length < 3
    ) {

        return null;

    }


    const [
        group,
        artifact,
        version,
        classifier
    ] = parts;


    for (const part of [group, artifact, version, classifier, extension].filter(Boolean)) safeSegment(part, "Maven coordinate");

    const groupPath =
        group.replace(
            /\./g,
            "/"
        );


    const fileName =
        [
            artifact,
            version,
            classifier
        ]
            .filter(Boolean)
            .join("-") +
        `.${extension}`;


    return path.join(
        groupPath,
        artifact,
        version,
        fileName
    );

}


async function buildClasspath(
    instanceDirectory,
    versionData, clientVersion
) {

    const classpath = [];

    const seen =
        new Set();


    for (
        const library of
        versionData.libraries || []
    ) {

        if (
            !isLibraryAllowed(
                library
            )
        ) {

            continue;

        }


        let relativePath =
            library.downloads
                ?.artifact
                ?.path;


        if (!relativePath && library.downloads?.classifiers) continue;
        if (!relativePath) {

            relativePath =
                getMavenLibraryPath(
                    library.name
                );

        }


        if (!relativePath) {
            continue;
        }


        const libraryPath =
            resolveInside(path.join(instanceDirectory, "libraries"), relativePath, false);


        if (
            seen.has(
                libraryPath
            )
        ) {

            continue;

        }


        seen.add(
            libraryPath
        );


        try {

            await fs.access(
                libraryPath
            );

        } catch {

            throw new Error(
                `Required Minecraft library is missing: ${relativePath}`
            );

        }


        classpath.push(
            libraryPath
        );

    }


    /*
     * Loader profiles inherit the
     * actual Minecraft client JAR.
     */

    clientVersion ||= versionData.inheritsFrom || versionData.id;


    safeSegment(clientVersion, "client version");
    const clientJar =
        path.join(
            instanceDirectory,
            "versions",
            clientVersion,
            `${clientVersion}.jar`
        );


    try {

        await fs.access(
            clientJar
        );

    } catch {

        throw new Error(
            `Minecraft client JAR is missing: ${clientJar}`
        );

    }


    classpath.push(
        clientJar
    );


    return launchClasspath(classpath, instanceDirectory);

}


/*
 * ============================================================
 * ARGUMENT VARIABLE REPLACEMENT
 * ============================================================
 */

function replaceArgumentVariables(
    argument,
    values
) {
    let result = argument;

    for (
        const [key, value] of Object.entries(values)
    ) {
        result = result.replaceAll(
            `\${${key}}`,
            String(value ?? "")
        );
    }

    return result;
}


/*
 * ============================================================
 * ARGUMENT RULES
 * ============================================================
 */

const argumentRuleAllowed = rulesAllowed;


function parseMinecraftArguments(
    argumentsList,
    values
) {
    const result = [];

    if (!Array.isArray(argumentsList)) {
        return result;
    }

    for (const entry of argumentsList) {

        if (typeof entry === "string") {
            result.push(
                replaceArgumentVariables(
                    entry,
                    values
                )
            );

            continue;
        }

        if (
            typeof entry !== "object" ||
            entry === null
        ) {
            continue;
        }

        if (!argumentRuleAllowed(entry)) {
            continue;
        }

        const value = entry.value;

        if (Array.isArray(value)) {

            for (const item of value) {
                result.push(
                    replaceArgumentVariables(
                        item,
                        values
                    )
                );
            }

        } else if (typeof value === "string") {

            result.push(
                replaceArgumentVariables(
                    value,
                    values
                )
            );
        }
    }

    return result;
}


/*
 * ============================================================
 * REMOVE DUPLICATE QUICK PLAY OPTIONS
 * ============================================================
 */

function removeDuplicateQuickPlayArguments(
    argumentsList
) {
    const quickPlayArguments = new Set([
        "--quickPlayPath",
        "--quickPlaySingleplayer",
        "--quickPlayMultiplayer",
        "--quickPlayRealms"
    ]);

    const result = [];

    let quickPlayFound = false;

    for (
        let i = 0;
        i < argumentsList.length;
        i++
    ) {
        const argument =
            argumentsList[i];

        if (
            quickPlayArguments.has(argument)
        ) {

            if (quickPlayFound) {

                /*
                 * Remove this option and its value.
                 */

                if (
                    i + 1 <
                    argumentsList.length
                ) {
                    i++;
                }

                continue;
            }

            quickPlayFound = true;
        }

        result.push(argument);
    }

    return result;
}


/*
 * ============================================================
 * LEGACY ARGUMENTS
 * ============================================================
 */

function parseLegacyGameArguments(
    minecraftArguments,
    values
) {
    if (
        typeof minecraftArguments !== "string"
    ) {
        return [];
    }

    return minecraftArguments
        .split(/\s+/)
        .filter(Boolean)
        .map(argument =>
            replaceArgumentVariables(
                argument,
                values
            )
        );
}


/*
 * ============================================================
 * LOAD VERSION PROFILE
 * ============================================================
 */

async function loadVersionProfile(
    instanceDirectory,
    version,
    installation
) {
    /*
     * Prefer the launchVersion saved by the installer.
     *
     * Fabric example:
     *
     * fabric-loader-0.19.3-1.21.11
     */

    const possibleVersions = [];

    if (
        installation?.launchVersion
    ) {
        possibleVersions.push(
            installation.launchVersion
        );
    }

    if (
        installation?.profile
    ) {
        possibleVersions.push(
            installation.profile
        );
    }

    if (version) {
        possibleVersions.push(
            version
        );
    }


    /*
     * Remove duplicates.
     */

    const uniqueVersions = [
        ...new Set(
            possibleVersions.filter(Boolean)
        )
    ];


    for (
        const profileVersion of uniqueVersions
    ) {
        safeSegment(profileVersion, "launch profile");
        // A configured loader profile is authoritative: never silently launch vanilla
        // when its JSON or inherited base profile is missing/corrupt.
        const profile = await readVersionProfile(instanceDirectory, profileVersion);
        return { ...profile, launchVersion: profileVersion };

    }


    throw new Error(
        `Minecraft launch profile was not found for ${version}.`
    );
}


/*
 * ============================================================
 * LAUNCH MINECRAFT
 * ============================================================
 */

export async function launchMinecraft(options) {
    if (preparing || minecraftProcess) throw new Error('Minecraft is already starting or running.');
    preparing = true;
    try { return await launchPrepared(options); } finally { preparing = false; }
}
async function launchPrepared({
    instanceDirectory,
    version,
    loader = "vanilla",
    username = "NovexPlayer",
    uuid =
        "00000000-0000-0000-0000-000000000000",
    accessToken = "0",
    userType = "legacy",
    xuid = "",
    onLog,
    onState
}) {

    if (minecraftProcess) {
        throw new Error(
            "Minecraft is already running."
        );
    }

    if (!instanceDirectory) {
        throw new Error(
            "Minecraft instance directory is required."
        );
    }

    if (!version) {
        throw new Error(
            "Minecraft version is required."
        );
    }


    /*
     * ========================================================
     * INSTALLATION INFO
     * ========================================================
     */

    onLog?.(`[Novex] Preparing launch: ${JSON.stringify({platform:process.platform,version,loader,instanceDirectory, libraries:path.join(instanceDirectory,'libraries'),assets:path.join(instanceDirectory,'assets'),natives:path.join(instanceDirectory,'natives')})}`);
    const installState = await readInstallState(instanceDirectory);
    if (['installing','failed','cancelled'].includes(installState.status)) throw new Error('This instance needs repair before playing. Open its Overview and select Repair.');
    const installation =
        await readInstallationInfo(
            instanceDirectory
        );


    /*
     * The installation file is optional for
     * vanilla, but recommended.
     */

    const originalState = onState;
    onState = state => { lastState = state; originalState?.(state); };

    const installedMinecraftVersion =
        installation?.minecraftVersion ||
        version;

    const installedLoader =
        installation?.loader ||
        loader ||
        "vanilla";


    /*
     * ========================================================
     * LOAD CORRECT PROFILE
     * ========================================================
     */

    const {
        data: versionData,
        clientVersion,
        launchVersion
    } =
        await loadVersionProfile(
            instanceDirectory,
            installedMinecraftVersion,
            installation
        );


    /*
     * ========================================================
     * CLASSPATH
     * ========================================================
     */

    onLog?.(`[Novex] Resolved profile: ${JSON.stringify({launchVersion,clientVersion,mainClass:versionData.mainClass,requiredJava:versionData.javaVersion?.majorVersion || 8,loaderVersion:installation?.loaderVersion})}`);
    await repairMinecraftLibraries(versionData, instanceDirectory, onLog);
    const classpath =
        await buildClasspath(
            instanceDirectory,
            versionData, clientVersion
        );


    /*
     * ========================================================
     * DIRECTORIES
     * ========================================================
     */

    const nativesDirectory =
        path.join(
            instanceDirectory,
            "natives"
        );

    const assetsDirectory =
        path.join(
            instanceDirectory,
            "assets"
        );


    /*
     * ========================================================
     * MINECRAFT VARIABLES
     * ========================================================
     */

    const argumentValues = {
        natives_directory: nativesDirectory,
        library_directory: path.join(instanceDirectory, 'libraries'),
        classpath,
        classpath_separator: path.delimiter,
        launcher_name: 'Novex Client',
        launcher_version: '0.1.0',
        user_properties: '{}',
        auth_session: accessToken,
        clientid: '4df8fc45-5d5d-4d5d-ad5e-c98203479c15',
        auth_xuid: xuid,


        auth_player_name:
            username,

        version_name:
            versionData.id ||
            launchVersion,

        game_directory:
            instanceDirectory,

        assets_root:
            assetsDirectory,

        assets_index_name:
            versionData.assetIndex?.id ||
            "",

        auth_uuid:
            uuid,

        auth_access_token:
            accessToken,

        user_type:
            userType,

        version_type:
            versionData.type ||
            "release"

    };


    /*
     * ========================================================
     * JVM ARGUMENTS
     * ========================================================
     */

    // Redact before any renderer or secondary-console delivery.
    const originalLog = onLog;
    onLog = message => originalLog?.(redact(message, [accessToken]));
    let jvmArguments = [];


    if (
        Array.isArray(
            versionData.arguments?.jvm
        )
    ) {

        jvmArguments.push(
            ...parseMinecraftArguments(
                versionData.arguments.jvm,
                argumentValues
            )
        );
    }


    /*
     * Native library path.
     */

    if (!jvmArguments.some(arg => arg.startsWith('-Djava.library.path='))) jvmArguments.push(`-Djava.library.path=${nativesDirectory}`);


    /*
     * Novex memory settings.
     */

    jvmArguments.push(
        "-Xms1G"
    );

    jvmArguments.push(
        "-Xmx4G"
    );


    /*
     * Classpath.
     */

    if (!jvmArguments.includes("-cp") && !jvmArguments.includes("-classpath")) jvmArguments.push("-cp", classpath);


    /*
     * ========================================================
     * MAIN CLASS
     * ========================================================
     */

    const mainClass =
        versionData.mainClass;

    if (!mainClass) {
        throw new Error(
            `Minecraft ${installedMinecraftVersion} does not specify a main class.`
        );
    }


    /*
     * ========================================================
     * GAME ARGUMENTS
     * ========================================================
     */

    let gameArguments = [];


    /*
     * Modern Minecraft.

     */

    if (
        Array.isArray(
            versionData.arguments?.game
        )
    ) {

        gameArguments.push(
            ...parseMinecraftArguments(
                versionData.arguments.game,
                argumentValues
            )
        );
    }


    /*
     * Legacy Minecraft.
     */

    if (
        gameArguments.length === 0 &&
        versionData.minecraftArguments
    ) {

        gameArguments =
            parseLegacyGameArguments(
                versionData.minecraftArguments,
                argumentValues
            );
    }


    /*
     * ========================================================
     * QUICK PLAY FIX
     * ========================================================
     */

    gameArguments =
        removeDuplicateQuickPlayArguments(
            gameArguments
        );


    /*
     * ========================================================
     * FALLBACK GAME ARGUMENTS
     * ========================================================
     */

    if (
        !gameArguments.includes(
            "--gameDir"
        )
    ) {

        gameArguments.push(
            "--gameDir",
            instanceDirectory
        );
    }


    if (
        !gameArguments.includes(
            "--assetsDir"
        )
    ) {

        gameArguments.push(
            "--assetsDir",
            assetsDirectory
        );
    }


    if (
        !gameArguments.includes(
            "--assetIndex"
        ) &&
        versionData.assetIndex?.id
    ) {

        gameArguments.push(
            "--assetIndex",
            versionData.assetIndex.id
        );
    }


    if (
        !gameArguments.includes(
            "--username"
        )
    ) {

        gameArguments.push(
            "--username",
            username
        );
    }


    if (
        !gameArguments.includes(
            "--uuid"
        )
    ) {

        gameArguments.push(
            "--uuid",
            uuid
        );
    }


    if (
        !gameArguments.includes(
            "--accessToken"
        )
    ) {

        gameArguments.push(
            "--accessToken",
            accessToken
        );
    }


    /*
     * ========================================================
     * FINAL QUICK PLAY CLEANUP
     * ========================================================
     */

    gameArguments =
        removeDuplicateQuickPlayArguments(
            gameArguments
        );


    /*
     * ========================================================
     * FINAL JAVA COMMAND
     * ========================================================
     */

    const requiredJava = versionData.javaVersion?.majorVersion || 8;
    const selectedJava = (await getSettings()).javaPath;
    onLog?.(`[Novex] Java requirement: ${requiredJava}; selected: ${selectedJava || '(automatic discovery)'}; profile: ${launchVersion}; loader version: ${installation?.loaderVersion || '(none)'}`);
    const java = (await resolveJava(requiredJava, instanceDirectory, true)).path;

    if (jvmArguments.some(arg => /\$\{/.test(arg)) || gameArguments.some(arg => /\$\{/.test(arg))) throw new Error('The Minecraft launch profile has unsupported arguments. Repair this instance.');
    const finalArguments = [

        ...jvmArguments,

        mainClass,

        ...gameArguments

    ];


    /*
     * ========================================================
     * LOGGING
     * ========================================================
     */

    onState?.(
        "starting"
    );

    onLog?.(
        "[Novex] Starting Minecraft..."
    );

    onLog?.(
        `[Novex] Minecraft: ${installedMinecraftVersion}`
    );

    onLog?.(
        `[Novex] Loader: ${installedLoader}`
    );

    onLog?.(
        `[Novex] Launch profile: ${launchVersion}`
    );

    onLog?.(
        `[Novex] Main class: ${mainClass}`
    );

    onLog?.(
        `[Novex] Java: ${java}`
    );

    onLog?.(
        `[Novex] Classpath entries: ${
            classpath.split(
                path.delimiter
            ).length
        }`
    );


    /*
     * ========================================================
     * SPAWN
     * ========================================================
     */

    onLog?.(`[Novex] Platform: ${process.platform}; cwd: ${instanceDirectory}; argument characters: ${finalArguments.reduce((size,arg)=>size+arg.length+3, java.length)}`);
    onLog?.(`[Novex] JVM arguments: ${redact(JSON.stringify(jvmArguments), [accessToken])}`);
    // Mask the positional token before stringifying; never persist launch identity.
    const safeGameArguments = gameArguments.map((value,index) => /^(--accessToken|--clientId|--xuid)$/i.test(gameArguments[index-1] || '') ? '[REDACTED]' : value);
    onLog?.(`[Novex] Game arguments: ${redact(JSON.stringify(safeGameArguments), [accessToken])}`);
    const supervisor = spawn(process.execPath, [fileURLToPath(new URL('./gameSupervisor.cjs', import.meta.url))], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        detached: true, windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    minecraftProcess = supervisor;
    return await new Promise((resolve, reject) => {
        let started = false;
        let closed = false;
        const finish = (state, message) => {
            if (closed) return;
            closed = true;
            if (minecraftProcess === supervisor) minecraftProcess = null;
            onLog?.(message);
            onState?.(state);
            if (!started) reject(new Error(message));
        };
        supervisor.on('message', message => {
            if (message.type === 'log') onLog?.(message.text);
            if(message.type === 'error') onLog?.(`[Novex] Java spawn exception: ${JSON.stringify(message.error || {code:message.code})}`);
            if (message.type === 'started') { started = true; onState?.('running'); resolve(true); }
            if (message.type === 'error') finish('crashed', `Java could not start (${message.code || 'unknown error'}). Check the selected Java, instance folder and permissions. Open the Minecraft console or Novex logs.`);
            if (message.type === 'closed') finish(message.code === 0 || message.stopping ? 'stopped' : 'crashed', `[Novex] Minecraft exited (code ${message.code ?? 'none'}, signal ${message.signal ?? 'none'}).${message.code !== 0 && !message.stopping ? ' Open the Minecraft console or Novex logs for the Java error.' : ''}`);
        });
        supervisor.once('error', error => { onLog?.(`[Novex] Monitor spawn exception: ${JSON.stringify(describeError(error,[accessToken]))}`); finish('crashed', `Minecraft process monitor could not start (${error.code || error.name}).`); });
        supervisor.once('exit', () => finish('crashed', '[Novex] Minecraft process monitor exited.'));
        supervisor.send({ type: 'launch', executable: java, args: finalArguments, cwd: instanceDirectory, secret: accessToken }, error => {
            if (error) finish('crashed', 'Minecraft process monitor could not receive launch settings.');
        });
    });
}

export function stopMinecraft(onLog, onState) {
    if (!minecraftProcess?.connected) return false;
    lastState = 'stopping';
    onState?.('stopping');
    onLog?.('[Novex] Stopping Minecraft...');
    minecraftProcess.send({ type: 'stop' }, () => {});
    return true;
}
export function isMinecraftRunning() { return preparing || minecraftProcess !== null; }
