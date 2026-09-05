import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/entities/user.entity';
import { DriverProfile } from '../src/drivers/entities/driver-profile.entity';
import { DriverApprovalStatus } from '../src/common/enums/driver-status.enum';
import {
  DriverDocument,
  DriverDocumentType,
  DriverDocumentStatus,
} from '../src/drivers/entities/driver-document.entity';
import { Vehicle } from '../src/vehicles/entities/vehicle.entity';
import { VehicleStatus } from '../src/common/enums/vehicle.enum';
import { DriverServiceCapability } from '../src/drivers/entities/driver-service-capability.entity';
import {
  DriverService,
  ServiceApprovalStatus,
} from '../src/common/enums/driver-service.enum';

interface RegisterResponse {
  userId: string;
}
interface LoginResponse {
  accessToken: string;
}
interface DriverProfileResponse {
  id: string;
}
interface VehicleResponse {
  id: string;
}
interface RideResponse {
  id: string;
  driverId: string | null;
  status: string;
}
interface DriverMeResponse {
  availability: string;
}
interface ErrorResponse {
  message: string;
}

/**
 * The other real race from Batch 15's failure-test list, alongside
 * concurrent-acceptance.e2e-spec.ts: a passenger cancelling at the
 * exact instant a driver is accepting. Both acceptRide() and
 * cancelRide() read the same ride's status, then each attempts its own
 * conditional UPDATE keyed off that read - a genuine compare-and-swap
 * race on the same row, not two independent operations.
 *
 * Either outcome is legitimate (the accept can win, or the
 * cancellation can win - whichever transaction's UPDATE actually
 * commits first), so this test doesn't assert which one wins. What it
 * asserts is that exactly one of the two operations succeeds, the
 * ride ends up in a single consistent state (never half-accepted-and-
 * cancelled), and the loser gets an ACCURATE error message for
 * whichever thing actually happened - not a generic or misleading one.
 * See the fix directly above this ride's acceptRide() re-check: a
 * driver whose accept lost to a cancellation used to be told "accepted
 * by another driver," which was simply wrong.
 */
