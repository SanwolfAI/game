import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {toXZ} from '../core/geo.js';
const FILES=[
  ...'abcdefghijklmnopqrst'.split('').map(c=>'building-'+c),
  'detail-tank','detail-tank-large','chimney-basic','chimney-small','chimney-medium','chimney-large',
  'shipping-container-a','shipping-container-b','shipping-container-c',
  'water-tower','windmill-low','windmill','solar-panel-flat','solar-panel-landscape','solar-panel-portrait',
  'solar-panel-landscape-group','solar-panel-portrait-group'
];
const CHUNK=700;
function inside(x,z,r){let v=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])v=!v;}return v;}
function prep(scene){scene.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(scene),s=b.getSize(new THREE.Vector3()),c=b.getCenter(new THREE.Vector3()),parts=[];scene.traverse(o=>{if(!o.isMesh||!o.geometry||!o.material)return;const g=o.geometry.clone();g.applyMatrix4(o.matrixWorld);g.translate(-c.x,-b.min.y,-c.z);g.scale(1/Math.max(s.x,.001),1/Math.max(s.y,.001),1/Math.max(s.z,.001));g.computeBoundingSphere();parts.push({geometry:g,material:Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone()});});return parts;}
export async function buildIndustrialModels(data,hf,roads,city,rng){
 const group=new THREE.Group();group.name='durban-industrial-models';const loader=new GLTFLoader();
 const loaded=[];
 for(const name of FILES){
  try{
   const gltf=await loader.loadAsync('./src/assets/industrialkit/'+name+'.glb');
   loaded.push({name,parts:prep(gltf.scene)});
  }catch(e){
   console.warn('Industrial asset unavailable',name,e);
   loaded.push(null);
  }
 }
 const models=loaded.filter(m=>m&&m.parts.length);if(!models.length)return{group,update(){},count:0};
 const chunks=new Map();let count=0;
 for(const area of data.landuse||[]){
  if(area?.u!=='industrial'||!Array.isArray(area.p)||area.p.length<4)continue;
  const ring=area.p.map(([lon,lat])=>toXZ(lon,lat));let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const [x,z] of ring){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
  const w=maxX-minX,d=maxZ-minZ;if(w<24||d<24)continue;
  const spots=[[minX+w*.35,minZ+d*.35],[minX+w*.68,minZ+d*.62],[minX+w*.5,minZ+d*.5]];
  let n=0;
  for(const [x,z] of spots){
   if(!inside(x,z,ring)||hf.isWater(x,z))continue;
   const near=roads.nearestRoad(x,z,45);if(near&&near.dist<near.road.width*.5+8)continue;
   if(city.hash.query(x,z,12).length)continue;
   const model=models[Math.floor(rng()*models.length)];
   const detail=/tank|chimney|water-tower|windmill|solar-panel/.test(model.name);
   const key=Math.floor(x/CHUNK)+','+Math.floor(z/CHUNK);
   if(!chunks.has(key))chunks.set(key,{cx:Math.floor(x/CHUNK),cz:Math.floor(z/CHUNK),items:new Map()});
   const c=chunks.get(key);if(!c.items.has(model.name))c.items.set(model.name,[]);
   c.items.get(model.name).push({x,z,y:hf.heightAt(x,z),yaw:rng()*Math.PI*2,
    scale:/shipping-container/.test(model.name)?[12.2,2.6,2.45]:detail?[7+rng()*5,16+rng()*22,7+rng()*5]:
      [Math.min(70,Math.max(22,w*.22)),Math.min(30,Math.max(12,16+rng()*10)),Math.min(58,Math.max(18,d*.24))]});
   count++;n++;if(n===3)break;
  }
 }
 const mat=new THREE.Matrix4(),pos=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),groups=[];
 for(const c of chunks.values()){
  const cg=new THREE.Group();cg.userData.centerX=(c.cx+.5)*CHUNK;cg.userData.centerZ=(c.cz+.5)*CHUNK;
  for(const [name,items] of c.items){const model=models.find(m=>m.name===name);for(const part of model.parts){
   const mesh=new THREE.InstancedMesh(part.geometry,part.material,items.length);items.forEach((it,i)=>{pos.set(it.x,it.y,it.z);q.setFromAxisAngle(up,it.yaw);s.set(...it.scale);mat.compose(pos,q,s);mesh.setMatrixAt(i,mat);});
   mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();cg.add(mesh);
  }}
  group.add(cg);groups.push(cg);
 }
 function update(x,z){for(const c of groups){const dx=c.userData.centerX-x,dz=c.userData.centerZ-z;c.visible=dx*dx+dz*dz<1400*1400;}}
 group.userData.modelCount=count;group.userData.availableModels=models.map(m=>m.name);return{group,update,count};
}
