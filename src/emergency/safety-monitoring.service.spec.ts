import { NotFoundException } from '@nestjs/common';
import { SafetyMonitoringService } from './safety-monitoring.service';
import { RiskAlertType, RiskAlertStatus } from './entities/risk-alert.entity';
import { RideStatus } from '../common/enums/ride.enum';

const SAFETY_CONFIG: Record<string, number> = {
  'safetyMonitoring.excessiveSpeedKmh': 130,
  'safetyMonitoring.gpsStaleSeconds': 180,
  'safetyMonitoring.tripDurationAnomalyMultiplier': 2.5,
  'safetyMonitoring.routeDeviationDistanceMultiplier': 1.8,
  'safetyMonitoring.unusualStopMinutes': 8,
  'safetyMonitoring.unusualStopRadiusMeters': 100,
  'safetyMonitoring.minPlausibleTripSeconds': 60,
};

function fakeRide(overrides: Record<string, any> = {}) {
  return {
    id: 'ride-1',
    driverId: 'driver-1',
    status: RideStatus.IN_PROGRESS,
    startedAt: new Date(Date.now() - 5 * 60_000),
    estimatedDurationMin: 20,
    estimatedDistanceKm: 10,
    completedAt: null,
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const savedAlerts: any[] = [];
  const alertsRepo = {
    findOne: jest.fn().mockResolvedValue(null), // no existing open alert, by default
    save: jest.fn(async (a: any) => {
      const saved = { id: `alert-${savedAlerts.length + 1}`, ...a };
      savedAlerts.push(saved);
      return saved;
    }),
    create: jest.fn((d: any) => d),
    find: jest.fn().mockResolvedValue([]),
    ...overrides.alertsRepo,
  };
  const historyRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    ...overrides.historyRepo,
  };
  const ridesRepo = {
    findOne: jest.fn().mockResolvedValue(overrides.activeRide ?? fakeRide()),
    find: jest.fn().mockResolvedValue([]),
    ...overrides.ridesRepo,
  };
  const driversRepo = {
    find: jest.fn().mockResolvedValue([]),
    ...overrides.driversRepo,
  };
  const config = { get: jest.fn((key: string) => SAFETY_CONFIG[key]) };

  const service = new SafetyMonitoringService(
    alertsRepo as any,
    historyRepo as any,
    ridesRepo as any,
    driversRepo as any,
    config as any,
  );

  return { service, alertsRepo, historyRepo, ridesRepo, driversRepo, savedAlerts };
}

