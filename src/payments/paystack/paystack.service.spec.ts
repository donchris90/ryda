import { PaystackService } from './paystack.service';

function fakeResponse(overrides: Partial<{ ok: boolean; status: number; json: any }> = {}) {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    json: jest.fn().mockResolvedValue(overrides.json ?? { status: true, data: [{ name: 'Test Bank', code: '001' }] }),
  } as any;
}

function build() {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'paystack.secretKey') return 'sk_test_fake123';
      if (key === 'paystack.baseUrl') return 'https://api.paystack.co';
      return undefined;
    }),
  };
  const service = new PaystackService(config as any);
  return { service };
}

describe('PaystackService - request retry logic', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any) => {
      fn();
      return 0 as any;
    }) as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('succeeds immediately with no retry when the first attempt works', async () => {
    fetchMock.mockResolvedValue(fakeResponse());
    const { service } = build();

    const result = await service.listBanks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });

  it('retries after a network-level failure (e.g. connection reset, timeout) and succeeds on the second attempt', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(fakeResponse({ json: { status: true, data: [{ name: 'Test Bank', code: '001' }] } }));
    const { service } = build();

    const result = await service.listBanks();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ name: 'Test Bank', code: '001' }]);
  });

  it('retries after a 5xx (Paystack server error) and succeeds on a later attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 503, json: { message: 'Service unavailable' } }))
      .mockResolvedValueOnce(fakeResponse());
    const { service } = build();

    const result = await service.listBanks();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toBeDefined();
  });

  it('does NOT retry a 4xx (client error, including a genuine "duplicate reference") - fails immediately since retrying an invalid request cannot succeed differently', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ ok: false, status: 400, json: { message: 'Duplicate Transaction Reference' } }),
    );
    const { service } = build();

    await expect(service.listBanks()).rejects.toThrow('Duplicate Transaction Reference');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting all attempts on persistent network failure, with a clear error', async () => {
    fetchMock.mockRejectedValue(new Error('persistent network failure'));
    const { service } = build();

    await expect(service.listBanks()).rejects.toThrow('Could not reach Paystack');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after exhausting all attempts on persistent 5xx, with the real Paystack error message', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 500, json: { message: 'Internal server error' } }));
    const { service } = build();

    await expect(service.listBanks()).rejects.toThrow('Internal server error');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
