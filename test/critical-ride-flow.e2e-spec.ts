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
import { Wallet } from '../src/wallets/entities/wallet.entity';
import { Vehicle } from '../src/vehicles/entities/vehicle.entity';
import { VehicleStatus } from '../src/common/enums/vehicle.enum';
import { DriverServiceCapability } from '../src/drivers/entities/driver-service-capability.entity';
import {
  DriverService,
  ServiceApprovalStatus,
} from '../src/common/enums/driver-service.enum';

// Minimal shapes for the response fields this test actually reads -
// supertest types `.body` as `any` by design (it can't know your
// DTOs), so every access needs an explicit assertion to satisfy
// @typescript-eslint/no-unsafe-member-access rather than suppressing
// the rule wholesale for the file.
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
interface AvailabilityResponse {
  availability: string;
}
interface FareEstimateResponse {
  totalFare: number;
}
interface RideResponse {
  id: string;
  verificationPin: string;
  totalFare: string;
  status: string;
  earningsSettled: boolean;
}
interface VerifyPinResponse {
  verified: boolean;
}
interface WalletResponse {
  balance: string;
}
interface RatingResponse {
  driverRating: number;
}

/**
 * Automates the exact flow this project's own e2e-test.sh has proven
 * works, end to end, through the real app rather than curl + psql:
 *
 *   passenger registers -> driver registers -> driver onboards ->
 *   driver approved -> vehicle registered -> documents approved ->
 *   driver online -> fare estimate -> ride requested -> driver accepts
 *   -> arrives -> PIN verified -> trip starts -> trip completes ->
 *   wallet settlement verified on BOTH sides -> passenger rates driver.
 *
 * Runs against a real, running Postgres + Redis (this project's own
 * `npm run test:e2e` / CI setup), not mocks - the same "verified
 * end-to-end" standard the rest of this codebase holds itself to,
 * just automated instead of manually read off a terminal.
 *
 * The three steps that have no real API in this codebase (email
 * verification requires an actual inbox; driver-profile/document/
 * vehicle approval requires an admin account this test doesn't want
 * to seed just for this) go through the app's own repositories via
 * its DI container - functionally identical to e2e-test.sh's raw
 * `psql` shortcuts for the same steps, just through TypeORM instead
 * of a shell string.
 *
 * NOTE ON THE VEHICLE-APPROVAL STEP: e2e-test.sh (this project's own
 * bash e2e script) never approves the registered vehicle to ACTIVE -
 * it would fail today against DriversService.setAvailability()'s
 * vehicle-status gating, a real regression in that script's own
 * "verified working" claim that this test catches and works around
 * correctly rather than repeating.
 */
