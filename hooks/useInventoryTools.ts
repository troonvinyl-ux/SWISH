import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useMasterInventory } from './useMasterInventory';
import { useModuleOperationGuard } from './useModuleOperationGuard';
import { useApp } from './useApp';
import { useAlert } from '@/template';
import { publishInventoryBatch } from '@/services/inventoryToolsService';
export function useInventoryTools() {
 const inventory = useMasterInventory();
 const guard = useModuleOperationGuard();
 const { triggerInventoryReload, businessConfig } = useApp();
 const { showAlert } = useAlert();
 const [mode, setMode] = useState<'stock' | 'draft' | 'all'>('stock');
 const [modal, setModal] = useState<'value' | 'identify' | null>(null);
 const [progress, setProgress] = useState<{current:number;total:number;done:number;failed:number} | null>(null);
 const [running, setRunning] = useState(false);
 const busy = useRef(false);
 const items = useMemo(() => mode === 'all' ? inventory.allItems : inventory.views[mode], [inventory.allItems, inventory.views, mode]);
 const actionable = guard.ready && inventory.hasSnapshot && !inventory.error && !inventory.loading && !inventory.syncing && !running;
 useEffect(() => { setMode('stock'); setModal(null); setProgress(null); setRunning(false); }, [inventory.scope]);
 const closeModal = useCallback(() => {
  setModal(null); setProgress(null);
  if (guard.isCurrent(guard.scope)) { triggerInventoryReload(); void inventory.reload(); }
 }, [guard.scope, guard.isCurrent, triggerInventoryReload, inventory.reload]);
 const openModal = useCallback((value: 'value' | 'identify') => {
  if (actionable && mode === 'stock' && items.length) setModal(value);
 }, [actionable, mode, items.length]);
 const publish = useCallback(() => {
  if (!actionable || mode === 'all' || !items.length || busy.current) return;
  const scope = guard.scope, selected = [...items], selectedMode = mode;
  showAlert(selectedMode === 'stock' ? 'List this stock on eBay?' : 'Publish these drafts?', `Process ${selected.length} ${selectedMode} items one at a time. Each result is checked; failed or uncertain items are not automatically retried.`, [
   { text: 'Cancel', style: 'cancel' },
   { text: 'Confirm publishing', onPress: async () => {
    if (!guard.isCurrent(scope) || busy.current) return;
    busy.current = true; setRunning(true);
    try {
     const result = await publishInventoryBatch(guard.tenantId, guard.nicheId ?? '', selectedMode, selected, () => guard.isCurrent(scope));
     if (!guard.isCurrent(scope)) return;
     triggerInventoryReload(); await inventory.reload();
     showAlert('Batch finished', `${result.live} of ${result.total} processed items confirmed live on eBay. Check remaining drafts before retrying.`);
    } catch (cause) {
     if (guard.isCurrent(scope)) showAlert('Batch stopped', cause instanceof Error ? cause.message : 'Check eBay and reload before retrying.');
    } finally { busy.current = false; if (guard.isCurrent(scope)) setRunning(false); }
   } },
  ]);
 }, [actionable, mode, items, guard.scope, guard.tenantId, guard.nicheId, guard.isCurrent, showAlert, triggerInventoryReload, inventory.reload]);
 return { inventory, mode, setMode, items, actionable, running, modal, progress, setProgress, closeModal, openModal, publish, tenantId: guard.tenantId, autonomousMode: businessConfig?.autoValue === true || businessConfig?.automationLevel === 'autonomous' };
}
