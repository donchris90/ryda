import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Incident, IncidentStatus, IncidentType } from './entities/incident.entity';
import { IncidentTimelineEntry } from './entities/incident-timeline-entry.entity';
import { ReportIncidentDto } from './dto/emergency.dto';
import { Ride } from '../rides/entities/ride.entity';
import { DriverProfile } from '../drivers/entities/driver-profile.entity';
import { RideStatus, CancelledBy } from '../common/enums/ride.enum';
import { PassengersService } from '../passengers/passengers.service';
import { User } from '../users/entities/user.entity';

const ACTIVE_RIDE_STATUSES = [
  RideStatus.ACCEPTED,
  RideStatus.ARRIVING,
  RideStatus.ARRIVED,
  RideStatus.IN_PROGRESS,
];

export interface LiveRideView {
  rideId: string;
  status: RideStatus;
  passengerId: string;
  passengerName: string;
  driverId: string | null;
  driverName: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  driverCurrentLat: number | null;
  driverCurrentLng: number | null;
  driverLocationUpdatedAt: Date | null;
}

@Injectable()
export class EmergencyService {
  constructor(
    @InjectRepository(Incident)
    private readonly incidentsRepo: Repository<Incident>,
    @InjectRepository(IncidentTimelineEntry)
    private readonly timelineRepo: Repository<IncidentTimelineEntry>,
    @InjectRepository(Ride)
    private readonly ridesRepo: Repository<Ride>,
    @InjectRepository(DriverProfile)
    private readonly driversRepo: Repository<DriverProfile>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly passengersService: PassengersService,
    private readonly events: EventEmitter2,
  ) {}

  /** The one-tap SOS button — always type=SOS, always high-urgency handling. */
  async triggerSos(
    userId: string,
    rideId: string | undefined,
    lat: number | undefined,
    lng: number | undefined,
  ): Promise<Incident> {
    const incident = await this.incidentsRepo.save(
      this.incidentsRepo.create({
        type: IncidentType.SOS,
        reportedByUserId: userId,
        rideId: rideId ?? null,
        description: 'SOS triggered',
        lat: lat ?? null,
        lng: lng ?? null,
      }),
    );

    await this.addTimelineEntry(incident.id, null, 'sos_triggered', 'SOS button pressed');

    // Notify admin/support (via the notifications broadcast pattern) and
    // the reporter's own trusted contacts, if they've set any.
    const emergencyContacts = await this.passengersService
      .listEmergencyContacts(userId)
      .catch(() => []);

    this.events.emit('incident.sos_triggered', {
      incidentId: incident.id,
      userId,
      rideId: rideId ?? null,
      lat: lat ?? null,
      lng: lng ?? null,
      emergencyContactPhones: emergencyContacts.map((c) => c.phone),
    });

    return incident;
  }

  async reportIncident(userId: string, dto: ReportIncidentDto): Promise<Incident> {
    const incident = await this.incidentsRepo.save(
      this.incidentsRepo.create({
        type: dto.type,
        reportedByUserId: userId,
        rideId: dto.rideId ?? null,
        description: dto.description,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
      }),
    );
    await this.addTimelineEntry(incident.id, userId, 'reported', dto.description);
    return incident;
  }

  async findById(id: string): Promise<Incident> {
    const incident = await this.incidentsRepo.findOne({ where: { id } });
    if (!incident) throw new NotFoundException('Incident not found');
    return incident;
  }

  /**
   * Same "raw userId, no name" gap already found and fixed four times
   * elsewhere (rides, drivers, support, users) — here it matters more
   * than usual: a responder looking at an active SOS needs to know WHO
   * is in danger at a glance, not resolve a UUID first. Shared by
   * listActive/listAll since they differ only in the WHERE clause.
   */
  private async listWithReporter(statusFilter?: IncidentStatus[]) {
    const qb = this.incidentsRepo
      .createQueryBuilder('incident')
      .leftJoin(User, 'reporter', 'reporter.id::text = incident.reportedByUserId')
      .select('incident.id', 'id')
      .addSelect('incident.type', 'type')
      .addSelect('incident.status', 'status')
      .addSelect('incident.description', 'description')
      .addSelect('incident.rideId', 'rideId')
      .addSelect('incident.lat', 'lat')
      .addSelect('incident.lng', 'lng')
      .addSelect('incident.acknowledgedBy', 'acknowledgedBy')
      .addSelect('incident.resolvedBy', 'resolvedBy')
      .addSelect('incident.resolutionNotes', 'resolutionNotes')
      .addSelect('incident.createdAt', 'createdAt')
      .addSelect('incident.resolvedAt', 'resolvedAt')
      .addSelect('reporter.firstName', 'reporterFirstName')
      .addSelect('reporter.lastName', 'reporterLastName')
      .addSelect('reporter.phone', 'reporterPhone')
      .addSelect('reporter.role', 'reporterRole')
      .orderBy('incident.createdAt', 'DESC');

    if (statusFilter) qb.andWhere('incident.status IN (:...statuses)', { statuses: statusFilter });
    return qb.getRawMany();
  }

