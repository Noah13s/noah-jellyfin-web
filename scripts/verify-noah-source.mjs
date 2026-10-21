import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

for (const file of ['policy.js', 'embedded.js', 'protocol.js']) {
    const source = fs.readFileSync(`src/plugins/noah/${file}`, 'utf8');
    assert.doesNotMatch(source, /(?:window\.)?fetch\s*=|XMLHttpRequest\.prototype|HTMLMediaElement\.prototype|Element\.prototype/, `Global browser interception in ${file}`);
    assert.doesNotMatch(source, /api\.getItem\s*=|playbackManager\.setMaxStreamingBitrate\s*=/, `SDK method interception in ${file}`);
}
assert.equal(crypto.createHash('sha256').update(fs.readFileSync('src/assets/hls.worker-1.6.16.js')).digest('hex'), 'b50e20b9f0a9b70f29086bcfad647a2ab121339a4a961e2ee1432d6eedf1a721');
const lock = JSON.parse(fs.readFileSync('package-lock.json'));
assert.equal(lock.packages['node_modules/hls.js'].version, '1.6.16', 'Update HLS worker and integrity gate together');
console.log('Explicit source hooks and matching HLS worker verified');
