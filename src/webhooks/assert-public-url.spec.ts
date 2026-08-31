import { assertPublicUrl } from './assert-public-url';

describe('assertPublicUrl', () => {
  it('rejects non-http(s) protocols regardless of environment', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertPublicUrl('ftp://example.com/x')).rejects.toThrow();
  });

  it('rejects malformed URLs regardless of environment', async () => {
    await expect(assertPublicUrl('not a url')).rejects.toThrow();
  });

  describe('in production', () => {
    const originalEnv = process.env.NODE_ENV;
    beforeAll(() => {
      process.env.NODE_ENV = 'production';
    });
    afterAll(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('rejects loopback IP literals', async () => {
      await expect(assertPublicUrl('http://127.0.0.1/hook')).rejects.toThrow();
      await expect(assertPublicUrl('http://[::1]/hook')).rejects.toThrow();
    });

    it('rejects the cloud metadata address', async () => {
      await expect(
        assertPublicUrl('http://169.254.169.254/latest/meta-data/'),
      ).rejects.toThrow();
    });

    it('rejects RFC1918 private ranges', async () => {
      await expect(assertPublicUrl('http://10.0.0.5/hook')).rejects.toThrow();
      await expect(assertPublicUrl('http://172.16.0.1/hook')).rejects.toThrow();
      await expect(
        assertPublicUrl('http://192.168.1.1/hook'),
      ).rejects.toThrow();
    });

    it('rejects IPv4-mapped IPv6 loopback', async () => {
      await expect(
        assertPublicUrl('http://[::ffff:127.0.0.1]/hook'),
      ).rejects.toThrow();
    });

    it('rejects localhost (resolves to loopback)', async () => {
      await expect(assertPublicUrl('http://localhost/hook')).rejects.toThrow();
    });

    it('allows a public IP literal', async () => {
      await expect(
        assertPublicUrl('http://93.184.216.34/hook'),
      ).resolves.toBeUndefined();
    });
  });

  describe('outside production', () => {
    const originalEnv = process.env.NODE_ENV;
    beforeAll(() => {
      process.env.NODE_ENV = 'test';
    });
    afterAll(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('allows localhost, so webhooks/test-receiver keeps working in dev/sandbox', async () => {
      await expect(
        assertPublicUrl('http://localhost:3000/webhooks/test-receiver'),
      ).resolves.toBeUndefined();
    });
  });
});
