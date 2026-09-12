import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ride } from '../rides/entities/ride.entity';
import { UsersService } from '../users/users.service';
import { UserRole } from '../common/enums/user-role.enum';
import { AfricasTalkingVoiceProvider } from '../notifications/providers/africas-talking-voice.provider';
import { CallLog, CallStatus } from './entities/call-log.entity';

// Mirrors the local STAFF_ROLES list in RidesService — not exported from
// user-role.enum.ts, so redefined here rather than importing something
// that doesn't exist. Kept in sync manually since both modules need the
// same "who can act on someone else's ride" definition.
const STAFF_ROLES = [UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT, UserRole.DISPATCHER];

/**
 * Masked ride calling: a passenger and driver can reach each other
 * without either app ever seeing the other's real phone number.
 *
 * How the bridge actually happens: Africa's Talking Voice dials the
 * *initiator* first (the person who tapped "Call"), and only once they
 * pick up does AT ask our Voice Callback URL what to do next — that's
 * when we tell it to bridge to the other party's real number. So
 * initiateMaskedCall() only ever starts half the connection; the
 * second half is completed in voiceCallback() below once AT tells us
 * the first leg answered.
 */
@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    @InjectRepository(Ride) private readonly rideRepo: Repository<Ride>,
    @InjectRepository(CallLog) private readonly callLogRepo: Repository<CallLog>,
    private readonly usersService: UsersService,
    private readonly voiceProvider: AfricasTalkingVoiceProvider,
  ) {}

  async initiateMaskedCall(rideId: string, requesterId: string, requesterRole: UserRole) {
    const ride = await this.rideRepo.findOne({ where: { id: rideId } });
    if (!ride) throw new NotFoundException('Ride not found');

    const isPassenger = ride.passengerId === requesterId;
    const isDriver = ride.driverId === requesterId;
    const isStaff = STAFF_ROLES.includes(requesterRole);

    if (!isPassenger && !isDriver && !isStaff) {
      throw new ForbiddenException("You don't have access to this ride");
    }
    if (!ride.driverId) {
      throw new ForbiddenException('No driver assigned to this ride yet');
    }

    // Staff placing a support call bridges driver -> passenger by default.
    const initiatorUserId = isDriver ? ride.driverId : ride.passengerId;
    const calleeUserId = isDriver ? ride.passengerId : ride.driverId;

    const [initiator, callee] = await Promise.all([
      this.usersService.findById(initiatorUserId),
      this.usersService.findById(calleeUserId),
    ]);

    if (!initiator.phone || !callee.phone) {
      throw new ForbiddenException('Missing phone number on file for this ride');
    }

    const result = await this.voiceProvider.initiateCall(initiator.phone);

    const log = this.callLogRepo.create({
      rideId,
      initiatedByUserId: initiatorUserId,
      calleeUserId,
      bridgeToPhone: callee.phone,
      providerSessionId: result.entries?.[0]?.sessionId ?? null,
      status: result.success ? CallStatus.INITIATED : CallStatus.FAILED,
    });
    await this.callLogRepo.save(log);

    if (!result.success) {
      this.logger.warn(`Masked call failed to initiate for ride ${rideId}: ${result.error}`);
      throw new ForbiddenException('Could not place call right now — please try again');
    }

    return { status: 'initiated' };
  }

  /**
   * Africa's Talking Voice callback. Called once when the initiator's
   * leg answers (isActive=1, no dialDurations yet), and again at call
   * end with final duration. Must respond with AT's Voice XML — this
   * is the only place either real number is ever used again after
   * initiateMaskedCall(), and it never leaves the backend.
   */
  async voiceCallback(body: Record<string, string>): Promise<string> {
    const sessionId = body.sessionId;
    const isActive = body.isActive === '1';

    const log = sessionId
      ? await this.callLogRepo.findOne({ where: { providerSessionId: sessionId } })
      : null;

    if (!log) {
      this.logger.warn(`Voice callback for unknown session ${sessionId}`);
      return '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this call could not be connected.</Say></Response>';
    }

    if (!isActive) {
      // Call ended — record final duration if AT included it.
      const duration = Number(body.durationInSeconds ?? body.callDurationInSeconds ?? 0) || null;
      log.status = CallStatus.COMPLETED;
      log.durationSeconds = duration;
      await this.callLogRepo.save(log);
      return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
    }

    // Initiator just answered — bridge them to the other party's real
    // number now. AT displays our shared virtual number as caller ID
    // on both legs, so the callee never sees the initiator's number.
    log.status = CallStatus.BRIDGED;
    await this.callLogRepo.save(log);

    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting your call.</Say><Dial phoneNumbers="${log.bridgeToPhone}"/></Response>`;
  }
}
