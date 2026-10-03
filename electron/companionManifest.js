import semver from 'semver';
import {safeSegment} from './pathSafety.js';
const REPO='MySocksAreGone-Dev/Novex-Companion-Mod';
export function validateCompanionManifest(manifest,release) {
    if(manifest.schema!==1||!Array.isArray(manifest.builds)||manifest.builds.length>100)throw new Error('Unsupported Companion compatibility manifest.');
    return manifest.builds.map(build=>{
        const asset=release.assets.find(a=>a.name===build.asset);
        if(!asset||!asset.name.endsWith('.jar')||asset.size>32*1048576||!/^[a-f0-9]{64}$/.test(build.sha256)||asset.digest!=='sha256:'+build.sha256||typeof build.minecraft!=='string'||build.loader!=='fabric'||typeof build.version!=='string'||typeof build.modVersion!=='string'||!semver.valid(build.loaderMinimum)||!Number.isInteger(build.java))throw new Error('Invalid Companion release metadata.');
        safeSegment(build.asset,'Companion asset');
        if(build.asset.includes('/')||build.asset.includes('\\'))throw new Error('Invalid Companion asset name.');
        const url=new URL(asset.browser_download_url);
        if(url.protocol!=='https:'||url.hostname!=='github.com'||!url.pathname.startsWith('/'+REPO+'/releases/download/'))throw new Error('Unexpected Companion source.');
        return {...build,url:url.href,size:asset.size};
    });
}
