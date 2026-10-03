import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCompanionManifest} from '../electron/companionManifest.js';
const sha='a'.repeat(64);
const row={asset:'Companion.jar',sha256:sha,minecraft:'1.21.11',loader:'fabric',loaderMinimum:'0.19.5',java:21,version:'0.3.0',modVersion:'0.3.0+mc1.21.11'};
const release={assets:[{name:'Companion.jar',size:100,digest:'sha256:'+sha,browser_download_url:'https://github.com/MySocksAreGone-Dev/Novex-Companion-Mod/releases/download/v0.3.0/Companion.jar'}]};
test('Companion uses exact manifest metadata and verified official release assets',()=>{
 const [build]=validateCompanionManifest({schema:1,builds:[row]},release);assert.equal(build.minecraft,'1.21.11');assert.equal(build.size,100);assert.equal(build.loader,'fabric');
 for(const patch of [{loader:'forge'},{sha256:'b'.repeat(64)},{loaderMinimum:'invalid'},{asset:'missing.jar'}])assert.throws(()=>validateCompanionManifest({schema:1,builds:[{...row,...patch}]},release));
 assert.throws(()=>validateCompanionManifest({schema:1,builds:[row]},{assets:[{...release.assets[0],browser_download_url:'https://example.invalid/Companion.jar'}]}),/source/);
 assert.throws(()=>validateCompanionManifest({schema:2,builds:[row]},release));
});
