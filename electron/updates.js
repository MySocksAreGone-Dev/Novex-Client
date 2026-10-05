import path from 'node:path';
import fs from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import semver from 'semver';
import {downloadToFile,validFile} from './transfer.js';
import {startActivity,activityBusy,listActivity} from './activity.js';
import {resolveInside,assertNoSymlinks} from './pathSafety.js';
import {app,shell} from 'electron';
import {getSettings,setUpdateSettings} from './settings.js';
import {RELEASE_API,RELEASES_URL,releaseVersion,selectUpdateAsset,updateVisible} from './updateSource.js';
let state={current:app.getVersion(),latest:null,available:false,releasesUrl:RELEASES_URL,message:'',checkedAt:null,formats:[],notes:''};
let releaseData,pending,ready,dismissed='',notify=()=>{},preferred=null;
const emit=()=>notify({...state,visible:updateVisible(state,dismissed)});
const execute=promisify(execFile);
async function packageFormat(){if(process.platform==='win32')return '.exe';if(process.platform!=='linux')return null;if(process.env.APPIMAGE)return '.AppImage';if(!app.isPackaged)return null;
 try{const {stdout}=await execute('dpkg-query',['-S',process.execPath],{timeout:3000,maxBuffer:65536});if(stdout.trim())return '.deb';}catch{}
 try{const {stdout}=await execute('rpm',['-qf',process.execPath],{timeout:3000,maxBuffer:65536});if(stdout.trim())return '.rpm';}catch{}return null;}
export function initializeUpdates(broadcast){notify=s=>broadcast('updates:changed',s);setTimeout(()=>{void (async()=>{preferred=await packageFormat();state.preferred=preferred;const prefs=await getSettings();state.preferences={automatic:prefs.automaticUpdates,prereleases:prefs.includePrereleases};emit();if(prefs.automaticUpdates)await checkUpdates();})().catch(()=>{});},3000).unref();}
export async function updateStatus(){const prefs=await getSettings();return {...state,preferences:{automatic:prefs.automaticUpdates,prereleases:prefs.includePrereleases},visible:updateVisible(state,dismissed)};}
export function laterUpdate(){dismissed=`${state.latest}:${state.ready?'ready':'available'}`;emit();return updateStatus();}
export async function updatePreferences(input){const old=await getSettings();await setUpdateSettings(input);if(old.includePrereleases!==input.prereleases){releaseData=undefined;ready=undefined;state={...state,ready:false,available:false,checkedAt:null};}state={...state,preferences:input};emit();return updateStatus();}
export function checkUpdates(force=false){if(pending)return pending;if(!force&&state.checkedAt&&Date.now()-state.checkedAt<60000)return updateStatus();pending=query().finally(()=>pending=undefined);return pending;}
async function query(){const preferences=await getSettings();try{
 const response=await fetch(preferences.includePrereleases?RELEASE_API.replace('/latest','?per_page=30'):RELEASE_API,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Unavailable');const text=await response.text();if(text.length>2*1024*1024)throw new Error('Oversized metadata');const data=JSON.parse(text);if((await getSettings()).includePrereleases!==preferences.includePrereleases)return updateStatus();
 const candidates=(Array.isArray(data)?data:[data]).filter(r=>releaseVersion(state.current,r,preferences.includePrereleases)).sort((a,b)=>semver.rcompare(a.tag_name,b.tag_name));releaseData=candidates[0];
 const newer=releaseData&&releaseVersion(state.current,releaseData,preferences.includePrereleases);const formats=releaseData?['.exe','.AppImage','.rpm','.deb'].filter(f=>selectUpdateAsset(releaseData,process.platform,process.arch,f)):[];
 if(ready?.version!==newer?.latest)ready=undefined;
 state={...state,latest:newer?.latest||state.current,available:!!newer&&formats.length>0,formats,preferred,ready:!!ready,notes:typeof releaseData?.body==='string'?releaseData.body.slice(0,5000):'',checkedAt:Date.now(),message:newer&&!formats.length?'A newer release exists, but no checksum-verified package for this OS and architecture is available.':''};
 }catch{state={...state,checkedAt:Date.now(),message:'Could not check for updates. Check your network and retry.'};}emit();return updateStatus();}
export async function openUpdate(){return shell.openExternal(RELEASES_URL);}
export async function downloadUpdate(format){const prefs=await getSettings();if(!releaseData||!releaseVersion(state.current,releaseData,prefs.includePrereleases))throw new Error('Check for updates again.');if(preferred&&format!==preferred)throw new Error('Choose the package type matching this installation.');const asset=selectUpdateAsset(releaseData,process.platform,process.arch,format);if(!asset)throw new Error('No verified package for this OS and architecture.');if(listActivity().some(j=>j.kind==='update'&&['queued','running'].includes(j.status)))throw new Error('An update is already downloading.');const version=semver.valid(releaseData.tag_name);state.ready=false;ready=undefined;emit();
 return startActivity({label:`Novex ${version}`,kind:'update',cancellable:true},async()=>{const directory=path.join(app.getPath('userData'),'updates');await fs.mkdir(directory,{recursive:true});const file=resolveInside(directory,asset.name);await downloadToFile(asset.browser_download_url,file,{hashes:{sha256:asset.digest.slice(7)},size:asset.size,cache:false});const currentPrefs=await getSettings();if(semver.prerelease(version)&&!currentPrefs.includePrereleases)return {downloaded:true};ready={file,hash:asset.digest.slice(7),size:asset.size,version,format};state={...state,latest:version,ready:true,readyFormat:format,available:true};emit();return {downloaded:true};});}
export async function installUpdate(running){if(running()||activityBusy())throw new Error('Stop Minecraft and wait for active downloads before installing Novex.');if(!ready||!await validFile(assertNoSymlinks(ready.file),{sha256:ready.hash},ready.size))throw new Error('The update file is missing or changed. Download it again.');const prefs=await getSettings();if(semver.prerelease(ready.version)&&!prefs.includePrereleases)throw new Error('Prerelease updates are disabled.');
 if(process.platform==='win32'){if(!app.isPackaged)throw new Error('Run the installed Novex application to restart and update.');const child=spawn(ready.file,[],{detached:true,stdio:'ignore',shell:false});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();app.quit();return;}
 if(ready.format==='.AppImage'){shell.showItemInFolder(ready.file);return;}
 const error=await shell.openPath(ready.file);if(error)throw new Error('Could not open the package installer. Use Open Download Folder.');}
export const openUpdateFolder=()=>shell.openPath(path.join(app.getPath('userData'),'updates'));
