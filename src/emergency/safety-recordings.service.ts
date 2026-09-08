import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SafetyRecording } from './entities/safety-recording.entity';
import { Incident } from './entities/incident.entity';
import { StorageService, UploadedFile } from '../storage/storage.service';
import { UserRole, SAFETY_OPS_ROLES } from '../common/enums/user-role.enum';

@Injectable()
export class SafetyRecordingsService {
  private readonly logger = new Logger(SafetyRecordingsService.name);

  constructor(
    @InjectRepository(SafetyRecording)
    private readonly recordingsRepo: Repository<SafetyRecording>,
    @InjectRepository(Incident)
    private readonly incidentsRepo: Repository<Incident>,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Only the person who actually triggered the SOS can upload a
   * recording against it - not just anyone on the ride, and not staff
   * (staff review recordings, they don't create them). Mirrors exactly
   * who's allowed to *access* a recording afterward (see canAccess()
   * below) for the same reason: the recording is that person's own
   * safety evidence.
   */
  async uploadRecording(
    incidentId: string,
    uploaderId: string,
    file: UploadedFile,
    durationSeconds?: number,
  ): Promise<SafetyRecording> {
    const incident = await this.incidentsRepo.findOne({ where: { id: incidentId } });
    if (!incident) throw new NotFoundException('Incident not found');
    if (incident.reportedByUserId !== uploaderId) {
      throw new ForbiddenException('Only the person who triggered this SOS can upload a recording for it');
    }

    const { url, key } = await this.storageService.upload(file, 'safety-recordings');

    return this.recordingsRepo.save(
      this.recordingsRepo.create({
        incidentId,
        uploadedByUserId: uploaderId,
        rideId: incident.rideId,
        audioUrl: url,
        storageKey: key,
        durationSeconds: durationSeconds ?? null,
        expiresAt: SafetyRecording.computeExpiry(),
      }),
    );
  }

  /**
   * The triggering passenger and safety/ops staff only - explicitly
   * not the driver on the ride, even though they were presumably a
   * party to whatever the recording captured. A recording is the
   * reporting party's own evidence; extending access to the other
   * party in the same incident it was made about would defeat the
   * point of it as a safety tool.
   */
  private canAccess(recording: SafetyRecording, requesterId: string, requesterRole: UserRole): boolean {
    return recording.uploadedByUserId === requesterId || SAFETY_OPS_ROLES.includes(requesterRole);
  }

  async getRecording(incidentId: string, requesterId: string, requesterRole: UserRole): Promise<SafetyRecording> {
    const recording = await this.recordingsRepo.findOne({ where: { incidentId } });
    if (!recording) throw new NotFoundException('No recording found for this incident');
    if (!this.canAccess(recording, requesterId, requesterRole)) {
      throw new ForbiddenException("You don't have access to this recording");
    }
    return recording;
  }

  /** Null for the local-disk driver - caller should fall back to readBytes() below. */
  async getSignedUrl(recording: SafetyRecording): Promise<string | null> {
    return this.storageService.getSignedReadUrl(recording.storageKey);
  }

  async readBytes(recording: SafetyRecording): Promise<Buffer> {
    return this.storageService.readLocal(recording.storageKey);
  }

  /**
   * Runs daily rather than hourly (contrast withdrawals.service.ts's
   * EVERY_HOUR cleanup) - deleting expired safety evidence isn't
   * time-critical the way an expired OTP window is, and daily keeps
   * this from ever running mid-review if a staff member happens to be
   * looking at a recording right as its 7-day window closes.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async deleteExpiredRecordings(): Promise<void> {
    const expired = await this.recordingsRepo.find({ where: { expiresAt: LessThan(new Date()) } });
    if (expired.length === 0) return;

    for (const recording of expired) {
      try {
        await this.storageService.delete(recording.storageKey);
      } catch (err) {
        // Logged, not thrown - one bad delete (file already gone,
        // provider hiccup) shouldn't stop the rest of the batch or
        // leave the DB row behind forever because of a single failure.
        this.logger.warn(`Failed to delete expired recording file ${recording.audioUrl}: ${(err as Error).message}`);
      }
    }

    await this.recordingsRepo.remove(expired);
    this.logger.log(`Deleted ${expired.length} expired safety recording(s)`);
  }
}
