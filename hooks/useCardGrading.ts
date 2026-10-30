import { useState,useCallback } from 'react';
import { calculateCardGrading,type CardGradingInput,type CardGradingResult } from '@/services/cardGradingService';
export type GradingField = Exclude<keyof CardGradingInput,'scenarios'>;
export const GRADING_FIELDS: Array<{ key:GradingField;label:string;percent?:boolean }> = [
  { key:'rawSalePrice',label:'Raw sale price (£)' },{ key:'purchaseCost',label:'Purchase cost (£)' },
  { key:'saleFeeRate',label:'Selling fee (%)',percent:true },{ key:'saleFixedFee',label:'Fixed selling fee (£)' },
  { key:'rawSaleShipping',label:'Raw sale postage (£)' },{ key:'gradedSaleShipping',label:'Graded sale postage (£)' },
  { key:'gradingFee',label:'Grading fee incl. VAT / surcharges (£)' },{ key:'insuredOutbound',label:'Insured shipping to grader (£)' },
  { key:'insuredReturn',label:'Insured return shipping (£)' },{ key:'packagingCost',label:'Sale packaging (£)' },
  { key:'holdingDays',label:'Days held before graded sale' },{ key:'monthlyHoldingCost',label:'Monthly storage / holding cost (£)' },
  { key:'annualCapitalRate',label:'Annual cost of tied-up capital (%)',percent:true },
];
interface OutcomeDraft { id:string;label:string;price:string;probability:string }
const initial = Object.fromEntries(GRADING_FIELDS.map(field => [field.key,''])) as Record<GradingField,string>;
export function useCardGrading() {
  const [fields,setFields] = useState(initial);
  const [scenarios,setScenarios] = useState<OutcomeDraft[]>([
    { id:'high',label:'Higher-grade scenario',price:'',probability:'' },
    { id:'lower',label:'Lower-grade scenario',price:'',probability:'' },
    { id:'returned',label:'Ungraded / returned',price:'',probability:'' },
  ]);
  const [result,setResult] = useState<CardGradingResult|null>(null),[error,setError] = useState<string|null>(null);
  const invalidate = useCallback(() => { setResult(null);setError(null); },[]);
  const setField = useCallback((key:GradingField,value:string) => { invalidate();setFields(previous => ({ ...previous,[key]:value })); },[invalidate]);
  const setOutcome = useCallback((id:string,key:'label'|'price'|'probability',value:string) => { invalidate();setScenarios(previous => previous.map(s => s.id === id ? { ...s,[key]:value } : s)); },[invalidate]);
  const calculate = useCallback(() => {
    try {
      const number = (value:string) => { if (!/^\d+(?:\.\d+)?$/.test(value.trim())) throw new Error('Complete every numeric field; enter 0 explicitly for costs that do not apply.'); return Number(value); };
      const input = Object.fromEntries(GRADING_FIELDS.map(field => [field.key,number(fields[field.key]) / (field.percent ? 100 : 1)])) as Omit<CardGradingInput,'scenarios'>;
      const outcomes = scenarios.map(s => ({ id:s.id,label:s.label,probability:number(s.probability) / 100,salePrice:number(s.price) }));
      setResult(calculateCardGrading({ ...input,scenarios:outcomes }));setError(null);
    } catch(e:unknown) { setResult(null);setError(e instanceof Error ? e.message : 'Calculation failed.'); }
  },[fields,scenarios]);
  return { fields,scenarios,result,error,setField,setOutcome,calculate };
}
