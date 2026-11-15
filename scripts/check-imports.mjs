import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory()){if(entry.name!=='node_modules'&&entry.name!=='.git')walk(full);}else if(/\\.m?js$/.test(entry.name))files.push(full);}}
walk(path.join(root,'src'));walk(path.join(root,'vendor'));
const missing=[];
for(const file of files){const source=fs.readFileSync(file,'utf8');const re=/\\bfrom\\s*['"]([^'"]+)['"]|\\bimport\\s*['"]([^'"]+)['"]/g;let match;while((match=re.exec(source))){const spec=match[1]||match[2];let target=null;if(spec.startsWith('.'))target=path.resolve(path.dirname(file),spec);else if(spec.startsWith('three/addons/'))target=path.resolve(root,'vendor/three',spec.slice('three/addons/'.length));else continue;if(!path.extname(target))target+='.js';if(!fs.existsSync(target))missing.push(path.relative(root,file)+' -> '+spec);}}
if(missing.length){console.error('Missing imported files:\\n'+missing.join('\\n'));process.exit(1);}
console.log('Import paths verified: '+files.length+' JavaScript files scanned.');
