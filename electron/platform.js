import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export function rulesAllowed(entry, platform = process.platform, arch = process.arch, features = {}) {
    if (!entry.rules) return true;
    const name = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'osx' : 'linux';
    let allowed = false;
    for (const rule of entry.rules) {
        if (rule.os?.name && rule.os.name !== name) continue;
        if (rule.os?.arch && !new RegExp(`^(?:${rule.os.arch})$`).test(arch === 'x64' ? 'x86_64' : arch === 'ia32' ? 'x86' : arch)) continue;
        if (rule.os?.version && !new RegExp(rule.os.version).test(os.release())) continue;
        if (Object.entries(rule.features || {}).some(([key, value]) => (features[key] ?? false) !== value)) continue;
        allowed = rule.action === 'allow';
    }
    return allowed;
}
export function javaMajor(output) {
    const match = /(?:^|\n)(?:openjdk|java)\s+(?:version\s+)?"?(\d+)(?:\.(\d+))?/i.exec(output);
    return match ? Number(match[1] === '1' ? match[2] : match[1]) : 0;
}
export async function listJava(manual = '', onlyManual = false) {
    const binary = process.platform === 'win32' ? 'java.exe' : 'java';
    const candidates = [];
    if (manual) candidates.push(manual);
    if (!manual || !onlyManual) {
        for (const home of [process.env.JAVA_HOME, process.env.JDK_HOME].filter(Boolean)) candidates.push(path.join(home, 'bin', binary));
        for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(dir.replace(/^"|"$/g, ''), binary));
        const roots = process.platform === 'win32'
            ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).flatMap(root => ['Java', 'Eclipse Adoptium', 'Microsoft', 'Amazon Corretto', 'Zulu'].map(name => path.join(root, name)))
            : ['/usr/lib/jvm', '/usr/java', '/opt/java', path.join(os.homedir(), '.sdkman', 'candidates', 'java'), path.join(os.homedir(), '.jdks')];
        for (const root of roots) {
            for (const entry of await fs.readdir(root).catch(() => [])) candidates.push(path.join(root, entry, 'bin', binary));
        }
    }
    const found = [];
    for (let candidate of [...new Set(candidates)]) {
        try {
            if ((await fs.stat(candidate)).isDirectory()) candidate = path.join(candidate, 'bin', binary);
            // javaw does not reliably expose -version output on Windows.
            const probe = candidate.replace(/javaw\.exe$/i, 'java.exe');
            const { stdout, stderr } = await execute(probe, ['-XshowSettings:properties', '-version'], { timeout: 5000, windowsHide: true, maxBuffer: 65536 });
            const output = stdout + stderr;
            const major = javaMajor(output);
            const architecture = /os\.arch\s*=\s*(\S+)/m.exec(output)?.[1];
            if (process.arch === 'x64' && !['amd64','x86_64','x64'].includes(architecture)) continue;
            if (major) found.push({ path: probe, major });
        } catch { /* Continue through unavailable installations. */ }
    }
    return [...new Map(await Promise.all(found.map(async java => [await fs.realpath(java.path), java]))).values()];
}
export async function discoverJava(manual = '', required = 8) {
    const found = await listJava(manual, true);
    const exact = found.find(java => java.major === required);
    if (exact) return exact;
    // Prefer the metadata's major: older Minecraft often fails with newer Java.
    if (found.length) throw new Error(`Minecraft requires Java ${required} (64-bit). Found Java ${[...new Set(found.map(j => j.major))].join(', ')}. Select a compatible Java in Settings.`);
    throw new Error(manual ? 'The selected Java could not run. Check its path and executable permissions in Settings.' : `Java ${required} (64-bit) was not found. Install it for your user or select an existing Java in Settings.`);
}

// Keep Windows command lines short without shell quoting; Java resolves these
// paths against the instance cwd. Linux retains its existing absolute paths.
export function launchClasspath(entries, cwd, platform = process.platform) {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    return entries.map(entry => platform === 'win32' ? paths.relative(cwd, entry) : entry).join(paths.delimiter);
}
