const { contextBridge, ipcRenderer, webUtils } = require("electron");


contextBridge.exposeInMainWorld(
    "novex",
    {

        content: { list:(instance,kind)=>ipcRenderer.invoke('content:list',instance,kind), check:(instance,kind)=>ipcRenderer.invoke('content:check',instance,kind), change:(instance,kind,names,enabled)=>ipcRenderer.invoke('content:change',instance,kind,names,enabled), delete:(instance,kind,names)=>ipcRenderer.invoke('content:delete',instance,kind,names), open:(instance,kind,name)=>ipcRenderer.invoke('content:open',instance,kind,name), update:(instance,kind,ids)=>ipcRenderer.invoke('content:update',instance,kind,ids) },
        contentInstalled:instance=>ipcRenderer.invoke('content:installed',instance),
        imports: { choose:kind=>ipcRenderer.invoke('imports:choose',kind), detect:()=>ipcRenderer.invoke('imports:detect'), drop:file=>ipcRenderer.invoke('imports:drop',webUtils.getPathForFile(file)), start:(id,override,duplicate=false)=>ipcRenderer.invoke('imports:start',id,override,duplicate), project:(id,version)=>ipcRenderer.invoke('imports:project',id,version) },
        activity: { list:()=>ipcRenderer.invoke('activity:list'), install:(instance,companion=false)=>ipcRenderer.invoke('activity:install',instance,companion), cancel:id=>ipcRenderer.invoke('activity:cancel',id), retry:id=>ipcRenderer.invoke('activity:retry',id), onChanged:callback=>{const listener=(_event,jobs)=>callback(jobs);ipcRenderer.on('activity:changed',listener);return()=>ipcRenderer.removeListener('activity:changed',listener);} },
        java: { use:(instance,selected)=>ipcRenderer.invoke('java:use',instance,selected), list:()=>ipcRenderer.invoke('java:list'), required:version=>ipcRenderer.invoke('java:requirement',version), install:major=>ipcRenderer.invoke('java:install',major), choose:(instance,automatic)=>ipcRenderer.invoke('java:choose',instance,automatic) },
        companion: { status:(instance,force=false)=>ipcRenderer.invoke('companion:status',instance,force), install:(instance,dependencies)=>ipcRenderer.invoke('companion:install',instance,dependencies), remove:instance=>ipcRenderer.invoke('companion:remove',instance) },
        instanceStates:instances=>ipcRenderer.invoke('instances:states',instances),
        overview:instance=>ipcRenderer.invoke('instances:overview',instance),
        openLogs:()=>ipcRenderer.invoke('logs:open'),
        utilities: { run: (action, instance = null, input = {}) => ipcRenderer.invoke('utilities:run', action, instance, input),
            onProgress: callback => { const listener = (_event, message) => callback(message); ipcRenderer.on('utilities:progress', listener); return () => ipcRenderer.removeListener('utilities:progress', listener); } },
        openExternal: url => ipcRenderer.invoke('external:open', url),
        updates: { status:()=>ipcRenderer.invoke('updates:status'), later:()=>ipcRenderer.invoke('updates:later'), preferences:input=>ipcRenderer.invoke('updates:preferences',input), install:()=>ipcRenderer.invoke('updates:install'), onChanged:callback=>{const listener=(_e,value)=>callback(value);ipcRenderer.on('updates:changed',listener);return()=>ipcRenderer.removeListener('updates:changed',listener);}, download:format=>ipcRenderer.invoke('updates:download',format), openFolder:()=>ipcRenderer.invoke('updates:folder'), check: () => ipcRenderer.invoke('updates:check'), open: () => ipcRenderer.invoke('updates:open') },
        settings: {
            get: () => ipcRenderer.invoke('settings:get'),
            setLaunch:input=>ipcRenderer.invoke('settings:launch',input),
            chooseJava: () => ipcRenderer.invoke('settings:java'),
            resetJava: () => ipcRenderer.invoke('settings:java-reset'),
            chooseStorage: () => ipcRenderer.invoke('settings:storage'),
            setBackground: value => ipcRenderer.invoke('settings:background', value)
        },
        socialSession: {
            read: () => ipcRenderer.invoke('social-session:read'),
            write: value => ipcRenderer.invoke('social-session:write', value)
        },
        appearance: {
            get:(id,force=false)=>ipcRenderer.invoke('minecraft-appearance:get',id,force),
            choose:id=>ipcRenderer.invoke('minecraft-appearance:choose',id),
            upload:(id,draft,model)=>ipcRenderer.invoke('minecraft-appearance:upload',id,draft,model),
            setSkin:(id,skin,model)=>ipcRenderer.invoke('minecraft-appearance:skin',id,skin,model),
            resetSkin:id=>ipcRenderer.invoke('minecraft-appearance:reset-skin',id),
            setCape:(id,cape)=>ipcRenderer.invoke('minecraft-appearance:cape',id,cape),
            disableCape:id=>ipcRenderer.invoke('minecraft-appearance:disable-cape',id),
            deleteSaved:(id,skin)=>ipcRenderer.invoke('minecraft-appearance:delete-saved',id,skin)
        },
        minecraftAccounts: {
            list: () => ipcRenderer.invoke('minecraft-accounts:list'),
            login: () => ipcRenderer.invoke('minecraft-accounts:login'),
            cancel: () => ipcRenderer.invoke('minecraft-accounts:cancel'),
            select: id => ipcRenderer.invoke('minecraft-accounts:select', id),
            remove: id => ipcRenderer.invoke('minecraft-accounts:remove', id),
            refresh: id => ipcRenderer.invoke('minecraft-accounts:refresh', id),
            addLocal: name => ipcRenderer.invoke('minecraft-accounts:local', name),
            onProgress: callback => {
                const listener = (_event, message) => callback(message);
                ipcRenderer.on('minecraft-accounts:progress', listener);
                return () => ipcRenderer.removeListener('minecraft-accounts:progress', listener);
            }
        },


        /*
         * INSTANCES
         */

        instances: {

            create: instance =>
                ipcRenderer.invoke(
                    "instances:create",
                    instance
                ),

            delete: instance =>
                ipcRenderer.invoke(
                    "instances:delete",
                    instance
                ),

            getDirectory: instance =>
                ipcRenderer.invoke(
                    "instances:getDirectory",
                    instance
                ),

            openFolder: instance =>
                ipcRenderer.invoke(
                    "instances:openFolder",
                    instance
                )

        },


        /*
         * FILE MANAGER
         */

        files: {

            list: (
                instance,
                relativePath = ""
            ) =>
                ipcRenderer.invoke(
                    "files:list",
                    instance,
                    relativePath
                ),

            createFolder: (
                instance,
                relativePath
            ) =>
                ipcRenderer.invoke(
                    "files:createFolder",
                    instance,
                    relativePath
                ),

            delete: (
                instance,
                relativePath
            ) =>
                ipcRenderer.invoke(
                    "files:delete",
                    instance,
                    relativePath
                ),

            rename: (
                instance,
                relativePath,
                newName
            ) =>
                ipcRenderer.invoke(
                    "files:rename",
                    instance,
                    relativePath,
                    newName
                ),

            readText: (
                instance,
                relativePath
            ) =>
                ipcRenderer.invoke(
                    "files:readText",
                    instance,
                    relativePath
                ),

            writeText: (
                instance,
                relativePath,
                content
            ) =>
                ipcRenderer.invoke(
                    "files:writeText",
                    instance,
                    relativePath,
                    content
                )

        },


        /*
         * MODS
         */

        mods: {
            installedProjects: instance => ipcRenderer.invoke("mods:installedProjects", instance),
            list: instance => ipcRenderer.invoke("mods:list", instance),
            setEnabled: (instance, name, enabled) => ipcRenderer.invoke("mods:setEnabled", instance, name, enabled),

            install: (
                instance,
                projectId,
                versionId
            ) =>
                ipcRenderer.invoke(
                    "mods:install",
                    instance,
                    projectId,
                    versionId
                ),

            installFavorites: (
                instance,
                projectIds
            ) =>
                ipcRenderer.invoke(
                    "mods:installFavorites",
                    instance,
                    projectIds
                )

        },


        /*
         * MODPACKS
         */

        modpacks: {

            install: (
                instance,
                projectId,
                versionId
            ) =>
                ipcRenderer.invoke(
                    "modpacks:install",
                    instance,
                    projectId,
                    versionId
                )

        },


        /*
         * RESOURCE PACKS
         */

        resourcepacks: {

            install: (
                instance,
                projectId,
                versionId, kind="resourcepack"
            ) =>
                ipcRenderer.invoke(
                    "resourcepacks:install",
                    instance,
                    projectId,
                    versionId, kind
                )

        },


        /*
         * MINECRAFT
         */

        minecraft: {
            status: () => ipcRenderer.invoke("minecraft:status"),

            install: options =>
                ipcRenderer.invoke(
                    "minecraft:install",
                    options
                ),

            cancelInstall: () =>
                ipcRenderer.invoke(
                    "minecraft:cancel-install"
                ),

            launch: options =>
                ipcRenderer.invoke(
                    "minecraft:launch",
                    options
                ),

            stop: () =>
                ipcRenderer.invoke(
                    "minecraft:stop"
                ),

            isRunning: () =>
                ipcRenderer.invoke(
                    "minecraft:is-running"
                ),


            /*
             * MINECRAFT CONSOLE
             */

            openConsole: instanceName =>
                ipcRenderer.invoke(
                    "minecraft:console-open",
                    instanceName
                ),

            closeConsole: () =>
                ipcRenderer.invoke(
                    "minecraft:console-close"
                ),

            onConsoleClosed: callback => {

                const listener = () => {

                    callback();

                };

                ipcRenderer.on(
                    "minecraft:console-closed",
                    listener
                );

                return () => {

                    ipcRenderer.removeListener(
                        "minecraft:console-closed",
                        listener
                    );

                };

            },


            /*
             * INSTALL PROGRESS
             */

            onInstallProgress: callback => {

                const listener = (
                    _event,
                    progress
                ) => {

                    callback(progress);

                };

                ipcRenderer.on(
                    "minecraft:install-progress",
                    listener
                );

                return () => {

                    ipcRenderer.removeListener(
                        "minecraft:install-progress",
                        listener
                    );

                };

            },


            /*
             * MINECRAFT LOGS
             */

            onLog: callback => {

                const listener = (
                    _event,
                    message
                ) => {

                    callback(message);

                };

                ipcRenderer.on(
                    "minecraft:log",
                    listener
                );

                return () => {

                    ipcRenderer.removeListener(
                        "minecraft:log",
                        listener
                    );

                };

            },


            /*
             * MINECRAFT STATE
             */

            onState: callback => {

                const listener = (
                    _event,
                    state
                ) => {

                    callback(state);

                };

                ipcRenderer.on(
                    "minecraft:state",
                    listener
                );

                return () => {

                    ipcRenderer.removeListener(
                        "minecraft:state",
                        listener
                    );

                };

            }

        }

    }
);