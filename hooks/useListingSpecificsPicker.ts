import { useCallback, useMemo, useState } from 'react';
import { availableSpecificFields, suggestedSpecificValues, type ListingAspectSummary, type ListingSpecificValue } from '@/services/listingSpecificsPresentationService';

interface PickerOptions {
  aspects: ListingAspectSummary[];
  specifics: ListingSpecificValue[];
  disabled: boolean;
  onChange: (specifics: ListingSpecificValue[]) => void;
}
type PickerTarget = { kind: 'field' } | { kind: 'value'; index: number; name: string };
export function useListingSpecificsPicker({ aspects, specifics, disabled, onChange }: PickerOptions) {
  const [target, setTarget] = useState<PickerTarget | null>(null);
  const [query, setQuery] = useState('');
  const close = useCallback(() => { setTarget(null); setQuery(''); }, []);
  const openFields = useCallback(() => { if (!disabled && specifics.length < 25) { setQuery(''); setTarget({ kind: 'field' }); } }, [disabled, specifics.length]);
  const openValues = useCallback((index: number) => {
    const specific = specifics[index];
    if (!disabled && specific) { setQuery(''); setTarget({ kind: 'value', index, name: specific.name }); }
  }, [disabled, specifics]);
  const aspect = target?.kind === 'value' ? aspects.find(row => row.name.trim().toLowerCase() === target.name.trim().toLowerCase()) : undefined;
  const suggestions = useMemo(() => target?.kind === 'value' ? suggestedSpecificValues(aspect, query) : { values: target ? availableSpecificFields(aspects, specifics, query) : [], hasMore: false }, [target, aspect, query, aspects, specifics]);
  const choose = useCallback((value: string) => {
    if (disabled || !target) return;
    if (target.kind === 'field') {
      if (specifics.length >= 25 || specifics.some(row => row.name.trim().toLowerCase() === value.trim().toLowerCase())) return;
      onChange([...specifics, { name: value, value: '' }]);
    } else {
      if (specifics[target.index]?.name !== target.name) { close(); return; }
      onChange(specifics.map((row, index) => index === target.index ? { ...row, value } : row));
    }
    close();
  }, [disabled, target, specifics, onChange, close]);
  const addCustom = useCallback(() => {
    if (disabled || specifics.length >= 25) return;
    onChange([...specifics, { name: '', value: '' }]); close();
  }, [disabled, specifics, onChange, close]);
  return { target, query, setQuery, suggestions, close, openFields, openValues, choose, addCustom };
}
