import { startInstallation as queueInstallation, useActivity } from "../services/activity";
import type { CompanionStatus } from "../components/CompanionCard";
import {getInstances, saveInstances} from "../services/instances";
import NovexSelect from "../components/NovexSelect";
import { useDialogs } from "../components/Dialogs";
import {
    useEffect,
    useState,
    type ChangeEvent
} from "react";

import MinecraftConsole from "../components/MinecraftConsole";

import {
    createInstance,
    deleteInstance,
    updateInstance,
    type MinecraftInstance,
    type ModLoader
} from "../services/instances";

import {
    getMinecraftVersions,
    getRecommendedVersions,
    type MinecraftVersion
} from "../services/minecraft";


type InstancesProps = {
    instances: MinecraftInstance[];
    onInstancesChanged: () => void;
    onEditInstance?: (instance: MinecraftInstance) => void;
};


function Instances({
    instances,
    onInstancesChanged,
    onEditInstance
}: InstancesProps) {

    useEffect(() => {
        void window.novex.minecraft.status().then(status => {
            if (status.instanceId && ['starting', 'running', 'stopping'].includes(status.state)) {
                setRunningInstanceId(status.instanceId);
                setInstanceStates(current => ({ ...current, [status.instanceId!]: status.state }));
            }
        }).catch(() => {});
    }, []);

    const { notice } = useDialogs();
    const [sort, setSort] = useState(localStorage.getItem('novex-instance-sort') || 'recent');
    const [cloning, setCloning] = useState('');
    const [cloneProgress, setCloneProgress] = useState('');
    useEffect(() => window.novex.utilities.onProgress(setCloneProgress), []);
    async function cloneInstance(instance: MinecraftInstance) {
        setCloning(instance.id); setCloneProgress('Copying instance…');
        try {
            const result = await window.novex.utilities.run('clone', instance);
            if(result.instance) {saveInstances([...getInstances(), {...result.instance, icon:instance.icon, notes:instance.notes, group:instance.group}]);onInstancesChanged();}
        } catch(error) {void notice(error instanceof Error ? error.message : 'Unable to clone this instance.');}
        finally {setCloning('');setCloneProgress('');}
    }
    const [runningInstanceId, setRunningInstanceId] =
        useState<string | null>(null);

    const [instanceStates, setInstanceStates] =
        useState<Record<string, string>>({});

    const [consoleInstance, setConsoleInstance] =
        useState<MinecraftInstance | null>(null);

    const [versions, setVersions] =
        useState<MinecraftVersion[]>([]);

    const [loadingVersions, setLoadingVersions] =
        useState(true);

    const [versionError, setVersionError] =
        useState("");

    const [showCreate, setShowCreate] =
        useState(false);

    const [editing, setEditing] =
        useState<MinecraftInstance | null>(null);

    const [deleting, setDeleting] =
        useState<MinecraftInstance | null>(null);

    const jobs=useActivity();
    const installing=jobs.some(job=>['queued','running'].includes(job.status));
    const [search,setSearch]=useState('');
    const sortedInstances = instances.filter(i=>i.name.toLowerCase().includes(search.toLowerCase())).sort((a,b) => sort === 'recent' ? (b.lastPlayedAt || 0)-(a.lastPlayedAt || 0) : sort === 'created' ? b.createdAt-a.createdAt : sort === 'favorites' ? Number(!!b.favorite)-Number(!!a.favorite) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
    const [companion,setCompanion]=useState<CompanionStatus|null>(null);
    const [addCompanion,setAddCompanion]=useState(false);
    const [loaderVersion,setLoaderVersion]=useState('');
    const [javaPath,setJavaPath]=useState('');
    const [javaOptions,setJavaOptions]=useState<{path:string;major:number;source:string}[]>([]);
    useEffect(()=>{if(showCreate)void window.novex.java.list().then(setJavaOptions).catch(()=>{});},[showCreate]);
    const [required,setRequired]=useState<number|null>(null);
    const [name, setName] =
        useState("");

    const [minecraftVersion, setMinecraftVersion] =
        useState("");

    const [loader, setLoader] =
        useState<ModLoader>("vanilla");

    const [icon, setIcon] =
        useState<string | undefined>();


    useEffect(()=>{let alive=true;setAddCompanion(false);setCompanion(null);setRequired(null);
        if(minecraftVersion){void window.novex.companion.status({minecraftVersion,loader}).then(value=>{if(alive)setCompanion(value);}).catch(()=>{});void window.novex.java.required(minecraftVersion).then(value=>{if(alive)setRequired(value);}).catch(()=>{});}
        return()=>{alive=false;};
    },[minecraftVersion,loader]);
    /*
     * ============================================================
     * LOAD MINECRAFT VERSIONS
     * ============================================================
     */

    useEffect(() => {

        async function loadVersions() {

            try {

                setLoadingVersions(true);
                setVersionError("");

                const allVersions =
                    await getMinecraftVersions();

                const supportedVersions =
                    getRecommendedVersions(allVersions);

                setVersions(
                    supportedVersions
                );

                if (
                    supportedVersions.length > 0 &&
                    !minecraftVersion
                ) {

                    setMinecraftVersion(
                        supportedVersions[0].id
                    );

                }

            } catch (error) {

                console.error(
                    "Failed to load Minecraft versions:",
                    error
                );

                setVersionError(
                    "Could not load Minecraft versions."
                );

            } finally {

                setLoadingVersions(false);

            }

        }

        loadVersions();

    }, []);


    /*
     * ============================================================
     * INSTALLATION PROGRESS
     * ============================================================
     */

    /*
     * ============================================================
     * MINECRAFT STATE
     * ============================================================
     */

    useEffect(() => {

        if (
            !window.novex?.minecraft?.onState
        ) {

            return;

        }

        const cleanup =
            window.novex.minecraft.onState(
                (state: string) => {

                    setInstanceStates(
                        current => {

                            if (!runningInstanceId) {
                                return current;
                            }

                            return {
                                ...current,

                                [runningInstanceId]:
                                    state
                            };

                        }
                    );


                    if(state === 'crashed') void window.novex.minecraft.status().then(result => notice((result.lastError || 'Minecraft exited unexpectedly.') + '\nOutput is saved in Novex data/logs/novex.log.')).catch(()=>{});
                    if (
                        state === "stopped" ||
                        state === "crashed"
                    ) {

                        setRunningInstanceId(
                            null
                        );

                        if(state === "stopped") setConsoleInstance(null);

                    }

                }
            );

        return cleanup;

    }, [runningInstanceId]);


    /*
     * ============================================================
     * OPEN CREATE
     * ============================================================
     */

    function openCreate() {

        setEditing(null);

        setName("");

        setLoader("vanilla");
        setLoaderVersion("");
        setJavaPath("");

        setIcon(undefined);

        if (
            versions.length > 0
        ) {

            setMinecraftVersion(
                versions[0].id
            );

        }

        setAddCompanion(false);

        setShowCreate(true);

    }


    /*
     * ============================================================
     * OPEN EDIT
     * ============================================================
     */

    function openEdit(
        instance: MinecraftInstance
    ) {

        setEditing(
            instance
        );

        setName(
            instance.name
        );

        setMinecraftVersion(
            instance.minecraftVersion
        );

        setLoader(
            instance.loader
        );

        setIcon(
            instance.icon
        );

        setAddCompanion(false);

        setShowCreate(true);

    }


    /*
     * ============================================================
     * ICON UPLOAD
     * ============================================================
     */

    function handleIconUpload(
        event: ChangeEvent<HTMLInputElement>
    ) {

        const file =
            event.target.files?.[0];

        if (!file) {
            return;
        }

        if (
            !file.type.startsWith("image/")
        ) {

            void notice(
                "Please select an image file."
            );

            return;

        }

        if(file.size > 256 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) { void notice('Choose a PNG, JPEG or WebP icon smaller than 256 KiB.'); return; }
        const reader =
            new FileReader();

        reader.onload = () => {

            setIcon(
                reader.result as string
            );

        };

        reader.readAsDataURL(file);

    }


    /*
     * ============================================================
     * SAVE INSTANCE
     * ============================================================
     */

    async function handleSave() {

        if (
            !name.trim()
        ) {

            void notice(
                "Please enter an instance name."
            );

            return;

        }

        if (
            !minecraftVersion
        ) {

            void notice(
                "Please select a Minecraft version."
            );

            return;

        }


        /*
         * ========================================================
         * EDIT EXISTING INSTANCE
         * ========================================================
         */

        if (
            editing
        ) {

            const versionChanged =
                editing.minecraftVersion !==
                minecraftVersion;

            const loaderChanged =
                editing.loader !==
                loader;


            const updated =
                updateInstance(
                    editing.id,
                    {
                        name:
                            name.trim(),

                        minecraftVersion,

                        loader,

                        icon
                    }
                );


            if (
                !updated
            ) {

                void notice(
                    "Could not update the instance."
                );

                return;

            }


            onInstancesChanged();

            setShowCreate(false);


            /*
             * Only the name/icon changed.
             * No reinstall is required.
             */

            if (
                !versionChanged &&
                !loaderChanged
            ) {

                return;

            }


            /*
             * Minecraft version or loader changed.
             * Reinstall into the same instance folder.
             */

            await startInstallation(
                updated
            );

            return;

        }


        /*
         * ========================================================
         * CREATE NEW INSTANCE
         * ========================================================
         */

        const instance =
            createInstance(
                name.trim(),
                minecraftVersion,
                loader,
                icon
            );


        try {

            const instanceDirectory =
                await window.novex
                    .instances
                    .create(
                        instance
                    );

            console.log(
                "Instance directory:",
                instanceDirectory
            );

        } catch (error) {

            console.error(
                "Failed to create instance directory:",
                error
            );

            deleteInstance(
                instance.id
            );

            void notice(
                "Novex could not create the instance folder."
            );

            return;

        }


        onInstancesChanged();

        setShowCreate(false);


        await startInstallation(
            instance
        );

    }


    /*
     * ============================================================
     * INSTALL MINECRAFT
     * ============================================================
     */

    async function startInstallation(instance:MinecraftInstance) {
        try {if(javaPath)await window.novex.java.use(instance,javaPath);await queueInstallation({...instance,loaderVersion:loaderVersion.trim()||instance.loaderVersion},addCompanion);onInstancesChanged();}
        catch(error){void notice(error instanceof Error?error.message:'Unable to start installation.');}
    }
    /*
     * ============================================================
     * PLAY MINECRAFT
     * ============================================================
     */

    async function handlePlay(
        instance: MinecraftInstance
    ) {

        if (
            runningInstanceId
        ) {

            return;

        }


        try {

            const directory =
                await window.novex
                    .instances
                    .getDirectory(
                        instance
                    );


            setRunningInstanceId(
                instance.id
            );


            setInstanceStates(
                current => ({
                    ...current,

                    [instance.id]:
                        "starting"
                })
            );


            await window.novex
                .minecraft
                .launch({

                    instanceDirectory:
                        directory,

                    version:
                        instance.minecraftVersion,

                    loader:
                        instance.loader,

                    instanceId: instance.id

                });
            updateInstance(instance.id,{lastPlayedAt:Date.now()});
            onInstancesChanged();

        } catch (error) {

            void notice(error instanceof Error ? error.message : "Minecraft could not start. Open the console for details.");
            console.error(
                "Failed to launch Minecraft:",
                error
            );


            setInstanceStates(
                current => ({
                    ...current,

                    [instance.id]:
                        "crashed"
                })
            );


            setRunningInstanceId(
                null
            );

        }

    }


    /*
     * ============================================================
     * STOP MINECRAFT
     * ============================================================
     */

    async function handleStop(
        instance: MinecraftInstance
    ) {

        if (
            runningInstanceId !==
            instance.id
        ) {

            return;

        }


        try {

            setInstanceStates(
                current => ({
                    ...current,

                    [instance.id]:
                        "stopping"
                })
            );


            await window.novex
                .minecraft
                .stop();

        } catch (error) {

            console.error(
                "Failed to stop Minecraft:",
                error
            );

        }

    }


    /*
     * ============================================================
     * DELETE INSTANCE
     * ============================================================
     */

    async function confirmDelete() {

        if (
            !deleting
        ) {

            return;

        }


        if (
            runningInstanceId ===
            deleting.id
        ) {

            void notice(
                "Stop Minecraft before deleting this instance."
            );

            return;

        }


        try {

            await window.novex
                .instances
                .delete(
                    deleting
                );

        } catch (error) {

            console.error(
                "Failed to delete instance:",
                error
            );

            void notice(
                "Novex could not delete the instance folder."
            );

            return;

        }


        deleteInstance(
            deleting.id
        );

        onInstancesChanged();

        setDeleting(
            null
        );

    }


    /*
     * ============================================================
     * RENDER
     * ============================================================
     */

    return (

        <div className="page">

            {/* HEADER */}

            <div className="page-header">

                <div>

                    <div className="eyebrow">
                        NOVEX CLIENT
                    </div>

                    <h1>
                        Instances
                    </h1>

                    <p>
                        Manage your Minecraft installations.
                    </p>

                </div>


                <button className="secondary-button" onClick={()=>window.dispatchEvent(new Event("novex-import"))}>Import</button>
                <button
                    className="primary-button"
                    onClick={openCreate}
                    disabled={!!runningInstanceId}
                >
                    Create Instance
                </button>

            </div>


            <input className="instance-search" aria-label="Search instances" placeholder="Search your instances…" value={search} onChange={e=>setSearch(e.target.value)} />
            <div className="utility-actions" style={{marginBlock:16}}><NovexSelect label="Sort instances" value={sort} options={[{value:'favorites',label:'Favorites first'},{value:'name',label:'Name'},{value:'recent',label:'Recently played'},{value:'created',label:'Recently created'}]} onChange={value=>{setSort(value);localStorage.setItem('novex-instance-sort',value);}} />{cloning && <span role="status">{cloneProgress}</span>}</div>

            {/* VERSION ERROR */}

            {versionError && (

                <div className="version-warning">
                    {versionError}
                </div>

            )}


            {/* INSTANCES */}

            {instances.length === 0 ? (

                <div className="empty-card">

                    <div className="empty-icon">
                        +
                    </div>

                    <h3>
                        No instances
                    </h3>

                    <p>
                        Create your first Minecraft instance.
                    </p>

                    <button
                        className="primary-button"
                        onClick={openCreate}
                    >
                        Create Instance
                    </button>

                </div>

            ) : (

                <div className="instance-grid">

                    {sortedInstances.map(
                        instance => {

                            const state =
                                instanceStates[
                                    instance.id
                                ];

                            const isRunning =
                                runningInstanceId ===
                                instance.id;


                            const consoleDisabled =
                                !!installing ||
                                (
                                    !!runningInstanceId &&
                                    runningInstanceId !==
                                        instance.id
                                );


                            return (

                                <div
                                    className="instance-card"
                                    key={
                                        instance.id
                                    }
                                >

                                    {/* ICON */}

                                    {instance.icon ? (

                                        <img
                                            className="instance-icon-image"
                                            src={instance.icon}
                                            alt=""
                                        />

                                    ) : (

                                        <div className="instance-icon">
                                            MC
                                        </div>

                                    )}


                                    {/* INFO */}

                                    <div className="instance-info">

                                        <h3>
                                            {
                                                instance.name
                                            }
                                        </h3>

                                        <p>
                                            Minecraft{" "}
                                            {
                                                instance.minecraftVersion
                                            }
                                        </p>

                                        <div className="utility-actions"><button className="secondary-button button-small" aria-pressed={!!instance.favorite} title="Favorite instance" onClick={()=>{updateInstance(instance.id,{favorite:!instance.favorite});onInstancesChanged();}}>{instance.favorite ? '★ Favorite' : '☆ Favorite'}</button><button className="secondary-button button-small" disabled={!!cloning || !!runningInstanceId || !!installing} onClick={()=>void cloneInstance(instance)}>{cloning===instance.id ? 'Cloning…' : 'Clone'}</button></div>
                                        {instance.group && <p>{instance.group}</p>}
                                        {state === 'crashed' && <p className="utility-error">Minecraft stopped unexpectedly. Open Edit → Utilities → Inspect Crash Logs.</p>}
                                        <span className="loader-badge">

                                            {
                                                formatLoader(
                                                    instance.loader
                                                )
                                            }

                                        </span>


                                        {instance.loaderVersion && (

                                            <p>
                                                Loader{" "}
                                                {
                                                    instance.loaderVersion
                                                }
                                            </p>

                                        )}


                                        {(state || instance.status) && (

                                            <div
                                                className={
                                                    `instance-status instance-status-${state}`
                                                }
                                            >
                                                {
                                                    formatState(state || (instance.status === "ready" ? "Ready" : "Needs Repair"))
                                                }
                                            </div>

                                        )}

                                    </div>


                                    {/* ACTIONS */}

                                    <div className="instance-actions">
                                        <button className="secondary-button instance-folder" onClick={() => void window.novex.instances.openFolder(instance).catch(() => { void notice("Unable to open the instance folder. Check that it still exists."); })}>Open Folder</button>

                                        {isRunning ? (

                                            <button
                                                className="danger-button"
                                                onClick={() =>
                                                    handleStop(
                                                        instance
                                                    )
                                                }
                                            >
                                                Stop
                                            </button>

                                        ) : (

                                            <button
                                                className="primary-button"
                                                disabled={
                                                    !!runningInstanceId ||
                                                    (!!installing || instance.status === "installing" || instance.status === "repair")
                                                }
                                                onClick={() =>
                                                    handlePlay(
                                                        instance
                                                    )
                                                }
                                            >
                                                Play
                                            </button>

                                        )}


                                        <button
                                            className="secondary-button"
                                            disabled={
                                                consoleDisabled
                                            }
                                            onClick={() =>
                                                setConsoleInstance(
                                                    instance
                                                )
                                            }
                                        >
                                            Console
                                        </button>


                                        <button
                                            className="secondary-button"
                                            disabled={
                                                !!installing ||
                                                (
                                                    !!runningInstanceId &&
                                                    runningInstanceId !==
                                                        instance.id
                                                )
                                            }
                                            onClick={() => {

                                                if (
                                                    onEditInstance
                                                ) {

                                                    onEditInstance(
                                                        instance
                                                    );

                                                } else {

                                                    openEdit(
                                                        instance
                                                    );

                                                }

                                            }}
                                        >
                                            Edit
                                        </button>


                                        <button
                                            className="danger-button"
                                            disabled={
                                                !!runningInstanceId ||
                                                !!installing
                                            }
                                            onClick={() =>
                                                setDeleting(
                                                    instance
                                                )
                                            }
                                        >
                                            Delete
                                        </button>

                                    </div>

                                </div>

                            );

                        }
                    )}

                </div>

            )}


            {/* CREATE / EDIT MODAL */}

            {showCreate && (

                <div className="modal-background">

                    <div className="modal">

                        <h2>
                            {
                                editing
                                    ? "Edit Instance"
                                    : "Create Instance"
                            }
                        </h2>


                        <div className="form-group">

                            <label>
                                Instance Name
                            </label>

                            <input
                                type="text"
                                value={name}
                                onChange={event =>
                                    setName(
                                        event.target.value
                                    )
                                }
                                placeholder="My Minecraft Instance"
                            />

                        </div>


                        <div className="form-group">

                            <label>
                                Minecraft Version
                            </label>

                            <NovexSelect label="Minecraft version" searchable value={minecraftVersion} disabled={loadingVersions} onChange={setMinecraftVersion} options={versions.map(version => ({ value: version.id, label: version.id }))} />

                        </div>


                        <div className="form-group">

                            <label>
                                Mod Loader
                            </label>

                            <NovexSelect label="Mod loader" value={loader} onChange={value => setLoader(value as ModLoader)} options={[{value:"vanilla",label:"Vanilla"},{value:"fabric",label:"Fabric"},{value:"quilt",label:"Quilt"},{value:"forge",label:"Forge"},{value:"neoforge",label:"NeoForge"}]} />

                        </div>


                        <div className="form-group">

                            <label>
                                Instance Icon
                            </label>

                            <input
                                type="file"
                                accept="image/*"
                                onChange={
                                    handleIconUpload
                                }
                            />

                        </div>


                        {icon && (

                            <img
                                className="instance-icon-image"
                                src={icon}
                                alt=""
                            />

                        )}


                        {loader !== 'vanilla' && <div className="form-group"><label>Loader version (optional)</label><input value={loaderVersion} onChange={e=>setLoaderVersion(e.target.value)} placeholder="Latest compatible version" /></div>}
                        <section className="creation-option"><h3>Java</h3><NovexSelect label="Instance Java" value={javaPath} onChange={setJavaPath} options={[{value:"",label:"Automatic (Recommended)"},...javaOptions.map(j=>({value:j.path,label:`Java ${j.major} · ${j.source} · ${j.path}`}))]} /><p>{required?`Java ${required} will be detected or downloaded securely if needed.`:'Java requirements come from Minecraft metadata.'}</p></section>
                        {companion?.available && <section className="creation-option"><h3>Novex Companion</h3><p>Friends, messages and badges inside Minecraft. Requires Fabric API.</p><label><input type="checkbox" checked={addCompanion} onChange={e=>setAddCompanion(e.target.checked)} /> Add Fabric API + Novex Companion</label><button type="button" onClick={()=>setAddCompanion(false)}>Later</button></section>}
                        <div className="modal-actions">

                            <button
                                className="secondary-button"
                                onClick={() =>
                                    setShowCreate(
                                        false
                                    )
                                }
                            >
                                Cancel
                            </button>


                            <button
                                className="primary-button"
                                disabled={
                                    loadingVersions
                                }
                                onClick={
                                    handleSave
                                }
                            >
                                {
                                    editing
                                        ? "Save Changes"
                                        : "Create Instance"
                                }
                            </button>

                        </div>

                    </div>

                </div>

            )}


            {/* DELETE CONFIRMATION */}

            {deleting && (

                <div className="modal-background">

                    <div className="modal">

                        <h2>
                            Delete Instance
                        </h2>

                        <p>
                            Are you sure you want to{" "}
                            <strong>
                                {deleting.name}
                            </strong>
                            ?
                        </p>

                        <p>
                            This will delete the instance
                            files from Novex.
                        </p>


                        <div className="modal-actions">

                            <button
                                className="secondary-button"
                                onClick={() =>
                                    setDeleting(
                                        null
                                    )
                                }
                            >
                                Cancel
                            </button>


                            <button
                                className="danger-button"
                                onClick={
                                    confirmDelete
                                }
                            >
                                Delete Instance
                            </button>

                        </div>

                    </div>

                </div>

            )}


            {/* MINECRAFT CONSOLE */}

            <MinecraftConsole
                open={
                    consoleInstance !== null
                }
                instanceName={
                    consoleInstance?.name || ""
                }
                onClose={() =>
                    setConsoleInstance(
                        null
                    )
                }
            />

        </div>

    );

}


/*
 * ============================================================
 * FORMAT STATE
 * ============================================================
 */

function formatState(
    state: string
): string {

    switch (state) {

        case "starting":
            return "Starting...";

        case "running":
            return "Running";

        case "stopping":
            return "Stopping...";

        case "stopped":
            return "Stopped";

        case "crashed":
            return "Crashed";

        default:
            return state;

    }

}


/*
 * ============================================================
 * FORMAT LOADER
 * ============================================================
 */

function formatLoader(
    loader: ModLoader
): string {

    switch (loader) {

        case "vanilla":
            return "Vanilla";

        case "fabric":
            return "Fabric";

        case "forge":
            return "Forge";

        case "neoforge":
            return "NeoForge";

        case "quilt":
            return "Quilt";

        default:
            return "Unknown";

    }

}


export default Instances;