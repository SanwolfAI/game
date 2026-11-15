import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CHUNK=600;
const FILES=[
  ['fence','./src/assets/suburbankit/fence-1x4.glb'],
  ['driveway','./src/assets/suburbankit/driveway-long.glb'],
  ['path','./src/assets/suburbankit/path-long.glb'],
  ['planter','./src/assets/suburbankit/planter.glb'],
  ['tree','./src/assets/suburbankit/tree-small.glb']
];

function prepare(scene){
  scene.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(scene);
  const size=bounds.getSize(new THREE.Vector3());
  const center=bounds.getCenter(new THREE.Vector3());
  const parts=[];
  scene.traverse(o=>{
    if(!o.isMesh||!o.geometry||!o.material)return;
    const geometry=o.geometry.clone();
    geometry.applyMatrix4(o.matrixWorld);
    geometry.translate(-center.x,-bounds.min.y,-center.z);
    geometry.scale(1/Math.max(size.x,.001),1/Math.max(size.y,.001),1/Math.max(size.z,.001));
    geometry.computeBoundingSphere();
    parts.push({geometry,material:Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone()});
  });
  return parts;
}
export async function buildSuburbanDetails(city,hf,rng){
  const group=new THREE.Group();
  group.name='durban-suburban-fences-driveways-details';
  const loader=new GLTFLoader();
  const loaded=[];
  for(const [name,url] of FILES){
    try{
      const gltf=await loader.loadAsync(url);
      loaded.push({name,parts:prepare(gltf.scene)});
    }catch(error){
      console.warn('Suburban detail model unavailable',url,error);
      loaded.push({name,parts:[]});
    }
  }
  const models=new Map(loaded.map(m=>[m.name,m]));
  const items=new Map(FILES.map(([name])=>[name,[]]));
  const houses=(city.buildings||[]).filter(b=>b.kind==='house').slice(0,420);
  const add=(name,x,z,yaw,scale)=>{
    if(!models.get(name)?.parts.length)return;
    items.get(name).push({x,z,y:hf.heightAt(x,z)+.015,yaw,scale});
  };
  for(const b of houses){
    const c=Math.cos(b.yaw||0),s=Math.sin(b.yaw||0);
    const point=(lx,lz)=>[b.x+lx*c+lz*s,b.z-lx*s+lz*c];
    const halfW=Math.max(3.2,(b.w||7)*.5+2.2);
    const halfD=Math.max(4.5,(b.dp||9)*.5+2.2);
    const fenceY=1.35;
    for(const side of [-1,1]){
      const [x,z]=point(side*halfW,0);
      add('fence',x,z,(b.yaw||0)+Math.PI/2,[.25,fenceY,halfD*2]);
    }
    const [rx,rz]=point(0,-halfD);
    add('fence',rx,rz,b.yaw||0,[halfW*2,fenceY,.25]);
    const [dx,dz]=point(0,halfD+3.5);
    add('driveway',dx,dz,b.yaw||0,[Math.min(7,halfW*1.45),.12,7]);
    if(rng()<.55){
      const [px,pz]=point(halfW+1.5,halfD*.45);
      add('planter',px,pz,(b.yaw||0)+rng()*.25,[1.8,.8,1.8]);
    }
    if(rng()<.35){
      const [tx,tz]=point(-halfW-2,halfD*.25);
      add('tree',tx,tz,rng()*Math.PI*2,[2.2,5.5,2.2]);
    }
  }
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
  const chunks=new Map();
  for(const [name,list] of items){
    for(const item of list){
      const cx=Math.floor(item.x/CHUNK),cz=Math.floor(item.z/CHUNK),key=cx+','+cz;
      if(!chunks.has(key))chunks.set(key,{cx,cz,items:new Map()});
      const c=chunks.get(key);if(!c.items.has(name))c.items.set(name,[]);c.items.get(name).push(item);
    }
  }
  const chunkGroups=[];
  for(const chunk of chunks.values()){
    const cg=new THREE.Group();
    cg.userData.centerX=(chunk.cx+.5)*CHUNK;cg.userData.centerZ=(chunk.cz+.5)*CHUNK;
    for(const [name,list] of chunk.items){
      const model=models.get(name);
      for(const part of model.parts){
        const mesh=new THREE.InstancedMesh(part.geometry,part.material,list.length);
        mesh.castShadow=false;mesh.receiveShadow=true;
        list.forEach((item,i)=>{
          position.set(item.x,item.y,item.z);rotation.setFromAxisAngle(up,item.yaw);scale.set(...item.scale);
          matrix.compose(position,rotation,scale);mesh.setMatrixAt(i,matrix);
        });
        mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();cg.add(mesh);
      }
    }
    group.add(cg);chunkGroups.push(cg);
  }
  function update(x,z){
    for(const c of chunkGroups){const dx=c.userData.centerX-x,dz=c.userData.centerZ-z;c.visible=dx*dx+dz*dz<1100*1100;}
  }
  group.userData.detailCounts=Object.fromEntries([...items].map(([k,v])=>[k,v.length]));
  return{group,update,counts:group.userData.detailCounts};
}
