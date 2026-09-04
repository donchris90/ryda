import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FleetService } from './fleet.service';
import { FleetStaffRole } from './entities/fleet-staff.entity';

function fakeStaff(overrides: Record<string, any> = {}) {
  return { id: 'staff-1', fleetCompanyId: 'company-a', userId: 'user-a-owner', role: FleetStaffRole.OWNER, ...overrides };
}

function build(overrides: Record<string, any> = {}) {
  const companiesRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'company-a', name: 'Company A' }),
  };
  const staffRepo = {
    // Scoped exactly like the real query: assertIsStaff() looks up
    // {fleetCompanyId, userId} together (the actual tenant check);
    // getCompanyForStaff() looks up {userId} alone (no company to
    // check against yet - resolving it IS the point). Both real
    // shapes are matched here, not just one.
    findOne: jest.fn(({ where }: any) => {
      const rows: any[] = overrides.staffRows ?? [fakeStaff()];
      const match = rows.find(
        (r) => r.userId === where.userId && (where.fleetCompanyId === undefined || r.fleetCompanyId === where.fleetCompanyId),
      );
      return Promise.resolve(match ?? null);
    }),
    save: jest.fn(async (d: any) => d),
    create: jest.fn((d: any) => d),
    ...overrides.staffRepo,
  };
  const walletsRepo = { findOne: jest.fn().mockResolvedValue({ id: 'wallet-a', fleetCompanyId: 'company-a', balance: '5000.00' }) };
  const txRepo = { find: jest.fn().mockResolvedValue([]) };
  const payoutsRepo = { find: jest.fn().mockResolvedValue([]) };
  const driversService = {
    findByUserId: jest.fn().mockResolvedValue({ userId: 'driver-a', fleetCompanyId: 'company-a' }),
    assignToFleet: jest.fn().mockResolvedValue(undefined),
    listByFleet: jest.fn().mockResolvedValue([]),
    ...overrides.driversService,
  };
  const vehiclesService = { assignToFleet: jest.fn().mockResolvedValue(undefined), listByFleet: jest.fn().mockResolvedValue([]) };
  const paystack = {};

  const service = new FleetService(
    companiesRepo as any,
    staffRepo as any,
    walletsRepo as any,
    txRepo as any,
    payoutsRepo as any,
    driversService as any,
    vehiclesService as any,
    paystack as any,
  );

  return { service, companiesRepo, staffRepo, driversService, vehiclesService };
}

describe('FleetService - tenant isolation', () => {
  it("refuses to let Company B's staff assign a driver into Company A", async () => {
    const { service } = build({ staffRows: [fakeStaff({ fleetCompanyId: 'company-b', userId: 'user-b-owner' })] });

    await expect(service.assignDriver('company-a', 'user-b-owner', 'driver-x')).rejects.toThrow(ForbiddenException);
  });

  it("refuses to let Company B's staff remove a driver from Company A", async () => {
    const { service } = build({ staffRows: [fakeStaff({ fleetCompanyId: 'company-b', userId: 'user-b-owner' })] });

    await expect(service.removeDriver('company-a', 'user-b-owner', 'driver-x')).rejects.toThrow(ForbiddenException);
  });

  it("refuses to let Company B's staff assign a vehicle into Company A", async () => {
    const { service } = build({ staffRows: [fakeStaff({ fleetCompanyId: 'company-b', userId: 'user-b-owner' })] });

    await expect(service.assignVehicle('company-a', 'user-b-owner', 'vehicle-x')).rejects.toThrow(ForbiddenException);
  });

  it('refuses to let a non-owner staff member (manager) add another manager', async () => {
    const { service } = build({ staffRows: [fakeStaff({ role: FleetStaffRole.MANAGER })] });

    await expect(service.addManager('company-a', 'user-a-owner', 'new-manager')).rejects.toThrow(ForbiddenException);
  });

  it("refuses to reassign a driver who already belongs to a DIFFERENT fleet company - even to a legitimate staff member of the target company", async () => {
    const { service } = build({
      driversService: { findByUserId: jest.fn().mockResolvedValue({ userId: 'driver-x', fleetCompanyId: 'company-b' }) },
    });

    await expect(service.assignDriver('company-a', 'user-a-owner', 'driver-x')).rejects.toThrow(ConflictException);
  });

  it("refuses to remove a driver that doesn't actually belong to the calling company, even though the caller IS legitimate staff there", async () => {
    const { service } = build({
      driversService: { findByUserId: jest.fn().mockResolvedValue({ userId: 'driver-x', fleetCompanyId: 'company-b' }) },
    });

    await expect(service.removeDriver('company-a', 'user-a-owner', 'driver-x')).rejects.toThrow();
  });

  it('a completely unaffiliated user (no staff row anywhere) is refused for every company-scoped action', async () => {
    const { service } = build({ staffRows: [] });

    await expect(service.assignDriver('company-a', 'stranger', 'driver-x')).rejects.toThrow(ForbiddenException);
    await expect(service.assignVehicle('company-a', 'stranger', 'vehicle-x')).rejects.toThrow(ForbiddenException);
    await expect(service.addManager('company-a', 'stranger', 'new-manager')).rejects.toThrow(ForbiddenException);
  });

  it('allows a genuine owner of the target company to perform the same action that a wrong-company caller was refused', async () => {
    const { service, driversService } = build(); // default staffRows: owner of company-a

    await service.assignDriver('company-a', 'user-a-owner', 'driver-x');

    expect(driversService.assignToFleet).toHaveBeenCalledWith('driver-x', 'company-a');
  });
});

describe('FleetService.getCompanyForStaff() - the resolver every /mine endpoint depends on', () => {
  it("resolves to the caller's OWN company, never one supplied by the caller", async () => {
    const { service, staffRepo } = build();

    await service.getCompanyForStaff('user-a-owner');

    // Scoped by userId alone - there is no company parameter for a
    // caller to supply in the first place, which is the actual
    // security property: every /mine endpoint resolves the company
    // from the token, never from client input.
    expect(staffRepo.findOne).toHaveBeenCalledWith({ where: { userId: 'user-a-owner' } });
  });

  it('throws (does not fall back to any default company) for a user with no staff row at all', async () => {
    const { service } = build({ staffRepo: { findOne: jest.fn().mockResolvedValue(null) } });

    await expect(service.getCompanyForStaff('stranger')).rejects.toThrow(NotFoundException);
  });
});
