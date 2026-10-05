import ProjectPage from '../components/ProjectPageView';
import { uiError } from "../services/uiError";
import ContentSource from "../components/ContentSource";
import { useEffect, useState } from "react";

import {
    browseProjects,
    searchProjects,
    getProjectVersions,
    type ModrinthProject,
    type ModrinthVersion
} from "../services/modrinth";

import type {
    MinecraftInstance
} from "../services/instances";


type Props = {
    instance?: MinecraftInstance | MinecraftInstance[];
};


function ModrinthResourcePacks({
    instance
}: Props) {

    /*
     * InstanceEditor passes [instance], while this page
     * can also be used with a single instance.
     */
    const selectedInstance =
        Array.isArray(instance)
            ? instance[0]
            : instance;


    const [packs, setPacks] =
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


    const gameVersion =
        selectedInstance?.minecraftVersion ||
        "1.21.11";


    /*
     * LOAD RESOURCE PACKS
     */

    async function loadPacks() {

        setLoading(true);
        setError("");

        try {

            const results =
                search.trim()

                    ? await searchProjects(
                        search,
                        gameVersion,
                        "vanilla",
                        "resourcepack"
                    )

                    : await browseProjects(
                        gameVersion,
                        "vanilla",
                        "resourcepack"
                    );

            setPacks(results);

        } catch (err) {

            console.error(
                "Failed to load resource packs:",
                err
            );

            setError(
                uiError(err, "Failed to load resource packs.")
            );

        } finally {

            setLoading(false);

        }

    }


    /*
     * RELOAD WHEN MINECRAFT VERSION CHANGES
     */

    useEffect(() => {

        loadPacks();

    }, [gameVersion]);


    /*
     * INSTALL RESOURCE PACK
     */

    async function installPack(
        pack: ModrinthProject
    ) {

        if (!selectedInstance) {

            setError(
                "Select an instance first."
            );

            return;

        }


        setInstalling(
            pack.project_id
        );

        setError("");


        try {

            const versions:
                ModrinthVersion[] =
                await getProjectVersions(
                    pack.project_id,
                    gameVersion,
                    "vanilla",
                    "resourcepack"
                );


            if (
                versions.length === 0
            ) {

                throw new Error(
                    `No compatible resource pack version was found for Minecraft ${gameVersion}.`
                );

            }


            const version =
                versions[0];


            await window.novex.resourcepacks.install(
                selectedInstance,
                pack.project_id,
                version.id
            );


        } catch (err) {

            console.error(
                "Failed to install resource pack:",
                err
            );

            setError(
                uiError(err, "Failed to install resource pack.")
            );

        } finally {

            setInstalling(null);

        }

    }


    /*
     * NO INSTANCE
     */

    if(projectId)return <ProjectPage id={projectId} instance={selectedInstance} onBack={()=>setProjectId(null)}/>;

    if (!selectedInstance) {

        return (

            <div className="page">

                <div className="page-header">

                    <div>

                        <h1>
                            Resource Packs
                        </h1>

                        <p>
                            Browse and install
                            Minecraft resource packs
                            from Modrinth.
                        </p>

                    </div>

                </div>


                <div className="empty-state">

                    Create or select a Minecraft
                    instance first.

                </div>

            </div>

        );

    }


    return (

        <div className="page">

            {/* HEADER */}

            <div className="page-header">

                <div>

                    <h1>
                        Resource Packs
                    </h1>

                    <p>
                        Browse and install
                        Minecraft resource packs
                        from Modrinth.
                    </p>

                </div>

            </div>


            {/* INSTANCE INFO */}

            <div
                className="card"
                style={{
                    marginBottom: 18,
                    padding: "18px 20px"
                }}
            >

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14
                    }}
                >

                    <div
                        style={{
                            width: 44,
                            height: 44,
                            borderRadius: 12,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            background:
                                "rgba(124, 58, 237, 0.10)",
                            border:
                                "1px solid rgba(124, 58, 237, 0.20)",
                            color: "#a78bfa"
                        }}
                    >

                        <PackageIcon />

                    </div>


                    <div
                        style={{
                            minWidth: 0
                        }}
                    >

                        <div
                            style={{
                                fontSize: 14,
                                fontWeight: 700
                            }}
                        >
                            Installing to
                        </div>

                        <div
                            style={{
                                marginTop: 4,
                                fontSize: 12,
                                color: "#85858f"
                            }}
                        >

                            {selectedInstance.name}

                            {" • "}

                            Minecraft{" "}
                            {gameVersion}

                        </div>

                    </div>

                </div>

            </div>


            {/* SEARCH */}

            <div
                style={{
                    display: "flex",
                    gap: 10,
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

                            loadPacks();

                        }

                    }}
                    placeholder="Search resource packs..."
                    style={{
                        flex: 1,
                        minWidth: 0,
                        height: 44,
                        boxSizing: "border-box"
                    }}
                />


                <button
                    className="primary-button"
                    onClick={loadPacks}
                    disabled={loading}
                    style={{
                        minWidth: 100,
                        height: 44,
                        borderRadius: 10
                    }}
                >

                    {loading
                        ? "Searching..."
                        : "Search"}

                </button>

            </div>


            {/* ERROR */}

            {error && (

                <div
                    className="error"
                    style={{
                        marginBottom: 18
                    }}
                >

                    {error}

                </div>

            )}


            {/* LOADING */}

            {loading ? (

                <div className="empty-state">

                    Loading resource packs...

                </div>


            ) : packs.length === 0 ? (

                <div className="empty-state">

                    No resource packs found.

                </div>


            ) : (

                <div
                    className="card-grid"
                    style={{
                        alignItems: "stretch"
                    }}
                >

                    {packs.map(pack => {

                        const isInstalling =
                            installing ===
                            pack.project_id;


                        return (

                            <div
                                className="card"
                                key={
                                    pack.project_id
                                }
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 14,
                                    padding: 18,
                                    minWidth: 0
                                }}
                            >

                                {/* TOP */}

                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 14
                                    }}
                                >

                                    {pack.icon_url ? (

                                        <img
                                            src={
                                                pack.icon_url
                                            }
                                            alt=""
                                            style={{
                                                width: 58,
                                                height: 58,
                                                borderRadius: 12,
                                                objectFit: "cover",
                                                flexShrink: 0,
                                                background:
                                                    "rgba(255,255,255,.04)"
                                            }}
                                        />

                                    ) : (

                                        <div
                                            style={{
                                                width: 58,
                                                height: 58,
                                                borderRadius: 12,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                flexShrink: 0,
                                                background:
                                                    "rgba(124,58,237,.10)",
                                                border:
                                                    "1px solid rgba(124,58,237,.18)",
                                                color: "#a78bfa"
                                            }}
                                        >

                                            <PackageIcon />

                                        </div>

                                    )}


                                    <div
                                        style={{
                                            minWidth: 0,
                                            flex: 1
                                        }}
                                    >

                                        <h3
                                            style={{
                                                margin: 0,
                                                fontSize: 15,
                                                lineHeight: 1.3,
                                                overflow: "hidden",
                                                textOverflow:
                                                    "ellipsis",
                                                whiteSpace:
                                                    "nowrap"
                                            }}
                                        ><button className="project-title-button" onClick={()=>setProjectId(pack.project_id)}>

                                            {pack.title}

                                        </button></h3><span className="provider-badge">Modrinth</span><button className="secondary-button button-small" onClick={()=>setProjectId(pack.project_id)}>View project</button>


                                        <div
                                            style={{
                                                marginTop: 6,
                                                fontSize: 11,
                                                color: "#777780"
                                            }}
                                        >

                                            {pack.downloads.toLocaleString()}

                                            {" "}
                                            downloads

                                        </div>

                                    </div>

                                </div>


                                {/* DESCRIPTION */}

                                <p
                                    style={{
                                        margin: 0,
                                        fontSize: 12,
                                        lineHeight: 1.55,
                                        color: "#92929b",
                                        display:
                                            "-webkit-box",
                                        WebkitLineClamp: 3,
                                        WebkitBoxOrient:
                                            "vertical",
                                        overflow: "hidden"
                                    }}
                                >

                                    {pack.description ||
                                        "No description available."}

                                </p>


                                {/* INSTALL */}

                                <button
                                    onClick={() =>
                                        installPack(
                                            pack
                                        )
                                    }
                                    disabled={
                                        Boolean(installing)
                                    }
                                    style={{
                                        width: "100%",
                                        minHeight: 40,
                                        marginTop: "auto",
                                        borderRadius: 10,
                                        border:
                                            isInstalling
                                                ? "1px solid rgba(255,255,255,.08)"
                                                : "1px solid rgba(139,92,246,.35)",
                                        background:
                                            isInstalling
                                                ? "rgba(255,255,255,.04)"
                                                : "rgba(124,58,237,.16)",
                                        color:
                                            isInstalling
                                                ? "#777780"
                                                : "#c4b5fd",
                                        cursor:
                                            isInstalling
                                                ? "default"
                                                : "pointer",
                                        fontWeight: 650
                                    }}
                                >

                                    {isInstalling
                                        ? "Installing..."
                                        : "Install"}

                                </button>

                            </div>

                        );

                    })}

                </div>

            )}

        </div>

    );

}


/* =========================================================
   ICON
   ========================================================= */

function PackageIcon() {

    return (

        <svg
            width="20"
            height="20"
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

}export default function ResourcePacks(props: Props) {
    return <ContentSource kind="resourcepack"><ModrinthResourcePacks {...props} /></ContentSource>;
}
