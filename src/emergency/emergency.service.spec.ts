import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EmergencyService } from './emergency.service';
import { IncidentStatus, IncidentType, IncidentSeverity } from './entities/incident.entity';

function fakeIncident(overrides: Record<string, any> = {}) {
  return {
    id: 'incident-1',
    type: IncidentType.SOS,
    severity: IncidentSeverity.CRITICAL,
    reportedByUserId: 'user-1',
    rideId: null,
    status: IncidentStatus.OPEN,
    description: 'SOS triggered',
    lat: 6.6,
    lng: 3.3,
    createdAt: new Date(),
    ...overrides,
  };
}

function build(overrides: Record<string, any> = {}) {
  let savedIncident: any = overrides.existingIncident ?? null;
  const incidentsRepo = {
    findOne: jest.fn().mockImplementation(async () => savedIncident),
    save: jest.fn(async (i: any) => {
      savedIncident = { id: savedIncident?.id ?? 'incident-1', ...i };
      return savedIncident;
    }),
    create: jest.fn((d: any) => d),
    ...overrides.incidentsRepo,
  };
  const timelineRepo = {
    save: jest.fn(async (d: any) => ({ id: 'timeline-1', ...d })),
    create: jest.fn((d: any) => d),
    find: jest.fn().mockResolvedValue([]),
  };
  const ridesRepo = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
  const driversRepo = { find: jest.fn().mockResolvedValue([]) };
  const usersRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'user-1', firstName: 'Ada', lastName: 'Okoye', role: 'passenger' }),
  };
  const passengersService = {
    listEmergencyContacts: jest.fn().mockResolvedValue([{ name: 'Mom', phone: '+2348011112222' }]),
  };
  const events = { emit: jest.fn() };

  const service = new EmergencyService(
    incidentsRepo as any,
    timelineRepo as any,
    ridesRepo as any,
    driversRepo as any,
    usersRepo as any,
    passengersService as any,
    events as any,
  );

  return { service, incidentsRepo, timelineRepo, usersRepo, passengersService, events, getSavedIncident: () => savedIncident };
}

