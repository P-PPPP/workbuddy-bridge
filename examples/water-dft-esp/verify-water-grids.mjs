import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(process.argv[2]);
async function cube(name){
 const lines=(await fs.readFile(path.join(root,name),'utf8')).trimEnd().split(/\r?\n/);
 const row=i=>lines[i].trim().split(/\s+/).map(s=>Number(s.replace(/[Dd]/,'E')));
 const h=row(2), atoms=h[0], axes=[row(3),row(4),row(5)], dims=axes.map(a=>a[0]);
 if(!Number.isInteger(atoms)||atoms<=0||dims.some(n=>!Number.isInteger(n)||n<=0))throw Error('Expected a single scalar cube with Bohr axes: '+name);
 const data=Float64Array.from(lines.slice(6+atoms).join(' ').trim().split(/\s+/),s=>Number(s.replace(/[Dd]/,'E')));
 if(data.length!==dims.reduce((a,b)=>a*b,1)||data.some(n=>!Number.isFinite(n)))throw Error('Invalid cube data: '+name);
 let min=Infinity,max=-Infinity,sum=0,zeros=0;
 for(const n of data){min=Math.min(min,n);max=Math.max(max,n);sum+=n;if(n===0)zeros++;}
 const v=axes.map(a=>a.slice(1));
 const det=v[0][0]*(v[1][1]*v[2][2]-v[1][2]*v[2][1])-v[0][1]*(v[1][0]*v[2][2]-v[1][2]*v[2][0])+v[0][2]*(v[1][0]*v[2][1]-v[1][1]*v[2][0]);
 return {data,origin:h.slice(1),vectors:v,dims,integral:sum*Math.abs(det),summary:{file:name,atoms,grid_dimensions:dims,grid_points:data.length,origin_bohr:h.slice(1),axis_vectors_bohr:v,min,max,zero_values:zeros}};
}
const density=await cube('surf.cub'), esp=await cube('mapfunc.cub');
density.summary.approximate_electron_count_on_display_grid=density.integral;
density.summary.integration_note='Coarse rectangular-grid diagnostic only. The 0.20 Bohr display grid under-resolves nuclear peaks and is not used to determine the 10-electron wavefunction or surface ESP extrema.';
if(JSON.stringify([density.dims,density.origin,density.vectors])!==JSON.stringify([esp.dims,esp.origin,esp.vectors]))throw Error('Density and ESP grids do not match.');
const iso=0.001,[nx,ny,nz]=density.dims;
let samples=0,min=Infinity,max=-Infinity;
for(let x=0;x<nx;x++)for(let y=0;y<ny;y++)for(let z=0;z<nz;z++){
 const i=(x*ny+y)*nz+z;
 for(const step of [x+1<nx?ny*nz:0,y+1<ny?nz:0,z+1<nz?1:0]){
  if(!step)continue;const j=i+step,a=density.data[i],b=density.data[j];
  if((a<iso&&b<iso)||(a>iso&&b>iso)||a===b)continue;
  const f=(iso-a)/(b-a),v=esp.data[i]+f*(esp.data[j]-esp.data[i]);
  min=Math.min(min,v);max=Math.max(max,v);samples++;
 }
}
const passed=density.summary.min>=0&&density.summary.max>iso&&samples>0&&min<0&&max>0;
const result={source:'Independent scalar-cube validation; no model-generated statistics used',passed,density:density.summary,esp:esp.summary,approximate_surface_check:{density_isovalue_e_per_bohr3:iso,method:'Linear interpolation on density-grid edges that cross the isovalue; diagnostic only, not a replacement for Multiwfn surface extrema',edge_crossings:samples,esp_min_au:min,esp_max_au:max}};
console.log(JSON.stringify(result,null,2));
if(process.argv[3])await fs.writeFile(path.resolve(process.argv[3]),JSON.stringify(result,null,2)+'\n');
if(!passed)process.exitCode=1;
