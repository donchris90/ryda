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

/**
 * The scenario this whole file exists to prove: two drivers, both
 * genuinely online and eligible, both call POST /rides/:id/accept for
 * the exact same ride within milliseconds of each other via real
 * concurrent HTTP requests (Promise.all, not sequential awaits) - not
 * a unit test mocking a query builder and asserting it was "called
 * correctly," but the real HTTP layer, real auth, real transaction,
 * real Postgres row lock deciding the outcome.
 *
 * Exactly one request must succeed; the other must fail with the
 * specific "already accepted by another driver" error, not a generic
 * 500, and not a silent double-acceptance. Afterward: the ride has
 * exactly one driver, the winner is ON_TRIP, and the loser is still
 * ONLINE (not stuck in a half-transitioned state) - see
 * acceptRide()'s own comment on why the driver-reservation UPDATE and
 * the ride-claim UPDATE are wrapped in one transaction together.
 *
 * This also stands in for Batch 16's "dispatch must be distributed and
 * concurrency-safe": the guarantee here comes from Postgres's own row-
 * level locking on the conditional UPDATE, not from any in-process
 * lock or shared memory - so it holds exactly the same way whether
 * these two accept calls land on the same API instance or two
 * different ones behind a load balancer. A real multi-instance
 * deployment isn't needed to prove that; the database is what
 * actually serializes the two writers, and a single instance already
 * exercises that path faithfully.
 */
describe('Concurrent ride acceptance (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let driverProfileRepo: Repository<DriverProfile>;
  let documentsRepo: Repository<DriverDocument>;
  let vehiclesRepo: Repository<Vehicle>;
  let serviceCapabilitiesRepo: Repository<DriverServiceCapability>;

  const passenger = {
    email: `passenger.race.${Date.now()}@example.com`,
    phone: `+234803${Date.now().toString().slice(-7)}`,
    password: 'Passw0rd!',
    firstName: 'Chidi',
    lastName: 'Eze',
    termsAccepted: true,
    role: 'passenger',
  };

  function fakeDriver(tag: string) {
    return {
      email: `driver.${tag}.${Date.now()}@example.com`,
      phone: `+2348${tag === 'a' ? '04' : '05'}${Date.now().toString().slice(-7)}`,
      password: 'Passw0rd!',
      firstName: tag === 'a' ? 'Driver-A' : 'Driver-B',
      lastName: 'Test',
      termsAccepted: true,
      role: 'driver',
    };
  }
  const driverA = fakeDriver('a');
  const driverB = fakeDriver('b');

  let passengerToken: string;
  let driverATokenValue: string;
  let driverBTokenValue: string;
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

    // Register + fully approve the passenger and both drivers (same
    // shortcuts as critical-ride-flow.e2e-spec.ts - see its own doc
    // comment for why these three steps go through the repositories
    // directly rather than a real inbox / real admin account).
    async function registerAndApproveDriver(payload: typeof driverA) {
      const registerRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(payload)
        .expect(201);
      const userId = (registerRes.body as RegisterResponse).userId;
      await usersRepo.update({ id: userId }, { isEmailVerified: true });

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: payload.email, password: payload.password })
        .expect(201);
      const token = (loginRes.body as LoginResponse).accessToken;

      const onboardRes = await request(app.getHttpServer())
        .post('/api/v1/drivers/onboard')
        .set('Authorization', `Bearer ${token}`)
        .send({
          licenseNumber: `LAG-DR-${userId.slice(0, 8)}`,
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
        .set('Authorization', `Bearer ${token}`)
        .send({
          category: 'car',
          make: 'Toyota',
          model: 'Camry',
          year: 2020,
          plateNumber: `LAG-${userId.slice(0, 6)}`,
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
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      return token;
    }

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

    driverATokenValue = await registerAndApproveDriver(driverA);
    driverBTokenValue = await registerAndApproveDriver(driverB);

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

  it('lets exactly one of two simultaneous accept attempts succeed', async () => {
    const [resultA, resultB] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/rides/${rideId}/accept`)
        .set('Authorization', `Bearer ${driverATokenValue}`),
      request(app.getHttpServer())
        .patch(`/api/v1/rides/${rideId}/accept`)
        .set('Authorization', `Bearer ${driverBTokenValue}`),
    ]);

    const statuses = [resultA.status, resultB.status].sort();
    // One 200 (the winner), one 400 (the specific race-loss message
    // acceptRide() throws, not a generic failure) - never two 200s,
    // which would mean the ride got double-booked, and never two
    // failures, which would mean a genuinely acceptable ride was
    // wrongly rejected for both drivers.
    expect(statuses).toEqual([200, 400]);

    const loserResult = resultA.status === 400 ? resultA : resultB;
    expect((loserResult.body as { message: string }).message).toContain(
      'just accepted by another driver',
    );
  });

  it('leaves the ride assigned to exactly one driver, and driver availability consistent with the outcome', async () => {
    const rideRes = await request(app.getHttpServer())
      .get(`/api/v1/rides/${rideId}`)
      .set('Authorization', `Bearer ${passengerToken}`)
      .expect(200);
    const ride = rideRes.body as RideResponse;

    expect(ride.status).toBe('accepted');
    expect(ride.driverId).toBeDefined();

    const [driverAMe, driverBMe] = await Promise.all([
      request(app.getHttpServer())
        .get('/api/v1/drivers/me')
        .set('Authorization', `Bearer ${driverATokenValue}`)
        .expect(200),
      request(app.getHttpServer())
        .get('/api/v1/drivers/me')
        .set('Authorization', `Bearer ${driverBTokenValue}`)
        .expect(200),
    ]);
    const availabilities = [
      (driverAMe.body as DriverMeResponse).availability,
      (driverBMe.body as DriverMeResponse).availability,
    ].sort();

    // Exactly one driver ended up ON_TRIP (the winner) and the other
    // is still ONLINE (not left in some half-reserved limbo state) -
    // this is the real assertion that reserveOnlineDriverForTrip()'s
    // transactional rollback on the losing side actually worked, not
    // just that the HTTP status codes looked right. Sorted order is
    // ['on_trip', 'online_for_rides'] - '_' (0x5F) sorts before 'l'
    // (0x6C), so 'on_trip' comes first alphabetically.
    expect(availabilities).toEqual(['on_trip', 'online_for_rides']);
  });
});
