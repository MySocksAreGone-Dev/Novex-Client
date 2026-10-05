import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { secureFetch } from './downloads.js';
export const transferContext = new AsyncLocalStorage();
let cacheDirectory;
export function configureDownloads(directory) { cacheDirectory = directory; }
export async function validFile(file, hashes, size) {
    const algorithm = hashes?.sha512 ? 'sha512' : hashes?.sha256 ? 'sha256' : hashes?.sha1 ? 'sha1' : null;
    if (!algorithm || !new RegExp(`^[a-f0-9]{${{sha1:40,sha256:64,sha512:128}[algorithm]}}$`, 'i').test(hashes[algorithm])) return false;
    try {
        if (size !== undefined && (await fs.stat(file)).size !== size) return false;
        const hash = crypto.createHash(algorithm);
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        return hash.digest('hex') === hashes[algorithm].toLowerCase();
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function checkSpace(directory, bytes) {
    await fs.mkdir(directory, { recursive: true });
    if (!fs.statfs || !Number.isFinite(bytes)) return;
    const stat = await fs.statfs(directory);
    const available = stat.bavail * stat.bsize;
    if (available < bytes) throw new Error(`Not enough storage. Required: ${Math.ceil(bytes/1048576)} MB; available: ${Math.floor(available/1048576)} MB.`);
}
export async function downloadToFile(url, destination, { hashes, size, signal, onProgress, cache = true, allowedHosts, maxBytes = Infinity } = {}) {
    const context = transferContext.getStore();
    signal ||= context?.signal;
    signal?.throwIfAborted();
    if (await validFile(destination, hashes, size)) { onProgress?.({ skipped: true, downloaded: 0, total: size || 0 }); return false; }
    const algorithm = hashes?.sha512 ? 'sha512' : hashes?.sha256 ? 'sha256' : hashes?.sha1 ? 'sha1' : null;
    if (!algorithm || !new RegExp(`^[a-f0-9]{${{sha1:40,sha256:64,sha512:128}[algorithm]}}$`, 'i').test(hashes[algorithm])) throw new Error('A valid download checksum is required.');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const cached = cache && cacheDirectory ? path.join(cacheDirectory, `${algorithm}-${hashes[algorithm].toLowerCase()}`) : null;
    const temporary = destination + '.' + crypto.randomUUID() + '.part';
    if (cached && await validFile(cached, hashes, size)) {
        try { await fs.copyFile(cached, temporary); signal?.throwIfAborted(); await fs.rename(temporary, destination); }
        finally { await fs.rm(temporary, {force:true}); }
        onProgress?.({ skipped:true, downloaded:0, total:size || 0 }); return false;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
        let file;
        try {
            signal?.throwIfAborted();
            const response = await secureFetch(url, { signal, allowedHosts });
            if (!response.ok) { await response.body?.cancel(); const error = new Error(`${new URL(url).hostname}: HTTP ${response.status}. Retry the download.`); error.retryable = response.status === 429 || response.status >= 500; throw error; }
            if (!response.body) throw new Error('Download returned no data.');
            const total = size ?? Number(response.headers.get('content-length') || 0);
            if(total>maxBytes){await response.body.cancel();throw new Error('Download exceeds its permitted size.');}
            await checkSpace(path.dirname(destination), total + 16 * 1048576);
            file = await fs.open(temporary, 'wx');
            const hash = crypto.createHash(algorithm);
            let downloaded = 0, last = Date.now(), previous = 0, speed = 0;
            for await (const chunk of response.body) {
                signal?.throwIfAborted();
                downloaded += chunk.length;
                if(downloaded>maxBytes)throw new Error('Download exceeds its permitted size.');
                if (size !== undefined && downloaded > size) throw new Error('Download exceeded its expected size.');
                hash.update(chunk); await file.writeFile(chunk);
                const now = Date.now();
                if (now-last >= 250) {
                    const sample = (downloaded-previous)*1000/(now-last); speed = speed ? speed*.7+sample*.3 : sample;
                    const progress = { skipped:false, downloaded, total, speed, file:path.basename(destination) };
                    onProgress?.(progress); context?.progress?.({bytes:downloaded, totalBytes:total, speed, file:progress.file});
                    previous=downloaded; last=now;
                }
            }
            await file.close(); file=null;
            if ((size !== undefined && downloaded !== size) || hash.digest('hex') !== hashes[algorithm].toLowerCase()) throw new Error('Download integrity verification failed. Retry the installation.');
            signal?.throwIfAborted();
            await fs.rename(temporary, destination);
            if (cached) {
                const tempCache=cached+'.'+crypto.randomUUID()+'.part';
                try { await fs.mkdir(cacheDirectory,{recursive:true}); await fs.copyFile(destination,tempCache); await fs.rename(tempCache,cached); }
                catch { /* A full cache must not invalidate a successful installation. */ }
                finally { await fs.rm(tempCache,{force:true}).catch(()=>{}); }
            }
            onProgress?.({skipped:false,downloaded,total,speed}); return true;
        } catch (error) {
            await file?.close(); await fs.rm(temporary,{force:true});
            if (signal?.aborted || error.retryable === false || ['ENOSPC','EACCES','EPERM'].includes(error.code) || attempt===2) throw error;
            await new Promise(resolve=>setTimeout(resolve,500*2**attempt));
        }
    }
}
export async function parallelFiles(items, action, limit=6) {
    let next=0, failure;
    await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
        while (!failure && next<items.length) { const index=next++; try { await action(items[index],index); } catch(error) {failure=error;} }
    }));
    if (failure) throw failure;
}
// Existing modpack/dependency code can retain its in-memory ZIP API while sharing
// verified transfer, retry and cache behavior with Minecraft and Java.
export async function downloadBytes(url, hashes, options = {}) {
    const os=await import('node:os');
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'novex-transfer-'));
    try {const file=path.join(directory,'download');await downloadToFile(url,file,{...options,hashes});return await fs.readFile(file);}
    finally {await fs.rm(directory,{recursive:true,force:true});}
}
