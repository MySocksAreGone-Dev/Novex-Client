import type { ImportSource } from '../components/InstanceImport';
import type { UpdateStatus } from "../components/UpdateNotice";
import type { MinecraftAccountsState, LauncherSettings } from "../services/minecraftAccounts";
import type {
    MinecraftInstance
} from "../services/instances";


type MinecraftInstallProgress = {

    stage: string;

    current: number;

    total: number;

    message: string;

};


type MinecraftState =

    | "starting"
    | "running"
    | "stopping"
    | "stopped"
    | "crashed";


type MinecraftInstallResult = {

    version: string;

    instanceDirectory: string;

    loader?: string;

    loaderVersion?: string;

};


type NovexFile = {

    name: string;

    path: string;

    type:
        | "file"
        | "directory";

    size: number;

    modified: number;

};


declare global {

    interface Window {

        novex: {
            contentInstalled(instance:MinecraftInstance):Promise<{projectId:string;versionId:string;name:string}[]>;
            imports: { choose(kind:'folder'|'pack'):Promise<ImportSource[]>; detect():Promise<ImportSource[]>; drop(file:File):Promise<ImportSource[]>; start(id:string,override:{minecraftVersion?:string;includeOptional?:boolean;loader?:string;loaderVersion?:string},duplicate:boolean):Promise<MinecraftInstance>; project(id:string,version:string):Promise<ImportSource> };
            activity: { list():Promise<import('../services/activity').ActivityJob[]>; install(instance:MinecraftInstance,companion?:boolean):Promise<string>; cancel(id:string):Promise<boolean>; retry(id:string):Promise<string>; onChanged(callback:(jobs:import('../services/activity').ActivityJob[])=>void):()=>void };
            java: { use(instance:MinecraftInstance,selected:string):Promise<void>; list():Promise<{path:string;major:number;source:string}[]>; required(version:string):Promise<number>; install(major:number):Promise<string>; choose(instance:MinecraftInstance,automatic:boolean):Promise<void> };
            companion: { status(instance:Partial<MinecraftInstance>,force?:boolean):Promise<import('../components/CompanionCard').CompanionStatus>; install(instance:MinecraftInstance,dependencies:boolean):Promise<string>; remove(instance:MinecraftInstance):Promise<boolean> };
            instanceStates(instances:MinecraftInstance[]):Promise<{id:string;status:string}[]>;
            overview(instance:MinecraftInstance):Promise<{state:{status:string;error?:string};required?:number;java?:{major:number;path:string;source:string};error?:string;mods:number;customJava:string}>;
            openLogs():Promise<string>;
            utilities: { run: (action: string, instance?: MinecraftInstance | null, input?: Record<string, unknown>) => Promise<import("../components/Utilities").UtilityResult>; onProgress: (callback: (message: string) => void) => () => void };

            updates: { download(format:string):Promise<string>; openFolder():Promise<string>; check: () => Promise<UpdateStatus>; open: () => Promise<void> };
            openExternal: (url: string) => Promise<void>;
            settings: {
                get(): Promise<LauncherSettings>;
                setLaunch(input:Pick<LauncherSettings,"automaticJava"|"launchBehavior">):Promise<LauncherSettings>;
                chooseJava(): Promise<LauncherSettings>;
                resetJava(): Promise<LauncherSettings>;
                chooseStorage(): Promise<LauncherSettings>;
                setBackground(input: Pick<LauncherSettings, 'backgroundMode' | 'backgroundNotification'>): Promise<LauncherSettings>;
            };
            socialSession: { read(): Promise<string | null>; write(value: string): Promise<boolean> };
            minecraftAccounts: {
                list(): Promise<MinecraftAccountsState>;
                login(): Promise<MinecraftAccountsState>;
                cancel(): Promise<boolean>;
                select(id: string): Promise<MinecraftAccountsState>;
                remove(id: string): Promise<MinecraftAccountsState>;
                refresh(id: string): Promise<MinecraftAccountsState>;
                addLocal(name: string): Promise<MinecraftAccountsState>;
                onProgress(callback: (message: string) => void): () => void;
            };


            /*
             * INSTANCES
             */

            instances: {

                create(
                    instance:
                        MinecraftInstance
                ): Promise<string>;

                delete(
                    instance:
                        MinecraftInstance
                ): Promise<boolean>;

                getDirectory(
                    instance:
                        MinecraftInstance
                ): Promise<string>;

                openFolder(
                    instance:
                        MinecraftInstance
                ): Promise<boolean>;

            };


            /*
             * FILE MANAGER
             */

            files: {

                list(

                    instance:
                        MinecraftInstance,

                    relativePath?:
                        string

                ): Promise<
                    NovexFile[]
                >;


                createFolder(

                    instance:
                        MinecraftInstance,

                    relativePath:
                        string

                ): Promise<boolean>;


                delete(

                    instance:
                        MinecraftInstance,

                    relativePath:
                        string

                ): Promise<boolean>;


                rename(

                    instance:
                        MinecraftInstance,

                    relativePath:
                        string,

                    newName:
                        string

                ): Promise<boolean>;


                readText(

                    instance:
                        MinecraftInstance,

                    relativePath:
                        string

                ): Promise<string>;


                writeText(

                    instance:
                        MinecraftInstance,

                    relativePath:
                        string,

                    content:
                        string

                ): Promise<boolean>;

            };


            /*
             * MODS
             */

            mods: {
                installedProjects(instance: MinecraftInstance): Promise<string[]>;
                list(instance: MinecraftInstance): Promise<{name:string; enabled:boolean}[]>;
                setEnabled(instance: MinecraftInstance, name: string, enabled: boolean): Promise<void>;

                install(

                    instance:
                        MinecraftInstance,

                    projectId:
                        string,

                    versionId:
                        string

                ): Promise<boolean>;


                installFavorites(

                    instance:
                        MinecraftInstance,

                    projectIds:
                        string[]

                ): Promise<boolean>;

            };


            /*
             * MODPACKS
             */

            modpacks: {

                install(

                    instance:
                        MinecraftInstance,

                    projectId:
                        string,

                    versionId:
                        string

                ): Promise<{

                    projectId:
                        string;

                    versionId:
                        string;

                    name:
                        string;

                }>;

            };


            /*
             * RESOURCE PACKS
             */

            resourcepacks: {

                install(

                    instance:
                        MinecraftInstance,

                    projectId:
                        string,

                    versionId:
                        string

                ): Promise<boolean>;

            };


            /*
             * MINECRAFT
             */

            minecraft: {
                status(): Promise<{ state: MinecraftState; lastError?: string; instanceId?: string; instanceDirectory?: string; accountId?: string }>;

                install(

                    options: {

                        version:
                            string;

                        loader:
                            MinecraftInstance["loader"];

                        loaderVersion?:
                            string;

                        instanceDirectory:
                            string;

                    }

                ): Promise<
                    MinecraftInstallResult
                >;


                cancelInstall():
                    Promise<boolean>;


                /*
                 * MINECRAFT CONSOLE
                 */

                openConsole(
                    instanceName:
                        string
                ): Promise<boolean>;


                closeConsole():
                    Promise<boolean>;


                onConsoleClosed(

                    callback: () => void

                ): () => void;


                /*
                 * INSTALL PROGRESS
                 */

                onInstallProgress(

                    callback: (

                        progress:
                            MinecraftInstallProgress

                    ) => void

                ): () => void;


                /*
                 * LAUNCH
                 */

                launch(

                    options: {

                        instanceDirectory:
                            string;

                        version:
                            string;

                        loader:
                            MinecraftInstance["loader"];

                        instanceId?: string;

                    }

                ): Promise<boolean>;


                /*
                 * STOP
                 */

                stop():
                    Promise<boolean>;


                /*
                 * RUNNING CHECK
                 */

                isRunning():
                    Promise<boolean>;


                /*
                 * MINECRAFT LOGS
                 */

                onLog(

                    callback: (

                        message:
                            string

                    ) => void

                ): () => void;


                /*
                 * MINECRAFT STATE
                 */

                onState(

                    callback: (

                        state:
                            MinecraftState

                    ) => void

                ): () => void;

            };

        };

    }

}


export {};