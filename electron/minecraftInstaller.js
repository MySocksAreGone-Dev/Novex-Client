import { resolveJava } from './javaManager.js';
import { transferContext } from './transfer.js';
import { writeInstallState } from './installationState.js';
import { downloadToFile, parallelFiles, checkSpace } from './transfer.js';
import { prepareLoaderClient, neoForgeVersionPrefix } from './loaderSupport.js';
import { secureFetch as fetch } from "./downloads.js";
import { installNatives, nativeArtifact, applicableLibraries, downloadLibraryArtifact, ensureLibraryArtifacts } from "./natives.js";
import { rulesAllowed } from "./platform.js";
import { resolveInside, safeSegment } from "./pathSafety.js";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";


/*
 * ============================================================
 * OFFICIAL METADATA SOURCES
 * ============================================================
 */

const VERSION_MANIFEST =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

const FABRIC_META =
    "https://meta.fabricmc.net/v2";

const QUILT_META =
    "https://meta.quiltmc.org/v3";

const FORGE_PROMOTIONS =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";

const FORGE_MAVEN =
    "https://maven.minecraftforge.net/net/minecraftforge/forge";

const NEOFORGE_MAVEN =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge";

let currentInstallController = null;
let currentRequiredJava = 8;


/*
 * ============================================================
 * BASIC HTTP HELPERS
 * ============================================================
 */

