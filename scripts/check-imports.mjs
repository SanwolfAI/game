// Static checks that protect the Android WebView build:
//  1. every relative import in src/ and vendor/ points at an existing file;
//  2. no bare specifiers ('three', 'three/addons/...') so the game never
//     depends on import-map support (old WebViews hang at "Starting engine…");
//  3. no argument-spreading of arrays into calls (Math.min(...a), push(...a),
//     fn.apply(null, a)) which overflows the call stack on big Durban data.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') walk(full);
    } else if (/\.m?js$/.test(entry.name)) files.push(full);
  }
}
walk(path.join(root, 'src'));
walk(path.join(root, 'vendor'));

const problems = [];
for (const file of files) {
  const rel = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  // Only real import/export statements (comments and log strings mentioning
  // "from 'x'" are ignored).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const re = /^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(code))) {
    const spec = m[1] || m[2] || m[3];
    if (!spec.startsWith('.')) {
      problems.push(`${rel}: bare import '${spec}' (use a relative path to vendor/)`);
      continue;
    }
    let target = path.resolve(path.dirname(file), spec);
    if (!path.extname(target)) target += '.js';
    if (!fs.existsSync(target)) problems.push(`${rel}: missing import '${spec}'`);
  }
  if (rel.startsWith('src')) {
    const lines = source.split('\n');
    lines.forEach((line, i) => {
      if (/Math\.(min|max)\(\s*\.\.\./.test(line) || /\.(push|unshift)\(\s*\.\.\./.test(line) || /\.apply\(\s*(null|Math|undefined)\s*,/.test(line)) {
        problems.push(`${rel}:${i + 1}: array spread into a call (stack overflow risk): ${line.trim()}`);
      }
    });
  }
}
if (problems.length) {
  console.error('Import/stack checks failed:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('Import paths verified: ' + files.length + ' JavaScript files scanned, no bare imports, no array spreads.');
