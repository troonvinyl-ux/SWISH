// Pure defaults only; no providers, device camera or live marketplace calls.
import { automaticCondition, automaticSpecifics, automaticListingPrice, marketValueAmount } from '../listingAutofillService';
import { normalizeAntiqueAspects } from '@/shared/antiqueListingPolicy';
const policy={categoryId:'100',itemConditionRequired:true,itemConditions:[{conditionId:'1000',conditionDescription:'New'},{conditionId:'3000',conditionDescription:'Used'},{conditionId:'4000',conditionDescription:'Very Good'}]};
const market=(mid:number,recommended?:number):any=>({valuation:{valuationMid:mid,recommendedListingPrice:recommended}});
test('one market value is the retained midpoint, not the selling price or a midpoint of rounded ranges',()=>{expect(marketValueAmount(market(12.34,15))).toBe(12.34);expect(marketValueAmount(null,12.34)).toBe(12.34);expect(marketValueAmount(market(0,15))).toBeNull();expect(marketValueAmount(null)).toBeNull();});
test('listing price is prefilled from actual research without inventing unavailable amounts',()=>{expect(automaticListingPrice(market(12.34,15.126))).toBe(15.13);expect(automaticListingPrice(market(12.34))).toBe(12.34);expect(automaticListingPrice(null)).toBe(0);expect(automaticListingPrice(market(-5,-20))).toBe(0);});
test('condition matches category metadata and never treats unknown or used stock as new',()=>{expect(automaticCondition(policy,'Used','1000')).toBe('3000');expect(automaticCondition(policy,'Very Good')).toBe('4000');expect(automaticCondition(policy,'Not assessed','1000')).toBe('');expect(automaticCondition(policy,'New sealed')).toBe('1000');expect(automaticCondition({...policy,itemConditions:[],itemConditionRequired:false},'Used')).toBe('');});
test('all supported known fields seed together while unknown and inferred claims stay blank',()=>{
 const aspects=normalizeAntiqueAspects([{name:'Brand',required:true},{name:'Model',required:true},{name:'Material',required:true},{name:'Year',required:false},{name:'MPN',required:true}]);
 const result:any={attributes:{_inferred_material:'Visual appearance'},attributesInferred:{material:'Silver'},attributesConfirmed:{brand:'Maker',model:'ABC',material:'Silver',year:2020},specialistAnalysis:undefined};
 const copy:any={item_specifics:{Brand:'Maker',Model:'ABC',Material:'Silver',MPN:'INVENTED'}};
 const fields=automaticSpecifics('collectibles',result,copy,aspects);
 expect(fields).toEqual(expect.arrayContaining([{name:'Brand',value:'Maker'},{name:'Model',value:'ABC'},{name:'Year',value:'2020'},{name:'MPN',value:''},{name:'Material',value:''}]));
 expect(fields.some(row=>row.value==='Silver'||row.value==='INVENTED')).toBe(false);
});