describe('Cancellation during acceptance (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let driverProfileRepo: Repository<DriverProfile>;
  let documentsRepo: Repository<DriverDocument>;
  let vehiclesRepo: Repository<Vehicle>;
  let serviceCapabilitiesRepo: Repository<DriverServiceCapability>;

  const passenger = {
    email: `passenger.cancelrace.${Date.now()}@example.com`,
    phone: `+234806${Date.now().toString().slice(-7)}`,
    password: 'Passw0rd!',
    firstName: 'Ngozi',
    lastName: 'Uche',
    termsAccepted: true,
    role: 'passenger',
  };
  const driver = {
    email: `driver.cancelrace.${Date.now()}@example.com`,
    phone: `+234807${Date.now().toString().slice(-7)}`,
    password: 'Passw0rd!',
    firstName: 'Emeka',
    lastName: 'Test',
    termsAccepted: true,
    role: 'driver',
  };

  let passengerToken: string;
  let driverToken: string;
  let rideId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: ['verify-email', 'reset-password'],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    usersRepo = moduleFixture.get(getRepositoryToken(User));
    driverProfileRepo = moduleFixture.get(getRepositoryToken(DriverProfile));
    documentsRepo = moduleFixture.get(getRepositoryToken(DriverDocument));
    vehiclesRepo = moduleFixture.get(getRepositoryToken(Vehicle));
    serviceCapabilitiesRepo = moduleFixture.get(
      getRepositoryToken(DriverServiceCapability),
    );

    const passengerRegisterRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(passenger)
      .expect(201);
    const passengerId = (passengerRegisterRes.body as RegisterResponse).userId;
    await usersRepo.update({ id: passengerId }, { isEmailVerified: true });
    const passengerLoginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: passenger.email, password: passenger.password })
      .expect(201);
    passengerToken = (passengerLoginRes.body as LoginResponse).accessToken;

    const driverRegisterRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(driver)
      .expect(201);
    const driverId = (driverRegisterRes.body as RegisterResponse).userId;
    await usersRepo.update({ id: driverId }, { isEmailVerified: true });
    const driverLoginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: driver.email, password: driver.password })
      .expect(201);
    driverToken = (driverLoginRes.body as LoginResponse).accessToken;

    const onboardRes = await request(app.getHttpServer())
      .post('/api/v1/drivers/onboard')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        licenseNumber: `LAG-DR-${driverId.slice(0, 8)}`,
        city: 'Lagos',
        services: ['ride'],
      })
      .expect(201);
    const driverProfileId = (onboardRes.body as DriverProfileResponse).id;
    await driverProfileRepo.update(
      { id: driverProfileId },
      { approvalStatus: DriverApprovalStatus.APPROVED },
    );
    await serviceCapabilitiesRepo.update(
      { driverProfileId, service: DriverService.RIDE },
      { status: ServiceApprovalStatus.APPROVED },
    );

    const vehicleRes = await request(app.getHttpServer())
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        category: 'car',
        make: 'Honda',
        model: 'Accord',
        year: 2021,
        plateNumber: `LAG-${driverId.slice(0, 6)}`,
      })
      .expect(201);
    await vehiclesRepo.update(
      { id: (vehicleRes.body as VehicleResponse).id },
      { status: VehicleStatus.ACTIVE },
    );

    await documentsRepo.save([
      documentsRepo.create({
        driverProfileId,
        type: DriverDocumentType.DRIVERS_LICENSE,
        documentUrl: 'https://example.com/license.jpg',
        status: DriverDocumentStatus.APPROVED,
      }),
      documentsRepo.create({
        driverProfileId,
        type: DriverDocumentType.INSURANCE,
        documentUrl: 'https://example.com/insurance.jpg',
        status: DriverDocumentStatus.APPROVED,
      }),
      documentsRepo.create({
        driverProfileId,
        type: DriverDocumentType.ROAD_WORTHINESS,
        documentUrl: 'https://example.com/roadworthiness.jpg',
        status: DriverDocumentStatus.APPROVED,
      }),
    ]);

    await request(app.getHttpServer())
      .patch('/api/v1/drivers/availability/online_for_rides')
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);

    const rideRes = await request(app.getHttpServer())
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({
        category: 'economy',
        pickupLat: 6.6018,
        pickupLng: 3.3515,
        pickupAddress: 'Ikeja, Lagos',
        dropoffLat: 6.4281,
        dropoffLng: 3.4219,
        dropoffAddress: 'Victoria Island, Lagos',
        city: 'Lagos',
        paymentMethod: 'cash',
      })
      .expect(201);
    rideId = (rideRes.body as RideResponse).id;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('lets exactly one of "driver accepts" / "passenger cancels" win, with an accurate reason for the loser', async () => {
    const [acceptResult, cancelResult] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/rides/${rideId}/accept`)
        .set('Authorization', `Bearer ${driverToken}`),
      request(app.getHttpServer())
        .patch(`/api/v1/rides/${rideId}/cancel`)
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({ reason: 'Changed my mind' }),
    ]);

    const statuses = [acceptResult.status, cancelResult.status].sort();
    // Exactly one success, one failure - never both succeeding (which
    // would mean an accepted ride got silently cancelled out from
    // under its driver, or a cancelled ride still has a driver on the
    // way) and never both failing (which would mean a genuinely valid
    // operation on either side was wrongly rejected).
    expect(statuses).toEqual([200, 400]);

    if (acceptResult.status === 200) {
      // The driver's accept won - the passenger's cancel must say why
      // it failed accurately, not with a generic error.
      expect((cancelResult.body as ErrorResponse).message).toMatch(
        /just changed status|please refresh/i,
      );
    } else {
      // The passenger's cancellation won - the driver's accept must
      // say it was cancelled, specifically NOT the misleading "accepted
      // by another driver" message this exact race used to produce.
      expect((acceptResult.body as ErrorResponse).message).toBe(
        'This ride was just cancelled by the passenger.',
      );
      expect((acceptResult.body as ErrorResponse).message).not.toContain(
        'another driver',
      );
    }
  });

  it('leaves the ride and the driver in one consistent, correct final state', async () => {
    const rideRes = await request(app.getHttpServer())
      .get(`/api/v1/rides/${rideId}`)
      .set('Authorization', `Bearer ${passengerToken}`)
      .expect(200);
    const ride = rideRes.body as RideResponse;

    const driverMeRes = await request(app.getHttpServer())
      .get('/api/v1/drivers/me')
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    const driverAvailability = (driverMeRes.body as DriverMeResponse)
      .availability;

    if (ride.status === 'accepted') {
      // Accept won: ride has this driver, driver is genuinely on the trip.
      expect(ride.driverId).toBeDefined();
      expect(driverAvailability).toBe('on_trip');
    } else {
      // Cancellation won: ride is cancelled with no driver ever
      // assigned, and the driver was never actually reserved - still
      // free to accept other rides, not stuck in limbo.
      expect(ride.status).toBe('cancelled');
      expect(ride.driverId).toBeNull();
      expect(driverAvailability).toBe('online_for_rides');
    }
  });
});
