import semver from 'semver';
export const RELEASE_REPOSITORY = 'MySocksAreGone-Dev/Novex-Client';
export const RELEASES_URL = `https://github.com/${RELEASE_REPOSITORY}/releases`;
export const RELEASE_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
export function releaseVersion(current, release) {
    if (!semver.valid(current) || !release || release.draft || release.prerelease || typeof release.tag_name !== 'string' || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) return null;
    const latest = semver.valid(release.tag_name);
    if (!latest || !semver.gt(latest, current)) return null;
    const url = `${RELEASES_URL}/tag/${release.tag_name}`;
    if (release.html_url !== url) return null;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const formats = ['.exe', '.AppImage', '.rpm', '.deb'].filter(extension => assets.some(asset => typeof asset.name === 'string' && asset.name.endsWith(extension) && asset.browser_download_url === `https://github.com/${RELEASE_REPOSITORY}/releases/download/${release.tag_name}/${asset.name}`));
    return { latest, url, formats };
}
