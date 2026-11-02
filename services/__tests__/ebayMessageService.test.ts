jest.mock('@/template', () => ({ getSupabaseClient: jest.fn() }));

import { getSupabaseClient } from '@/template';
import { getEbayMessageBody, updateEbayMessageFlag } from '@/services/ebayMessageService';

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


describe('tenant-scoped eBay inbox flags', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates read/archive flags with both local message ID and tenant ID', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'message-1' }, error: null });
    const select = jest.fn().mockReturnValue({ maybeSingle });
    const tenantEq = jest.fn().mockReturnValue({ select });
    const messageEq = jest.fn().mockReturnValue({ eq: tenantEq });
    const update = jest.fn().mockReturnValue({ eq: messageEq });
    const from = jest.fn().mockReturnValue({ update });
    (getSupabaseClient as jest.Mock).mockReturnValue({ from });

    const result = await updateEbayMessageFlag('tenant-1', 'message-1', 'is_read');

    expect(result).toEqual({ error: null });
    expect(from).toHaveBeenCalledWith('ebay_messages');
    expect(update).toHaveBeenCalledWith({ is_read: true });
    expect(messageEq).toHaveBeenCalledWith('id', 'message-1');
    expect(tenantEq).toHaveBeenCalledWith('tenant_id', 'tenant-1');
  });

  test('does not report a flag update when the tenant-owned row was not confirmed', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    const select = jest.fn().mockReturnValue({ maybeSingle });
    const tenantEq = jest.fn().mockReturnValue({ select });
    const messageEq = jest.fn().mockReturnValue({ eq: tenantEq });
    const update = jest.fn().mockReturnValue({ eq: messageEq });
    const from = jest.fn().mockReturnValue({ update });
    (getSupabaseClient as jest.Mock).mockReturnValue({ from });

    expect(await updateEbayMessageFlag('tenant-1', 'message-1', 'is_archived')).toEqual({
      error: 'Message change was not confirmed.',
    });
  });
});
