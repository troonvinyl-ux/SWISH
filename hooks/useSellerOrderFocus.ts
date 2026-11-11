import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSellerOrders } from './useSellerOrders';
export function useSellerOrderFocus(){const orders=useSellerOrders();useFocusEffect(useCallback(()=>{if(!orders.ready)return;void orders.refresh();const timer=setInterval(()=>void orders.refresh(),30000);return()=>clearInterval(timer);},[orders.scope,orders.ready,orders.refresh]));return orders;}
