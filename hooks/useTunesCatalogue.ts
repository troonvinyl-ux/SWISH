import { useContext } from 'react';
import { TunesContext } from '@/contexts/TunesContext';
export function useTunesCatalogue(){const value=useContext(TunesContext);if(!value)throw new Error('useTunesCatalogue must be used within TunesProvider');return value;}
