import InstanceOverview from "../components/InstanceOverview";
import Utilities from "../components/Utilities";
import { useState } from "react";
import Mods from "./Mods";
import Files from "./Files";
import ResourcePacks from "./ResourcePacks";

type Props = {
    instance: any;
    onBack?: () => void;
    onPlay?:()=>void;
    onInstancesChanged?: () => void;
};

type Tab =
    | "overview"
    | "mods"
    | "resourcepacks"
    | "shaders"
    | "files"
    | "config"
    | "settings" | "tools" | "worlds" | "screenshots";

export default function InstanceEditor({
    instance,
    onBack, onInstancesChanged, onPlay
}: Props) {
    const [fileDirectory, setFileDirectory] = useState<"" | "shaderpacks" | "config">("");
    const [tab, setTab] = useState<Tab>("overview");

    if (!instance) {
        return (
            <div className="page instance-editor">
                <div
                    style={{
                        maxWidth: 1100,
                        margin: "0 auto",
                        padding: "40px 24px"
                    }}
                >
                    <h1>Instance Editor</h1>

                    <div className="empty-state">
                        No instance selected.
                    </div>
                </div>
            </div>
        );
    }

    const tabs: {
        id: Tab;
        label: string;
    }[] = [
        {id:"overview",label:"Overview"}, {id:"tools",label:"Utilities"}, {id:"worlds",label:"Worlds"}, {id:"screenshots",label:"Screenshots"},
        {
            id: "mods",
            label: "Mods"
        },
        {
            id: "resourcepacks",
            label: "Resource Packs"
        },
        {
            id: "shaders",
            label: "Shader Packs"
        },
        {
            id: "files",
            label: "Files"
        },
        {
            id: "config",
            label: "Config"
        },
        {
            id: "settings",
            label: "Instance Settings"
        }
    ];

    return (
        <div className="page instance-editor">

            {/* =================================================
                INSTANCE HEADER
               ================================================= */}

            <div
                style={{
                    maxWidth: 1100,
                    margin: "0 auto",
                    padding: "28px 24px 0"
                }}
            >

                <button
                    type="button"
                    onClick={onBack}
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        height: 36,
                        padding: "0 13px",
                        borderRadius: 9,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: "rgba(255,255,255,0.045)",
                        color: "#e8e8eb",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        transition:
                            "background 0.15s ease, border-color 0.15s ease"
                    }}
                >
                    ← Back
                </button>


                <div
                    style={{
                        marginTop: 28,
                        paddingBottom: 24
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
                                width: 46,
                                height: 46,
                                borderRadius: 13,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background:
                                    "linear-gradient(135deg, rgba(139,92,246,0.18), rgba(124,58,237,0.08))",
                                border:
                                    "1px solid rgba(139,92,246,0.22)",
                                color: "#a78bfa",
                                fontSize: 21,
                                fontWeight: 800,
                                flexShrink: 0
                            }}
                        >
                            ◆
                        </div>


                        <div
                            style={{
                                minWidth: 0
                            }}
                        >

                            <h1
                                style={{
                                    margin: 0,
                                    fontSize: 25,
                                    fontWeight: 750,
                                    color: "#f4f4f6",
                                    letterSpacing: "-0.4px",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap"
                                }}
                            >
                                {instance.name}
                            </h1>


                            <p
                                style={{
                                    margin: "6px 0 0",
                                    fontSize: 12,
                                    color: "#7f7f89"
                                }}
                            >
                                Minecraft {instance.minecraftVersion}
                                {" • "}
                                {instance.loader}
                            </p>

                        </div>

                    </div>

                </div>


                {/* =================================================
                    MODERN INSTANCE TABS
                   ================================================= */}

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        overflowX: "auto",
                        padding: "0 2px 8px",
                        borderBottom:
                            "1px solid rgba(255,255,255,0.075)",
                        scrollbarWidth: "none"
                    }}
                >

                    {tabs.map((item) => {

                        const active =
                            tab === item.id;

                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() =>
                                    setTab(item.id)
                                }
                                style={{
                                    flexShrink: 0,
                                    height: 38,
                                    padding: "0 14px",
                                    borderRadius: 9,
                                    border: active
                                        ? "1px solid rgba(139,92,246,0.28)"
                                        : "1px solid transparent",
                                    background: active
                                        ? "rgba(124,58,237,0.13)"
                                        : "transparent",
                                    color: active
                                        ? "#c4b5fd"
                                        : "#85858e",
                                    fontSize: 12,
                                    fontWeight: active
                                        ? 650
                                        : 550,
                                    cursor: "pointer",
                                    transition:
                                        "all 0.15s ease",
                                    whiteSpace: "nowrap"
                                }}
                            >
                                {item.label}
                            </button>
                        );

                    })}

                </div>

            </div>


            {/* =================================================
                TAB CONTENT
               ================================================= */}

            <div
                style={{
                    maxWidth: 1100,
                    margin: "0 auto",
                    padding: "28px 24px 40px"
                }}
            >

                {(tab === "tools" || tab === "worlds" || tab === "screenshots") && <Utilities key={instance.id+tab} instance={instance} mode={tab} onInstancesChanged={onInstancesChanged} />}
                {/* MODS */}

                {tab === 'overview' && <InstanceOverview instance={instance} onPlay={()=>onPlay?.()} />}
                {tab === "mods" && (
                    <Mods
                        instances={[instance]}
                    />
                )}


                {/* RESOURCE PACKS */}

                {tab === "resourcepacks" && (
                    <ResourcePacks
                        instance={[instance]}
                    />
                )}


                {/* SHADERS */}

                {tab === "shaders" && <><ResourcePacks instance={instance} kind="shader"/><button className="secondary-button" onClick={()=>{setFileDirectory('shaderpacks');setTab('files');}}>Browse Shader Files</button></>}

                {/* FILES */}

                {tab === "files" && (
                    <Files key={fileDirectory}
                        initialDirectory={fileDirectory}
                        instances={[instance]}
                    />
                )}


                {/* CONFIG */}

                {tab === "config" && (
                    <div
                        style={{
                            maxWidth: 850
                        }}
                    >

                        <div
                            className="card"
                            style={{
                                padding: 28
                            }}
                        >

                            <h2
                                style={{
                                    margin: 0,
                                    fontSize: 20
                                }}
                            >
                                Config
                            </h2>

                            <p
                                style={{
                                    margin:
                                        "8px 0 22px",
                                    color:
                                        "var(--text-muted, #888)",
                                    fontSize: 13
                                }}
                            >
                                Manage configuration files
                                for this Minecraft instance.
                            </p>

                            <button
                                type="button"
                                onClick={() => { setFileDirectory("config"); setTab("files"); }}
                                style={{
                                    height: 38,
                                    padding: "0 15px",
                                    borderRadius: 9,
                                    border:
                                        "1px solid rgba(255,255,255,0.10)",
                                    background:
                                        "rgba(255,255,255,0.06)",
                                    color: "#e8e8eb",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer"
                                }}
                            >
                                Open Config Folder
                            </button>

                        </div>

                    </div>
                )}


                {/* INSTANCE SETTINGS */}

                {tab === "settings" && (
                    <div
                        style={{
                            maxWidth: 700
                        }}
                    >

                        <div
                            className="card"
                            style={{
                                padding: 28
                            }}
                        >

                            <h2
                                style={{
                                    margin: 0,
                                    fontSize: 20
                                }}
                            >
                                Instance Settings
                            </h2>

                            <p
                                style={{
                                    margin:
                                        "8px 0 25px",
                                    color:
                                        "var(--text-muted, #888)",
                                    fontSize: 13,
                                    lineHeight: 1.5
                                }}
                            >
                                Configure Minecraft, Java,
                                memory and other instance
                                options.
                            </p>


                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 9
                                }}
                            >

                                <label
                                    style={{
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: "#a6a6ae"
                                    }}
                                >
                                    Instance Name
                                </label>

                                <input
                                    type="text"
                                    value={
                                        instance.name ?? ""
                                    }
                                    readOnly
                                    style={{
                                        width: "100%",
                                        boxSizing: "border-box",
                                        height: 42,
                                        padding: "0 12px",
                                        borderRadius: 9,
                                        border:
                                            "1px solid rgba(255,255,255,0.08)",
                                        background:
                                            "rgba(255,255,255,0.035)",
                                        color: "#e8e8eb",
                                        outline: "none"
                                    }}
                                />


                                <label
                                    style={{
                                        marginTop: 10,
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: "#a6a6ae"
                                    }}
                                >
                                    Minecraft Version
                                </label>

                                <input
                                    type="text"
                                    value={
                                        instance.minecraftVersion ?? ""
                                    }
                                    readOnly
                                    style={{
                                        width: "100%",
                                        boxSizing: "border-box",
                                        height: 42,
                                        padding: "0 12px",
                                        borderRadius: 9,
                                        border:
                                            "1px solid rgba(255,255,255,0.08)",
                                        background:
                                            "rgba(255,255,255,0.035)",
                                        color: "#e8e8eb",
                                        outline: "none"
                                    }}
                                />


                                <label
                                    style={{
                                        marginTop: 10,
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: "#a6a6ae"
                                    }}
                                >
                                    Loader
                                </label>

                                <input
                                    type="text"
                                    value={
                                        instance.loader ?? ""
                                    }
                                    readOnly
                                    style={{
                                        width: "100%",
                                        boxSizing: "border-box",
                                        height: 42,
                                        padding: "0 12px",
                                        borderRadius: 9,
                                        border:
                                            "1px solid rgba(255,255,255,0.08)",
                                        background:
                                            "rgba(255,255,255,0.035)",
                                        color: "#e8e8eb",
                                        outline: "none"
                                    }}
                                />

                            </div>

                        </div>

                    </div>
                )}

            </div>

        </div>
    );
}