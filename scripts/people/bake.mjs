import { chromium } from '/workspace/projects/2762b5c4-73c1-40a1-9656-cb2cc3366962/work/pw/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const G='/workspace/projects/2762b5c4-73c1-40a1-9656-cb2cc3366962/game', M='/workspace/projects/2762b5c4-73c1-40a1-9656-cb2cc3366962/work/models-dl', H='/workspace/projects/2762b5c4-73c1-40a1-9656-cb2cc3366962/work/bake';
const srv=http.createServer((q,r)=>{const p=decodeURIComponent(new URL(q.url,'http://x').pathname);let f=p.startsWith('/models/')?path.join(M,p.slice(8)):p==='/'?path.join(H,'bake.html'):path.join(G,p);fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/octet-stream'});r.end(d)})}).listen(5299);
const b=await chromium.launch({executablePath:process.env.CHROME,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const pg=await b.newPage(); pg.on('console',m=>console.log('c:',m.text())); pg.on('pageerror',e=>console.log('ERR',e.message));
await pg.goto('http://localhost:5299/');
await pg.waitForFunction(()=>window.__done,null,{timeout:180000});
const o=await pg.evaluate(()=>window.__out);
const outDir=G+'/src/assets/people'; fs.mkdirSync(outDir,{recursive:true});
// binary: per fig: uv u16, idx u16/u32, frames i16
const parts=[]; let off=0;
o.meta.figs.forEach((f,i)=>{const bn=o.bins[i];
  const uv=Uint16Array.from(bn.uv); const idx=f.nv<65536?Uint16Array.from(bn.idx):Uint32Array.from(bn.idx);
  f.uvOff=off; parts.push(Buffer.from(uv.buffer)); off+=uv.byteLength;
  if(off%4){const pad=4-off%4;parts.push(Buffer.alloc(pad));off+=pad}
  f.idxOff=off; f.idx32=!(f.nv<65536); parts.push(Buffer.from(idx.buffer)); off+=idx.byteLength;
  if(off%4){const pad=4-off%4;parts.push(Buffer.alloc(pad));off+=pad}
  f.frameOff=[]; for(const fr of bn.frames){const a=Int16Array.from(fr); f.frameOff.push(off); parts.push(Buffer.from(a.buffer)); off+=a.byteLength; if(off%4){const pad=4-off%4;parts.push(Buffer.alloc(pad));off+=pad}}
  const d=o.atlases[f.name].split(',')[1]; fs.writeFileSync(`${outDir}/${f.name}.webp`,Buffer.from(d,'base64'));
});
fs.writeFileSync(outDir+'/people.bin',Buffer.concat(parts));
fs.writeFileSync(outDir+'/people.json',JSON.stringify(o.meta));
console.log(JSON.stringify(o.meta.figs.map(f=>({n:f.name,nv:f.nv,tri:f.ni/3,h:f.height,mats:f.mats}))), off);
await b.close(); srv.close();