describe('EmergencyService', () => {
  describe('triggerSos()', () => {
    it('creates a real incident, records a timeline entry, and notifies with reporter name/role/emergency contacts', async () => {
      const { service, incidentsRepo, timelineRepo, events } = build({ existingIncident: null });

      const incident = await service.triggerSos('user-1', 'ride-1', 6.6, 3.3);

      expect(incidentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: IncidentType.SOS, severity: IncidentSeverity.CRITICAL, reportedByUserId: 'user-1' }),
      );
      expect(timelineRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sos_triggered' }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'incident.sos_triggered',
        expect.objectContaining({
          reporterName: 'Ada Okoye',
          reporterRole: 'passenger',
          emergencyContacts: [{ name: 'Mom', phone: '+2348011112222' }],
        }),
      );
      expect(incident.type).toBe(IncidentType.SOS);
    });

    it('a second SOS press while one is already open re-uses the existing incident rather than creating a duplicate', async () => {
      const existing = fakeIncident({ status: IncidentStatus.ACKNOWLEDGED });
      const { service, incidentsRepo, timelineRepo, events } = build({ existingIncident: existing });
      incidentsRepo.findOne.mockResolvedValue(existing); // the "find existing open SOS" lookup

      const result = await service.triggerSos('user-1', undefined, 6.6, 3.3);

      expect(result.id).toBe(existing.id);
      expect(timelineRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sos_pressed_again' }),
      );
      // Still genuinely re-notifies - a second press should reinforce urgency, not go silent.
      expect(events.emit).toHaveBeenCalledWith('incident.sos_triggered', expect.objectContaining({ incidentId: existing.id }));
    });
  });

  describe('cancelIncident() - reporter self-cancellation', () => {
    it('the reporter can cancel their own open incident', async () => {
      const incident = fakeIncident({ status: IncidentStatus.OPEN });
      const { service, incidentsRepo, timelineRepo } = build();
      incidentsRepo.findOne.mockResolvedValue(incident);

      const result = await service.cancelIncident('incident-1', 'user-1');

      expect(result.status).toBe(IncidentStatus.CLOSED);
      expect(timelineRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'cancelled_by_reporter' }),
      );
    });

    it('rejects cancellation from anyone other than the original reporter', async () => {
      const incident = fakeIncident({ status: IncidentStatus.OPEN, reportedByUserId: 'user-1' });
      const { service, incidentsRepo } = build();
      incidentsRepo.findOne.mockResolvedValue(incident);

      await expect(service.cancelIncident('incident-1', 'someone-else')).rejects.toThrow(ForbiddenException);
    });

    it('rejects self-cancellation once the incident has been escalated - a responder has already deemed it serious', async () => {
      const incident = fakeIncident({ status: IncidentStatus.ESCALATED });
      const { service, incidentsRepo } = build();
      incidentsRepo.findOne.mockResolvedValue(incident);

      await expect(service.cancelIncident('incident-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects cancelling an incident that is already resolved or closed', async () => {
      const incident = fakeIncident({ status: IncidentStatus.RESOLVED });
      const { service, incidentsRepo } = build();
      incidentsRepo.findOne.mockResolvedValue(incident);

      await expect(service.cancelIncident('incident-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('acknowledge() / respond() / escalate() / resolve() - the full lifecycle', () => {
    it('acknowledge() sets ACKNOWLEDGED and records who', async () => {
      const incident = fakeIncident({ status: IncidentStatus.OPEN });
      const { service, incidentsRepo } = build();
      incidentsRepo.findOne.mockResolvedValue(incident);

      const result = await service.acknowledge('incident-1', 'admin-1');

      expect(result.status).toBe(IncidentStatus.ACKNOWLEDGED);
      expect(result.acknowledgedBy).toBe('admin-1');
    });

    it('respond() sets RESPONDING and records who', async () => {
      const incident = fakeIncident({ status: IncidentStatus.ACKNOWLEDGED });
      const { service, incidentsRepo } = build();
      incidentsRepo.findOne.mockResolvedValue(incident);

      const result = await service.respond('incident-1', 'admin-1', 'Calling now');

      expect(result.status).toBe(IncidentStatus.RESPONDING);
      expect(result.respondingBy).toBe('admin-1');
    });

    it('respond() rejects an incident that is already resolved or closed', async () => {
      const incident = fakeIncident({ status: IncidentStatus.RESOLVED });
      const { service, incidentsRepo } = build();
      incidentsRepo.findOne.mockResolvedValue(incident);

      await expect(service.respond('incident-1', 'admin-1')).rejects.toThrow(BadRequestException);
    });

    it('escalate() sets ESCALATED, forces CRITICAL severity, records the reason, and genuinely emits a real-time event', async () => {
      const incident = fakeIncident({ status: IncidentStatus.RESPONDING, severity: IncidentSeverity.MEDIUM });
      const { service, incidentsRepo, events } = build();
      incidentsRepo.findOne.mockResolvedValue(incident);

      const result = await service.escalate('incident-1', 'admin-1', 'Not responding to calls');

      expect(result.status).toBe(IncidentStatus.ESCALATED);
      expect(result.severity).toBe(IncidentSeverity.CRITICAL);
      expect(result.escalationReason).toBe('Not responding to calls');
      expect(events.emit).toHaveBeenCalledWith(
        'incident.escalated',
        expect.objectContaining({ incidentId: 'incident-1', reason: 'Not responding to calls' }),
      );
    });

    it('escalate() rejects an incident that is already resolved or closed', async () => {
      const incident = fakeIncident({ status: IncidentStatus.CLOSED });
      const { service, incidentsRepo } = build();
      incidentsRepo.findOne.mockResolvedValue(incident);

      await expect(service.escalate('incident-1', 'admin-1', 'reason')).rejects.toThrow(BadRequestException);
    });

    it('resolve() sets RESOLVED and records who/notes/when', async () => {
      const incident = fakeIncident({ status: IncidentStatus.ESCALATED });
      const { service, incidentsRepo } = build();
      incidentsRepo.findOne.mockResolvedValue(incident);

      const result = await service.resolve('incident-1', 'admin-1', 'Confirmed safe');

      expect(result.status).toBe(IncidentStatus.RESOLVED);
      expect(result.resolvedBy).toBe('admin-1');
      expect(result.resolutionNotes).toBe('Confirmed safe');
      expect(result.resolvedAt).toBeInstanceOf(Date);
    });
  });

  describe('findById()', () => {
    it('throws for an incident that does not exist', async () => {
      const { service, incidentsRepo } = build();
      incidentsRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
