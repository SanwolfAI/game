// node --check every script and game module (so new files are never forgotten).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.m?js$/.test(e.name)) files.push(full);
  }
}
walk('scripts');
walk('src');
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`Syntax OK: ${files.length} files`);
