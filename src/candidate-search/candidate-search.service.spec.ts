import { CandidateSearchService } from './candidate-search.service';
import { DispatchDomain, DispatchMode } from './candidate-search.types';
import { DriverApprovalStatus, DriverAvailability } from '../common/enums/driver-status.enum';
import { VehicleCategory, VehicleStatus } from '../common/enums/vehicle.enum';
import { DriverLevel } from '../common/enums/driver-level.enum';
import { RideCategory } from '../common/enums/ride.enum';
import { DeliveryVehicleType } from '../logistics/entities/delivery-order.entity';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';

const LAGOS = { lat: 6.5244, lng: 3.3792 };

function profile(overrides: Partial<DriverProfile> = {}): DriverProfile {
  return {
    id: `profile-${overrides.userId ?? 'x'}`,
    userId: 'driver-x',
    approvalStatus: DriverApprovalStatus.APPROVED,
    availability: DriverAvailability.ONLINE,
    activeVehicleId: 'vehicle-x',
    rating: '4.80',
    level: DriverLevel.STANDARD,
    ...overrides,
  } as DriverProfile;
}

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'vehicle-x',
    category: VehicleCategory.CAR,
    status: VehicleStatus.ACTIVE,
    approvedRideCategories: null,
    ...overrides,
  } as Vehicle;
}

/** In-memory fake mirroring the LiveDriverIndexService.searchNearby() surface. */
class FakeLiveDriverIndex {
  entries: Array<{ driverUserId: string; distanceKm: number; vehicleId: string | null }> = [];

  async searchNearby(_center: { lat: number; lng: number }, radiusKm: number) {
    return this.entries
      .filter((e) => e.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .map((e) => ({
        driverUserId: e.driverUserId,
        driverProfileId: `profile-${e.driverUserId}`,
        vehicleId: e.vehicleId,
        lat: LAGOS.lat,
        lng: LAGOS.lng,
        updatedAtMs: Date.now(),
        distanceKm: e.distanceKm,
      }));
  }
}

/** Minimal fake TypeORM repository — just the `.find({ where: { X: In([...]) } })` shape this service uses. */
class FakeRepo<T extends { id?: string; userId?: string }> {
  rows: T[] = [];

  async find({ where }: { where: Record<string, any> }) {
    const key = Object.keys(where)[0];
    const inClause = where[key];
    const values: string[] = inClause?._value ?? inClause?.value ?? inClause;
    return this.rows.filter((r) => values.includes((r as any)[key]));
  }
}

function fakeConfig(overrides: Record<string, number> = {}) {
  const defaults: Record<string, number> = {
    'dispatch.initialRadiusKm': 8,
    'dispatch.maxRadiusKm': 15,
    'dispatch.radiusStepKm': 4,
    'dispatch.candidateFetchLimit': 50,
    ...overrides,
  };
  return { get: (key: string) => defaults[key] } as any;
}

// TypeORM's `In()` helper wraps values in a FindOperator; the FakeRepo
// above only needs the underlying array back out, so replicate just
// enough of that shape without importing the real TypeORM internals.
jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    In: (values: string[]) => ({ _value: values }),
  };
});

/** Minimal fake mirroring the handful of prom-client method shapes CandidateSearchService calls. */
function fakeMetrics() {
  return {
    candidateSearchDurationSeconds: { startTimer: jest.fn(() => jest.fn()) },
    candidateSearchCandidateCount: { observe: jest.fn() },
    candidateSearchRadiusExpansionTotal: { inc: jest.fn() },
  } as any;
}