async function downloadJson(url, expectedSha1) {
    const response = await fetch(url, { signal: currentInstallController?.signal });

    if (!response.ok) {
        throw new Error(
            `Failed to download ${url}: HTTP ${response.status}`
        );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (expectedSha1 && crypto.createHash('sha1').update(buffer).digest('hex') !== expectedSha1) throw new Error('Minecraft metadata integrity verification failed.');
    return JSON.parse(buffer.toString('utf8'));
}


async function downloadText(url) {
    const response = await fetch(url, { signal: currentInstallController?.signal });

    if (!response.ok) {
        throw new Error(
            `Failed to download ${url}: HTTP ${response.status}`
        );
    }

    return await response.text();
}


/*
 * ============================================================
 * SHA-1 HELPERS
 * ============================================================
 */

/*
 * ============================================================
 * GENERIC FILE DOWNLOAD
 * ============================================================
 *
 * Existing valid files are reused.
 *
 * Nothing is deleted automatically.
 */

async function downloadFile(
    url,
    destination,
    expectedSha1,
    onProgress
) {

    if (!expectedSha1 && String(url).endsWith('.jar')) {
        const checksum = await downloadText(String(url) + '.sha1');
        expectedSha1 = checksum.trim().split(/\s+/)[0];
        if (!/^[a-f0-9]{40}$/i.test(expectedSha1)) throw new Error('Invalid library checksum from download server.');
    }
    return downloadToFile(url, destination, { hashes: { sha1: expectedSha1 }, signal: currentInstallController?.signal, onProgress });
}


/*
 * ============================================================
 * DIRECTORY CREATION
 * ============================================================
 *
 * We intentionally do NOT delete anything here.
 */

async function createMinecraftDirectories(
    instanceDirectory
) {

    const directories = [

        "versions",

        "libraries",

        "assets",

        "assets/indexes",

        "assets/objects",

        "natives",

        "mods",

        "config",

        "saves",

        "resourcepacks",

        "shaderpacks",

        "screenshots"

    ];


    for (
        const directory of directories
    ) {

        await fs.mkdir(
            path.join(
                instanceDirectory,
                directory
            ),
            {
                recursive: true
            }
        );

    }

}


/*
 * ============================================================
 * OS LIBRARY RULES
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


function getMavenLibraryUrl(
    library,
    relativePath
) {

    const base =
        typeof library.url ===
            "string" &&
        library.url.trim()
            ? library.url.trim()
            : "https://maven.fabricmc.net/";


    return (
        `${base.replace(
            /\/+$/,
            ""
        )}/${relativePath.replace(
            /\\/g,
            "/"
        )}`
    );

}


async function installProfileLibrary({
    library,
    instanceDirectory
}) {

    if (
        !isLibraryAllowed(
            library
        )
    ) {

        return false;

    }


    const artifact =
        library.downloads?.artifact;


    if (artifact) {

        await downloadLibraryArtifact(library, artifact, instanceDirectory, downloadFile);


        return true;

    }


    if (library.downloads?.classifiers) return false;

    const relativePath =
        getMavenLibraryPath(
            library.name
        );


    if (!relativePath) {
        return false;
    }


    const destination =
        resolveInside(path.join(instanceDirectory, "libraries"), relativePath, false);


    const url =
        getMavenLibraryUrl(
            library,
            relativePath
        );


    try {

        await downloadFile(
            url,
            destination
        );

        return true;

    } catch (firstError) {

        const fallbackUrl =
            `https://repo1.maven.org/maven2/${relativePath.replace(
                /\\/g,
                "/"
            )}`;


        if (
            fallbackUrl ===
            url
        ) {

            throw firstError;

        }


        await downloadFile(
            fallbackUrl,
            destination
        );

        return true;

    }

}


/*
 * ============================================================
 * INSTALL VANILLA MINECRAFT
 * ============================================================
 */

async function installVanilla({
    version,
    instanceDirectory,
    onProgress
}) {

    onProgress?.({

        stage: "version",

        current: 0,

        total: 1,

        message:
            `Loading Minecraft ${version}...`

    });


    /*
     * Mojang version manifest.
     */

    const manifest =
        await downloadJson(
            VERSION_MANIFEST
        );


    const versionInfo =
        manifest.versions.find(
            item =>
                item.id === version
        );


    if (!versionInfo) {

        throw new Error(
            `Minecraft version ${version} was not found.`
        );

    }


    /*
     * Version JSON.
     */

    const versionData =
        await downloadJson(
            versionInfo.url, versionInfo.sha1
        );


    let estimated = 0;
    const planned = [
        { ...versionData.downloads?.client, path: `versions/${version}/${version}.jar` },
        ...applicableLibraries(versionData.libraries || []).flatMap(library => [library.downloads?.artifact, nativeArtifact(library)].filter(Boolean)).map(artifact=>({...artifact,path:'libraries/'+artifact.path}))
    ];
    for(const artifact of planned) {
        if(!Number.isFinite(artifact.size))continue;
        const stat=await fs.stat(resolveInside(instanceDirectory,artifact.path,false)).catch(()=>null);
        if(stat?.size!==artifact.size)estimated+=artifact.size;
    }
    if(versionData.assetIndex && !await fs.stat(resolveInside(instanceDirectory,`assets/indexes/${versionData.assetIndex.id}.json`)).catch(()=>null))estimated+=versionData.assetIndex.totalSize || 0;
    await checkSpace(instanceDirectory,estimated+32*1048576);

    await createMinecraftDirectories(
        instanceDirectory
    );


    /*
     * Vanilla version directory.
     */

    const versionDirectory =
        path.join(
            instanceDirectory,
            "versions",
            version
        );


    await fs.mkdir(
        versionDirectory,
        {
            recursive: true
        }
    );


    /*
     * Save the official version JSON.
     */

    await fs.writeFile(

        path.join(
            versionDirectory,
            `${version}.json`
        ),

        JSON.stringify(
            versionData,
            null,
            2
        ),

        "utf8"

    );


    /*
     * --------------------------------------------------------
     * CLIENT JAR
     * --------------------------------------------------------
     */

    const client =
        versionData.downloads?.client;


    if (!client) {

        throw new Error(
            `Minecraft ${version} does not provide a client download.`
        );

    }


    const clientPath =
        path.join(
            versionDirectory,
            `${version}.jar`
        );


    onProgress?.({

        stage: "client",

        current: 0,

        total:
            client.size || 0,

        message:
            "Checking Minecraft client..."

    });


    const clientDownloaded =
        await downloadFile(

            client.url,

            clientPath,

            client.sha1,

            progress => {

                onProgress?.({

                    stage: "client",

                    current:
                        progress.skipped
                            ? client.size || 0
                            : progress.downloaded,

                    total:
                        client.size || 0,

                    message:
                        progress.skipped
                            ? "Minecraft client already installed."
                            : "Downloading Minecraft client..."

                });

            }

        );


    if (!clientDownloaded) {

        onProgress?.({

            stage: "client",

            current:
                client.size || 0,

            total:
                client.size || 0,

            message:
                "Minecraft client already installed."

        });

    }


    /*
     * --------------------------------------------------------
     * LIBRARIES
     * --------------------------------------------------------
     */

    const libraries =
        versionData.libraries || [];


    const allowedLibraries =
        applicableLibraries(libraries);


    let libraryNumber = 0;


    await parallelFiles(allowedLibraries, async library => {




        const artifact =
            library.downloads?.artifact;


        if (!artifact) {
            return;
        }


        onProgress?.({

            stage: "libraries",

            current:
                libraryNumber,

            total:
                allowedLibraries.length,

            message:
                `Checking Minecraft libraries (${libraryNumber} of ${allowedLibraries.length} verified)…`

        });


        const downloaded =
            await downloadLibraryArtifact(library, artifact, instanceDirectory, downloadFile);
        libraryNumber++;

        onProgress?.({

            stage: "libraries",

            current:
                libraryNumber,

            total:
                allowedLibraries.length,

            message:
                downloaded
                    ? `Installed library ${libraryNumber} of ${allowedLibraries.length}.`
                    : `Library ${libraryNumber} of ${allowedLibraries.length} already installed.`

        });

    });


    /*
     * --------------------------------------------------------
     * ASSET INDEX
     * --------------------------------------------------------
     */

    const assetIndex =
        versionData.assetIndex;


    if (assetIndex) {
        safeSegment(assetIndex.id, "asset index");

        const assetIndexPath =
            path.join(

                instanceDirectory,

                "assets",

                "indexes",

                `${assetIndex.id}.json`

            );


        onProgress?.({

            stage: "assets",

            current: 0,

            total: 1,

            message:
                "Checking asset index..."

        });


        await downloadFile(

            assetIndex.url,

            assetIndexPath,

            assetIndex.sha1

        );


        /*
         * Read the asset index directly from disk.
         *
         * This avoids unnecessarily downloading it a second
         * time from Mojang.
         */

        const assetIndexRaw =
            await fs.readFile(
                assetIndexPath,
                "utf8"
            );


        const assetIndexData =
            JSON.parse(
                assetIndexRaw
            );


        const objects =
            assetIndexData.objects || {};


        const assetEntries =
            Object.entries(
                objects
            );


        let assetNumber = 0;


        await parallelFiles(assetEntries, async ([_assetName, asset]) => {




            const hash =
                asset.hash;


            if (hash && !/^[a-f0-9]{40}$/i.test(hash)) throw new Error("Invalid Minecraft asset hash.");
            if (!hash) {
                return;
            }


            const firstTwo =
                hash.substring(
                    0,
                    2
                );


            const assetPath =
                path.join(

                    instanceDirectory,

                    "assets",

                    "objects",

                    firstTwo,

                    hash

                );


            const assetUrl =
                `https://resources.download.minecraft.net/${firstTwo}/${hash}`;


            const downloaded =
                await downloadFile(

                    assetUrl,

                    assetPath,

                    hash

                );


            assetNumber++;
            onProgress?.({

                stage: "assets",

                current:
                    assetNumber,

                total:
                    assetEntries.length,

                message:
                    downloaded
                        ? `Downloaded asset ${assetNumber} of ${assetEntries.length}.`
                        : `Asset ${assetNumber} of ${assetEntries.length} already installed.`

            });

        });

    }


    await installNatives(versionData, instanceDirectory, downloadFile);
    return {
        versionData
    };

}


/*
 * ============================================================
 * FABRIC
 * ============================================================
 */

async function getFabricLoaderVersion(
    minecraftVersion
) {

    const url =
        `${FABRIC_META}/versions/loader/${encodeURIComponent(
            minecraftVersion
        )}`;


    const versions =
        await downloadJson(
            url
        );


    if (
        !Array.isArray(versions) ||
        versions.length === 0
    ) {

        throw new Error(
            `No Fabric Loader version is available for Minecraft ${minecraftVersion}.`
        );

    }


    return versions[0].loader.version;
}


async function installFabric({
    version,
    requestedLoaderVersion,
    instanceDirectory,
    onProgress
}) {

    const loaderVersion =
        requestedLoaderVersion ||
        await getFabricLoaderVersion(
            version
        );


    onProgress?.({

        stage: "loader",

        current: 0,

        total: 1,

        message:
            `Installing Fabric Loader ${loaderVersion}...`

    });


    const profileUrl =
        `${FABRIC_META}/versions/loader/` +
        `${encodeURIComponent(version)}/` +
        `${encodeURIComponent(loaderVersion)}/` +
        `profile/json`;


    const profile =
        await downloadJson(
            profileUrl
        );


    const result =
        await installLoaderProfile({

            profile,

            version,

            loader:
                "fabric",

            loaderVersion,

            instanceDirectory,

            onProgress

        });


    onProgress?.({

        stage: "loader",

        current: 1,

        total: 1,

        message:
            `Fabric Loader ${loaderVersion} installed.`

    });


    return {

        loader:
            "fabric",

        loaderVersion,

        profileId:
            result.profileId

    };

}


/*
 * ============================================================
 * QUILT
 * ============================================================
 */

async function getQuiltLoaderVersion(
    minecraftVersion
) {

    const url =
        `${QUILT_META}/versions/loader/${encodeURIComponent(
            minecraftVersion
        )}`;


    const versions =
        await downloadJson(
            url
        );


    if (
        !Array.isArray(versions) ||
        versions.length === 0
    ) {

        throw new Error(
            `No Quilt Loader version is available for Minecraft ${minecraftVersion}.`
        );

    }


    return versions[0].version;
}


async function installQuilt({
    version,
    requestedLoaderVersion,
    instanceDirectory,
    onProgress
}) {

    const loaderVersion =
        requestedLoaderVersion ||
        await getQuiltLoaderVersion(
            version
        );


    onProgress?.({

        stage: "loader",

        current: 0,

        total: 1,

        message:
            `Installing Quilt Loader ${loaderVersion}...`

    });


    const profileUrl =
        `${QUILT_META}/versions/loader/` +
        `${encodeURIComponent(version)}/` +
        `${encodeURIComponent(loaderVersion)}/` +
        `profile/json`;


    const profile =
        await downloadJson(
            profileUrl
        );


    const result =
        await installLoaderProfile({

            profile,

            version,

            loader:
                "quilt",

            loaderVersion,

            instanceDirectory,

            onProgress

        });


    onProgress?.({

        stage: "loader",

        current: 1,

        total: 1,

        message:
            `Quilt Loader ${loaderVersion} installed.`

    });


    return {

        loader:
            "quilt",

        loaderVersion,

        profileId:
            result.profileId

    };

}


/*
 * ============================================================
 * LOADER PROFILE LIBRARIES
 * ============================================================
 */

async function installProfileLibraries({
    profile,
    instanceDirectory,
    onProgress,
    stageName
}) {

    const libraries =
        Array.isArray(
            profile.libraries
        )
            ? profile.libraries
            : [];


    const allowedLibraries =
        applicableLibraries(libraries);


    let number = 0;


    for (
        const library of
        allowedLibraries
    ) {

        number++;


        onProgress?.({

            stage:
                stageName,

            current:
                number - 1,

            total:
                allowedLibraries.length,

            message:
                `Checking ${stageName} library ${number} of ${allowedLibraries.length}...`

        });


        await installProfileLibrary({

            library,

            instanceDirectory

        });


        onProgress?.({

            stage:
                stageName,

            current:
                number,

            total:
                allowedLibraries.length,

            message:
                `Installed ${stageName} library ${number} of ${allowedLibraries.length}.`

        });

    }

}


/*
 * ============================================================
 * FABRIC / QUILT PROFILE MERGING
 * ============================================================
 */

async function installLoaderProfile({
    profile,
    version,
    loader,
    loaderVersion,
    instanceDirectory,
    onProgress
}) {

    const vanillaVersionDirectory =
        path.join(

            instanceDirectory,

            "versions",

            version

        );


    const vanillaVersionFile =
        path.join(

            vanillaVersionDirectory,

            `${version}.json`

        );


    const vanillaRaw =
        await fs.readFile(

            vanillaVersionFile,

            "utf8"

        );


    const vanillaProfile =
        JSON.parse(
            vanillaRaw
        );


    /*
     * Install loader libraries.
     */

    await installProfileLibraries({

        profile,

        instanceDirectory,

        onProgress,

        stageName:
            loader === "fabric"
                ? "fabric"
                : "quilt"

    });


    /*
     * Clone vanilla profile.
     */

    const merged =
        JSON.parse(
            JSON.stringify(
                vanillaProfile
            )
        );


    /*
     * Profile ID.
     */

    const profileId =
        profile.id ||
        `${loader}-loader-${loaderVersion}-${version}`;


    /*
     * Main class.
     */

    safeSegment(profileId, "loader profile");

    if (
        profile.mainClass
    ) {

        merged.mainClass =
            profile.mainClass;

    }


    /*
     * Libraries.
     */

    const existingLibraries =
        Array.isArray(
            merged.libraries
        )
            ? merged.libraries
            : [];


    const profileLibraries =
        Array.isArray(
            profile.libraries
        )
            ? profile.libraries
            : [];


    merged.libraries = [

        ...existingLibraries,

        ...profileLibraries

    ];


    /*
     * JVM arguments.
     */

    if (
        profile.arguments?.jvm
    ) {

        merged.arguments =
            merged.arguments || {};

        merged.arguments.jvm = [

            ...(merged.arguments.jvm || []),

            ...profile.arguments.jvm

        ];

    }


    /*
     * Game arguments.
     */

    if (
        profile.arguments?.game
    ) {

        merged.arguments =
            merged.arguments || {};

        merged.arguments.game = [

            ...(merged.arguments.game || []),

            ...profile.arguments.game

        ];

    }


    /*
     * Old-style arguments.
     */

    if (
        profile.minecraftArguments
    ) {

        merged.minecraftArguments =
            profile.minecraftArguments;

    }


    /*
     * Loader metadata.
     */

    merged.id =
        profileId;

    merged.type =
        "release";

    merged.inheritsFrom =
        version;


    /*
     * Save profile.
     */

    const loaderDirectory =
        path.join(

            instanceDirectory,

            "versions",

            profileId

        );


    await fs.mkdir(

        loaderDirectory,

        {
            recursive: true
        }

    );


    const loaderJsonPath =
        path.join(

            loaderDirectory,

            `${profileId}.json`

        );


    await fs.writeFile(

        loaderJsonPath,

        JSON.stringify(
            merged,
            null,
            2
        ),

        "utf8"

    );


    /*
     * Some loader profiles provide a client JAR.
     */

    if (
        profile.downloads?.client
    ) {

        const client =
            profile.downloads.client;


        await downloadFile(

            client.url,

            path.join(
                loaderDirectory,
                `${profileId}.jar`
            ),

            client.sha1

        );

    }


    return {

        profileId,

        profile:
            merged

    };

}


/*
 * ============================================================
 * JAVA EXECUTABLE
 * ============================================================
 */




/*
 * ============================================================
 * RUN JAVA INSTALLER
 * ============================================================
 *
 * Used by Forge and NeoForge.
 *
 * The installer is executed inside the instance directory.
 *
 * We do NOT delete anything before or after running it.
 */

async function runJavaInstaller({
    installerPath,
    instanceDirectory,
    arguments: installerArguments,
    onProgress,
    loaderName,
    loaderVersion
}) {

    await prepareLoaderClient(instanceDirectory);
    const java =
        (await resolveJava(currentRequiredJava, instanceDirectory, true)).path;


    onProgress?.({

        stage: "loader",

        current: 0,

        total: 1,

        message:
            `Running ${loaderName} installer ${loaderVersion}...`

    });


    return await new Promise(
        (
            resolve,
            reject
        ) => {

            const child =
                spawn(

                    java,

                    [
                        "-jar",
                        installerPath,
                        ...installerArguments
                    ],

                    {

                        signal: currentInstallController?.signal,
                        cwd:
                            instanceDirectory,

                        windowsHide:
                            true,

                        stdio: [
                            "ignore",
                            "pipe",
                            "pipe"
                        ]

                    }

                );


            let stdout = "";
            let stderr = "";


            child.stdout.on(
                "data",
                data => {

                    const text =
                        data.toString();

                    stdout += text;

                    onProgress?.({

                        stage:
                            "loader",

                        current: 0,

                        total: 1,

                        message:
                            text.trim() ||
                            `Installing ${loaderName}...`

                    });

                }
            );


            child.stderr.on(
                "data",
                data => {

                    const text =
                        data.toString();

                    stderr += text;

                    onProgress?.({

                        stage:
                            "loader",

                        current: 0,

                        total: 1,

                        message:
                            text.trim() ||
                            `Installing ${loaderName}...`

                    });

                }
            );


            child.on(
                "error",
                error => {

                    reject(
                        new Error(
                            `Failed to run ${loaderName} installer: ${error.message}`
                        )
                    );

                }
            );


            child.on(
                "close",
                code => {

                    if (
                        code !== 0
                    ) {

                        const details =
                            stderr.trim() ||
                            stdout.trim() ||
                            "No installer output was available.";


                        reject(
                            new Error(
                                `${loaderName} installer failed with exit code ${code}.\n\n${details}`
                            )
                        );

                        return;

                    }


                    onProgress?.({

                        stage:
                            "loader",

                        current: 1,

                        total: 1,

                        message:
                            `${loaderName} installer completed.`

                    });


                    resolve({

                        stdout,

                        stderr

                    });

                }
            );

        }
    );

}


/*
 * ============================================================
 * FORGE VERSION RESOLUTION
 * ============================================================
 */

async function getForgeLoaderVersion(
    minecraftVersion
) {

    const promotions =
        await downloadJson(
            FORGE_PROMOTIONS
        );


    const promos =
        promotions.promos || {};


    /*
     * Prefer the recommended Forge build.
     */

    const recommended =
        promos[
            `${minecraftVersion}-recommended`
        ];


    if (recommended) {
        return String(recommended);
    }


    /*
     * Fall back to latest.
     */

    const latest =
        promos[
            `${minecraftVersion}-latest`
        ];


    if (latest) {
        return String(latest);
    }


    throw new Error(
        `No Forge version is available for Minecraft ${minecraftVersion}.`
    );

}


/*
 * ============================================================
 * FORGE INSTALLATION
 * ============================================================
 */

async function installForge({
    version,
    requestedLoaderVersion,
    instanceDirectory,
    onProgress
}) {

    const forgeVersion =
        requestedLoaderVersion ||
        await getForgeLoaderVersion(
            version
        );


    const fullVersion =
        `${version}-${forgeVersion}`;


    const installerUrl =
        `${FORGE_MAVEN}/` +
        `${encodeURIComponent(fullVersion)}/` +
        `forge-${fullVersion}-installer.jar`;


    const installerDirectory =
        path.join(
            instanceDirectory,
            ".novex",
            "installers"
        );


    const installerPath =
        path.join(
            installerDirectory,
            `forge-${fullVersion}-installer.jar`
        );


    await fs.mkdir(
        installerDirectory,
        {
            recursive: true
        }
    );


    onProgress?.({

        stage: "loader",

        current: 0,

        total: 1,

        message:
            `Downloading Forge ${forgeVersion}...`

    });


    await downloadFile(

        installerUrl,

        installerPath,

        undefined,

        progress => {

            onProgress?.({

                stage: "loader",

                current:
                    progress.downloaded,

                total:
                    progress.total,

                message:
                    `Downloading Forge ${forgeVersion} installer...`

            });

        }

    );


    /*
     * Forge's official installer installs a client profile
     * and its required libraries into the supplied directory.
     */

    await runJavaInstaller({

        installerPath,

        instanceDirectory,

        arguments: [
            "--installClient",
            instanceDirectory
        ],

        onProgress,

        loaderName:
            "Forge",

        loaderVersion:
            forgeVersion

    });


    /*
     * Forge normally creates:
     *
     * versions/<forge-version>/<forge-version>.json
     *
     * Find the generated profile instead of assuming a
     * particular naming format.
     */

    const profileId =
        await findLoaderProfile(
            instanceDirectory,
            version,
            "forge"
        );


    return {

        loader:
            "forge",

        loaderVersion:
            forgeVersion,

        profileId

    };

}


/*
 * ============================================================
 * NEOFORGE VERSION RESOLUTION
 * ============================================================
 */

function extractVersionsFromMavenMetadata(
    xml
) {

    const versions = [];

    const matches =
        xml.match(
            /<version>([^<]+)<\/version>/g
        ) || [];


    for (
        const match of matches
    ) {

        const value =
            match
                .replace(
                    "<version>",
                    ""
                )
                .replace(
                    "</version>",
                    ""
                )
                .trim();


        if (value) {
            versions.push(value);
        }

    }


    return versions;
}


async function getNeoForgeLoaderVersion(
    minecraftVersion
) {

    const metadataUrl =
        `${NEOFORGE_MAVEN}/maven-metadata.xml`;


    const xml =
        await downloadText(
            metadataUrl
        );


    const versions =
        extractVersionsFromMavenMetadata(
            xml
        );


    /*
     * NeoForge 1.21.x uses a 21.x loader series.
     *
     * Examples:
     *
     * Minecraft 1.21.1  -> 21.1.x
     * Minecraft 1.21.11 -> 21.11.x
     */

    const prefix = neoForgeVersionPrefix(minecraftVersion);

    const compatible =
        versions.filter(
            candidate =>
                candidate.startsWith(
                    prefix
                )
        );


    if (
        compatible.length === 0
    ) {

        throw new Error(
            `No NeoForge version is available for Minecraft ${minecraftVersion}.`
        );

    }


    /*
     * Maven metadata is normally ordered, but sorting
     * numerically gives us a safer result.
     */

    compatible.sort(
        compareVersionStrings
    );


    return compatible[
        compatible.length - 1
    ];

}


/*
 * ============================================================
 * NEOFORGE INSTALLATION
 * ============================================================
 */

async function installNeoForge({
    version,
    requestedLoaderVersion,
    instanceDirectory,
    onProgress
}) {

    const neoForgeVersion =
        requestedLoaderVersion ||
        await getNeoForgeLoaderVersion(
            version
        );


    const installerUrl =
        `${NEOFORGE_MAVEN}/` +
        `${encodeURIComponent(neoForgeVersion)}/` +
        `neoforge-${neoForgeVersion}-installer.jar`;


    const installerDirectory =
        path.join(
            instanceDirectory,
            ".novex",
            "installers"
        );


    const installerPath =
        path.join(
            installerDirectory,
            `neoforge-${neoForgeVersion}-installer.jar`
        );


    await fs.mkdir(
        installerDirectory,
        {
            recursive: true
        }
    );


    onProgress?.({

        stage: "loader",

        current: 0,

        total: 1,

        message:
            `Downloading NeoForge ${neoForgeVersion}...`

    });


    await downloadFile(

        installerUrl,

        installerPath,

        undefined,

        progress => {

            onProgress?.({

                stage: "loader",

                current:
                    progress.downloaded,

                total:
                    progress.total,

                message:
                    `Downloading NeoForge ${neoForgeVersion} installer...`

            });

        }

    );


    /*
     * NeoForge's official installer uses --install-client.
     */

    await runJavaInstaller({

        installerPath,

        instanceDirectory,

        arguments: [
            "--install-client",
            instanceDirectory
        ],

        onProgress,

        loaderName:
            "NeoForge",

        loaderVersion:
            neoForgeVersion

    });


    const profileId =
        await findLoaderProfile(
            instanceDirectory,
            version,
            "neoforge"
        );


    return {

        loader:
            "neoforge",

        loaderVersion:
            neoForgeVersion,

        profileId

    };

}


/*
 * ============================================================
 * VERSION STRING COMPARISON
 * ============================================================
 */

function compareVersionStrings(
    a,
    b
) {

    const aParts =
        a
            .replace(
                /[^0-9.].*$/,
                ""
            )
            .split(".")
            .map(
                Number
            );


    const bParts =
        b
            .replace(
                /[^0-9.].*$/,
                ""
            )
            .split(".")
            .map(
                Number
            );


    const length =
        Math.max(
            aParts.length,
            bParts.length
        );


    for (
        let i = 0;
        i < length;
        i++
    ) {

        const av =
            Number.isFinite(
                aParts[i]
            )
                ? aParts[i]
                : 0;


        const bv =
            Number.isFinite(
                bParts[i]
            )
                ? bParts[i]
                : 0;


        if (
            av !== bv
        ) {

            return av - bv;

        }

    }


    /*
     * If numeric versions are equal, put beta/
     * release candidates after the base release.
     */

    return a.localeCompare(
        b,
        undefined,
        {
            numeric: true,
            sensitivity: "base"
        }
    );

}


/*
 * ============================================================
 * FIND LOADER PROFILE
 * ============================================================
 *
 * Forge and NeoForge installers decide their own profile
 * naming. We inspect the versions directory instead of
 * hardcoding a fragile filename.
 */

async function findLoaderProfile(
    instanceDirectory,
    minecraftVersion,
    loader
) {

    const versionsDirectory =
        path.join(
            instanceDirectory,
            "versions"
        );


    let entries;

    try {

        entries =
            await fs.readdir(
                versionsDirectory,
                {
                    withFileTypes: true
                }
            );

    } catch {

        throw new Error(
            `${formatLoaderName(loader)} installer did not create a versions directory.`
        );

    }


    const candidates = [];


    for (
        const entry of entries
    ) {

        if (!entry.isDirectory()) {
            continue;
        }


        const directoryName =
            entry.name;


        const lower =
            directoryName.toLowerCase();


        /*
         * Only inspect profiles that appear to belong
         * to this loader.
         */

        const matchesLoader =
            loader === "forge"
                ? lower.includes("forge") && !lower.includes("neoforge")
                : lower.includes("neoforge");


        if (!matchesLoader) {
            continue;
        }


        const jsonPath =
            path.join(

                versionsDirectory,

                directoryName,

                `${directoryName}.json`

            );


        try {

            const raw =
                await fs.readFile(
                    jsonPath,
                    "utf8"
                );


            const profile =
                JSON.parse(
                    raw
                );


            /*
             * Prefer profiles that inherit from the
             * requested Minecraft version.
             */

            if(profile.inheritsFrom !== minecraftVersion) continue;
            let score = 0;


            if (
                profile.inheritsFrom ===
                minecraftVersion
            ) {

                score += 100;

            }


            if (
                lower.includes(
                    minecraftVersion.toLowerCase()
                )
            ) {

                score += 50;

            }


            candidates.push({

                id:
                    directoryName,

                score

            });

        } catch {

            /*
             * Ignore unrelated/broken JSON files.
             */

        }

    }


    if (
        candidates.length === 0
    ) {

        throw new Error(
            `${formatLoaderName(loader)} installed successfully, but Novex could not find its Minecraft launch profile.`
        );

    }


    candidates.sort(
        (
            a,
            b
        ) =>
            b.score - a.score
    );


    return candidates[0].id;

}


/*
 * ============================================================
 * LOADER NAME
 * ============================================================
 */

function formatLoaderName(
    loader
) {

    switch (loader) {

        case "fabric":
            return "Fabric";

        case "forge":
            return "Forge";

        case "neoforge":
            return "NeoForge";

        case "quilt":
            return "Quilt";

        default:
            return "Vanilla";

    }

}


/*
 * ============================================================
 * MAIN INSTALLER
 * ============================================================
 */

export async function installMinecraft({

    version,

    loader = "vanilla",

    loaderVersion,

    instanceDirectory,

    onProgress

}) {

    if(!transferContext.getStore()?.deferReady && await fs.stat(resolveInside(instanceDirectory,'.novex-import-pending.json')).catch(e=>{if(e.code==='ENOENT')return null;throw e;}))throw new Error('This import is incomplete. Retry its Download Activity task. After restarting Novex, import the original source again; ordinary Repair cannot complete missing pack files.');
    if (currentInstallController) throw new Error("A Minecraft installation is already running.");
    currentInstallController = new AbortController();
    const parentSignal=transferContext.getStore()?.signal;
    const abort=()=>currentInstallController?.abort();
    parentSignal?.addEventListener('abort',abort,{once:true});
    if(parentSignal?.aborted)abort();
    try {
    safeSegment(version, "Minecraft version");
    if (loaderVersion) safeSegment(loaderVersion, "loader version");

    /*
     * --------------------------------------------------------
     * Validate arguments.
     * --------------------------------------------------------
     */

    if (!version) {

        throw new Error(
            "Minecraft version is required."
        );

    }


    if (!instanceDirectory) {

        throw new Error(
            "Instance directory is required."
        );

    }


    const supportedLoaders = [

        "vanilla",

        "fabric",

        "forge",

        "neoforge",

        "quilt"

    ];


    if (
        !supportedLoaders.includes(
            loader
        )
    ) {

        throw new Error(
            `Unsupported Minecraft loader: ${loader}`
        );

    }


    /*
     * --------------------------------------------------------
     * Prepare directories.
     *
     * IMPORTANT:
     * Nothing is deleted here.
     * --------------------------------------------------------
     */

    await fs.mkdir(
        instanceDirectory,
        {
            recursive: true
        }
    );


    await createMinecraftDirectories(
        instanceDirectory
    );
    await writeInstallState(instanceDirectory,{status:'installing',version,loader});

    onProgress?.({

        stage: "manifest",

        current: 0,

        total: 1,

        message:
            `Preparing Minecraft ${version} ${formatLoaderName(loader)} installation...`

    });


    /*
     * --------------------------------------------------------
     * VANILLA BASE
     * --------------------------------------------------------
     *
     * Every loader needs the correct Minecraft base files.
     */

    const vanilla =
        await installVanilla({

            version,

            instanceDirectory,

            onProgress

        });


    currentRequiredJava = vanilla.versionData.javaVersion?.majorVersion || 8;
    onProgress?.({stage:"java",current:0,total:1,message:`Selecting Java ${currentRequiredJava}…`});
    await resolveJava(currentRequiredJava, instanceDirectory, true);

    let installedLoader =
        "vanilla";


    let installedLoaderVersion =
        undefined;


    let launchVersion =
        version;


    /*
     * --------------------------------------------------------
     * LOADER
     * --------------------------------------------------------
     */

    switch (
        loader
    ) {

        /*
         * ----------------------------------------------------
         * VANILLA
         * ----------------------------------------------------
         */

        case "vanilla": {

            installedLoader =
                "vanilla";

            break;

        }


        /*
         * ----------------------------------------------------
         * FABRIC
         * ----------------------------------------------------
         */

        case "fabric": {

            const result =
                await installFabric({

                    version,

                    requestedLoaderVersion:
                        loaderVersion,

                    instanceDirectory,

                    onProgress

                });


            installedLoader =
                "fabric";


            installedLoaderVersion =
                result.loaderVersion;


            launchVersion =
                result.profileId;


            break;

        }


        /*
         * ----------------------------------------------------
         * QUILT
         * ----------------------------------------------------
         */

        case "quilt": {

            const result =
                await installQuilt({

                    version,

                    requestedLoaderVersion:
                        loaderVersion,

                    instanceDirectory,

                    onProgress

                });


            installedLoader =
                "quilt";


            installedLoaderVersion =
                result.loaderVersion;


            launchVersion =
                result.profileId;


            break;

        }


        /*
         * ----------------------------------------------------
         * FORGE
         * ----------------------------------------------------
         */

        case "forge": {

            const result =
                await installForge({

                    version,

                    requestedLoaderVersion:
                        loaderVersion,

                    instanceDirectory,

                    onProgress

                });


            installedLoader =
                "forge";


            installedLoaderVersion =
                result.loaderVersion;


            launchVersion =
                result.profileId;


            break;

        }


        /*
         * ----------------------------------------------------
         * NEOFORGE
         * ----------------------------------------------------
         */

        case "neoforge": {

            const result =
                await installNeoForge({

                    version,

                    requestedLoaderVersion:
                        loaderVersion,

                    instanceDirectory,

                    onProgress

                });


            installedLoader =
                "neoforge";


            installedLoaderVersion =
                result.loaderVersion;


            launchVersion =
                result.profileId;


            break;

        }

    }


    /*
     * --------------------------------------------------------
     * SAVE INSTALLATION STATE
     * --------------------------------------------------------
     *
     * This file tells Novex exactly what is installed.
     */

    const installationInfo = {

        minecraftVersion:
            version,

        loader:
            installedLoader,

        loaderVersion:
            installedLoaderVersion,

        launchVersion,

        installedAt:
            Date.now()

    };


    await fs.writeFile(

        path.join(

            instanceDirectory,

            "installation.json"

        ),

        JSON.stringify(

            installationInfo,

            null,

            2

        ),

        "utf8"

    );


    /*
     * --------------------------------------------------------
     * COMPLETE
     * --------------------------------------------------------
     */

    onProgress?.({

        stage: "complete",

        current: 1,

        total: 1,

        message:
            `Minecraft ${version} ${formatLoaderName(
                installedLoader
            )} installation complete.`

    });


    const result = {

        version,

        loader:
            installedLoader,

        loaderVersion:
            installedLoaderVersion,

        launchVersion,

        instanceDirectory

    };

    currentInstallController.signal.throwIfAborted();
    if(!transferContext.getStore()?.deferReady)await writeInstallState(instanceDirectory,{status:'ready',version,loader});
    return result;
    } catch(error) {
        await writeInstallState(instanceDirectory,{status:currentInstallController?.signal.aborted?'cancelled':'failed',version,loader,error:String(error.message).slice(0,500)}).catch(()=>{});
        throw error;
    } finally { parentSignal?.removeEventListener('abort',abort); currentInstallController = null; }
}

export function cancelMinecraftInstall() {
    if (currentInstallController) {
        currentInstallController.abort();
        return true;
    }
    return false;
}
// Repair only libraries for this OS, using the stored official/inherited profile.
export async function repairMinecraftLibraries(profile, instanceDirectory, onLog) {
    const repaired = await ensureLibraryArtifacts(profile, instanceDirectory, downloadFile);
    for (const library of applicableLibraries(profile.libraries || [])) {
        // Loader-generated libraries may not have download metadata. Preserve existing outputs.
        if (library.downloads?.artifact || library.downloads?.classifiers) continue;
        const relativePath = getMavenLibraryPath(library.name);
        if (!relativePath) continue;
        try { await fs.access(resolveInside(path.join(instanceDirectory, 'libraries'), relativePath, false)); }
        catch (error) {
            if (error.code !== 'ENOENT') throw error;
            await installProfileLibrary({ library, instanceDirectory });
        }
    }
    onLog?.(`[Novex] Current-platform libraries verified (${process.platform}); repaired ${repaired} classpath artifacts.`);
}
