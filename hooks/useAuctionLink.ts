import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { useAlert } from '@/template';
import { normaliseAuctionUrl } from '@/services/auctionLinkService';

export function useAuctionLink() {
  const { showAlert } = useAlert();
  const [opening, setOpening] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; },[]);
  const openAuction = useCallback(async (value: string | null | undefined) => {
    if (lock.current) return;
    let url: string;
    try { url = normaliseAuctionUrl(value); if (!url) throw new Error('Add an auction-page link first.'); }
    catch (error) { showAlert('Check the link', error instanceof Error ? error.message : 'Use an HTTPS auction-page link.'); return; }
    lock.current = true; setOpening(true);
    try { await Linking.openURL(url); }
    catch { if (alive.current) showAlert('Page could not open', 'Try again or open the link in your browser.'); }
    finally { lock.current = false; if (alive.current) setOpening(false); }
  }, [showAlert]);
  return { openAuction, opening };
}