describe('SafetyMonitoringService', () => {
  describe('onDriverLocationUpdated()', () => {
    it('does nothing when the driver has no active (IN_PROGRESS) ride', async () => {
      const { service, ridesRepo, alertsRepo } = build({ ridesRepo: { findOne: jest.fn().mockResolvedValue(null) } });

      await service.onDriverLocationUpdated({ driverUserId: 'driver-1', lat: 6.6, lng: 3.3, at: new Date() });

      expect(alertsRepo.save).not.toHaveBeenCalled();
    });

    describe('excessive speed', () => {
      it('raises an alert when the implied speed between two points exceeds the threshold', async () => {
        const priorPoint = { lat: 6.6018, lng: 3.3515, recordedAt: new Date(Date.now() - 20_000) };
        const { service, alertsRepo } = build({ historyRepo: { findOne: jest.fn().mockResolvedValue(priorPoint) } });

        // ~1.1km in 20s => ~198 km/h, above the 130 km/h threshold.
        await service.onDriverLocationUpdated({ driverUserId: 'driver-1', lat: 6.6118, lng: 3.3515, at: new Date() });

        expect(alertsRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({ type: RiskAlertType.EXCESSIVE_SPEED }),
        );
      });

      it('does not raise an alert for a plausible speed below the threshold', async () => {
        const priorPoint = { lat: 6.6018, lng: 3.3515, recordedAt: new Date(Date.now() - 60_000) };
        const { service, alertsRepo } = build({ historyRepo: { findOne: jest.fn().mockResolvedValue(priorPoint) } });

        // ~0.5km in 60s => ~30 km/h, well under the threshold.
        await service.onDriverLocationUpdated({ driverUserId: 'driver-1', lat: 6.6063, lng: 3.3515, at: new Date() });

        const speedAlerts = alertsRepo.save.mock.calls.filter((c: any) => c[0].type === RiskAlertType.EXCESSIVE_SPEED);
        expect(speedAlerts).toHaveLength(0);
      });

      it('does not raise an alert when there is no prior point to compare against (first ping of the trip)', async () => {
        const { service, alertsRepo } = build({ historyRepo: { findOne: jest.fn().mockResolvedValue(null) } });

        await service.onDriverLocationUpdated({ driverUserId: 'driver-1', lat: 6.6018, lng: 3.3515, at: new Date() });

        const speedAlerts = alertsRepo.save.mock.calls.filter((c: any) => c[0].type === RiskAlertType.EXCESSIVE_SPEED);
        expect(speedAlerts).toHaveLength(0);
      });
    });

    describe('trip duration anomaly', () => {
      it('raises an alert when elapsed time well exceeds the estimated duration', async () => {
        const ride = fakeRide({ startedAt: new Date(Date.now() - 60 * 60_000), estimatedDurationMin: 20 }); // 60min elapsed vs 20min estimate (3x > 2.5x multiplier)
        const { service, alertsRepo } = build({ activeRide: ride });

        await service.onDriverLocationUpdated({ driverUserId: 'driver-1', lat: 6.6, lng: 3.3, at: new Date() });

        expect(alertsRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({ type: RiskAlertType.TRIP_DURATION_ANOMALY }),
        );
      });

      it('does not raise an alert for a trip running only moderately over estimate', async () => {
        const ride = fakeRide({ startedAt: new Date(Date.now() - 25 * 60_000), estimatedDurationMin: 20 }); // 1.25x, well under 2.5x
        const { service, alertsRepo } = build({ activeRide: ride });

        await service.onDriverLocationUpdated({ driverUserId: 'driver-1', lat: 6.6, lng: 3.3, at: new Date() });

        const durationAlerts = alertsRepo.save.mock.calls.filter((c: any) => c[0].type === RiskAlertType.TRIP_DURATION_ANOMALY);
        expect(durationAlerts).toHaveLength(0);
      });

      it('does not raise a second alert while one is already open for this ride', async () => {
        const ride = fakeRide({ startedAt: new Date(Date.now() - 60 * 60_000), estimatedDurationMin: 20 });
        const { service, alertsRepo } = build({
          activeRide: ride,
          alertsRepo: { findOne: jest.fn().mockResolvedValue({ id: 'existing-alert' }) },
        });

        await service.onDriverLocationUpdated({ driverUserId: 'driver-1', lat: 6.6, lng: 3.3, at: new Date() });

        expect(alertsRepo.save).not.toHaveBeenCalled();
      });
    });

    describe('route/distance deviation', () => {
      it('raises an alert when total distance traveled well exceeds the estimated trip distance', async () => {
        const ride = fakeRide({ estimatedDistanceKm: 10 });
        // Points implying ~28km traveled (well over the 18km = 10km * 1.8x threshold) via several hops.
        const points = Array.from({ length: 5 }, (_, i) => ({
          lat: 6.6 + i * 0.07,
          lng: 3.35,
          recordedAt: new Date(Date.now() - (5 - i) * 60_000),
        }));
        const { service, alertsRepo } = build({
          activeRide: ride,
          historyRepo: { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue(points) },
        });

        await service.onDriverLocationUpdated({ driverUserId: 'driver-1', lat: 6.6, lng: 3.3, at: new Date() });

        expect(alertsRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({ type: RiskAlertType.ROUTE_DEVIATION }),
        );
      });

      it('does not raise an alert when distance traveled is reasonably close to the estimate', async () => {
        const ride = fakeRide({ estimatedDistanceKm: 10 });
        const points = [
          { lat: 6.6, lng: 3.3, recordedAt: new Date(Date.now() - 60_000) },
          { lat: 6.65, lng: 3.3, recordedAt: new Date() },
        ]; // ~5.5km, well within 1.8x of 10km
        const { service, alertsRepo } = build({
          activeRide: ride,
          historyRepo: { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue(points) },
        });

        await service.onDriverLocationUpdated({ driverUserId: 'driver-1', lat: 6.6, lng: 3.3, at: new Date() });

        const deviationAlerts = alertsRepo.save.mock.calls.filter((c: any) => c[0].type === RiskAlertType.ROUTE_DEVIATION);
        expect(deviationAlerts).toHaveLength(0);
      });
    });

    describe('unusual stop', () => {
      it('raises an alert when several readings across the full window are all within the radius', async () => {
        const now = new Date();
        // unusualStopMinutes is 8 - all three points need to genuinely
        // fall within that window, with the oldest close to its start
        // (within 60s), to satisfy "the window is actually full", not
        // just "there happen to be 3 points somewhere in history".
        const points = [
          { lat: 6.6, lng: 3.3, recordedAt: new Date(now.getTime() - 7.9 * 60_000) },
          { lat: 6.6001, lng: 3.3, recordedAt: new Date(now.getTime() - 5 * 60_000) },
          { lat: 6.6, lng: 3.3001, recordedAt: new Date(now.getTime() - 2 * 60_000) },
        ];
        const { service, alertsRepo } = build({
          historyRepo: { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue(points) },
        });

        await service.onDriverLocationUpdated({ driverUserId: 'driver-1', lat: 6.6, lng: 3.3, at: now });

        expect(alertsRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({ type: RiskAlertType.UNUSUAL_STOP }),
        );
      });

      it('does not raise an alert with too few readings to establish a genuine stop (avoids mistaking a data gap for a stop)', async () => {
        const now = new Date();
        const points = [{ lat: 6.6, lng: 3.3, recordedAt: new Date(now.getTime() - 9 * 60_000) }];
        const { service, alertsRepo } = build({
          historyRepo: { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue(points) },
        });

        await service.onDriverLocationUpdated({ driverUserId: 'driver-1', lat: 6.6, lng: 3.3, at: now });

        const stopAlerts = alertsRepo.save.mock.calls.filter((c: any) => c[0].type === RiskAlertType.UNUSUAL_STOP);
        expect(stopAlerts).toHaveLength(0);
      });

      it('does not raise an alert when the vehicle has genuinely been moving', async () => {
        const now = new Date();
        const points = [
          { lat: 6.6, lng: 3.3, recordedAt: new Date(now.getTime() - 7.9 * 60_000) },
          { lat: 6.62, lng: 3.32, recordedAt: new Date(now.getTime() - 5 * 60_000) },
          { lat: 6.64, lng: 3.34, recordedAt: new Date(now.getTime() - 2 * 60_000) },
        ];
        const { service, alertsRepo } = build({
          historyRepo: { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue(points) },
        });

        await service.onDriverLocationUpdated({ driverUserId: 'driver-1', lat: 6.66, lng: 3.36, at: now });

        const stopAlerts = alertsRepo.save.mock.calls.filter((c: any) => c[0].type === RiskAlertType.UNUSUAL_STOP);
        expect(stopAlerts).toHaveLength(0);
      });
    });
  });

  describe('checkGpsFreshness() (scheduled)', () => {
    it('raises an alert for an in-progress ride whose driver has a stale GPS fix', async () => {
      const ride = fakeRide();
      const staleDriver = { userId: 'driver-1', locationUpdatedAt: new Date(Date.now() - 10 * 60_000) }; // 10min old, past the 180s threshold
      const { service, alertsRepo } = build({
        ridesRepo: { find: jest.fn().mockResolvedValue([ride]) },
        driversRepo: { find: jest.fn().mockResolvedValue([staleDriver]) },
      });

      await service.checkGpsFreshness();

      expect(alertsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ type: RiskAlertType.GPS_STALE }));
    });

    it('does not raise an alert for a driver with a fresh GPS fix', async () => {
      const ride = fakeRide();
      const freshDriver = { userId: 'driver-1', locationUpdatedAt: new Date() };
      const { service, alertsRepo } = build({
        ridesRepo: { find: jest.fn().mockResolvedValue([ride]) },
        driversRepo: { find: jest.fn().mockResolvedValue([freshDriver]) },
      });

      await service.checkGpsFreshness();

      expect(alertsRepo.save).not.toHaveBeenCalled();
    });

    it('does not raise a duplicate alert while one is already open for this ride', async () => {
      const ride = fakeRide();
      const staleDriver = { userId: 'driver-1', locationUpdatedAt: new Date(Date.now() - 10 * 60_000) };
      const { service, alertsRepo } = build({
        ridesRepo: { find: jest.fn().mockResolvedValue([ride]) },
        driversRepo: { find: jest.fn().mockResolvedValue([staleDriver]) },
        alertsRepo: { findOne: jest.fn().mockResolvedValue({ id: 'existing' }) },
      });

      await service.checkGpsFreshness();

      expect(alertsRepo.save).not.toHaveBeenCalled();
    });

    it('does nothing when there are no active rides at all', async () => {
      const { service, alertsRepo } = build({ ridesRepo: { find: jest.fn().mockResolvedValue([]) } });

      await service.checkGpsFreshness();

      expect(alertsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('onRideStatusChanged() - unexpected termination', () => {
    it('raises an alert when a ride completes implausibly fast after starting', async () => {
      const startedAt = new Date(Date.now() - 20_000);
      const completedRide = fakeRide({ startedAt, completedAt: new Date() }); // 20s, under the 60s floor
      const { service, alertsRepo } = build({ ridesRepo: { findOne: jest.fn().mockResolvedValue(completedRide) } });

      await service.onRideStatusChanged({ rideId: 'ride-1', status: RideStatus.COMPLETED });

      expect(alertsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: RiskAlertType.UNEXPECTED_TERMINATION }),
      );
    });

    it('does not raise an alert for a normal-duration completed trip', async () => {
      const startedAt = new Date(Date.now() - 15 * 60_000);
      const completedRide = fakeRide({ startedAt, completedAt: new Date() });
      const { service, alertsRepo } = build({ ridesRepo: { findOne: jest.fn().mockResolvedValue(completedRide) } });

      await service.onRideStatusChanged({ rideId: 'ride-1', status: RideStatus.COMPLETED });

      expect(alertsRepo.save).not.toHaveBeenCalled();
    });

    it('ignores status changes other than COMPLETED entirely', async () => {
      const { service, ridesRepo, alertsRepo } = build();

      await service.onRideStatusChanged({ rideId: 'ride-1', status: RideStatus.CANCELLED });

      expect(ridesRepo.findOne).not.toHaveBeenCalled();
      expect(alertsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('review()', () => {
    it('marks an alert reviewed with the admin and notes recorded', async () => {
      const { service, alertsRepo } = build({
        alertsRepo: { findOne: jest.fn().mockResolvedValue({ id: 'alert-1', status: RiskAlertStatus.OPEN }) },
      });

      const result = await service.review('alert-1', 'admin-1', RiskAlertStatus.REVIEWED, 'Looked into it, all fine');

      expect(result.status).toBe(RiskAlertStatus.REVIEWED);
      expect(result.reviewedBy).toBe('admin-1');
      expect(result.reviewNotes).toBe('Looked into it, all fine');
      expect(result.reviewedAt).toBeInstanceOf(Date);
    });

    it('throws for an alert that does not exist', async () => {
      const { service } = build({ alertsRepo: { findOne: jest.fn().mockResolvedValue(null) } });

      await expect(service.review('nonexistent', 'admin-1', RiskAlertStatus.DISMISSED)).rejects.toThrow(NotFoundException);
    });
  });
});