describe('Critical ride flow (e2e)', () => {
  let app: INestApplication<App>;
  let usersRepo: Repository<User>;
  let driverProfileRepo: Repository<DriverProfile>;
  let documentsRepo: Repository<DriverDocument>;
  let walletsRepo: Repository<Wallet>;
  let vehiclesRepo: Repository<Vehicle>;
  let serviceCapabilitiesRepo: Repository<DriverServiceCapability>;

  const passenger = {
    email: `passenger.${Date.now()}@example.com`,
    phone: `+234801${Date.now().toString().slice(-7)}`,
    password: 'Passw0rd!',
    firstName: 'Ada',
    lastName: 'Obi',
    termsAccepted: true,
    role: 'passenger',
  };
  const driver = {
    email: `driver.${Date.now()}@example.com`,
    phone: `+234802${Date.now().toString().slice(-7)}`,
    password: 'Passw0rd!',
    firstName: 'Musa',
    lastName: 'Bello',
    termsAccepted: true,
    role: 'driver',
  };

  let passengerToken: string;
  let passengerId: string;
  let driverToken: string;
  let driverId: string;
  let driverProfileId: string;
  let rideId: string;
  let ridePin: string;
  let quotedTotalFare: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Same global setup as main.ts's real bootstrap - a test hitting
    // routes without the real prefix/pipes would be testing a
    // different app than what actually deploys.
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
    walletsRepo = moduleFixture.get(getRepositoryToken(Wallet));
    vehiclesRepo = moduleFixture.get(getRepositoryToken(Vehicle));
    serviceCapabilitiesRepo = moduleFixture.get(
      getRepositoryToken(DriverServiceCapability),
    );
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('1. registers the passenger', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(passenger)
      .expect(201);
    const body = res.body as RegisterResponse;
    passengerId = body.userId;
    expect(passengerId).toBeDefined();
  });

  it('2. registers the driver', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(driver)
      .expect(201);
    const body = res.body as RegisterResponse;
    driverId = body.userId;
    expect(driverId).toBeDefined();
  });

  it('3. verifies both emails (no real inbox in a test run) and logs in', async () => {
    await usersRepo.update({ id: passengerId }, { isEmailVerified: true });
    await usersRepo.update({ id: driverId }, { isEmailVerified: true });

    const passengerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: passenger.email, password: passenger.password })
      .expect(201);
    passengerToken = (passengerLogin.body as LoginResponse).accessToken;

    const driverLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: driver.email, password: driver.password })
      .expect(201);
    driverToken = (driverLogin.body as LoginResponse).accessToken;

    expect(passengerToken).toBeDefined();
    expect(driverToken).toBeDefined();
  });

  it('4. onboards the driver and an admin approves the profile and both service capabilities', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/drivers/onboard')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        licenseNumber: 'LAG-DR-00123',
        city: 'Lagos',
        services: ['ride', 'delivery'],
      })
      .expect(201);
    driverProfileId = (res.body as DriverProfileResponse).id;

    await driverProfileRepo.update(
      { id: driverProfileId },
      { approvalStatus: DriverApprovalStatus.APPROVED },
    );
    // onboard() creates PENDING DriverServiceCapability rows for each
    // requested service (see DriversService.requestServices()) - a
    // separate gate from the profile's own approvalStatus, and
    // setAvailability() genuinely checks both independently.
    await serviceCapabilitiesRepo.update(
      { driverProfileId, service: DriverService.RIDE },
      { status: ServiceApprovalStatus.APPROVED },
    );
    await serviceCapabilitiesRepo.update(
      { driverProfileId, service: DriverService.DELIVERY },
      { status: ServiceApprovalStatus.APPROVED },
    );
  });

  it('5. registers a vehicle (auto-becomes the active vehicle) and an admin approves it', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        category: 'car',
        make: 'Toyota',
        model: 'Corolla',
        year: 2019,
        plateNumber: `LAG-${Date.now()}`,
      })
      .expect(201);

    // A vehicle starts PENDING_INSPECTION - DriversService.setAvailability()
    // genuinely requires ACTIVE (see vehicle-status online gating), the
    // same real-world "an admin inspects it first" step this test
    // shouldn't skip just because it's inconvenient to simulate.
    await vehiclesRepo.update(
      { id: (res.body as VehicleResponse).id },
      { status: VehicleStatus.ACTIVE },
    );
  });

  it('6. approves the required documents (license, insurance, road-worthiness)', async () => {
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
  });

  it('7. driver goes online for both services', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/drivers/availability/online_for_both')
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    expect((res.body as AvailabilityResponse).availability).toBe(
      'online_for_both',
    );
  });

  it('8. fare estimate for a real Lagos route (Ikeja -> Victoria Island)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/rides/estimate')
      .send({
        category: 'economy',
        pickupLat: 6.6018,
        pickupLng: 3.3515,
        dropoffLat: 6.4281,
        dropoffLng: 3.4219,
      })
      .expect(201);

    quotedTotalFare = (res.body as FareEstimateResponse).totalFare;
    expect(quotedTotalFare).toBeGreaterThan(0);
  });

  it('9. passenger requests the ride (wallet payment)', async () => {
    await walletsRepo.update({ userId: passengerId }, { balance: '50000.00' });

    const res = await request(app.getHttpServer())
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
        paymentMethod: 'wallet',
      })
      .expect(201);

    const body = res.body as RideResponse;
    rideId = body.id;
    ridePin = body.verificationPin;
    expect(rideId).toBeDefined();
    // Same tiered fare math the estimate used, so the ride the
    // passenger actually gets charged for matches what they were
    // quoted a moment earlier - a mismatch here would mean the two
    // code paths have silently diverged.
    expect(parseFloat(body.totalFare)).toBeCloseTo(quotedTotalFare, 2);
  });

  it('10. driver accepts, arrives, and the PIN verifies correctly', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/rides/${rideId}/accept`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/rides/${rideId}/arrived`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);

    const wrongPin = await request(app.getHttpServer())
      .post(`/api/v1/rides/${rideId}/verify-pin`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ pin: '0000' })
      .expect(201);
    expect((wrongPin.body as VerifyPinResponse).verified).toBe(false);

    const rightPin = await request(app.getHttpServer())
      .post(`/api/v1/rides/${rideId}/verify-pin`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ pin: ridePin })
      .expect(201);
    expect((rightPin.body as VerifyPinResponse).verified).toBe(true);
  });

  it('11. trip starts and completes, calculating the final fare', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/rides/${rideId}/start`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/rides/${rideId}/complete`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);

    const body = res.body as RideResponse;
    expect(body.status).toBe('completed');
    expect(body.earningsSettled).toBe(true);
  });

  it('12. payment succeeded and driver earnings landed - verified on BOTH wallets, not just a 200 response', async () => {
    const passengerWallet = await request(app.getHttpServer())
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${passengerToken}`)
      .expect(200);
    // Started at 50000, debited exactly the ride's total fare.
    expect(
      parseFloat((passengerWallet.body as WalletResponse).balance),
    ).toBeCloseTo(50000 - quotedTotalFare, 2);

    const driverWallet = await request(app.getHttpServer())
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);
    // Rookie-level commission (25% per DEFAULT_COMMISSION_BY_LEVEL) -
    // driver keeps the rest. Started at 0.
    const driverBalance = parseFloat(
      (driverWallet.body as WalletResponse).balance,
    );
    expect(driverBalance).toBeGreaterThan(0);
    expect(driverBalance).toBeLessThan(quotedTotalFare);
  });

  it('13. passenger rates the driver', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/rides/${rideId}/rate/driver`)
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({ rating: 5, comment: 'Great, safe ride.' })
      .expect(201);

    expect((res.body as RatingResponse).driverRating).toBe(5);

    // One-shot - a second rating attempt on the same ride must be
    // rejected, not silently overwrite or average in a new score.
    await request(app.getHttpServer())
      .post(`/api/v1/rides/${rideId}/rate/driver`)
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({ rating: 1 })
      .expect(400);
  });
});
