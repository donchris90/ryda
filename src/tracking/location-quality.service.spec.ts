import { LocationQualityService } from './location-quality.service';

function build(configOverrides: Record<string, any> = {}) {
  const values: Record<string, any> = {
    'locationQuality.maxAccuracyMeters': 100,
    'locationQuality.maxFixAgeSeconds': 120,
    'locationQuality.duplicateStreakThreshold': 20,
    ...configOverrides,
  };
  const config = { get: jest.fn((key: string) => values[key]) };
  return new LocationQualityService(config as any);
}

const NOW = new Date('2026-09-03T12:00:00Z');

describe('LocationQualityService.assess()', () => {
  it('accepts a clean reading with no previous position and no issues', () => {
    const service = build();
    const result = service.assess(null, { lat: 6.5, lng: 3.3 }, NOW);

    expect(result.accept).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags poor accuracy but still accepts the reading - rejecting outright would leave the position even more stale', () => {
    const service = build();
    const result = service.assess(null, { lat: 6.5, lng: 3.3, accuracy: 500 }, NOW);

    expect(result.accept).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining('poor_accuracy')]));
  });

  it('does not flag accuracy within the configured threshold', () => {
    const service = build();
    const result = service.assess(null, { lat: 6.5, lng: 3.3, accuracy: 50 }, NOW);

    expect(result.issues).toEqual([]);
  });

  it('flags a stale fix (client-reported timestamp far in the past) but still accepts it', () => {
    const service = build();
    const fixTimestamp = NOW.getTime() - 10 * 60_000; // 10 minutes old, threshold is 120s
    const result = service.assess(null, { lat: 6.5, lng: 3.3, fixTimestamp }, NOW);

    expect(result.accept).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining('stale_fix')]));
  });

  it('flags a fix timestamped in the future (clock skew or tampering) as stale too', () => {
    const service = build();
    const fixTimestamp = NOW.getTime() + 5 * 60_000;
    const result = service.assess(null, { lat: 6.5, lng: 3.3, fixTimestamp }, NOW);

    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining('stale_fix')]));
  });

  it('rejects a genuinely impossible speed jump - this must not become the driver live position', () => {
    const service = build();
    const previous = { lat: 6.5244, lng: 3.3792, at: new Date(NOW.getTime() - 60_000) }; // 1 minute ago
    // ~500km away in 1 minute is obviously impossible for any vehicle
    const result = service.assess(previous, { lat: 10.5, lng: 7.4 }, NOW);

    expect(result.accept).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining('impossible_speed')]));
    expect(result.impliedSpeedKmh).toBeGreaterThan(250);
  });

  it('accepts a genuinely plausible movement between two readings', () => {
    const service = build();
    const previous = { lat: 6.5244, lng: 3.3792, at: new Date(NOW.getTime() - 5 * 60_000) }; // 5 minutes ago
    // A few km away in 5 minutes - ordinary city driving
    const result = service.assess(previous, { lat: 6.54, lng: 3.39 }, NOW);

    expect(result.accept).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('respects a genuinely different configured accuracy threshold - not hard-coded', () => {
    const service = build({ 'locationQuality.maxAccuracyMeters': 10 });
    const result = service.assess(null, { lat: 6.5, lng: 3.3, accuracy: 50 }, NOW);

    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining('poor_accuracy')]));
  });
});

describe('LocationQualityService.isDuplicateOf()', () => {
  it('returns false when there is no previous position', () => {
    const service = build();
    expect(service.isDuplicateOf(null, { lat: 6.5, lng: 3.3 })).toBe(false);
  });

  it('returns true for an exact coordinate match', () => {
    const service = build();
    expect(service.isDuplicateOf({ lat: 6.5, lng: 3.3 }, { lat: 6.5, lng: 3.3 })).toBe(true);
  });

  it('returns false for even a tiny genuine change', () => {
    const service = build();
    expect(service.isDuplicateOf({ lat: 6.5, lng: 3.3 }, { lat: 6.50001, lng: 3.3 })).toBe(false);
  });
});

describe('LocationQualityService.isDuplicateStreakNotable()', () => {
  it('is true only exactly at the configured threshold, not every call past it', () => {
    const service = build({ 'locationQuality.duplicateStreakThreshold': 5 });

    expect(service.isDuplicateStreakNotable(4)).toBe(false);
    expect(service.isDuplicateStreakNotable(5)).toBe(true);
    expect(service.isDuplicateStreakNotable(6)).toBe(false); // fires once, not on every subsequent duplicate
  });
});
