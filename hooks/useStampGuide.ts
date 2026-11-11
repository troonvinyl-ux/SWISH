import { useCallback, useMemo, useState } from 'react';
import { useApp } from './useApp';
import { estimateStampPerforation, stampSellingEstimate, stampGuideCards, type StampGuideTopic, type StampProfitInput } from '@/services/stampGuideService';
export function useStampGuide() {
  const app = useApp();
  const [topic,setTopic] = useState<StampGuideTopic>('start');
  const [intervals,setIntervals] = useState(''),[span,setSpan] = useState('');
  const [profitInput,setProfitInput] = useState<StampProfitInput>({price:'',cost:'',postage:'',packaging:'',minutes:''});
  const cards = useMemo(()=>stampGuideCards.filter(card=>card.topic===topic),[topic]);
  const perforation = useMemo(()=>estimateStampPerforation(intervals,span),[intervals,span]);
  const profit = useMemo(()=>stampSellingEstimate(profitInput),[profitInput]);
  const changeProfit = useCallback((key:keyof StampProfitInput,value:string)=>setProfitInput(previous=>({...previous,[key]:value})),[]);
  return { available:app.accessReady && (app.fixedNicheId ?? app.activeNicheId)==='stamps',topic,setTopic,cards,intervals,setIntervals,span,setSpan,perforation,profitInput,changeProfit,profit };
}
