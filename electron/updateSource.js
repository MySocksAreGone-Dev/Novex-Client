import semver from 'semver';
export const RELEASE_REPOSITORY='MySocksAreGone-Dev/Novex-Client';
export const RELEASES_URL=`https://github.com/${RELEASE_REPOSITORY}/releases`;
export const RELEASE_API=`https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
export function releaseVersion(current,release,includePrereleases=false){
    if(!semver.valid(current)||!release||release.draft||(!includePrereleases&&release.prerelease)||typeof release.tag_name!=='string'||!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.tag_name))return null;
    const latest=semver.valid(release.tag_name);if(!latest||(!includePrereleases&&semver.prerelease(latest))||!semver.gt(latest,current))return null;
    const url=`${RELEASES_URL}/tag/${release.tag_name}`;if(release.html_url!==url)return null;
    const formats=['.exe','.AppImage','.rpm','.deb'].filter(ext=>(release.assets||[]).some(a=>typeof a.name==='string'&&a.name.endsWith(ext)&&a.browser_download_url===`https://github.com/${RELEASE_REPOSITORY}/releases/download/${release.tag_name}/${a.name}`));
    return {latest,url,formats};
}
export function selectUpdateAsset(release,platform,arch,format){
    if(arch!=='x64'||!(platform==='win32'?['.exe']:platform==='linux'?['.AppImage','.rpm','.deb']:[]).includes(format))return null;
    const version=semver.valid(release?.tag_name);if(!version)return null;
    const expectedNames=format==='.exe'?[`Novex-Client-${version}-win-x64.exe`]:format==='.deb'?[`Novex-Client-${version}-linux-amd64.deb`,`Novex-Client-${version}-linux-x64.deb`]:[`Novex-Client-${version}-linux-x86_64${format}`,`Novex-Client-${version}-linux-x64${format}`];
    return (release.assets||[]).find(a=>expectedNames.includes(a.name)&&a.browser_download_url===`https://github.com/${RELEASE_REPOSITORY}/releases/download/${release.tag_name}/${a.name}`&&/^sha256:[a-f0-9]{64}$/i.test(a.digest)&&Number.isSafeInteger(a.size)&&a.size>0)||null;
}
export function updateVisible(status,dismissed){return !!status.available&&dismissed!==`${status.latest}:${status.ready?'ready':'available'}`;}
