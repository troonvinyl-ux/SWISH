import { useMemo } from 'react';
import type { AIIdentificationResult } from '@/services/aiIdentificationService';
import { packetForResult, packetReviewValues, packetReviewIssue, packetFieldLabels } from '@/services/coinPacketReviewService';
import { coinPacketKeys } from '@/shared/coinPacket';
export function useCoinPacketReview(result:AIIdentificationResult,answers:Record<string,string>){
 return useMemo(()=>{const packet=packetForResult(result);if(!packet)return null;
 const values=packetReviewValues(packet,answers);
 return {packet,reviewed:packetReviewIssue(result)===null,fields:coinPacketKeys.map(key=>({key,label:packetFieldLabels[key],value:values[key],uncertain:packet.fields[key]?.uncertain??false,quote:packet.fields[key]?.quote??''}))};
 },[result,answers]);
}
