jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));

import { getSupabaseClient } from '@/template';
import { getEbayMessageBody } from '@/services/ebayMessageService';

describe('tenant-scoped eBay message body client service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('requests a full message body using the local message row ID and tenant', async () => {
    const invoke = jest.fn().mockResolvedValue({
      data: { success: true, body: 'Hello from the buyer.', cached: true },
      error: null,
    });
    (getSupabaseClient as jest.Mock).mockReturnValue({ functions: { invoke } });

    const result = await getEbayMessageBody('tenant-1', 'local-message-1');

    expect(result).toEqual({ body: 'Hello from the buyer.', error: null });
    expect(invoke).toHaveBeenCalledWith('swish-ebay-messages', {
      body: { messageId: 'local-message-1', route: 'get_message_body', tenantId: 'tenant-1' },
    });
  });

  test('rejects a missing tenant or message before making a request', async () => {
    const invoke = jest.fn();
    (getSupabaseClient as jest.Mock).mockReturnValue({ functions: { invoke } });

    expect(await getEbayMessageBody('', 'message-1')).toEqual({
      body: null,
      error: 'Business account is required.',
    });
    expect(await getEbayMessageBody('tenant-1', '')).toEqual({
      body: null,
      error: 'Message is required.',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  test('does not treat an unconfirmed provider response as a loaded message body', async () => {
    const invoke = jest.fn().mockResolvedValue({
      data: { success: false, error: 'eBay did not return the requested message body.' },
      error: null,
    });
    (getSupabaseClient as jest.Mock).mockReturnValue({ functions: { invoke } });

    expect(await getEbayMessageBody('tenant-1', 'message-1')).toEqual({
      body: null,
      error: 'eBay did not return the requested message body.',
    });
  });
});
