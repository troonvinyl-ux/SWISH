import type { StudioResult } from '@/shared/smartStudio';
// Fictional transport fixture only; never claims real photographic acceptance.
export const backgroundEraseQuality:StudioResult['quality']={sourcePixelsOnly:false,method:'backgrounderase',provider:'BackgroundErase',checks:{validPng:true,dimensionsUnchanged:true,foregroundPresent:true,transparencyPresent:true},completeness:'not_assessed',boundary:'Provider segmentation',detailCheck:'Transport checks only',background:'transparent'};