describe('CandidateSearchService', () => {
  let liveDriverIndex: FakeLiveDriverIndex;
  let driversRepo: FakeRepo<DriverProfile>;
  let vehiclesRepo: FakeRepo<Vehicle>;
  let service: CandidateSearchService;

  beforeEach(() => {
    liveDriverIndex = new FakeLiveDriverIndex();
    driversRepo = new FakeRepo<DriverProfile>();
    vehiclesRepo = new FakeRepo<Vehicle>();
    service = new CandidateSearchService(
      liveDriverIndex as any,
      driversRepo as any,
      vehiclesRepo as any,
      fakeConfig(),
      fakeMetrics(),
    );
  });

  function addOnlineDriver(userId: string, distanceKm: number, opts: Partial<DriverProfile & Vehicle> = {}) {
    liveDriverIndex.entries.push({ driverUserId: userId, distanceKm, vehicleId: `veh-${userId}` });
    driversRepo.rows.push(
      profile({
        userId,
        id: `profile-${userId}`,
        activeVehicleId: `veh-${userId}`,
        approvalStatus: opts.approvalStatus ?? DriverApprovalStatus.APPROVED,
        availability: opts.availability ?? DriverAvailability.ONLINE,
        rating: opts.rating ?? '4.80',
        level: opts.level ?? DriverLevel.STANDARD,
      }),
    );
    vehiclesRepo.rows.push(
      vehicle({
        id: `veh-${userId}`,
        category: opts.category ?? VehicleCategory.CAR,
        status: opts.status ?? VehicleStatus.ACTIVE,
        approvedRideCategories: opts.approvedRideCategories ?? null,
      }),
    );
  }

  const rideInput = (overrides: Partial<Parameters<CandidateSearchService['search']>[0]> = {}) => ({
    pickup: LAGOS,
    domain: DispatchDomain.RIDE,
    mode: DispatchMode.MANUAL,
    rideCategory: RideCategory.ECONOMY,
    ...overrides,
  });

  it('returns a candidate inside the initial radius', async () => {
    addOnlineDriver('near', 3);

    const result = await service.search(rideInput());

    expect(result.candidates.map((c) => c.driverUserId)).toEqual(['near']);
    expect(result.radiusUsedKm).toBe(8);
    expect(result.roundsAttempted).toBe(1);
  });

  it('excludes a candidate outside every configured radius round', async () => {
    addOnlineDriver('far-away', 50); // beyond max radius of 15

    const result = await service.search(rideInput());

    expect(result.candidates).toHaveLength(0);
    expect(result.radiusUsedKm).toBe(15); // still expanded all the way out looking
    expect(result.roundsAttempted).toBe(3); // 8, 12, 15
  });

  it('expands progressively through 8 -> 12 -> 15 by default', async () => {
    addOnlineDriver('only-at-13km', 13);

    const result = await service.search(rideInput());

    expect(result.candidates.map((c) => c.driverUserId)).toEqual(['only-at-13km']);
    expect(result.radiusUsedKm).toBe(15);
    expect(result.roundsAttempted).toBe(3);
  });

  it('stops expanding as soon as minCandidates is satisfied', async () => {
    addOnlineDriver('at-3km', 3);
    addOnlineDriver('at-13km', 13); // would also be found, but shouldn't be needed

    const result = await service.search(rideInput({ minCandidates: 1 }));

    expect(result.roundsAttempted).toBe(1);
    expect(result.candidates.map((c) => c.driverUserId)).toEqual(['at-3km']);
  });

  it('finds a candidate only after radius expansion', async () => {
    addOnlineDriver('at-10km', 10); // not in round 1 (8km), found in round 2 (12km)

    const result = await service.search(rideInput());

    expect(result.roundsAttempted).toBe(2);
    expect(result.candidates.map((c) => c.driverUserId)).toEqual(['at-10km']);
  });

  it('excludes a driver that is not ONLINE in Postgres (defense in depth against a stale index entry)', async () => {
    addOnlineDriver('went-on-trip', 3, { availability: DriverAvailability.ON_TRIP });

    const result = await service.search(rideInput());

    expect(result.candidates).toHaveLength(0);
  });

  it('excludes a driver that is not APPROVED', async () => {
    addOnlineDriver('unapproved', 3, { approvalStatus: DriverApprovalStatus.SUSPENDED });

    const result = await service.search(rideInput());

    expect(result.candidates).toHaveLength(0);
  });

  it('excludes an incompatible ride-category vehicle', async () => {
    addOnlineDriver('motorbike-driver', 3, { category: VehicleCategory.MOTORCYCLE });

    const result = await service.search(rideInput({ rideCategory: RideCategory.ECONOMY }));

    expect(result.candidates).toHaveLength(0);
  });

  it('includes an admin-approved-override vehicle for a ride category it would not otherwise match', async () => {
    addOnlineDriver('nice-suv', 3, {
      category: VehicleCategory.SUV,
      approvedRideCategories: [RideCategory.COMFORT],
    });

    const result = await service.search(rideInput({ rideCategory: RideCategory.COMFORT }));

    expect(result.candidates.map((c) => c.driverUserId)).toEqual(['nice-suv']);
  });

  it('excludes an incompatible courier vehicle type (bike cannot cover a van-sized request)', async () => {
    addOnlineDriver('biker', 3, { category: VehicleCategory.MOTORCYCLE });

    const result = await service.search({
      pickup: LAGOS,
      domain: DispatchDomain.COURIER,
      mode: DispatchMode.AUTO,
      deliveryVehicleType: DeliveryVehicleType.VAN,
    });

    expect(result.candidates).toHaveLength(0);
  });

  it('includes a compatible courier vehicle (van covers a bike-sized request — permissive matching)', async () => {
    addOnlineDriver('van-driver', 3, { category: VehicleCategory.VAN });

    const result = await service.search({
      pickup: LAGOS,
      domain: DispatchDomain.COURIER,
      mode: DispatchMode.AUTO,
      deliveryVehicleType: DeliveryVehicleType.BIKE,
    });

    expect(result.candidates.map((c) => c.driverUserId)).toEqual(['van-driver']);
  });

  it('does not mix ride and courier category systems: a ride search never accepts a deliveryVehicleType-only match and vice versa', async () => {
    addOnlineDriver('car-driver', 3, { category: VehicleCategory.CAR });

    // Same driver would be eligible for a RIDE(ECONOMY) search...
    const rideResult = await service.search(rideInput());
    expect(rideResult.candidates.map((c) => c.driverUserId)).toEqual(['car-driver']);

    // ...and the courier search path never even looks at rideCategory —
    // a request missing the field it actually needs (deliveryVehicleType) throws
    // rather than silently falling back to ride-category logic.
    await expect(
      service.search({
        pickup: LAGOS,
        domain: DispatchDomain.COURIER,
        mode: DispatchMode.AUTO,
      } as any),
    ).rejects.toThrow(/deliveryVehicleType is required/);
  });

  it('returns no candidates when none exist anywhere in range', async () => {
    const result = await service.search(rideInput());

    expect(result.candidates).toEqual([]);
    expect(result.radiusUsedKm).toBe(15);
    expect(result.roundsAttempted).toBe(3);
  });

  it('honors excludeDriverUserIds even for an otherwise-eligible driver', async () => {
    addOnlineDriver('already-tried', 2);

    const result = await service.search(rideInput({ excludeDriverUserIds: ['already-tried'] }));

    expect(result.candidates).toHaveLength(0);
  });

  it('MANUAL and AUTO return the exact same eligible pool for identical inputs', async () => {
    addOnlineDriver('a', 2);
    addOnlineDriver('b', 5);
    addOnlineDriver('c', 11);

    const manual = await service.search(rideInput({ mode: DispatchMode.MANUAL, minCandidates: 10 }));
    const auto = await service.search(rideInput({ mode: DispatchMode.AUTO, minCandidates: 10 }));

    expect(manual.candidates.map((c) => c.driverUserId)).toEqual(auto.candidates.map((c) => c.driverUserId));
  });

  it('never scans PostgreSQL for more than the drivers the geo index actually returned', async () => {
    addOnlineDriver('a', 2);
    addOnlineDriver('b', 5);
    // Simulate an unrelated online driver sitting in Postgres who was never
    // returned by the geo index (e.g. genuinely far away) — this must not
    // show up, proving eligibility filtering is scoped to geo candidates only.
    driversRepo.rows.push(profile({ userId: 'unrelated-online-driver' }));

    const result = await service.search(rideInput());

    expect(result.candidates.map((c) => c.driverUserId)).not.toContain('unrelated-online-driver');
  });
});

