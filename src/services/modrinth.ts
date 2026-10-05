const API =
    "https://api.modrinth.com/v2";


export type ModrinthProject = {

    id?: string;

    project_id: string;

    slug: string;

    title: string;

    description: string;

    project_type: string;

    icon_url?: string;

    downloads: number;

    categories: string[];

    versions: string[];

    loaders: string[];

};


export type ModrinthVersion = {

    id: string;

    project_id: string;

    name: string;

    version_number: string;

    game_versions: string[];

    loaders: string[];

    dependencies: {

        version_id:
            string | null;

        project_id:
            string;

        dependency_type:
            string;

    }[];

    files: {

        url: string;

        filename: string;

        primary?: boolean;

        hashes?: {

            sha1?: string;

        };

    }[];

};


/*
 * SEARCH MODRINTH
 */

export async function searchProjects(

    query: string,

    gameVersion: string,

    loader: string,

    projectType:
        | "mod"
        | "modpack"
        | "resourcepack" | "shader" = "mod",

    limit = 24

): Promise<ModrinthProject[]> {


    const facets: string[][] = [

        [
            `project_type:${projectType}`
        ],

        [
            `versions:${gameVersion}`
        ]

    ];


    /*
     * Only mods use the loader/category
     * filter here.
     *
     * Resource packs and modpacks do not
     * need a Fabric/Forge loader filter.
     */

    if (
        projectType === "mod" &&
        loader &&
        loader !== "vanilla"
    ) {

        facets.push([

            `categories:${loader}`

        ]);

    }


    const url =
        new URL(
            `${API}/search`
        );


    url.searchParams.set(
        "query",
        query
    );


    url.searchParams.set(
        "limit",
        String(limit)
    );


    url.searchParams.set(
        "facets",
        JSON.stringify(
            facets
        )
    );


    const response =
        await fetch(url);


    if (!response.ok) {

        throw new Error(
            `Modrinth search failed: HTTP ${response.status}`
        );

    }


    const data =
        await response.json();


    return data.hits;

}


/*
 * BROWSE MODRINTH
 */

export async function browseProjects(

    gameVersion: string,

    loader: string,

    projectType:
        | "mod"
        | "modpack"
        | "resourcepack" | "shader" = "mod",

    limit = 24

): Promise<ModrinthProject[]> {

    return searchProjects(

        "",

        gameVersion,

        loader,

        projectType,

        limit

    );

}


/*
 * GET PROJECT VERSIONS
 */

export async function getProjectVersions(

    projectId: string,

    gameVersion: string,

    loader: string,

    projectType:
        | "mod"
        | "modpack"
        | "resourcepack" | "shader" = "mod"

): Promise<ModrinthVersion[]> {


    const url =
        new URL(
            `${API}/project/${encodeURIComponent(
                projectId
            )}/version`
        );


    /*
     * Filter by Minecraft version.
     */

    if (gameVersion) {

        url.searchParams.set(
            "game_versions",
            JSON.stringify([
                gameVersion
            ])
        );

    }


    /*
     * ONLY apply loader filtering
     * to mods.
     *
     * Resource packs don't have
     * Fabric/Forge loaders.
     */

    if (
        projectType === "mod" &&
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


    const response =
        await fetch(url);


    if (!response.ok) {

        throw new Error(
            `Modrinth versions failed: HTTP ${response.status}`
        );

    }


    return response.json();

}


/*
 * GET PROJECT
 */

export async function getProject(

    projectId: string

): Promise<ModrinthProject> {


    const response =
        await fetch(

            `${API}/project/${encodeURIComponent(
                projectId
            )}`

        );


    if (!response.ok) {

        throw new Error(
            `Modrinth project failed: HTTP ${response.status}`
        );

    }


    return response.json();

}

export async function getRequiredDependencyNames(version: ModrinthVersion): Promise<string[]> {
    const required = (version.dependencies || []).filter(item => item.dependency_type === 'required');
    if(required.length > 30) return [`${required.length} required dependencies (validated by the installer)`];
    return Promise.all(required.map(async dependency => {
        try {
            let id = dependency.project_id;
            if(!id && dependency.version_id) {
                const response = await fetch(`${API}/version/${encodeURIComponent(dependency.version_id)}`, {signal:AbortSignal.timeout(10000)});
                if(!response.ok) throw new Error('Unavailable');
                id = (await response.json()).project_id;
            }
            if(!id) return 'Required dependency (identity checked during installation)';
            const response = await fetch(`${API}/project/${encodeURIComponent(id)}`, {signal:AbortSignal.timeout(10000)});
            if(!response.ok) throw new Error('Unavailable');
            return String((await response.json()).title || id);
        } catch {return `Required dependency ${dependency.project_id || dependency.version_id || '(unavailable)'}`;}
    }));
}
