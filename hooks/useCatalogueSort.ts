import { useCallback, useMemo, useState } from 'react';
import { sortCatalogue, type CatalogueSort, type CatalogueSortValues } from '@/services/catalogueSortService';
export function useCatalogueSort<T>(items:readonly T[],scope:string,values:(item:T)=>CatalogueSortValues) {
 const [selection,setSelection]=useState<{scope:string;order:CatalogueSort}>({scope:'',order:'newest'});
 const order=selection.scope===scope?selection.order:'newest';
 const setOrder=useCallback((next:CatalogueSort)=>setSelection({scope,order:next}),[scope]);
 const sorted=useMemo(()=>sortCatalogue(items,order,values),[items,order,values]);
 return {order,setOrder,sorted};
}
