export type SkinModel='classic'|'slim';
export type MinecraftSkin={id:string;name:string;url:string;model:SkinModel;active:boolean};
export type MinecraftCape={id:string;name:string;url:string;active:boolean};
export type SavedSkin={id:string;name:string;model:SkinModel;image:string};
export type Appearance={accountId:string;uuid:string;username:string;skins:MinecraftSkin[];capes:MinecraftCape[];saved:SavedSkin[];warning:string};
export type SkinDraft={draftId:string;name:string;image:string;width:number;height:number};
export interface AppearanceAPI {
    get(id:string,force?:boolean):Promise<Appearance>;
    choose(id:string):Promise<SkinDraft|null>;
    upload(id:string,draft:string,model:SkinModel):Promise<Appearance>;
    setSkin(id:string,skin:string,model:SkinModel):Promise<Appearance>;
    resetSkin(id:string):Promise<Appearance>;
    setCape(id:string,cape:string):Promise<Appearance>;
    disableCape(id:string):Promise<Appearance>;
    deleteSaved(id:string,skin:string):Promise<Appearance>;
}
