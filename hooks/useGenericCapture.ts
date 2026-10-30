import { useState, useRef } from 'react';
import { useApp } from './useApp';
import { useAlert } from '@/template';
import { captureFromCamera, pickFromLibrary, identifyItemWithAI, saveIdentifiedItem, uploadItemImages, updateItemMedia, type CapturedImage, type AIIdentificationResult } from '@/services/aiIdentificationService';
import { SPECIALISTS } from '@/constants/specialists';
export function useGenericCapture() {
  const { tenant, activeNiche, triggerInventoryReload } = useApp(); const { showAlert } = useAlert();
  const [images, setImages] = useState<CapturedImage[]>([]); const [result, setResult] = useState<AIIdentificationResult | null>(null);
  const [busy, setBusy] = useState(false); const [savedId, setSavedId] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const scope = `${tenant?.id}:${activeNiche.id}`; const currentScope = useRef(scope); currentScope.current = scope;
  const slots = SPECIALISTS[activeNiche.defaultSpecialist].captureRequirements;
  const capture = async (slotId: string, library: boolean) => {
    const capturedScope = scope; const slot = slots.find(slot => slot.id === slotId);
    if (!slot || busy) return;
    const image = library ? await pickFromLibrary(slot.id, slot.label) : await captureFromCamera();
    if (image && currentScope.current === capturedScope) setImages(previous => [...previous.filter(img => img.slotId !== slotId), { ...image, slotId, slotLabel: slot.label }]);
  };
  const identify = async () => {
    if (!tenant || busy || !images.length) return;
    setBusy(true); setError(null); const capturedScope = scope;
    try { const response = await identifyItemWithAI(images, activeNiche.defaultSpecialist, undefined, undefined, { tenantId: tenant.id });
      if (currentScope.current !== capturedScope) return;
      setResult(response.result); setError(response.error);
    } finally { setBusy(false); }
  };
  const save = async () => {
    if (!tenant || !result || busy || savedId) return;
    setBusy(true); setError(null); const capturedScope = scope;
    try {
      const response = await saveIdentifiedItem(tenant.id, result, { mediaUris: [] });
      if (response.error || !response.item) { setError(response.error ?? 'Item was not saved'); return; }
      const id = response.item.id;
      const upload = await uploadItemImages(id, images);
      if (upload.urls.length) await updateItemMedia(tenant.id, id, upload.urls);
      if (currentScope.current !== capturedScope) return;
      setSavedId(id); triggerInventoryReload();
      if (upload.errors.length) showAlert('Photos Incomplete', 'The inventory record was saved, but some photos could not be uploaded. Keep these photos and retry from the item screen.');
    } catch (e: any) { setError(e?.message ?? 'Save failed'); }
    finally { setBusy(false); }
  };
  return { activeNiche, slots, images, result, busy, savedId, error, capture, identify, save };
}
