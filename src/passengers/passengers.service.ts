import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PassengerProfile } from './entities/passenger-profile.entity';
import { FavouritePlace, FavouritePlaceType } from './entities/favourite-place.entity';
import { EmergencyContact } from './entities/emergency-contact.entity';
import { KycStatus } from '../common/enums/driver-status.enum';
import {
  BlacklistPassengerDto,
  CreateEmergencyContactDto,
  CreateFavouritePlaceDto,
  SetAddressDto,
  SubmitVerificationDto,
  UpdatePreferencesDto,
} from './dto/passengers.dto';

@Injectable()
export class PassengersService {
  constructor(
    @InjectRepository(PassengerProfile)
    private readonly profilesRepo: Repository<PassengerProfile>,
    @InjectRepository(FavouritePlace)
    private readonly favouritesRepo: Repository<FavouritePlace>,
    @InjectRepository(EmergencyContact)
    private readonly contactsRepo: Repository<EmergencyContact>,
  ) {}

  /** Passengers don't go through an explicit onboarding step — the profile
   * is created lazily the first time it's needed. */
  async getOrCreate(userId: string): Promise<PassengerProfile> {
    let profile = await this.profilesRepo.findOne({ where: { userId } });
    if (!profile) {
      profile = await this.profilesRepo.save(this.profilesRepo.create({ userId }));
    }
    return profile;
  }

  async findByUserId(userId: string): Promise<PassengerProfile> {
    const profile = await this.profilesRepo.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('Passenger profile not found');
    return profile;
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<PassengerProfile> {
    const profile = await this.getOrCreate(userId);
    Object.assign(profile, dto);
    return this.profilesRepo.save(profile);
  }

  async submitVerification(userId: string, dto: SubmitVerificationDto): Promise<PassengerProfile> {
    const profile = await this.getOrCreate(userId);
    profile.verificationStatus = KycStatus.SUBMITTED;
    if (dto.idDocumentUrl) profile.idDocumentUrl = dto.idDocumentUrl;
    return this.profilesRepo.save(profile);
  }

  async setVerificationStatus(userId: string, status: KycStatus): Promise<PassengerProfile> {
    const profile = await this.getOrCreate(userId);
    profile.verificationStatus = status;
    return this.profilesRepo.save(profile);
  }

  async setBlacklist(userId: string, dto: BlacklistPassengerDto): Promise<PassengerProfile> {
    const profile = await this.getOrCreate(userId);
    profile.isBlacklisted = dto.blacklisted;
    profile.blacklistReason = dto.blacklisted ? (dto.reason ?? 'No reason provided') : null;
    return this.profilesRepo.save(profile);
  }

  /** Throws if the passenger is blacklisted — call before letting them request a ride. */
  async assertNotBlacklisted(userId: string): Promise<void> {
    const profile = await this.profilesRepo.findOne({ where: { userId } });
    if (profile?.isBlacklisted) {
      throw new ForbiddenException('This account is restricted from booking rides');
    }
  }

  async recordTripOutcome(
    userId: string,
    outcome: 'completed' | 'cancelled',
    fareAmount?: number,
  ): Promise<void> {
    const profile = await this.getOrCreate(userId);
    profile.totalRides += 1;
    if (outcome === 'completed') {
      profile.completedRides += 1;
      if (fareAmount) {
        profile.totalSpend = (parseFloat(profile.totalSpend) + fareAmount).toFixed(2);
      }
    } else {
      profile.cancelledRides += 1;
    }
    await this.profilesRepo.save(profile);
  }

  // ---- Home / Work addresses (special favourite place types) ----

  async setHome(userId: string, dto: SetAddressDto): Promise<FavouritePlace> {
    return this.upsertTypedPlace(userId, FavouritePlaceType.HOME, 'Home', dto);
  }

  async setWork(userId: string, dto: SetAddressDto): Promise<FavouritePlace> {
    return this.upsertTypedPlace(userId, FavouritePlaceType.WORK, 'Work', dto);
  }

  private async upsertTypedPlace(
    userId: string,
    type: FavouritePlaceType,
    label: string,
    dto: SetAddressDto,
  ): Promise<FavouritePlace> {
    let place = await this.favouritesRepo.findOne({ where: { userId, type } });
    if (!place) {
      place = this.favouritesRepo.create({ userId, type, label });
    }
    place.lat = dto.lat;
    place.lng = dto.lng;
    place.address = dto.address;
    return this.favouritesRepo.save(place);
  }

  // ---- Favourite places ----

  async listFavourites(userId: string): Promise<FavouritePlace[]> {
    return this.favouritesRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async addFavourite(userId: string, dto: CreateFavouritePlaceDto): Promise<FavouritePlace> {
    const place = this.favouritesRepo.create({
      userId,
      type: dto.type ?? FavouritePlaceType.OTHER,
      label: dto.label,
      lat: dto.lat,
      lng: dto.lng,
      address: dto.address,
    });
    return this.favouritesRepo.save(place);
  }

  async removeFavourite(userId: string, id: string): Promise<{ removed: boolean }> {
    const result = await this.favouritesRepo.delete({ id, userId });
    return { removed: (result.affected ?? 0) > 0 };
  }

  // ---- Emergency contacts ----

  async listEmergencyContacts(userId: string): Promise<EmergencyContact[]> {
    return this.contactsRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async addEmergencyContact(userId: string, dto: CreateEmergencyContactDto): Promise<EmergencyContact> {
    const contact = this.contactsRepo.create({ userId, ...dto });
    return this.contactsRepo.save(contact);
  }

  async removeEmergencyContact(userId: string, id: string): Promise<{ removed: boolean }> {
    const result = await this.contactsRepo.delete({ id, userId });
    return { removed: (result.affected ?? 0) > 0 };
  }
}
