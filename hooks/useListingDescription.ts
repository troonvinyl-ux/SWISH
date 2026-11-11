import { useCallback, useMemo, useState } from 'react';
import { editListingDescription, projectListingDescription, restoreFlattenedDescription, type DescriptionDetail } from '@/services/listingDescriptionService';
export function useListingDescription(description: string, specifics: DescriptionDetail[], onChange: (value: string) => void) {
  const [preview, setPreview] = useState(false);
  const model = useMemo(() => projectListingDescription(description), [description]);
  const restored = useMemo(() => restoreFlattenedDescription(description, specifics), [description, specifics]);
  const changeText = useCallback((text: string) => onChange(editListingDescription(description, text)), [description, onChange]);
  const restore = useCallback(() => { if (restored) { onChange(restored); setPreview(true); } }, [restored, onChange]);
  return { model, preview, showPreview: () => setPreview(true), showEditor: () => setPreview(false), changeText, canRestore: restored !== null, restore };
}
