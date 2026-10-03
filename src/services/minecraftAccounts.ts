export interface MinecraftAccount {
    id: string;
    type: 'microsoft' | 'local';
    username: string;
    uuid: string;
    skinUrl?: string;
    authenticationStatus: string;
}
export interface MinecraftAccountsState {
    accounts: MinecraftAccount[];
    selectedId: string | null;
    secureStorage: boolean;
    busy: boolean;
}
export interface LauncherSettings {
    automaticJava:boolean;
    launchBehavior:"keep"|"minimize"|"hide";
    javaPath: string;
    instancesDirectory: string;
    dataDirectory: string;
    browserCacheDirectory: string;
    platform: string;
    backgroundMode: 'background' | 'exit';
    backgroundNotification: boolean;
}
