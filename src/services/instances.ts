export type ModLoader =
    | "vanilla"
    | "fabric"
    | "forge"
    | "neoforge"
    | "quilt";

export interface MinecraftInstance {
    id: string;
    name: string;
    minecraftVersion: string;
    loader: ModLoader;
    loaderVersion?: string;
    icon?: string;
    createdAt: number;
    favorite?: boolean;
    notes?: string;
    group?: string;
    lastPlayedAt?: number;
    status?:string;
}

const STORAGE_KEY = "novex_instances";

export function getInstances(): MinecraftInstance[] {
    const data = localStorage.getItem(STORAGE_KEY);

    if (!data) {
        return [];
    }

    try {
        return JSON.parse(data);
    } catch {
        return [];
    }
}

export function saveInstances(
    instances: MinecraftInstance[]
) {
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(instances)
    );
}

export function createInstance(
    name: string,
    minecraftVersion: string,
    loader: ModLoader,
    icon?: string
): MinecraftInstance {

    const instance: MinecraftInstance = {
        id: crypto.randomUUID(),
        name,
        minecraftVersion,
        loader,
        icon,
        createdAt: Date.now()
    };

    const instances = getInstances();

    instances.push(instance);

    saveInstances(instances);

    return instance;
}

export function updateInstance(
    id: string,
    changes: Partial<MinecraftInstance>
) {
    const instances = getInstances();

    const updated = instances.map(instance => {
        if (instance.id !== id) {
            return instance;
        }

        return {
            ...instance,
            ...changes
        };
    });

    saveInstances(updated);

    return updated.find(
        instance => instance.id === id
    );
}

export function deleteInstance(id: string) {
    const instances = getInstances();

    saveInstances(
        instances.filter(
            instance => instance.id !== id
        )
    );
}