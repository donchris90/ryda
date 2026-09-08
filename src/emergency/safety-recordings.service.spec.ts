import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SafetyRecordingsService } from './safety-recordings.service';
import { SafetyRecording } from './entities/safety-recording.entity';
import { UserRole } from '../common/enums/user-role.enum';

function fakeIncident(overrides: Record<string, any> = {}) {
  return {
    id: 'incident-1',
    reportedByUserId: 'passenger-1',
    rideId: 'ride-1',
    ...overrides,
  };
}

function fakeRecording(overrides: Record<string, any> = {}) {
  return {
    id: 'recording-1',
    incidentId: 'incident-1',
    uploadedByUserId: 'passenger-1',
    rideId: 'ride-1',
    audioUrl: 'https://example.com/audio.m4a',
    storageKey: 'safety-recordings/audio.m4a',
    durationSeconds: 300,
    expiresAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  const recordingsRepo = {
    create: jest.fn((d: any) => d),
    save: jest.fn(async (d: any) => ({ id: 'recording-1', ...d })),
    findOne: jest.fn().mockResolvedValue(fakeRecording()),
    find: jest.fn().mockResolvedValue([]),
    remove: jest.fn().mockResolvedValue(undefined),
    ...overrides.recordingsRepo,
  };
  const incidentsRepo = {
    findOne: jest.fn().mockResolvedValue(fakeIncident()),
    ...overrides.incidentsRepo,
  };
  const storageService = {
    upload: jest.fn().mockResolvedValue({ url: 'https://example.com/audio.m4a', key: 'safety-recordings/audio.m4a' }),
    delete: jest.fn().mockResolvedValue(undefined),
    getSignedReadUrl: jest.fn().mockResolvedValue('https://signed.example.com/audio.m4a'),
    readLocal: jest.fn().mockResolvedValue(Buffer.from('fake-audio')),
    ...overrides.storageService,
  };

  const service = new SafetyRecordingsService(recordingsRepo as any, incidentsRepo as any, storageService as any);
  return { service, recordingsRepo, incidentsRepo, storageService };
}

const fakeFile = { buffer: Buffer.from('audio'), originalname: 'rec.m4a', mimetype: 'audio/m4a' };

describe('SafetyRecordingsService.uploadRecording()', () => {
  it('lets the person who triggered the SOS upload a recording against it', async () => {
    const { service, storageService } = build();
    await service.uploadRecording('incident-1', 'passenger-1', fakeFile);
    expect(storageService.upload).toHaveBeenCalledWith(fakeFile, 'safety-recordings');
  });

  it('rejects anyone other than the person who triggered the SOS - not even the driver on the same ride', async () => {
    const { service, storageService } = build();
    await expect(service.uploadRecording('incident-1', 'driver-1', fakeFile)).rejects.toThrow(ForbiddenException);
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for an incident that does not exist', async () => {
    const { service } = build({ incidentsRepo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.uploadRecording('missing', 'passenger-1', fakeFile)).rejects.toThrow(NotFoundException);
  });

  it('sets expiresAt to 7 days from now', async () => {
    const { service, recordingsRepo } = build();
    const before = Date.now();
    await service.uploadRecording('incident-1', 'passenger-1', fakeFile);
    const saved = recordingsRepo.create.mock.calls[0][0];
    const daysUntilExpiry = (saved.expiresAt.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(daysUntilExpiry).toBeGreaterThan(6.9);
    expect(daysUntilExpiry).toBeLessThan(7.1);
  });

  it('stores both the storage key and the URL, since deletion needs the key specifically', async () => {
    const { service, recordingsRepo } = build();
    await service.uploadRecording('incident-1', 'passenger-1', fakeFile);
    const saved = recordingsRepo.create.mock.calls[0][0];
    expect(saved.storageKey).toBe('safety-recordings/audio.m4a');
    expect(saved.audioUrl).toBe('https://example.com/audio.m4a');
  });
});

describe('SafetyRecordingsService.getRecording() - access control', () => {
  it('allows the person who uploaded it', async () => {
    const { service } = build();
    const result = await service.getRecording('incident-1', 'passenger-1', UserRole.PASSENGER);
    expect(result.id).toBe('recording-1');
  });

  it('allows safety/ops staff', async () => {
    const { service } = build();
    const result = await service.getRecording('incident-1', 'staff-1', UserRole.SUPPORT_AGENT);
    expect(result.id).toBe('recording-1');
  });

  it(
    'rejects the driver on the same ride the recording is about - a recording is the reporting ' +
      "party's own evidence, not something the other party gets to hear",
    async () => {
      const { service } = build();
      await expect(service.getRecording('incident-1', 'driver-1', UserRole.DRIVER)).rejects.toThrow(
        ForbiddenException,
      );
    },
  );

  it('throws NotFoundException when no recording exists for the incident', async () => {
    const { service } = build({ recordingsRepo: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(service.getRecording('incident-1', 'passenger-1', UserRole.PASSENGER)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('SafetyRecordingsService.getSignedUrl() / readBytes()', () => {
  it('returns a signed URL when the storage driver supports it', async () => {
    const { service, storageService } = build();
    const url = await service.getSignedUrl(fakeRecording() as SafetyRecording);
    expect(url).toBe('https://signed.example.com/audio.m4a');
    expect(storageService.getSignedReadUrl).toHaveBeenCalledWith('safety-recordings/audio.m4a');
  });

  it('falls back to reading bytes directly when signing is unavailable (local disk)', async () => {
    const { service } = build({ storageService: { getSignedReadUrl: jest.fn().mockResolvedValue(null) } });
    const url = await service.getSignedUrl(fakeRecording() as SafetyRecording);
    expect(url).toBeNull();
    const bytes = await service.readBytes(fakeRecording() as SafetyRecording);
    expect(bytes.toString()).toBe('fake-audio');
  });
});

describe('SafetyRecordingsService.deleteExpiredRecordings()', () => {
  it('deletes the storage file and the database row for every expired recording', async () => {
    const expired = [fakeRecording({ id: 'r1', storageKey: 'key1' }), fakeRecording({ id: 'r2', storageKey: 'key2' })];
    const { service, recordingsRepo, storageService } = build({
      recordingsRepo: { find: jest.fn().mockResolvedValue(expired) },
    });

    await service.deleteExpiredRecordings();

    expect(storageService.delete).toHaveBeenCalledWith('key1');
    expect(storageService.delete).toHaveBeenCalledWith('key2');
    expect(recordingsRepo.remove).toHaveBeenCalledWith(expired);
  });

  it('does nothing when there are no expired recordings', async () => {
    const { service, recordingsRepo, storageService } = build({ recordingsRepo: { find: jest.fn().mockResolvedValue([]) } });
    await service.deleteExpiredRecordings();
    expect(storageService.delete).not.toHaveBeenCalled();
    expect(recordingsRepo.remove).not.toHaveBeenCalled();
  });

  it(
    'still deletes the database row and continues the batch even when the storage file delete fails - ' +
      'a missing file or provider hiccup should not leave the row (or the rest of the batch) stuck forever',
    async () => {
      const expired = [fakeRecording({ id: 'r1' })];
      const { service, recordingsRepo } = build({
        recordingsRepo: { find: jest.fn().mockResolvedValue(expired) },
        storageService: { delete: jest.fn().mockRejectedValue(new Error('not found')) },
      });

      await expect(service.deleteExpiredRecordings()).resolves.toBeUndefined();
      expect(recordingsRepo.remove).toHaveBeenCalledWith(expired);
    },
  );
});
