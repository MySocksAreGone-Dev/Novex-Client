import { downloadBytes } from './transfer.js';
import { identifyInstalledMods } from './modIdentity.js';
import { validateModrinthVersion } from "./contentValidation.js";
import { installMinecraft } from "./minecraftInstaller.js";
import { secureFetch as fetch } from "./downloads.js";
import { resolveInside } from "./pathSafety.js";
import fs from "fs/promises";
import path from "path";


const API =
    "https://api.modrinth.com/v2";


/*
 * GET JSON
 */

async function json(
    url
) {

    const response =
        await fetch(
            url
        );


    if (!response.ok) {

        throw new Error(
            `Modrinth request failed: HTTP ${response.status}`
        );

    }


    return response.json();

}


/*
 * DOWNLOAD FILE
 */

async function download(
    url, hashes
) {

    return downloadBytes(url, hashes);
}


/*
 * GET COMPATIBLE VERSIONS
 */

async function versions(

    projectId,

    gameVersion,

    loader

) {

    const url =
        new URL(

            `${API}/project/${encodeURIComponent(
                projectId
            )}/version`

        );


    if (gameVersion) {

        url.searchParams.set(

            "game_versions",

            JSON.stringify([
                gameVersion
            ])

        );

    }


    /*
     * Only apply loader filtering
     * when installing a loader-based
     * project such as a mod.
     */

    if (

        loader &&
        loader !== "vanilla"

    ) {

        url.searchParams.set(

            "loaders",

            JSON.stringify([
                loader
            ])

        );

    }


    return json(

        url.toString()

    );

}


/*
 * PREVENT ../ PATH ESCAPES
 */

const safeTarget = (root, relative) => resolveInside(root, relative, false);

const installingInstances = new Set();
export async function installMod(options) {
    if(installingInstances.has(options.instanceDirectory)) throw new Error('A mod installation is already running for this instance.');
    installingInstances.add(options.instanceDirectory);
    try { return await installModChecked(options); }
    finally { installingInstances.delete(options.instanceDirectory); }
}
async function installModChecked({

    instanceDirectory,

    projectId,

    versionId,

    gameVersion,

    loader

}) {

    const existingMods = await identifyInstalledMods(instanceDirectory);
    const projectVersions = new Map();
    const installed =
        new Set();


    async function install(

        id,

        forcedVersionId = null

    ) {

        const existing = existingMods.find(entry=>entry.version.project_id===id);
        if(existing) {
            if(id===projectId) return; // Already installed, including disabled files.
            if(!existing.enabled) throw new Error(`Required dependency ${existing.name} is disabled. Enable it in Installed mods first.`);
            validateModrinthVersion(existing.version,id,gameVersion,loader);
            if(forcedVersionId && existing.version.id!==forcedVersionId) throw new Error(`Required dependency ${existing.name} needs a different version. Review mod updates first.`);
            return;
        }
        const cacheKey =
            forcedVersionId ||
            id;


        if (

            installed.has(
                cacheKey
            )

        ) {

            return;

        }


        let availableVersions;


        /*
         * If a version was explicitly
         * selected, get that exact version.
         */

        if (forcedVersionId) {

            availableVersions = [

                await json(

                    `${API}/version/${encodeURIComponent(
                        forcedVersionId
                    )}`

                )

            ];

        } else {

            availableVersions =
                await versions(

                    id,

                    gameVersion,

                    loader

                );

        }


        const version =
            availableVersions[0];


        if (!version) {

            throw new Error(

                `No compatible Modrinth version for ${id}.`

            );

        }


        validateModrinthVersion(version, id, gameVersion, loader);
        if(projectVersions.has(id) && projectVersions.get(id)!==version.id) throw new Error('Required dependencies request conflicting versions of the same mod. No duplicate was installed.');
        projectVersions.set(id,version.id);
        if (installed.size >= 200) throw new Error('This mod has too many required dependencies.');
        installed.add(cacheKey);


        /*
         * Install required dependencies first.
         */

        for (

            const dependency
            of version.dependencies || []

        ) {

            if (

                dependency.dependency_type !==
                "required"

            ) {

                continue;

            }


            let dependencyProject = dependency.project_id;
            if (!dependencyProject && dependency.version_id) {
                dependencyProject = (await json(`${API}/version/${encodeURIComponent(dependency.version_id)}`)).project_id;
            }
            if (!dependencyProject) throw new Error('A required mod dependency has no project identity.');

            await install(

                dependencyProject,

                dependency.version_id ||
                null

            );

        }


        /*
         * Find the main downloadable file.
         */

        const file =

            version.files.find(

                file =>
                    file.primary

            ) ||

            version.files[0];


        if (!file) {

            throw new Error(

                `No downloadable file for ${version.name}.`

            );

        }


        const destination = safeTarget(instanceDirectory, path.join('mods', path.basename(file.filename)));
        for(const candidate of [destination,destination+'.disabled']) {
            if(await fs.stat(candidate).catch(error=>{if(error.code==='ENOENT')return null;throw error;})) throw new Error('This mod filename is already installed. No file was overwritten.');
        }
        const data =
            await download(
                file.url, file.hashes
            );


        const modsDirectory =
            safeTarget(

                instanceDirectory,

                "mods"

            );


        await fs.mkdir(

            modsDirectory,

            {
                recursive: true
            }

        );


        await fs.writeFile(

            safeTarget(

                instanceDirectory,

                path.join(

                    "mods",

                    path.basename(
                        file.filename
                    )

                )

            ),

            data, {flag:"wx"}

        );

    }


    await install(

        projectId,

        versionId ||
        null

    );


    return true;

}


