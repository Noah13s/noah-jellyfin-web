import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const files = {};
function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.name !== 'noah-build.json') files[path.relative('dist', file).replaceAll('\\', '/')] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
}
visit('dist');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
fs.writeFileSync('dist/noah-build.json', JSON.stringify({ version: 1, protocol: 1, upstream: '61b1f890365ad15138e943e694af723c1d47df2a', commit, files }, null, 2) + '\n');
console.log(`Manifest: ${Object.keys(files).length} assets, source ${commit}`);
