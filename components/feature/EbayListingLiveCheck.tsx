import { memo } from 'react';
import { useEbayLiveContent } from '@/hooks/useEbayLiveContent';
import { EbayContentComparison } from './EbayContentComparison';
interface EbayListingLiveCheckProps { tenantId: string; listingId: string; externalListingId: string; title: string; description: string; price: number }
export const EbayListingLiveCheck = memo(function EbayListingLiveCheck(props: EbayListingLiveCheckProps) {
  const status = useEbayLiveContent(props.tenantId, props.listingId);
  return <EbayContentComparison {...props} live={status.live} busy={status.busy} error={status.error} onCheck={() => { void status.check(); }}/>;
});
