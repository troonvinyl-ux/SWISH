/**
 * Browser-only adapter for the SWISH experimental segmentation engine.
 * Intended for OnSpace web preview. No model or weights are bundled here.
 * Supply a separately licensed and verified inference runtime.
 */
import { runNativeSegmentation, type SegmentationRuntime } from './nativeSegmentationEngine';

export interface BrowserCutout { dataUrl:string; elapsedMs:number; }
export async function cutoutBrowserImage(
 image:HTMLImageElement,runtime:SegmentationRuntime,
 background:'transparent'|'white'|'light-grey'='transparent'
):Promise<BrowserCutout>{
 if(typeof document==='undefined')throw new Error('Browser canvas is unavailable');
 if(!image.complete||image.naturalWidth<1||image.naturalHeight<1)throw new Error('Image not loaded');
 const w=image.naturalWidth,h=image.naturalHeight;
 if(w*h>3_000_000)throw new Error('Resize image before segmentation');
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw new Error('Canvas 2D is unavailable');
 ctx.drawImage(image,0,0);
 const original=ctx.getImageData(0,0,w,h);
 const cutout=await runNativeSegmentation({rgba:new Uint8Array(original.data),width:w,height:h,background},runtime);
 const output=ctx.createImageData(w,h);
 output.data.set(cutout.rgba);
 ctx.putImageData(output,0,0);
 return {dataUrl:canvas.toDataURL('image/png'),elapsedMs:cutout.elapsedMs};
}
