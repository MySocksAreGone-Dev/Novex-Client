import ProjectPage from '../components/ProjectPageView';
import { uiError } from "../services/uiError";
import ContentSource from "../components/ContentSource";
import { useEffect, useState } from "react";

import NovexSelect from "../components/NovexSelect";

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
    instances: MinecraftInstance[];
};

function ModrinthModpacks({
    instances
}: Props) {
    const [packs, setPacks] =
        useState<ModrinthProject[]>([]);

    const [projectId,setProjectId]=useState<string|null>(null);
    const [search, setSearch] =
        useState("");

    const [loading, setLoading] =
        useState(false);

    const [installing, setInstalling] =
        useState<string | null>(null);

    const [error, setError] =
        useState("");

    const [selectedInstanceId, setSelectedInstanceId] =
        useState(
            instances[0]?.id ?? ""
        );

    const selectedInstance =
        instances.find(
            instance =>
                instance.id ===
                selectedInstanceId
        );

    const gameVersion =
        selectedInstance?.minecraftVersion ??
        "1.21.11";

    const loader =
        selectedInstance?.loader ??
        "fabric";

    useEffect(() => {
        if (
            !instances.some(
                instance =>
                    instance.id ===
                    selectedInstanceId
            )
        ) {
            setSelectedInstanceId(
                instances[0]?.id ?? ""
            );
        }
    }, [
        instances,
        selectedInstanceId
    ]);

    async function loadModpacks() {
        setLoading(true);
        setError("");

        try {
            const result =
                search.trim()
                    ? await searchProjects(
                        search.trim(),
                        gameVersion,
                        loader,
                        "modpack"
                    )
                    : await browseProjects(
                        gameVersion,
                        loader,
                        "modpack"
                    );

            setPacks(result);
        } catch (err) {
            setError(
                uiError(err, "Failed to load modpacks.")
            );
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadModpacks();
    }, [
        gameVersion,
        loader
    ]);

    async function install(
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
                    loader
                );

            if (!versions.length) {
                throw new Error(
                    `No compatible version was found for Minecraft ${gameVersion}.`
                );
            }

            await window.novex.modpacks.install(
                selectedInstance,
                pack.project_id,
                versions[0].id
            );
        } catch (err) {
            setError(
                uiError(err, "Failed to install modpack.")
            );
        } finally {
            setInstalling(null);
        }
    }

    if(projectId)return <ProjectPage id={projectId} instance={selectedInstance} onBack={()=>setProjectId(null)}/>;

    return (
        <div className="page">

            <div className="page-header">
                <div>
                    <div className="eyebrow">
                        MODRINTH
                    </div>

                    <h1>
                        Modpacks
                    </h1>

                    <p>
                        Browse and install modpacks
                        into your Minecraft instances.
                    </p>
                </div>
            </div>

            <div className="content-toolbar modpack-toolbar">

                <div className="toolbar-field toolbar-instance-field">

                    <span className="toolbar-label">
                        Install into
                    </span>

                    <NovexSelect
                        value={
                            selectedInstanceId
                        }
                        onChange={
                            setSelectedInstanceId
                        }
                        options={
                            instances.map(
                                instance => ({
                                    value:
                                        instance.id,

                                    label:
                                        `${instance.name}  ·  ${instance.minecraftVersion}  ·  ${formatLoader(instance.loader)}`
                                })
                            )
                        }
                    />

                </div>

                <div className="toolbar-context">
                    <span>
                        {gameVersion}
                    </span>

                    <span>
                        {formatLoader(loader)}
                    </span>
                </div>

            </div>

            <div className="search-row modpack-search">

                <input
                    value={search}
                    onChange={event =>
                        setSearch(
                            event.target.value
                        )
                    }
                    onKeyDown={event => {
                        if (
                            event.key ===
                            "Enter"
                        ) {
                            void loadModpacks();
                        }
                    }}
                    placeholder="Search Modrinth modpacks..."
                />

                <button
                    className="primary-button"
                    onClick={() =>
                        void loadModpacks()
                    }
                    disabled={loading}
                >
                    {
                        loading
                            ? "Searching..."
                            : "Search"
                    }
                </button>

            </div>

            {error && (
                <div className="error">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="empty-card compact-empty">
                    <div className="loading-spinner" />

                    <h3>
                        Loading modpacks
                    </h3><span className="provider-badge">Modrinth</span>

                    <p>
                        Finding compatible projects
                        for {gameVersion}.
                    </p>
                </div>
            ) : !packs.length ? (
                <div className="empty-card compact-empty">
                    <h3>
                        No modpacks found
                    </h3><span className="provider-badge">Modrinth</span>

                    <p>
                        Try another search or change
                        the selected instance.
                    </p>
                </div>
            ) : (
                <div className="modpack-grid">

                    {packs.map(pack => (
                        <article
                            className="modpack-card"
                            key={pack.project_id}
                        >

                            <div className="modpack-card-top">

                                {pack.icon_url ? (
                                    <img
                                        className="modpack-icon"
                                        src={pack.icon_url}
                                        alt=""
                                    />
                                ) : (
                                    <div className="modpack-icon-placeholder">
                                        MP
                                    </div>
                                )}

                                <div className="modpack-card-title">

                                    <h3 title={pack.title}><button className="project-title-button" onClick={()=>setProjectId(pack.project_id)}>
                                        {pack.title}
                                    </button></h3><span className="provider-badge">Modrinth</span><button className="secondary-button button-small" onClick={()=>setProjectId(pack.project_id)}>View project</button>

                                    <span>
                                        {
                                            formatLoader(
                                                loader
                                            )
                                        }
                                        {" · "}
                                        {gameVersion}
                                    </span>

                                </div>

                            </div>

                            <p className="modpack-description">
                                {
                                    pack.description ||
                                    "No description available."
                                }
                            </p>

                            <div className="modpack-card-footer">

                                <span className="modpack-downloads">
                                    {
                                        pack.downloads.toLocaleString()
                                    }
                                    {" downloads"}
                                </span>

                                <button
                                    className="primary-button"
                                    disabled={Boolean(installing)}
                                    onClick={() =>
                                        void install(pack)
                                    }
                                >
                                    {
                                        installing ===
                                        pack.project_id
                                            ? "Installing..."
                                            : "Install"
                                    }
                                </button>

                            </div>

                        </article>
                    ))}

                </div>
            )}

        </div>
    );
}

function formatLoader(
    loader: string
) {
    return loader === "neoforge"
        ? "NeoForge"
        : loader.charAt(0).toUpperCase() +
          loader.slice(1);
}
export default function Modpacks(props: Props) {
    return <ContentSource kind="modpack"><ModrinthModpacks {...props} /></ContentSource>;
}
