import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInside, assertNoSymlinks } from './pathSafety.js';

// Sequential asynchronous walking bounds memory and never follows symlinks.
export async function walkFiles(root, visit, relative = '', budget = { count: 0 }, visitDirectory = async () => {}, skipLinks = false) {
    const directory = resolveInside(root, relative);
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (++budget.count > 100000) throw new Error('This folder is too large for a single scan.');
        if (entry.isSymbolicLink()) { if(skipLinks) continue; throw new Error('This operation does not support symbolic links.'); }
        const next = path.join(relative, entry.name);
        if (entry.isDirectory()) { await visitDirectory(next); await walkFiles(root, visit, next, budget, visitDirectory, skipLinks); }
        else if (entry.isFile()) await visit(resolveInside(root, next), next);
    }
}
export async function directorySize(root) {
    let size = 0;
    try { await walkFiles(root, async file => { size += (await fs.stat(file)).size; }, '', {count:0}, async()=>{}, true); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return size;
}
export async function copyNewDirectory(source, destination, progress = () => {}) {
    source = assertNoSymlinks(source); destination = assertNoSymlinks(destination);
    if(destination === source || destination.startsWith(source + path.sep)) throw new Error('Choose a destination outside the original instance.');
    await fs.mkdir(destination, { recursive: false }); // Fail if it already exists.
    try {
        let count = 0;
        await walkFiles(source, async (file, relative) => {
            const target = resolveInside(destination, relative);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.copyFile(file, target, fs.constants.COPYFILE_EXCL);
            if (++count % 50 === 0) progress(`Copied ${count} files…`);
        }, '', {count:0}, relative => fs.mkdir(resolveInside(destination,relative), {recursive:true}));

    } catch (error) { await fs.rm(destination, { recursive: true, force: true }); throw error; }
}
export function crashHints(text) {
    const rules = [
        [/OutOfMemoryError|Java heap space|GC overhead limit exceeded/i, 'Possible cause: Minecraft ran out of memory.'],
        [/UnsupportedClassVersionError|class file version/i, 'Possible cause: the selected Java version is incompatible.'],
        [/requires .* which is missing|missing.*dependenc|requires.*fabric.?api/i, 'Possible cause: a required mod dependency is missing.'],
        [/incompatible mods|incompatible mod set|requires.*minecraft/i, 'Possible cause: a mod does not match this Minecraft version or loader.'],
        [/Mixin.*(?:failed|error)|MixinApplyError/i, 'Likely related to a mod Mixin failure. Check the full log for the named mod.']
    ];
    return rules.filter(([pattern]) => pattern.test(text)).map(([, detail]) => ({ name: 'Crash hint', detail }));
}
