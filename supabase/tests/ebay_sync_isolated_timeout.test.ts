import { isIsolatedGetItemTimeout } from '../functions/_shared/ebaySyncPolicy.ts';

Deno.test('only a real bounded GetItem read transport deadline is isolated', () => {
 const timeout=new Error('The operation timed out');timeout.name='TimeoutError';
 if(!isIsolatedGetItemTimeout(timeout))throw new Error('Transport timeout should be isolated to one listing');
 for(const failure of [
  new Error('eBay Trading HTTP 429; rate limited'),
  new Error('eBay Trading HTTP 503; unavailable'),
  new Error('REQUIRES_REAUTH: mismatched seller'),
  new Error('SWISH status readback unavailable'),
  new Error('Unknown network failure'),
  new Error('GetItem availability incomplete; statuses preserved'),
  null,
  {name:'TimeoutError'},
 ])if(isIsolatedGetItemTimeout(failure))throw new Error('Unsafe failure was misclassified as an isolated timeout');
});
Deno.test('explicit AbortError without confirmed per-item deadline remains a stop',()=>{
 const error=new Error('request aborted');error.name='AbortError';
 if(isIsolatedGetItemTimeout(error))throw new Error('Unknown abort must stop the sync');
});
