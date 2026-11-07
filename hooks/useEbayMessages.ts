import { useContext } from 'react';
import { EbayMessagesContext } from '@/contexts/EbayMessagesContext';
export function useEbayMessages() {
  const context = useContext(EbayMessagesContext);
  if (!context) throw new Error('useEbayMessages must be used within EbayMessagesProvider');
  return context;
}