describe('CandidateSearchService observability (batch 9)', () => {
  it('records candidate_search_latency and candidate_count for every call, and radius-expansion only when it actually expanded', async () => {
    const liveDriverIndex = new FakeLiveDriverIndex();
    const driversRepo = new FakeRepo<DriverProfile>();
    const vehiclesRepo = new FakeRepo<Vehicle>();
    const metrics = fakeMetrics();
    const service = new CandidateSearchService(
      liveDriverIndex as any,
      driversRepo as any,
      vehiclesRepo as any,
      fakeConfig(),
      metrics,
    );

    // Nobody in range at all -> forced to expand all the way to max radius.
    await service.search({
      pickup: LAGOS,
      domain: DispatchDomain.RIDE,
      mode: DispatchMode.AUTO,
      rideCategory: RideCategory.ECONOMY,
    });

    expect(metrics.candidateSearchDurationSeconds.startTimer).toHaveBeenCalledWith({
      domain: DispatchDomain.RIDE,
      mode: DispatchMode.AUTO,
    });
    expect(metrics.candidateSearchCandidateCount.observe).toHaveBeenCalledWith(
      { domain: DispatchDomain.RIDE, mode: DispatchMode.AUTO },
      0,
    );
    expect(metrics.candidateSearchRadiusExpansionTotal.inc).toHaveBeenCalledWith({
      domain: DispatchDomain.RIDE,
      mode: DispatchMode.AUTO,
    });

    metrics.candidateSearchRadiusExpansionTotal.inc.mockClear();
    liveDriverIndex.entries.push({ driverUserId: 'close-driver', distanceKm: 1, vehicleId: 'veh-close-driver' });
    driversRepo.rows.push(
      profile({ userId: 'close-driver', id: 'profile-close-driver', activeVehicleId: 'veh-close-driver' }),
    );
    vehiclesRepo.rows.push(vehicle({ id: 'veh-close-driver' }));

    // Found within the initial round this time -> no expansion recorded.
    await service.search({
      pickup: LAGOS,
      domain: DispatchDomain.RIDE,
      mode: DispatchMode.AUTO,
      rideCategory: RideCategory.ECONOMY,
    });

    expect(metrics.candidateSearchRadiusExpansionTotal.inc).not.toHaveBeenCalled();
  });
});
