import { useContext } from 'react';
import { SellerOrdersContext } from '@/contexts/SellerOrdersContext';
export function useSellerOrders(){const state=useContext(SellerOrdersContext);if(!state)throw new Error('SellerOrdersProvider is required.');return state;}
