import crypto from 'node:crypto';
export function verifyBuffer(buffer, hashes) {
    const algorithm = hashes?.sha512 ? 'sha512' : hashes?.sha256 ? 'sha256' : hashes?.sha1 ? 'sha1' : null;
    if (!algorithm) throw new Error('The download has no integrity hash.');
    const expected = hashes[algorithm];
    if (typeof expected !== 'string' || crypto.createHash(algorithm).update(buffer).digest('hex') !== expected.toLowerCase()) throw new Error('Download integrity verification failed. Retry the installation.');
    return buffer;
}
export async function secureFetch(input, options = {}) {
    const {allowedHosts,...requestOptions}=options;
    let url = new URL(input);
    for (let redirects = 0; redirects < 6; redirects++) {
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Downloads require HTTPS.');
        if(allowedHosts && !allowedHosts.includes(url.hostname))throw new Error('Download host is not permitted for this pack.');
        const response = await fetch(url, { ...requestOptions, redirect: 'manual', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            await response.body?.cancel();
            url = new URL(response.headers.get('location'), url);
            continue;
        }
        return response;
    }
    throw new Error('Too many download redirects.');
}
