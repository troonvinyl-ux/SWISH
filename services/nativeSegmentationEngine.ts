/**
 * Stage 3 native segmentation integration boundary.
 * A native ONNX runtime supplies infer() and a licensed model supplies weights.
 * This file intentionally does not claim a model is installed.
 * All pixels are RGBA, row-major. Model input/output are CHW floats.
 */
import { compositeSegmentationMask, type BackgroundColour, type NativeCutoutResult } from './nativeBackgroundCompositor';

export interface SegmentationRuntime {
  /** Must return a single-channel foreground probability map of inputSize^2 values in [0,1]. */
  infer(input:Float32Array,inputSize:number):Promise<Float32Array>;
}
export interface NativeSegmentationRequest {
  rgba:Uint8Array;width:number;height:number;inputSize?:number;
  background?:BackgroundColour;
}
export interface NativeSegmentationResult extends NativeCutoutResult {
  inputSize:number;elapsedMs:number;
}
function validDimensions(w:number,h:number,len:number):void {
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>3_000_000||len!==w*h*4)
    throw new Error('Invalid image raster');
}
/** Bilinear sample, with pixel-center alignment. */
function sample(src:Uint8Array,w:number,h:number,x:number,y:number,c:number):number {
  const x0=Math.max(0,Math.min(w-1,Math.floor(x)));
  const y0=Math.max(0,Math.min(h-1,Math.floor(y)));
  const x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1);
  const fx=Math.max(0,Math.min(1,x-x0)),fy=Math.max(0,Math.min(1,y-y0));
  const at=(xx:number,yy:number)=>src[(yy*w+xx)*4+c];
  return (at(x0,y0)*(1-fx)+at(x1,y0)*fx)*(1-fy)+(at(x0,y1)*(1-fx)+at(x1,y1)*fx)*fy;
}
/** RGB input normalised to 0..1; model-specific mean/std must be adapted by runtime. */
export function rgbaToChw(rgb:Uint8Array,w:number,h:number,size:number):Float32Array {
  validDimensions(w,h,rgb.length);
  if(!Number.isInteger(size)||size<32||size>1024)throw new Error('Invalid model input size');
  const out=new Float32Array(3*size*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sx=(x+0.5)*w/size-0.5,sy=(y+0.5)*h/size-0.5;
    for(let c=0;c<3;c++)out[c*size*size+y*size+x]=sample(rgb,w,h,sx,sy,c)/255;
  }
  return out;
}
/** Bilinear resize of foreground probabilities; rejects NaN and out-of-range output. */
export function probabilityMaskToAlpha(prob:Float32Array,size:number,w:number,h:number):Uint8Array {
  if(prob.length!==size*size||!Number.isInteger(size)||size<1||w*h>3_000_000||w<1||h<1)
    throw new Error('Invalid segmentation output dimensions');
  for(const p of prob)if(!Number.isFinite(p)||p<0||p>1)throw new Error('Invalid segmentation probabilities');
  const mask=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const sx=Math.max(0,Math.min(size-1,(x+0.5)*size/w-0.5));
    const sy=Math.max(0,Math.min(size-1,(y+0.5)*size/h-0.5));
    const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(size-1,x0+1),y1=Math.min(size-1,y0+1);
    const fx=sx-x0,fy=sy-y0;
    const a=prob[y0*size+x0]*(1-fx)+prob[y0*size+x1]*fx;
    const b=prob[y1*size+x0]*(1-fx)+prob[y1*size+x1]*fx;
    mask[y*w+x]=Math.round(255*(a*(1-fy)+b*fy));
  }
  return mask;
}
/** Inference is injected: no hidden API calls or automatic paid fallback. */
export async function runNativeSegmentation(
  request:NativeSegmentationRequest,runtime:SegmentationRuntime
):Promise<NativeSegmentationResult> {
  const {rgba,width,height}=request;
  validDimensions(width,height,rgba.length);
  const size=request.inputSize??320;
  const start=Date.now();
  const input=rgbaToChw(rgba,width,height,size);
  const probabilities=await runtime.infer(input,size);
  const mask=probabilityMaskToAlpha(probabilities,size,width,height);
  const image=compositeSegmentationMask(rgba,mask,width,height,request.background??'transparent');
  return {...image,inputSize:size,elapsedMs:Date.now()-start};
}
