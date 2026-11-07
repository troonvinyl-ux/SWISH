import { useCallback, useRef, useState } from 'react';
import { useAlert } from '@/template';
import { deleteItem } from '@/services/itemService';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { useApp } from './useApp';
import { useModuleOperationGuard } from './useModuleOperationGuard';
export interface RemovableInventoryItem { id: string; title: string; specialistId: string; tenantId?: string; status?: string; }
/** Every niche shares explicit confirmation and a fresh server deletion guard. Never ends eBay here. */
export function useInventoryRemoval(onDeleted: (itemId: string) => void) {
 const guard = useModuleOperationGuard();
 const { triggerInventoryReload } = useApp();
 const { showAlert } = useAlert();
 const running = useRef(false);
 const [operation, setOperation] = useState<{ scope: string; itemId: string } | null>(null);
 const requestDelete = useCallback((item: RemovableInventoryItem) => {
  const scope = guard.scope;
  if (running.current || !guard.isCurrent(scope)) return;
  if ((item.tenantId && item.tenantId !== guard.tenantId) || resolveProductionNiche(item.specialistId) !== guard.nicheId) {
   showAlert('Deletion unavailable', 'Open this item in its original account and specialist workspace.'); return;
  }
  if (['listed','active','sold','fulfilled','completed'].includes(item.status ?? '')) {
   showAlert('Item retained', 'End every live eBay listing first. Sold items and order history cannot be deleted.'); return;
  }
  showAlert('Delete inventory item?', `Permanently delete “${item.title}” and its saved drafts from SWISH? This cannot be undone. No eBay listing will be ended by this action. Sale and order history are protected; stored original photo files are retained.`, [
   { text: 'Cancel', style: 'cancel' },
   { text: 'Delete item', style: 'destructive', onPress: async () => {
    if (running.current || !guard.isCurrent(scope)) return;
    running.current = true; setOperation({ scope, itemId: item.id });
    try {
     const result = await deleteItem(item.id, guard.tenantId);
     if (!guard.isCurrent(scope)) return;
     if (result.error) { showAlert('Item not deleted', result.error); return; }
     triggerInventoryReload(); onDeleted(item.id);
    } finally { running.current = false; if (guard.isCurrent(scope)) setOperation(null); }
   } },
  ]);
 }, [guard.scope, guard.tenantId, guard.nicheId, guard.isCurrent, showAlert, triggerInventoryReload, onDeleted]);
 return { requestDelete, busyId: guard.ready && operation?.scope === guard.scope ? operation.itemId : null };
}