  async listActive() {
    return this.listWithReporter([IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED]);
  }

  async listAll() {
    return this.listWithReporter();
  }

  async acknowledge(incidentId: string, adminUserId: string): Promise<Incident> {
    const incident = await this.findById(incidentId);
    incident.status = IncidentStatus.ACKNOWLEDGED;
    incident.acknowledgedBy = adminUserId;
    const saved = await this.incidentsRepo.save(incident);
    await this.addTimelineEntry(incidentId, adminUserId, 'acknowledged');
    return saved;
  }

  async resolve(incidentId: string, adminUserId: string, notes: string): Promise<Incident> {
    const incident = await this.findById(incidentId);
    incident.status = IncidentStatus.RESOLVED;
    incident.resolvedBy = adminUserId;
    incident.resolutionNotes = notes;
    incident.resolvedAt = new Date();
    const saved = await this.incidentsRepo.save(incident);
    await this.addTimelineEntry(incidentId, adminUserId, 'resolved', notes);
    return saved;
  }

  async addTimelineEntry(
    incidentId: string,
    actorUserId: string | null,
    action: string,
    notes?: string,
  ): Promise<IncidentTimelineEntry> {
    return this.timelineRepo.save(
      this.timelineRepo.create({ incidentId, actorUserId, action, notes: notes ?? null }),
    );
  }

  async getTimeline(incidentId: string): Promise<IncidentTimelineEntry[]> {
    return this.timelineRepo.find({ where: { incidentId }, order: { createdAt: 'ASC' } });
  }

  // ---- Live ride monitoring ----

  async getLiveRides(): Promise<LiveRideView[]> {
    const rides = await this.ridesRepo.find({ where: { status: In(ACTIVE_RIDE_STATUSES) } });
    if (rides.length === 0) return [];

    const driverIds = rides.map((r) => r.driverId).filter((id): id is string => !!id);
    const drivers = driverIds.length
      ? await this.driversRepo.find({ where: { userId: In(driverIds) } })
      : [];
    const driverByUserId = new Map(drivers.map((d) => [d.userId, d]));

    const involvedUserIds = [...new Set([...rides.map((r) => r.passengerId), ...driverIds])];
    const users = involvedUserIds.length
      ? await this.usersRepo.find({ where: { id: In(involvedUserIds) } })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    const nameFor = (userId: string | null) => {
      if (!userId) return null;
      const u = userById.get(userId);
      return u ? `${u.firstName} ${u.lastName}` : null;
    };

    return rides.map((ride) => {
      const driver = ride.driverId ? driverByUserId.get(ride.driverId) : undefined;
      return {
        rideId: ride.id,
        status: ride.status,
        passengerId: ride.passengerId,
        passengerName: nameFor(ride.passengerId) ?? 'Unknown',
        driverId: ride.driverId,
        driverName: nameFor(ride.driverId),
        pickupAddress: ride.pickupAddress,
        dropoffAddress: ride.dropoffAddress,
        driverCurrentLat: driver?.currentLat ?? null,
        driverCurrentLng: driver?.currentLng ?? null,
        driverLocationUpdatedAt: driver?.locationUpdatedAt ?? null,
      };
    });
  }

  // ---- Admin intervention ----

  /**
   * Emergency force-cancel — bypasses the normal ownership check in
   * RidesService.cancelRide() (an admin isn't the passenger or driver) and
   * deliberately skips fee/commission handling, since this is a safety
   * override, not a normal cancellation flow.
   */
  async forceCancelRide(rideId: string, adminUserId: string, reason: string): Promise<Ride> {
    const ride = await this.ridesRepo.findOne({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Ride not found');

    ride.status = RideStatus.CANCELLED;
    ride.cancelledAt = new Date();
    ride.cancelledBy = CancelledBy.SYSTEM;
    ride.cancelReason = `Admin intervention: ${reason}`;
    const saved = await this.ridesRepo.save(ride);

    this.events.emit('incident.admin_intervention', {
      rideId,
      adminUserId,
      action: 'force_cancel',
      reason,
    });

    return saved;
  }
}
