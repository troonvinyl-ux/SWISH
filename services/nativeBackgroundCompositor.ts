/**
 * Native background-removal experiment: deterministic alpha compositing.
 * Does not infer a mask, load a model, contact an API, or alter originals.
 * Input pixels and mask must be produced by a separately validated native model.
 */
export type NativeCutoutResult = { width:number; height:number; rgba:Uint8Array };
export type BackgroundColour = 'transparent'|'white'|'light-grey';
export function compositeSegmentationMask(
 source:Uint8Array, mask:Uint8Array, width:number, height:number,
 background:BackgroundColour='transparent'
):NativeCutoutResult {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>3_000_000)
  throw new Error('Invalid image dimensions');
 const pixels=width*height;
 if(source.length!==pixels*4||mask.length!==pixels)throw new Error('Invalid source or segmentation mask size');
 const result=new Uint8Array(source.length);
 const bg=background==='white'?255:background==='light-grey'?245:0;
 let foreground=0, transparent=0;
 for(let i=0;i<pixels;i++){
  const offset=i*4,alpha=Math.round(source[offset+3]*mask[i]/255);
  if(alpha>0)foreground++;
  if(alpha<255)transparent++;
  if(background==='transparent'){
   result[offset]=source[offset];result[offset+1]=source[offset+1];result[offset+2]=source[offset+2];result[offset+3]=alpha;
  }else{
   const a=alpha/255;
   for(let c=0;c<3;c++)result[offset+c]=Math.round(source[offset+c]*a+bg*(1-a));
   result[offset+3]=255;
  }
 }
 if(foreground===0||transparent===0)throw new Error('Unusable segmentation mask; retain original');
 return {width,height,rgba:result};
}
export const NATIVE_BACKGROUND_REMOVAL_ENABLED=false;
