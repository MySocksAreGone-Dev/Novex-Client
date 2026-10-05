import crypto from 'node:crypto';
import { inspectPack, installPackContent } from './packArchive.js';
import { writeInstallState } from './installationState.js';
import { transferContext } from './transfer.js';
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


    if (version.project_id !== projectId) throw new Error('Modpack version does not belong to this project.');
    const pack=inspectPack(await downloadBytes(file.url,file.hashes,{maxBytes:512*1024*1024}));
    if(pack.minecraftVersion!==gameVersion || pack.loader!==loader)throw new Error('This pack requires a different Minecraft version or loader. Create a matching instance first.');
    return installInspectedPack(pack,instanceDirectory,{projectId,versionId});
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


    const installed=(await identifyInstalledMods(instanceDirectory,'resourcepacks')).filter(item=>item.version.project_id===projectId);
    if(installed.length>1)throw new Error('Multiple versions of this resource pack exist. Review the resourcepacks folder first.');
    const previous=installed[0];
    if(previous?.version.id===version.id)return true;
    const old=previous?safeTarget(instanceDirectory,`resourcepacks/${previous.name}`):null;
    if(target!==old&&await fs.stat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;}))throw new Error('A file with this name already exists.');
    const temporary=safeTarget(instanceDirectory,`resourcepacks/.novex-${crypto.randomUUID()}.tmp`);
    const backup=safeTarget(instanceDirectory,`.novex-mod-backups/${crypto.randomUUID()}-${previous?.name||filename}`);
    await fs.writeFile(temporary,data,{flag:'wx'});
    try {
        if(old){
            const digest=crypto.createHash('sha1').update(await fs.readFile(old)).digest('hex');
            if(digest!==previous.hash)throw new Error('The installed resource pack changed. Try again.');
            await fs.mkdir(path.dirname(backup),{recursive:true});await fs.rename(old,backup);
        }
        try{await fs.link(temporary,target);}catch(error){if(old)await fs.rename(backup,old);throw error;}
    }finally{await fs.rm(temporary,{force:true});}



    return true;

}
export async function installInspectedPack(pack,instanceDirectory,identity={}) {
    const {minecraftVersion:version,loader,loaderVersion}=pack;
    await writeInstallState(instanceDirectory,{status:'installing',version,loader});
    await fs.writeFile(resolveInside(instanceDirectory,'.novex-import-pending.json'),JSON.stringify({type:'modrinth-pack'}));
    try {
        const result=await transferContext.run({...transferContext.getStore(),deferReady:true},async()=>{
            const result=await installMinecraft({version,loader,loaderVersion,instanceDirectory});
            await installPackContent(pack,instanceDirectory);
            return result;
        });
        transferContext.getStore()?.signal?.throwIfAborted();
        await fs.rm(resolveInside(instanceDirectory,'.novex-import-pending.json'),{force:true});
        await writeInstallState(instanceDirectory,{status:'ready',version,loader});
        return {...result,...identity,name:pack.index.name};
    } catch(error) {
        await writeInstallState(instanceDirectory,{status:'failed',version,loader,error:String(error.message).slice(0,500)});
        throw error;
    }
}
