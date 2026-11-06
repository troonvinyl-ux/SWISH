// Conventional computer-vision edge support. Not an OCR or segmentation model.
import { sampleSource, type StudioRaster, type StudioDetection, type StudioPoint } from './smartStudio.ts';
const distance=(a:StudioPoint,b:StudioPoint)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function edgeStrength(source:StudioRaster,a:StudioPoint,b:StudioPoint,offset=0):number {
 const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.max(1,Math.hypot(dx,dy));const nx=-dy/length,ny=dx/length;let sum=0;
 for(let n=1;n<=20;n++){
  const p=n/21,x=a[0]+dx*p+nx*offset,y=a[1]+dy*p+ny*offset;
  const left=sampleSource(source,x+nx*2,y+ny*2),right=sampleSource(source,x-nx*2,y-ny*2);
  sum+=(Math.abs(left[0]-right[0])+Math.abs(left[1]-right[1])+Math.abs(left[2]-right[2]))/3;
 }
 return sum/20;
}
export function assessBoundaryEdges(source:StudioRaster,detection:StudioDetection):{edgeSupport:number;meanContrast:number} {
 const pts=detection.outline.map(p=>[p[0]*(source.width-1),p[1]*(source.height-1)] as StudioPoint);let supported=0,sum=0,count=0;
 for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];if(distance(a,b)<2)continue;const strength=edgeStrength(source,a,b);sum+=strength;count++;if(strength>=10)supported++;}
 return {edgeSupport:supported/Math.max(1,count),meanContrast:sum/Math.max(1,count)};
}
/** Refine a four-edge planar estimate only within a tiny source-pixel band.
 * Irregular/transparent boundaries are not snapped or replaced by a rectangle. */
export function refineRectangleEdges(source:StudioRaster,detection:StudioDetection):StudioDetection {
 if(detection.kind!=='rectangle'||detection.transparent||detection.outline.length!==4)return detection;
 const corners=detection.corners.map(p=>[p[0]*(source.width-1),p[1]*(source.height-1)] as StudioPoint);
 const lines=corners.map((a,i)=>{
  const b=corners[(i+1)%4],length=distance(a,b),nx=-(b[1]-a[1])/length,ny=(b[0]-a[0])/length;
  let best=0,strength=edgeStrength(source,a,b);for(let offset=-3;offset<=3;offset++){const candidate=edgeStrength(source,a,b,offset);if(candidate>strength*1.15){best=offset;strength=candidate;}}
  return {a:[a[0]+nx*best,a[1]+ny*best] as StudioPoint,b:[b[0]+nx*best,b[1]+ny*best] as StudioPoint};
 });
 const refined=corners.map((original,i)=>{
  const previous=lines[(i+3)%4],next=lines[i],dx1=previous.b[0]-previous.a[0],dy1=previous.b[1]-previous.a[1],dx2=next.b[0]-next.a[0],dy2=next.b[1]-next.a[1];
  const denominator=dx1*dy2-dy1*dx2;if(Math.abs(denominator)<1e-6)return original;
  const t=((next.a[0]-previous.a[0])*dy2-(next.a[1]-previous.a[1])*dx2)/denominator;const point:StudioPoint=[previous.a[0]+t*dx1,previous.a[1]+t*dy1];
  return distance(point,original)<=6&&point[0]>0&&point[1]>0&&point[0]<source.width-1&&point[1]<source.height-1?point:original;
 }).map(p=>[p[0]/(source.width-1),p[1]/(source.height-1)] as StudioPoint);
 return {...detection,corners:refined,outline:refined};
}
