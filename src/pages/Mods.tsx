import ProjectPage from '../components/ProjectPageView';
import InstalledMods from "../components/InstalledMods";
import { useDialogs } from "../components/Dialogs";
import { uiError } from "../services/uiError";
import ContentSource from "../components/ContentSource";
import {
    useEffect,
    useRef,
    useState
} from "react";

import {
    browseProjects,
    searchProjects,
    getProjectVersions, getRequiredDependencyNames,
    type ModrinthProject,
    type ModrinthVersion
} from "../services/modrinth";

import type {
    MinecraftInstance
} from "../services/instances";

type Props = {
    instances: MinecraftInstance[];
};

function ModrinthMods({
    instances
}: Props) {

    const {confirm} = useDialogs();
    const [installedRevision, setInstalledRevision] = useState(0);
    const [installedProjects, setInstalledProjects] = useState<string[]>([]);
    const [checkingInstalled, setCheckingInstalled] = useState(false);
    const [mods, setMods] =
        useState<ModrinthProject[]>([]);

    const [projectId,setProjectId]=useState<string|null>(null);
    const [search, setSearch] =
        useState("");

    const [loading, setLoading] =
        useState(false);

    const [error, setError] =
        useState("");

    const [installing, setInstalling] =
        useState<string | null>(null);

    const [selectedInstanceId, setSelectedInstanceId] =
        useState(
            instances[0]?.id || ""
        );

    const [instanceMenuOpen, setInstanceMenuOpen] =
        useState(false);

    const [instanceSearch, setInstanceSearch] =
        useState("");

    const instanceMenuRef =
        useRef<HTMLDivElement | null>(null);


    const selectedInstance =
        instances.find(
            instance =>
                instance.id === selectedInstanceId
        );


    useEffect(()=>{
        let cancelled=false;
        setInstalledProjects([]);
        if(!selectedInstance)return;
        setCheckingInstalled(true);
        window.novex.mods.installedProjects(selectedInstance).then(projects=>{if(!cancelled)setInstalledProjects(projects);})
            .catch(error=>{if(!cancelled)setError(uiError(error,'Unable to check installed mods.'));})
            .finally(()=>{if(!cancelled)setCheckingInstalled(false);});
        return ()=>{cancelled=true;};
    },[selectedInstance?.id,installedRevision]);

    const gameVersion =
        selectedInstance?.minecraftVersion ||
        "1.21.11";


    const loader =
        selectedInstance?.loader ||
        "fabric";


    useEffect(() => {

        if (
            selectedInstanceId &&
            instances.some(
                instance =>
                    instance.id === selectedInstanceId
            )
        ) {
            return;
        }

        setSelectedInstanceId(
            instances[0]?.id || ""
        );

    }, [
        instances,
        selectedInstanceId
    ]);


    useEffect(() => {

        function handleClick(
            event: MouseEvent
        ) {

            if (
                instanceMenuRef.current &&
                !instanceMenuRef.current.contains(
                    event.target as Node
                )
            ) {
                setInstanceMenuOpen(false);
            }

        }

        document.addEventListener(
            "mousedown",
            handleClick
        );

        return () => {

            document.removeEventListener(
                "mousedown",
                handleClick
            );

        };

    }, []);


    async function loadMods() {

        setLoading(true);
        setError("");

        try {

            const results =
                search.trim()
                    ? await searchProjects(
                        search,
                        gameVersion,
                        loader,
                        "mod"
                    )
                    : await browseProjects(
                        gameVersion,
                        loader,
                        "mod"
                    );

            setMods(results);

        } catch (err) {

            console.error(
                "Failed to load Modrinth mods:",
                err
            );

            setError(
                uiError(err, "Failed to load mods.")
            );

        } finally {

            setLoading(false);

        }

    }


    useEffect(() => {

        loadMods();

    }, [
        gameVersion,
        loader
    ]);


    async function installMod(
        mod: ModrinthProject
    ) {

        if (!selectedInstance) {

            setError(
                "Select an instance first."
            );

            return;

        }

        setInstalling(
            mod.project_id
        );

        setError("");

        try {

            const versions:
                ModrinthVersion[] =
                await getProjectVersions(
                    mod.project_id,
                    gameVersion,
                    loader
                );


            if (
                versions.length === 0
            ) {

                throw new Error(
                    `No compatible ${loader} version of this mod was found for Minecraft ${gameVersion}.`
                );

            }


            const version =
                versions[0];


            const required = await getRequiredDependencyNames(version);
            if(required.length && !await confirm(`Required dependencies:\n${required.join('\n')}\n\nInstall this mod with its required dependencies? Optional dependencies are not installed.`, 'Install with dependencies', false)) return;
            await window.novex.mods.install(
                selectedInstance,
                mod.project_id,
                version.id
            );
            setInstalledRevision(value=>value+1);

        } catch (err) {

            console.error(
                "Failed to install mod:",
                err
            );

            setError(
                uiError(err, "Failed to install mod.")
            );

        } finally {

            setInstalling(null);

        }

    }


    const filteredInstances =
        instances.filter(instance => {

            const query =
                instanceSearch
                    .trim()
                    .toLowerCase();

            if (!query) {
                return true;
            }

            return (
                instance.name
                    .toLowerCase()
                    .includes(query)
                ||
                instance.minecraftVersion
                    .toLowerCase()
                    .includes(query)
                ||
                instance.loader
                    .toLowerCase()
                    .includes(query)
            );

        });


    if(projectId)return <ProjectPage id={projectId} instance={selectedInstance} onBack={()=>setProjectId(null)}/>;

    if (
        instances.length === 0
    ) {

        return (

            <div
                style={{
                    width: "100%"
                }}
            >

                <div
                    style={{
                        marginBottom: 25
                    }}
                >

                    <h1
                        style={{
                            margin: 0,
                            fontSize: 25
                        }}
                    >
                        Mods
                    </h1>

                    <p
                        style={{
                            margin: "7px 0 0",
                            color: "#777780",
                            fontSize: 13
                        }}
                    >
                        Browse and install Minecraft
                        mods from Modrinth.
                    </p>

                </div>


                <div
                    className="empty-state"
                >
                    Create a Minecraft instance
                    first to install mods.
                </div>

            </div>

        );

    }


    return (

        <div
            style={{
                width: "100%"
            }}
        >

            <p className="utility-muted">Showing {loader === "neoforge" ? "NeoForge" : loader === "forge" ? "Forge" : loader} mods for Minecraft {gameVersion}. Select the matching instance to change the loader filter.</p>
            {selectedInstance && <InstalledMods key={selectedInstance.id} instance={selectedInstance} revision={installedRevision} />}
            {/* =================================================
                HEADER
               ================================================= */}

            <div
                style={{
                    marginBottom: 24
                }}
            >

                <h1
                    style={{
                        margin: 0,
                        fontSize: 25,
                        fontWeight: 750,
                        color: "#f4f4f6"
                    }}
                >
                    Mods
                </h1>

                <p
                    style={{
                        margin: "7px 0 0",
                        color: "#777780",
                        fontSize: 13
                    }}
                >
                    Browse and install Minecraft
                    mods from Modrinth.
                </p>

            </div>


            {/* =================================================
                INSTANCE SELECTOR
               ================================================= */}

            <div
                style={{
                    marginBottom: 18,
                    padding: 18,
                    borderRadius: 14,
                    border:
                        "1px solid rgba(255,255,255,0.075)",
                    background:
                        "rgba(255,255,255,0.025)"
                }}
            >

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 18,
                        flexWrap: "wrap"
                    }}
                >

                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            minWidth: 220
                        }}
                    >

                        <div
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 11,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                                background:
                                    "rgba(124,58,237,0.10)",
                                border:
                                    "1px solid rgba(124,58,237,0.18)",
                                color: "#a78bfa"
                            }}
                        >
                            <CubeIcon />
                        </div>


                        <div>

                            <div
                                style={{
                                    fontSize: 13,
                                    fontWeight: 650,
                                    color: "#e7e7eb"
                                }}
                            >
                                Install to
                            </div>

                            <div
                                style={{
                                    marginTop: 3,
                                    fontSize: 11,
                                    color: "#73737d"
                                }}
                            >
                                Select an instance for
                                these mods
                            </div>

                        </div>

                    </div>


                    {/* INSTANCE PICKER */}

                    <div
                        ref={instanceMenuRef}
                        style={{
                            position: "relative",
                            width: 320,
                            maxWidth: "100%"
                        }}
                    >

                        <button
                            type="button"
                            onClick={() =>
                                setInstanceMenuOpen(
                                    value => !value
                                )
                            }
                            style={{
                                width: "100%",
                                minHeight: 54,
                                display: "flex",
                                alignItems: "center",
                                gap: 11,
                                padding: "8px 11px",
                                borderRadius: 11,
                                border:
                                    instanceMenuOpen
                                        ? "1px solid rgba(139,92,246,0.50)"
                                        : "1px solid rgba(255,255,255,0.08)",
                                background:
                                    "rgba(255,255,255,0.035)",
                                color: "#f5f5f5",
                                cursor: "pointer",
                                textAlign: "left",
                                boxSizing: "border-box"
                            }}
                        >

                            <div
                                style={{
                                    width: 34,
                                    height: 34,
                                    borderRadius: 9,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                    background:
                                        "rgba(124,58,237,0.12)",
                                    color: "#a78bfa"
                                }}
                            >
                                <CubeIcon small />
                            </div>


                            <div
                                style={{
                                    flex: 1,
                                    minWidth: 0
                                }}
                            >

                                <div
                                    style={{
                                        fontSize: 12.5,
                                        fontWeight: 650,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap"
                                    }}
                                >
                                    {
                                        selectedInstance?.name ||
                                        "Select instance"
                                    }
                                </div>


                                {selectedInstance && (
                                    <div
                                        style={{
                                            marginTop: 3,
                                            fontSize: 10.5,
                                            color: "#777780"
                                        }}
                                    >
                                        {
                                            selectedInstance.minecraftVersion
                                        }
                                        {" • "}
                                        {
                                            selectedInstance.loader
                                        }
                                    </div>
                                )}

                            </div>


                            <ChevronDown
                                open={
                                    instanceMenuOpen
                                }
                            />

                        </button>


                        {instanceMenuOpen && (

                            <div
                                style={{
                                    position: "absolute",
                                    top: "calc(100% + 7px)",
                                    left: 0,
                                    right: 0,
                                    zIndex: 100,
                                    padding: 7,
                                    borderRadius: 12,
                                    background: "#151517",
                                    border:
                                        "1px solid rgba(255,255,255,0.10)",
                                    boxShadow:
                                        "0 18px 50px rgba(0,0,0,0.55)",
                                    boxSizing: "border-box"
                                }}
                            >

                                {instances.length >= 4 && (

                                    <div
                                        style={{
                                            position: "relative",
                                            marginBottom: 6
                                        }}
                                    >

                                        <input
                                            autoFocus
                                            value={
                                                instanceSearch
                                            }
                                            onChange={e =>
                                                setInstanceSearch(
                                                    e.target.value
                                                )
                                            }
                                            placeholder="Search instances..."
                                            style={{
                                                width: "100%",
                                                height: 36,
                                                padding:
                                                    "0 10px 0 32px",
                                                borderRadius: 8,
                                                border:
                                                    "1px solid rgba(255,255,255,0.08)",
                                                background:
                                                    "rgba(255,255,255,0.035)",
                                                color: "#f5f5f5",
                                                outline: "none",
                                                boxSizing:
                                                    "border-box",
                                                fontSize: 11.5
                                            }}
                                        />

                                        <SearchIcon />

                                    </div>

                                )}


                                <div
                                    style={{
                                        maxHeight: 270,
                                        overflowY: "auto"
                                    }}
                                >

                                    {filteredInstances.length === 0 ? (

                                        <div
                                            style={{
                                                padding:
                                                    "20px 10px",
                                                textAlign:
                                                    "center",
                                                color:
                                                    "#777780",
                                                fontSize: 11.5
                                            }}
                                        >
                                            No instances found.
                                        </div>

                                    ) : (

                                        filteredInstances.map(
                                            instance => {

                                                const active =
                                                    instance.id ===
                                                    selectedInstanceId;

                                                return (

                                                    <button
                                                        type="button"
                                                        key={
                                                            instance.id
                                                        }
                                                        onClick={() => {

                                                            setSelectedInstanceId(
                                                                instance.id
                                                            );

                                                            setInstanceMenuOpen(
                                                                false
                                                            );

                                                            setInstanceSearch(
                                                                ""
                                                            );

                                                        }}
                                                        style={{
                                                            width:
                                                                "100%",
                                                            minHeight:
                                                                52,
                                                            display:
                                                                "flex",
                                                            alignItems:
                                                                "center",
                                                            gap: 10,
                                                            padding:
                                                                "7px 9px",
                                                            marginBottom:
                                                                3,
                                                            borderRadius:
                                                                9,
                                                            border:
                                                                active
                                                                    ? "1px solid rgba(139,92,246,0.22)"
                                                                    : "1px solid transparent",
                                                            background:
                                                                active
                                                                    ? "rgba(124,58,237,0.11)"
                                                                    : "transparent",
                                                            color:
                                                                "#f5f5f5",
                                                            cursor:
                                                                "pointer",
                                                            textAlign:
                                                                "left",
                                                            boxSizing:
                                                                "border-box"
                                                        }}
                                                    >

                                                        <div
                                                            style={{
                                                                width: 32,
                                                                height: 32,
                                                                borderRadius: 8,
                                                                display:
                                                                    "flex",
                                                                alignItems:
                                                                    "center",
                                                                justifyContent:
                                                                    "center",
                                                                flexShrink:
                                                                    0,
                                                                background:
                                                                    active
                                                                        ? "rgba(124,58,237,0.18)"
                                                                        : "rgba(255,255,255,0.045)",
                                                                color:
                                                                    active
                                                                        ? "#a78bfa"
                                                                        : "#888892"
                                                            }}
                                                        >
                                                            <CubeIcon small />
                                                        </div>


                                                        <div
                                                            style={{
                                                                flex: 1,
                                                                minWidth: 0
                                                            }}
                                                        >

                                                            <div
                                                                style={{
                                                                    fontSize: 12,
                                                                    fontWeight: 600,
                                                                    overflow:
                                                                        "hidden",
                                                                    textOverflow:
                                                                        "ellipsis",
                                                                    whiteSpace:
                                                                        "nowrap"
                                                                }}
                                                            >
                                                                {
                                                                    instance.name
                                                                }
                                                            </div>

                                                            <div
                                                                style={{
                                                                    marginTop: 3,
                                                                    fontSize: 10,
                                                                    color:
                                                                        "#73737d"
                                                                }}
                                                            >
                                                                {
                                                                    instance.minecraftVersion
                                                                }
                                                                {" • "}
                                                                {
                                                                    instance.loader
                                                                }
                                                            </div>

                                                        </div>


                                                        {active && (
                                                            <CheckIcon />
                                                        )}

                                                    </button>

                                                );

                                            }
                                        )

                                    )}

                                </div>

                            </div>

                        )}

                    </div>

                </div>

            </div>


            {/* =================================================
                SEARCH
               ================================================= */}

            <div
                style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: 20
                }}
            >

                <input
                    value={search}
                    onChange={e =>
                        setSearch(
                            e.target.value
                        )
                    }
                    onKeyDown={e => {

                        if (
                            e.key === "Enter"
                        ) {
                            loadMods();
                        }

                    }}
                    placeholder="Search Modrinth mods..."
                    style={{
                        flex: 1,
                        minWidth: 0,
                        height: 42,
                        padding: "0 13px",
                        borderRadius: 9,
                        border:
                            "1px solid rgba(255,255,255,0.08)",
                        background:
                            "rgba(255,255,255,0.035)",
                        color: "#f5f5f5",
                        outline: "none",
                        boxSizing: "border-box",
                        fontSize: 12.5
                    }}
                />


                <button
                    type="button"
                    onClick={loadMods}
                    disabled={loading}
                    style={{
                        height: 42,
                        padding: "0 17px",
                        borderRadius: 9,
                        border:
                            "1px solid rgba(139,92,246,0.35)",
                        background:
                            loading
                                ? "rgba(124,58,237,0.08)"
                                : "rgba(124,58,237,0.15)",
                        color:
                            loading
                                ? "#777780"
                                : "#c4b5fd",
                        fontSize: 12,
                        fontWeight: 650,
                        cursor:
                            loading
                                ? "default"
                                : "pointer",
                        transition:
                            "all 0.15s ease",
                        flexShrink: 0
                    }}
                >
                    {loading
                        ? "Searching..."
                        : "Search"}
                </button>

            </div>


            {/* =================================================
                ERROR
               ================================================= */}

            {error && (

                <div
                    className="error"
                    style={{
                        marginBottom: 16,
                        borderRadius: 9
                    }}
                >
                    {error}
                </div>

            )}


            {/* =================================================
                RESULTS
               ================================================= */}

            {loading ? (

                <div
                    className="empty-state"
                >
                    Loading mods...
                </div>

            ) : mods.length === 0 ? (

                <div
                    className="empty-state"
                >
                    No mods found.
                </div>

            ) : (

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns:
                            "repeat(auto-fill, minmax(270px, 1fr))",
                        gap: 12
                    }}
                >

                    {mods.map(
                        mod => {

                            const alreadyInstalled = installedProjects.includes(mod.project_id);
                            const isInstalling =
                                installing ===
                                mod.project_id;

                            return (

                                <div
                                    key={
                                        mod.project_id
                                    }
                                    style={{
                                        display: "flex",
                                        flexDirection:
                                            "column",
                                        minWidth: 0,
                                        padding: 16,
                                        borderRadius: 13,
                                        border:
                                            "1px solid rgba(255,255,255,0.075)",
                                        background:
                                            "rgba(255,255,255,0.025)",
                                        transition:
                                            "border-color 0.15s ease, background 0.15s ease",
                                        boxSizing:
                                            "border-box"
                                    }}
                                >

                                    {/* MOD TOP */}

                                    <div
                                        style={{
                                            display:
                                                "flex",
                                            alignItems:
                                                "flex-start",
                                            gap: 12,
                                            minWidth: 0
                                        }}
                                    >

                                        {mod.icon_url ? (

                                            <img
                                                src={
                                                    mod.icon_url
                                                }
                                                alt=""
                                                style={{
                                                    width: 52,
                                                    height: 52,
                                                    borderRadius: 11,
                                                    objectFit:
                                                        "cover",
                                                    flexShrink: 0,
                                                    border:
                                                        "1px solid rgba(255,255,255,0.08)"
                                                }}
                                            />

                                        ) : (

                                            <div
                                                style={{
                                                    width: 52,
                                                    height: 52,
                                                    borderRadius: 11,
                                                    display:
                                                        "flex",
                                                    alignItems:
                                                        "center",
                                                    justifyContent:
                                                        "center",
                                                    flexShrink:
                                                        0,
                                                    background:
                                                        "rgba(124,58,237,0.10)",
                                                    border:
                                                        "1px solid rgba(124,58,237,0.18)",
                                                    color:
                                                        "#a78bfa"
                                                }}
                                            >
                                                <CubeIcon />
                                            </div>

                                        )}


                                        <div
                                            style={{
                                                flex: 1,
                                                minWidth: 0
                                            }}
                                        >

                                            <h3
                                                style={{
                                                    margin: 0,
                                                    fontSize: 14,
                                                    fontWeight:
                                                        700,
                                                    color:
                                                        "#ededf0",
                                                    overflow:
                                                        "hidden",
                                                    textOverflow:
                                                        "ellipsis",
                                                    whiteSpace:
                                                        "nowrap"
                                                }}
                                            ><button className="project-title-button" onClick={()=>setProjectId(mod.project_id)}>
                                                {
                                                    mod.title
                                                }
                                            </button></h3><span className="provider-badge">Modrinth</span><button className="secondary-button button-small" onClick={()=>setProjectId(mod.project_id)}>View project</button>


                                            <div
                                                style={{
                                                    marginTop: 5,
                                                    fontSize: 10.5,
                                                    color:
                                                        "#70707a"
                                                }}
                                            >
                                                {
                                                    mod.downloads.toLocaleString()
                                                }
                                                {" downloads"}
                                            </div>

                                        </div>

                                    </div>


                                    {/* DESCRIPTION */}

                                    <p
                                        style={{
                                            margin:
                                                "13px 0 15px",
                                            fontSize: 11.5,
                                            lineHeight:
                                                1.55,
                                            color:
                                                "#85858e",
                                            display:
                                                "-webkit-box",
                                            WebkitLineClamp:
                                                3,
                                            WebkitBoxOrient:
                                                "vertical",
                                            overflow:
                                                "hidden",
                                            minHeight:
                                                "53px"
                                        }}
                                    >
                                        {
                                            mod.description ||
                                            "No description available."
                                        }
                                    </p>


                                    {/* INSTALL */}

                                    <button
                                        type="button"
                                        onClick={() =>
                                            installMod(
                                                mod
                                            )
                                        }
                                        disabled={Boolean(installing) || checkingInstalled || alreadyInstalled}
                                        style={{
                                            width: "100%",
                                            height: 38,
                                            marginTop:
                                                "auto",
                                            borderRadius: 9,
                                            border:
                                                isInstalling
                                                    ? "1px solid rgba(255,255,255,0.06)"
                                                    : "1px solid rgba(139,92,246,0.30)",
                                            background:
                                                isInstalling
                                                    ? "rgba(255,255,255,0.035)"
                                                    : "rgba(124,58,237,0.13)",
                                            color:
                                                isInstalling
                                                    ? "#73737d"
                                                    : "#c4b5fd",
                                            fontSize: 11.5,
                                            fontWeight: 650,
                                            cursor:
                                                isInstalling
                                                    ? "default"
                                                    : "pointer",
                                            transition:
                                                "all 0.15s ease"
                                        }}
                                    >
                                        {alreadyInstalled ? "Installed" : checkingInstalled ? "Checking…" : isInstalling ? "Installing..." : "Install"}
                                    </button>

                                </div>

                            );

                        }
                    )}

                </div>

            )}

        </div>

    );
}


/* =========================================================
   ICONS
   ========================================================= */

function CubeIcon({
    small = false
}: {
    small?: boolean;
}) {

    const size =
        small ? 16 : 19;

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >

            <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />

            <path d="m4 7.5 8 4.5 8-4.5" />

            <path d="M12 12v9" />

        </svg>
    );
}


function ChevronDown({
    open
}: {
    open: boolean;
}) {

    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
                flexShrink: 0,
                opacity: 0.65,
                transform:
                    open
                        ? "rotate(180deg)"
                        : "rotate(0deg)",
                transition:
                    "transform 0.15s ease"
            }}
        >

            <path d="m6 9 6 6 6-6" />

        </svg>
    );
}


function CheckIcon() {

    return (
        <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#a78bfa"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
                flexShrink: 0
            }}
        >

            <path d="m5 12 4 4L19 6" />

        </svg>
    );
}


function SearchIcon() {

    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#777780"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
                position: "absolute",
                left: 10,
                top: 11
            }}
        >

            <circle
                cx="11"
                cy="11"
                r="7"
            />

            <path d="m20 20-4-4" />

        </svg>
    );
}
export default function Mods(props: Props) {
    return <ContentSource kind="mod"><ModrinthMods {...props} /></ContentSource>;
}
