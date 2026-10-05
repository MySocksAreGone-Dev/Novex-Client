// A standalone Node process (Electron RUN_AS_NODE in production). It owns Java's
// pipes so leaving Novex never closes the game's stdout/stderr readers.
const { spawn } = require('node:child_process');
const {redact,describeError} = require('./launchDiagnostics.cjs');
const {monitor}=require('./processMetrics.cjs');
let finishMetrics;
let game;
let stopping = false;
let timer;
const notify = message => { if (process.connected) { try { process.send(message, () => {}); } catch {} } };
const bootstrap = setTimeout(() => process.exit(1), 15000);
function stop() {
    if (!game?.pid || stopping) return;
    stopping = true;
    if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/pid', String(game.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { game.kill(); });
        killer.on('exit', code => { if (code) game.kill(); });
    } else {
        try { process.kill(-game.pid, 'SIGTERM'); } catch { game.kill('SIGTERM'); }
        timer = setTimeout(() => { try { process.kill(-game.pid, 'SIGKILL'); } catch {} }, 5000);
        timer.unref();
    }
}
process.on('message', message => {
    if (message.type === 'stop') { stop(); return; }
    if (message.type !== 'launch' || game) return;
    clearTimeout(bootstrap);
    const { executable, args, cwd, secret } = message;
    try { game = spawn(executable, args, { cwd, detached: true, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch(error) { notify({type:'error',code:error.code,error:describeError(error,[secret])}); if(process.connected) process.disconnect(); return; }
    for (const stream of [game.stdout, game.stderr]) {
        stream.setEncoding('utf8');
        let pending = '';
        const emit = text => notify({ type: 'log', text: redact(text,[secret]) });
        stream.on('data', chunk => {
            if (!process.connected) { pending = ''; return; }
            pending += chunk;
            let end;
            while ((end = pending.indexOf('\n')) >= 0) { emit(pending.slice(0, end + 1)); pending = pending.slice(end + 1); }
            if (pending.length > 1024 * 1024) pending = '[Novex] Oversized log line omitted.';
        });
        stream.on('end', () => { if (pending) emit(pending); });
    }
    game.once('spawn', () => {finishMetrics=monitor(game.pid,cwd,message.heapMiB||4096);notify({ type: 'started', pid: game.pid });});
    game.once('error', error => notify({ type: 'error', code: error.code, error:describeError(error,[secret]) }));
    game.once('close', async (code, signal) => {
        clearTimeout(timer);
        await finishMetrics?.(code,signal);
        notify({ type: 'closed', code, signal, stopping });
        if (process.connected) process.disconnect();
    });
});
process.on('disconnect', () => { clearTimeout(bootstrap); /* Keep draining Java pipes until it exits. */ });