/*
 * INSTALL FAVORITE MODS
 */

export async function installFavorites({

    instanceDirectory,

    gameVersion,

    loader,

    projectIds

}) {

    for (

        const projectId
        of projectIds || []

    ) {

        await installMod({

            instanceDirectory,

            projectId,

            gameVersion,

            loader

        });

    }


    return true;

}


/*
 * INSTALL MODPACK
 */

export async function installModpack({

    instanceDirectory,

    projectId,

    versionId,
    gameVersion,
    loader

}) {

    if (!versionId) {

        throw new Error(

            "A Modrinth modpack version is required."

        );

    }


    /*
     * Get the exact selected version.
     */

    const version =
        await json(

            `${API}/version/${encodeURIComponent(
                versionId
            )}`

        );


    const file =

        version.files.find(

            file =>
                file.primary

        ) ||

        version.files[0];


    if (!file) {

        throw new Error(

            "This modpack has no downloadable file."

        );

    }


    if (

        !file.filename
            .toLowerCase()
            .endsWith(".mrpack")

    ) {

        throw new Error(

            "The selected file is not a Modrinth .mrpack file."

        );

    }


    /*
     * adm-zip handles the .mrpack archive.
     */

    const AdmZip =
        (

            await import(
                "adm-zip"
            )

        ).default;


    const archive =
        new AdmZip(

            await download(
                file.url, file.hashes
            )

        );


    const entries =
        archive.getEntries();


    /*
     * Find modrinth.index.json.
     */

    const indexEntry =
        entries.find(

            entry =>
                entry.entryName ===
                "modrinth.index.json"

        );


    if (!indexEntry) {

        throw new Error(

            "Invalid modpack: modrinth.index.json is missing."

        );

    }


    const index =
        JSON.parse(

            indexEntry
                .getData()
                .toString(
                    "utf8"
                )

        );


    if (

        index.formatVersion !== 1 &&

        index.formatVersion !== 2

    ) {

        throw new Error(

            `Unsupported Modrinth pack format: ${index.formatVersion}`

        );

    }


    if (version.project_id !== projectId) throw new Error('Modpack version does not belong to the selected project.');
    const dependencies = index.dependencies || {};
    const loaderKeys = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' };
    const loaderKey = Object.keys(loaderKeys).find(key => dependencies[key]);
    const packLoader = loaderKey ? loaderKeys[loaderKey] : 'vanilla';
    if (dependencies.minecraft !== gameVersion || packLoader !== loader) throw new Error('This modpack requires a different Minecraft version or loader. Create a matching instance first.');
    const contentPath = relative => {
        const first = typeof relative === 'string' ? relative.replaceAll('\\', '/').split('/')[0].toLowerCase() : '';
        if (['versions', 'libraries', 'natives', '.novex', 'instance.json', 'installation.json'].includes(first)) throw new Error('Modpack contains a protected launcher path.');
        return safeTarget(instanceDirectory, relative);
    };
    for (const packFile of index.files || []) contentPath(packFile.path);
    for (const entry of entries) {
        const relative = entry.entryName.replace(/^(client-overrides|overrides)\//, '');
        if (!entry.isDirectory && relative !== entry.entryName) contentPath(relative);
    }
    await installMinecraft({ version: gameVersion, loader, loaderVersion: loaderKey ? dependencies[loaderKey] : undefined, instanceDirectory });

    /*
     * Download files listed in
     * modrinth.index.json.
     */

    for (

        const packFile
        of index.files || []

    ) {

        if (

            !packFile.downloads ||

            !packFile.downloads.length

        ) {

            continue;

        }


        const target =
            safeTarget(

                instanceDirectory,

                packFile.path

            );


        await fs.mkdir(

            path.dirname(
                target
            ),

            {
                recursive: true
            }

        );


        await fs.writeFile(

            target,

            await download(

                packFile.downloads[0], packFile.hashes

            )

        );

    }


    /*
     * Install overrides.
     */

    for (

        const entry
        of entries

    ) {

        if (
            entry.isDirectory
        ) {

            continue;

        }


        let relativePath =
            null;


        if (

            entry.entryName.startsWith(
                "overrides/"
            )

        ) {

            relativePath =
                entry.entryName.slice(

                    "overrides/"
                        .length

                );

        } else if (

            entry.entryName.startsWith(
                "client-overrides/"
            )

        ) {

            relativePath =
                entry.entryName.slice(

                    "client-overrides/"
                        .length

                );

        }


        if (((entry.attr >>> 16) & 0o170000) === 0o120000) throw new Error("Modpack contains a symbolic link.");
        if (!relativePath) {

            continue;

        }


        const target =
            safeTarget(

                instanceDirectory,

                relativePath

            );


        await fs.mkdir(

            path.dirname(
                target
            ),

            {
                recursive: true
            }

        );


        await fs.writeFile(

            target,

            entry.getData()

        );

    }


    return {

        projectId,

        versionId,

        name:
            index.name ||
            projectId

    };

}


/*
 * INSTALL RESOURCE PACK
 */

export async function installResourcePack({

    instanceDirectory,

    projectId,

    versionId,

    gameVersion

}) {

    /*
     * Get the exact selected version
     * when the UI supplied one.
     */

    let version;


    if (versionId) {

        version =
            await json(

                `${API}/version/${encodeURIComponent(
                    versionId
                )}`

            );

    } else {

        const availableVersions =
            await versions(

                projectId,

                gameVersion,

                null

            );


        version =
            availableVersions[0];

    }


    if (!version) {

        throw new Error(

            `No compatible resource pack version was found for ${projectId}.`

        );

    }


    validateModrinthVersion(version, projectId, gameVersion);

    /*
     * Find the primary file.
     */

    const file =

        version.files.find(

            file =>
                file.primary

        ) ||

        version.files[0];


    if (!file) {

        throw new Error(

            "This resource pack has no downloadable file."

        );

    }


    /*
     * Resource packs should normally
     * be ZIP files.
     */

    if (

        !file.filename
            .toLowerCase()
            .endsWith(".zip")

    ) {

        throw new Error(

            "The selected resource pack file is not a ZIP file."

        );

    }


    /*
     * Download the resource pack.
     */

    const data =
        await download(

            file.url, file.hashes

        );


    /*
     * Minecraft resource packs belong
     * inside the instance/resourcepacks
     * directory.
     */

    const resourcePacksDirectory =
        safeTarget(

            instanceDirectory,

            "resourcepacks"

        );


    await fs.mkdir(

        resourcePacksDirectory,

        {
            recursive: true
        }

    );


    /*
     * Use only the filename supplied by
     * Modrinth. This prevents a malicious
     * path such as ../../something.exe.
     */

    const filename =
        path.basename(
            file.filename
        );


    const target =
        safeTarget(

            instanceDirectory,

            path.join(

                "resourcepacks",

                filename

            )

        );


    await fs.writeFile(

        target,

        data

    );


    return true;

}