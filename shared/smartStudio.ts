// Dependency-free Smart Studio geometry and pixel protection contract.
// Mirrored byte-for-byte into the deployable Edge directory; no React or secrets.
export const SMART_STUDIO_VERSION = 'smart-studio-1.0.0';
export type StudioPoint = [number, number];
export interface StudioDetection {
 kind: 'rectangle' | 'circle' | 'contour'; outline: StudioPoint[]; holes: StudioPoint[][];
 corners: StudioPoint[]; confidence: number; complete: boolean; occluded: boolean;
 transparent: boolean; reflective: boolean; objectCount: number;
 rotation: number; aspectRatio: number | null; ratioEvidence: string;
 warnings: string[];
}
export interface StudioTransform {
 method: 'homography' | 'similarity'; inverse: number[]; margin: number;
 sourceWidth: number; sourceHeight: number; outputWidth: number; outputHeight: number;
 productBounds: [number, number, number, number];
}
export interface StudioResult {
 version: string; status: 'ready' | 'review' | 'fallback'; originalUri: string;
 enhancedUri?: string; maskUri?: string; sourceHash?: string; cacheKey?: string;
 detection?: StudioDetection; transform?: StudioTransform; confidence: number;
 warnings: string[]; quality: { sourcePixelsOnly: boolean; completeness: string;
  boundary: string; detailCheck: string; background: string; sharpness?: number; exposureGain?: number };
}
export interface StudioRaster { width: number; height: number; data: Uint8Array }
export function studioProfile(niche: string): string {
 const profiles: Record<string, string> = {
  coins:'Full rim, genuine holes, irregular flans and patina. Do not force irregular coins into circles.',
  tunes_flip:'Detect the actual selected CD disc, jewel case, sleeve or vinyl. Keep disc labels separate. Never use the entire photograph as the product plane.',
  collectibles:'Preserve accessories and irregular silhouette. Printed artwork is part of the product, not separate physical objects.',
  antiques:'Preserve handles, chips, cracks and irregular outlines. Transparent glass requires conservative opaque source retention.',
  clothing:'Complete garment silhouette, sleeves, folds, stains and every hem; do not make the garment symmetrical.',
  bicycles:'Both wheels, frame, cables and components; background holes between spokes and frame tubes. No perspective flattening of a 3D bike.',
  motocross:'All components, wheels and protruding parts. Preserve dents, rust and mechanical details. No flattening of 3D objects.',
  trading_cards:'All four card corners and borders. Preserve original text and damage. Perspective only on a genuine planar card.',
  fossils:'Natural irregular contour, missing anatomy and matrix; no shape reconstruction.',
  beauty:'Packaging, seals, labels and reflective surfaces; no invented transparency or label repair.',
  tech:'All device edges, screens, ports and damage; preserve screen content.',
  surplus_flip:'One selected physical item; multiple unrelated products require original-frame fallback.',
 };
 return profiles[niche] ?? 'Preserve complete product silhouette and condition evidence.';
}
function point(value: unknown): StudioPoint {
 if (!Array.isArray(value) || value.length !== 2 || value.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)) throw new Error('Invalid normalized boundary point.');
 return [value[0],value[1]];
}
export function polygonArea(points: StudioPoint[]): number {
 return Math.abs(points.reduce((sum,p,i)=>{const next=points[(i+1)%points.length];return sum+p[0]*next[1]-next[0]*p[1];},0)/2);
}
function cross(a:StudioPoint,b:StudioPoint,c:StudioPoint) { return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]); }
function validatePolygon(points:StudioPoint[]) {
 if(points.length<3||points.length>160||polygonArea(points)<0.0001)throw new Error('Unusable product outline.');
 for(let i=0;i<points.length;i++)for(let j=i+2;j<points.length;j++){
  if(i===0&&j===points.length-1)continue;
  const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];
  if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)throw new Error('Boundary crosses itself.');
 }
}
export function normalizeStudioDetection(raw: unknown): StudioDetection {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Boundary analysis missing.');
 const r=raw as Record<string,any>;
 if(!['rectangle','circle','contour'].includes(r.kind))throw new Error('Unsupported detected geometry.');
 if(!Array.isArray(r.outline))throw new Error('Product outline missing.');
 const outline=r.outline.map(point);validatePolygon(outline);
 const holes=(Array.isArray(r.holes)?r.holes:[]).slice(0,16).map((h:unknown)=>{if(!Array.isArray(h))throw new Error('Invalid mask hole.');const pts=h.map(point);validatePolygon(pts);return pts;});
 const corners=(Array.isArray(r.corners)?r.corners:[]).map(point);
 if(r.kind==='rectangle'){
  if(corners.length!==4)throw new Error('Four product-plane corners required.');
  validatePolygon(corners);const signs=corners.map((a:StudioPoint,i:number)=>cross(a,corners[(i+1)%4],corners[(i+2)%4]));
  if(!signs.every((v:number)=>v>0)||polygonArea(corners)<0.02)throw new Error('Corners must be convex and ordered top-left, top-right, bottom-right, bottom-left.');
 }
 const confidence=typeof r.confidence==='number'&&Number.isFinite(r.confidence)?Math.max(0,Math.min(1,r.confidence)):0;
 return {kind:r.kind,outline,holes,corners,confidence,complete:r.complete===true,occluded:r.occluded!==false,transparent:r.transparent===true,reflective:r.reflective===true,objectCount:Number.isInteger(r.objectCount)?r.objectCount:0,rotation:typeof r.rotation==='number'&&Math.abs(r.rotation)<=45?r.rotation:0,aspectRatio:typeof r.aspectRatio==='number'&&r.aspectRatio>=0.15&&r.aspectRatio<=6?r.aspectRatio:null,ratioEvidence:typeof r.ratioEvidence==='string'?r.ratioEvidence.slice(0,200):'',warnings:(Array.isArray(r.warnings)?r.warnings:[]).filter((v:unknown)=>typeof v==='string').slice(0,8).map((v:string)=>v.slice(0,180))};
}
export function studioRisk(d:StudioDetection): string[] {
 const reasons:string[]=[];
 if(d.confidence<0.8)reasons.push('Boundary confidence is insufficient; full original retained.');
 if(!d.complete||d.outline.some(p=>p[0]<=0.002||p[1]<=0.002||p[0]>=0.998||p[1]>=0.998))reasons.push('Product is clipped or incomplete. Missing edges cannot be reconstructed honestly.');
 if(d.occluded)reasons.push('Product is occluded. No missing product detail was invented.');
 if(d.objectCount!==1)reasons.push('Multiple or ambiguous physical objects; no items were merged or removed.');
 return reasons;
}
export function insidePolygon(x:number,y:number,points:StudioPoint[]):boolean {
 let inside=false;
 for(let i=0,j=points.length-1;i<points.length;j=i++){
  const a=points[i],b=points[j];
  if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
}
export function homography(from:StudioPoint[],to:StudioPoint[]):number[] {
 if(from.length!==4||to.length!==4)throw new Error('Homography requires four correspondences.');
 const matrix:number[][]=[];
 for(let i=0;i<4;i++){const [x,y]=from[i],[u,v]=to[i];matrix.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);}
 for(let col=0;col<8;col++){
  let pivot=col;for(let row=col+1;row<8;row++)if(Math.abs(matrix[row][col])>Math.abs(matrix[pivot][col]))pivot=row;
  if(Math.abs(matrix[pivot][col])<1e-10)throw new Error('Degenerate product plane.');
  [matrix[col],matrix[pivot]]=[matrix[pivot],matrix[col]];
  const divisor=matrix[col][col];for(let k=col;k<=8;k++)matrix[col][k]/=divisor;
  for(let row=0;row<8;row++){if(row===col)continue;const factor=matrix[row][col];for(let k=col;k<=8;k++)matrix[row][k]-=factor*matrix[col][k];}
 }
 return [...matrix.map(row=>row[8]),1];
}
export function project(matrix:readonly number[],x:number,y:number):StudioPoint {
 const denominator=matrix[6]*x+matrix[7]*y+matrix[8];
 if(!Number.isFinite(denominator)||Math.abs(denominator)<1e-9)throw new Error('Unstable perspective mapping.');
 return [(matrix[0]*x+matrix[1]*y+matrix[2])/denominator,(matrix[3]*x+matrix[4]*y+matrix[5])/denominator];
}
export function buildStudioTransform(d:StudioDetection,width:number,height:number,size=1024,margin=0.08):StudioTransform {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error('Invalid raster dimensions.');
 const output=Math.max(256,Math.min(1280,Math.round(size)));margin=Math.max(0.06,Math.min(0.2,margin));
 let inverse:number[],method:StudioTransform['method']='similarity';let target:StudioPoint[];
 // A single image cannot establish a true arbitrary rectangular aspect ratio.
 // Only explicit supported physical dimensions permit projective rectification.
 if(d.kind==='rectangle'&&d.aspectRatio&&/^(known_dimensions|known_product_plane)$/.test(d.ratioEvidence)){
  const w=output*(1-2*margin)*Math.min(1,d.aspectRatio),h=output*(1-2*margin)*Math.min(1,1/d.aspectRatio);
  const x=(output-w)/2,y=(output-h)/2;target=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
  inverse=homography(target,d.corners.map(p=>[p[0]*(width-1),p[1]*(height-1)]));method='homography';
 }else{
  const theta=-d.rotation*Math.PI/180,c=Math.cos(theta),s=Math.sin(theta);
  const rotated=d.outline.map(p=>{const x=p[0]*(width-1),y=p[1]*(height-1);return [c*x-s*y,s*x+c*y] as StudioPoint;});
  const minX=Math.min(...rotated.map(p=>p[0])),maxX=Math.max(...rotated.map(p=>p[0])),minY=Math.min(...rotated.map(p=>p[1])),maxY=Math.max(...rotated.map(p=>p[1]));
  const scale=output*(1-2*margin)/Math.max(1,maxX-minX,maxY-minY);
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  inverse=[c/scale,s/scale,c*(cx-output/2/scale)+s*(cy-output/2/scale),-s/scale,c/scale,-s*(cx-output/2/scale)+c*(cy-output/2/scale),0,0,1];
  const w=(maxX-minX)*scale,h=(maxY-minY)*scale;target=[[(output-w)/2,(output-h)/2],[(output+w)/2,(output-h)/2],[(output+w)/2,(output+h)/2],[(output-w)/2,(output+h)/2]];
 }
 if(inverse.some(v=>!Number.isFinite(v)))throw new Error('Invalid geometric correction.');
 return {method,inverse,margin,sourceWidth:width,sourceHeight:height,outputWidth:output,outputHeight:output,productBounds:[target[0][0],target[0][1],target[2][0],target[2][1]]};
}
export function sampleSource(source:StudioRaster,x:number,y:number):number[] {
 const x0=Math.floor(x),y0=Math.floor(y),dx=x-x0,dy=y-y0;
 const out=[0,0,0,0];
 for(let row=0;row<2;row++)for(let col=0;col<2;col++){
  const xx=Math.max(0,Math.min(source.width-1,x0+col)),yy=Math.max(0,Math.min(source.height-1,y0+row));
  const weight=(col?dx:1-dx)*(row?dy:1-dy),offset=(yy*source.width+xx)*4;
  for(let channel=0;channel<4;channel++)out[channel]+=source.data[offset+channel]*weight;
 }
 return out;
}
function inverseMatrix(m:readonly number[]):number[] {
 const [a,b,c,d,e,f,g,h,i]=m;const cof=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
 const det=a*cof[0]+b*cof[3]+c*cof[6];if(Math.abs(det)<1e-10)throw new Error('Singular transform.');return cof.map(v=>v/det);
}
function polygonMask(points:StudioPoint[],width:number,height:number):Uint8Array {
 const mask=new Uint8Array(width*height);
 for(let y=0;y<height;y++){
  const xs:number[]=[];for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y+0.5)!==(b[1]>y+0.5))xs.push(a[0]+(y+0.5-a[1])*(b[0]-a[0])/(b[1]-a[1]));}
  xs.sort((a,b)=>a-b);for(let i=0;i+1<xs.length;i+=2){const start=Math.max(0,Math.ceil(xs[i]-0.5)),end=Math.min(width,Math.ceil(xs[i+1]-0.5));if(end>start)mask.fill(255,y*width+start,y*width+end);}
 }
 return mask;
}
export function renderStudio(source:StudioRaster,d:StudioDetection,t:StudioTransform,background?:StudioRaster,exposureGain=1) {
 if(source.data.length!==source.width*source.height*4)throw new Error('Invalid RGBA source.');
 const {outputWidth:w,outputHeight:h}=t;const data=new Uint8Array(w*h*4),mask=new Uint8Array(w*h*4);
 const forward=inverseMatrix(t.inverse);const map=(points:StudioPoint[])=>points.map(p=>project(forward,p[0]*(source.width-1),p[1]*(source.height-1)));
 const productMask=polygonMask(map(d.outline),w,h);for(const hole of d.holes){const cut=polygonMask(map(hole),w,h);for(let i=0;i<cut.length;i++)if(cut[i])productMask[i]=0;}
 const gain=Math.max(1,Math.min(1.08,exposureGain));let pixels=0,invalid=0,sharpness=0,luma=0;
 const [left,top,right,bottom]=t.productBounds;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const offset=(y*w+x)*4;
  const shadow=Math.exp(-Math.pow((x-w/2)/Math.max(1,(right-left)*0.45),2)-Math.pow((y-bottom-6)/Math.max(3,(bottom-top)*0.035),2))*12;
  for(let c=0;c<3;c++)data[offset+c]=background?background.data[(Math.min(background.height-1,Math.floor(y/h*background.height))*background.width+Math.min(background.width-1,Math.floor(x/w*background.width)))*4+c]:Math.round(250-shadow);
  data[offset+3]=255;mask[offset+3]=255;
  if(!productMask[y*w+x])continue;
  const p=project(t.inverse,x+0.5,y+0.5);
  if(p[0]<0||p[1]<0||p[0]>source.width-1||p[1]>source.height-1){invalid++;continue;}
  const original=sampleSource(source,p[0],p[1]);
  // Full original-product layer is restored AFTER the background. No model output
  // is sampled for product pixels; no healing, inpainting, denoising or redraw.
  for(let c=0;c<3;c++)data[offset+c]=Math.min(255,Math.round(original[c]*gain));
  mask[offset]=mask[offset+1]=mask[offset+2]=255;pixels++;luma+=(original[0]+original[1]+original[2])/3;
  if(x>0&&mask[offset-4]===255)sharpness+=Math.abs(data[offset]-data[offset-4]);
 }
 if(pixels<w*h*0.01||invalid>0)throw new Error('Product mapping is incomplete; original must be retained.');
 return {image:{width:w,height:h,data},mask:{width:w,height:h,data:mask},quality:{sampledProductPixels:pixels,invalidMappings:invalid,sharpness:sharpness/pixels,meanLuma:luma/pixels,exposureGain:gain}};
}
export function preferredStudioImage(media:readonly string[],attributes:Record<string,any>):string|undefined {
 const original=media[0];if(!original)return undefined;
 const entries=attributes?._smart_studio_images;
 const entry=entries&&typeof entries==='object'?Object.values(entries).find((v:any)=>v?.originalUri===original&&v?.version===SMART_STUDIO_VERSION&&v?.status==='ready'&&v?.quality?.sourcePixelsOnly===true) as StudioResult|undefined:undefined;
 return entry?.enhancedUri?.startsWith('https://')?entry.enhancedUri:original;
}
