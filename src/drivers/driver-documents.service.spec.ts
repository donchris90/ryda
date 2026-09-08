import { DriverDocumentsService } from './driver-documents.service';
import { DriverDocumentType, DriverDocumentStatus } from './entities/driver-document.entity';

function fakeDoc(overrides: Record<string, any> = {}) {
  return {
    id: 'doc-1',
    driverProfileId: 'profile-1',
    type: DriverDocumentType.INSURANCE,
    documentUrl: 'https://example.com/doc.pdf',
    status: DriverDocumentStatus.PENDING,
    expiryDate: new Date('2027-06-01'),
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const docsRepo = {
    findOne: jest.fn().mockResolvedValue(fakeDoc()),
    save: jest.fn(async (d: any) => d),
    find: jest.fn().mockResolvedValue([]),
    ...overrides.docsRepo,
  };
  const profilesRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'profile-1', activeVehicleId: 'vehicle-1' }),
    ...overrides.profilesRepo,
  };
  const vehiclesRepo = {
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides.vehiclesRepo,
  };
  const events = { emit: jest.fn() };

  const service = new DriverDocumentsService(docsRepo as any, profilesRepo as any, vehiclesRepo as any, events as any);
  return { service, docsRepo, profilesRepo, vehiclesRepo };
}

describe('DriverDocumentsService.approve() - expiry propagation', () => {
  it("propagates an approved INSURANCE document's expiry to the driver's active vehicle", async () => {
    const { service, vehiclesRepo } = build({
      docsRepo: { findOne: jest.fn().mockResolvedValue(fakeDoc({ type: DriverDocumentType.INSURANCE })) },
    });

    await service.approve('doc-1', 'admin-1');

    expect(vehiclesRepo.update).toHaveBeenCalledWith('vehicle-1', { insuranceExpiry: expect.any(Date) });
  });

  it("propagates an approved ROAD_WORTHINESS document's expiry to the driver's active vehicle", async () => {
    const { service, vehiclesRepo } = build({
      docsRepo: { findOne: jest.fn().mockResolvedValue(fakeDoc({ type: DriverDocumentType.ROAD_WORTHINESS })) },
    });

    await service.approve('doc-1', 'admin-1');

    expect(vehiclesRepo.update).toHaveBeenCalledWith('vehicle-1', { roadWorthinessExpiry: expect.any(Date) });
  });

  it('does not touch any vehicle for a document type unrelated to expiry (e.g. drivers license)', async () => {
    const { service, vehiclesRepo } = build({
      docsRepo: { findOne: jest.fn().mockResolvedValue(fakeDoc({ type: DriverDocumentType.DRIVERS_LICENSE })) },
    });

    await service.approve('doc-1', 'admin-1');

    expect(vehiclesRepo.update).not.toHaveBeenCalled();
  });

  it(
    'skips propagation gracefully (not an error) when the driver has no active vehicle yet - ' +
      'documents can legitimately be uploaded and approved before a vehicle is ever registered',
    async () => {
      const { service, vehiclesRepo } = build({
        profilesRepo: { findOne: jest.fn().mockResolvedValue({ id: 'profile-1', activeVehicleId: null }) },
      });

      await expect(service.approve('doc-1', 'admin-1')).resolves.toBeDefined();
      expect(vehiclesRepo.update).not.toHaveBeenCalled();
    },
  );
});

describe('DriverDocumentsService.propagateApprovedDocumentsToVehicle()', () => {
  it(
    "carries over every already-approved insurance/roadworthiness expiry onto a newly activated " +
      "vehicle - otherwise switching vehicles would silently revert a driver's genuinely valid, " +
      "already-approved documents back to \"Not on file\"",
    async () => {
      const { service, vehiclesRepo } = build({
        docsRepo: {
          find: jest.fn().mockResolvedValue([
            fakeDoc({ type: DriverDocumentType.INSURANCE, expiryDate: new Date('2027-01-01') }),
            fakeDoc({ type: DriverDocumentType.ROAD_WORTHINESS, expiryDate: new Date('2027-02-01') }),
          ]),
        },
      });

      await service.propagateApprovedDocumentsToVehicle('profile-1', 'vehicle-2');

      expect(vehiclesRepo.update).toHaveBeenCalledWith('vehicle-2', { insuranceExpiry: new Date('2027-01-01') });
      expect(vehiclesRepo.update).toHaveBeenCalledWith('vehicle-2', { roadWorthinessExpiry: new Date('2027-02-01') });
    },
  );

  it('does nothing when the driver has no approved insurance/roadworthiness documents yet', async () => {
    const { service, vehiclesRepo } = build({ docsRepo: { find: jest.fn().mockResolvedValue([]) } });
    await service.propagateApprovedDocumentsToVehicle('profile-1', 'vehicle-2');
    expect(vehiclesRepo.update).not.toHaveBeenCalled();
  });
});
