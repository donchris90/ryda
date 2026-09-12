import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { CallLog, CallStatus } from './entities/call-log.entity';

// How long a ringing call is still considered "reachable" if the callee's
// socket reconnects after missing the original call:incoming broadcast
// (e.g. they were on a push-notification-only path and just tapped it).
// Kept in the same ballpark as how long a caller's UI would realistically
// still be showing "Calling..." — see call-manager.ts's own ring timeout
// on the client side. Deliberately NOT the same exact constant shared
// across a network boundary; a few seconds of slack here is safer than
// the two ever drifting out of sync and the server expiring a call the
// caller's screen still shows as ringing.
const PENDING_CALL_WINDOW_MS = 35_000;

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Backs the in-app WebRTC calling flow. This service does NOT relay any
 * signaling itself - that happens over the existing `/tracking` socket
 * namespace's `ride:${rideId}` room (see TrackingGateway's call:* handlers),
 * reusing the connection and room both apps already hold open during an
 * active ride rather than standing up a second socket. This service only
 * does two things a plain socket handler shouldn't own directly: issuing
 * short-lived TURN credentials, and persisting call history.
 */
@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    @InjectRepository(CallLog) private readonly callLogRepo: Repository<CallLog>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Returns the ICE server list a client's RTCPeerConnection needs.
   * STUN alone (Google's public server) is enough when both devices are
   * on networks that allow direct peer-to-peer traversal - which is NOT
   * guaranteed, especially on carrier-grade NAT (common on Nigerian
   * mobile networks). TURN is the fallback relay for when direct
   * traversal fails, and unlike STUN it can't be a fixed public server -
   * anyone who could read a hardcoded TURN credential could relay
   * arbitrary traffic through your server, so credentials here are
   * short-lived and generated per-request via the standard coturn
   * time-limited REST credential mechanism (username is "<expiry
   * unix-timestamp>:<userId>", credential is
   * base64(HMAC-SHA1(sharedSecret, username))) rather than a static
   * username/password pair.
   *
   * Returns STUN-only (still gets calls working for the common case)
   * when TURN_SERVER_URL/TURN_SHARED_SECRET aren't configured, rather
   * than failing the whole call setup - same graceful-degradation
   * pattern as every other optional integration in this project.
   */
  getIceServers(userId: string): { iceServers: IceServer[] } {
    const iceServers: IceServer[] = [
      { urls: this.config.get<string>('webrtc.stunUrls')!.split(',') },
    ];

    const turnUrl = this.config.get<string>('webrtc.turnUrl');
    const turnSecret = this.config.get<string>('webrtc.turnSharedSecret');
    const ttlSeconds = this.config.get<number>('webrtc.turnCredentialTtlSeconds')!;

    if (turnUrl && turnSecret) {
      const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
      const username = `${expiry}:${userId}`;
      const credential = createHmac('sha1', turnSecret).update(username).digest('base64');
      iceServers.push({ urls: turnUrl, username, credential });
    } else {
      this.logger.warn('TURN not configured - calls will only connect when direct P2P traversal succeeds');
    }

    return { iceServers };
  }

  async createCallLog(rideId: string, callerId: string, calleeId: string): Promise<CallLog> {
    return this.callLogRepo.save(this.callLogRepo.create({ rideId, callerId, calleeId }));
  }

  async findById(callId: string): Promise<CallLog | null> {
    return this.callLogRepo.findOne({ where: { id: callId } });
  }

  /**
   * Used when a callee's socket (re)connects — e.g. they were on a
   * screen with no tracking socket open when the call came in, got the
   * push notification instead, and just tapped it (see
   * notification-routing.ts's 'incoming_call' case and call-manager.ts's
   * attach()). A plain socket broadcast only reaches sockets already in
   * the room at the moment it's sent - it is NOT replayed to a socket
   * that joins later, so without this a reconnecting callee would never
   * learn a call is still waiting for them and the caller would be
   * stuck showing "Calling..." with no way to ever fail or succeed.
   */
  async findPendingRingingCall(rideId: string, calleeId: string): Promise<CallLog | null> {
    return this.callLogRepo.findOne({
      where: {
        rideId,
        calleeId,
        status: CallStatus.RINGING,
        createdAt: MoreThan(new Date(Date.now() - PENDING_CALL_WINDOW_MS)),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async markAccepted(callId: string): Promise<void> {
    await this.callLogRepo.update(callId, { status: CallStatus.ACCEPTED, acceptedAt: new Date() });
  }

  async markRejected(callId: string): Promise<void> {
    await this.callLogRepo.update(callId, { status: CallStatus.REJECTED, endedAt: new Date() });
  }

  async markOngoing(callId: string): Promise<void> {
    await this.callLogRepo.update(callId, { status: CallStatus.ONGOING });
  }

  async markEnded(callId: string): Promise<CallLog | null> {
    const log = await this.callLogRepo.findOne({ where: { id: callId } });
    if (!log) return null;
    const wasConnected = !!log.acceptedAt;
    const durationSeconds = wasConnected ? Math.round((Date.now() - log.acceptedAt!.getTime()) / 1000) : null;
    const status = wasConnected ? CallStatus.ENDED : CallStatus.MISSED;
    await this.callLogRepo.update(callId, { status, endedAt: new Date(), durationSeconds });
    return { ...log, status, durationSeconds };
  }
}
