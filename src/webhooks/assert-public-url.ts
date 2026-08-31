import { BadRequestException } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { isIPv4, isIPv6 } from 'net';

/**
 * Outbound webhook delivery previously did `fetch(subscription.url, ...)`
 * with no check on where that URL actually pointed. CreateWebhookSubscriptionDto
 * uses `@IsUrl({ require_tld: false })` — deliberately, so http://localhost
 * URLs work for local testing — which also means nothing stopped a
 * subscription from being pointed at http://169.254.169.254/ (cloud
 * instance metadata), an internal admin service on the VPC, etc. Creating
 * a subscription is admin-only today, but that's a role check, not a
 * network-layer guarantee — this closes the gap at the point requests
 * actually leave the server, which is where it belongs regardless of who's
 * allowed to configure a URL.
 *
 * Known residual gap: this resolves and checks the hostname's IP once, up
 * front. A DNS answer that changes between this check and the fetch a
 * moment later (DNS rebinding) isn't caught — closing that fully needs an
 * HTTP client that connects to a pinned IP rather than re-resolving the
 * hostname, which is a larger change than this fix.
 *
 * The private/loopback check is skipped outside production. webhooks/test-receiver
 * exists specifically so a subscription can point at this app's own
 * localhost address to verify the delivery chain in sandboxes that can't
 * reach a real external partner URL (see WebhooksController) — blocking
 * loopback unconditionally would break that. Production is the only
 * environment where an internal/loopback target is never legitimate.
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestException('Webhook URL is not a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Webhook URL must use http or https');
  }

  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const hostname = parsed.hostname;

  // Bare IP literals skip DNS resolution entirely.
  if (isIPv4(hostname) || isIPv6(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new BadRequestException(
        "Webhook URL can't point at a private, loopback, or link-local address",
      );
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new BadRequestException("Webhook URL's hostname doesn't resolve");
  }

  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new BadRequestException(
        "Webhook URL can't point at a private, loopback, or link-local address",
      );
    }
  }
}

function isPrivateOrReservedIp(address: string): boolean {
  if (isIPv4(address)) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
    if (a >= 224) return true; // multicast/reserved (224.0.0.0+)
    return false;
  }

  if (isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized === '::1') return true; // loopback
    if (normalized === '::') return true; // unspecified
    if (
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    )
      return true; // fe80::/10 link-local
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 unique local
    // IPv4-mapped (::ffff:a.b.c.d) — recurse on the embedded v4 address.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateOrReservedIp(mapped[1]);
    return false;
  }

  return false;
}
