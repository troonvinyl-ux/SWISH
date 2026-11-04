import { useMemo, useState, useCallback, useEffect } from 'react';
import { useApp } from './useApp';
import { useInventory } from './useInventory';
import { specialistReviewSummary } from '@/services/specialistWorkspaceService';
import { resolveProductionNiche, isRouteAllowedForModule, isRouteAllowedForBuild } from '@/services/nicheRouting';
import type { Item } from '@/services/itemService';
export function useSpecialistWorkspace(){
  const app=useApp();const inventory=useInventory();
  const id=resolveProductionNiche(app.fixedNicheId??app.activeNicheId);
  const scope=`${app.tenant?.id}:${id}`;
  const [selected,setSelected]=useState<Item|null>(null);const [selectedScope,setSelectedScope]=useState('');
  useEffect(()=>{setSelected(null);setSelectedScope(scope);},[scope]);
  const summary=useMemo(()=>id?specialistReviewSummary(id):null,[id]);
  const tools=summary?.tools.filter(tool=>app.fixedNicheId?isRouteAllowedForBuild(tool.route,id):isRouteAllowedForModule(tool.route,id))??[];
  const select=useCallback((item:Item)=>{setSelected(item);setSelectedScope(scope);},[scope]);
  const updated=useCallback((patch:Partial<Item>)=>{setSelected(previous=>previous?{...previous,...patch}:null);},[]);
  return {id,summary,tools,items:inventory.items as Item[],loading:inventory.loading,error:inventory.syncError,reload:inventory.reload,selected:selectedScope===scope?selected:null,select,updated,accent:app.activeNiche.color};
}
