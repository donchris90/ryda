import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { User } from './entities/user.entity';
import { UserRole } from '../common/enums/user-role.enum';

export interface CreateUserInput {
  email: string;
  phone?: string | null;
  passwordHash?: string | null;
  firstName: string;
  lastName: string;
  role?: UserRole;
  referredByCode?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    return this.usersRepo.find({ where: { id: In(ids) } });
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { phone } });
  }

  async findByPhoneWithPassword(phone: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.phone = :phone', { phone })
      .getOne();
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { email } });
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  async findByIdWithPassword(id: string): Promise<User | null> {
    return this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
  }

  async findByReferralCode(referralCode: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { referralCode } });
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(input: CreateUserInput): Promise<User> {
    const role = input.role ?? UserRole.PASSENGER;
    const user = this.usersRepo.create({
      ...input,
      role,
      roles: [role],
      referralCode: this.generateReferralCode(),
    });
    return this.usersRepo.save(user);
  }

  /**
   * Adds an additional role to an existing account (e.g. a passenger
   * becoming a driver too) without creating a new user row. Only called
   * from an authenticated context (POST /auth/add-role) — never during
   * unauthenticated registration, since that would let anyone graft a role
   * onto someone else's account just by knowing their email.
   */
  async addRole(userId: string, role: UserRole): Promise<User> {
    const user = await this.findById(userId);
    if (!user.roles.includes(role)) {
      user.roles = [...user.roles, role];
      await this.usersRepo.save(user);
    }
    return user;
  }

  async markPhoneVerified(userId: string): Promise<void> {
    await this.usersRepo.update(userId, { isPhoneVerified: true });
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.usersRepo.update(userId, { isEmailVerified: true });
  }

  async deactivate(userId: string): Promise<void> {
    await this.usersRepo.update(userId, { isActive: false });
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.usersRepo.update(userId, { passwordHash });
  }

  async save(user: User): Promise<User> {
    return this.usersRepo.save(user);
  }

  async setProfilePhoto(userId: string, url: string): Promise<User> {
    const user = await this.findById(userId);
    user.profilePhotoUrl = url;
    return this.usersRepo.save(user);
  }

  /** Strips passwordHash before returning a user object over the API — reused wherever a User is returned directly. */
  sanitize(user: User): Omit<User, 'passwordHash'> {
    const { passwordHash, ...safe } = user;
    return safe;
  }

  /**
   * Applies a new 1-5 rating (given by a driver, rating the passenger) to
   * the passenger's rolling average.
   */
  async applyRating(userId: string, ratingValue: number): Promise<User> {
    const user = await this.findById(userId);
    const currentAvg = parseFloat(user.rating);
    const newCount = user.ratingCount + 1;
    const newAvg = (currentAvg * user.ratingCount + ratingValue) / newCount;

    user.rating = newAvg.toFixed(2);
    user.ratingCount = newCount;
    return this.usersRepo.save(user);
  }

  private generateReferralCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }

  /**
   * `GET /search/passengers` already existed but is a lightweight
   * type-ahead tool — hardcoded limit of 10, no pagination, no total
   * count, no status filter, and a thin field set. Not enough for a
   * real browsable admin list. This is a proper one: role/status
   * filtering, search across name/phone/email, real pagination.
   */
  async listForAdmin(filter?: { role?: UserRole; isActive?: boolean; search?: string }, page = 1, limit = 25) {
    const qb = this.usersRepo
      .createQueryBuilder('user')
      .select([
        'user.id', 'user.phone', 'user.email', 'user.role', 'user.firstName', 'user.lastName',
        'user.isPhoneVerified', 'user.isEmailVerified', 'user.isActive', 'user.rating', 'user.ratingCount',
        'user.referralCode', 'user.createdAt',
      ])
      .orderBy('user.createdAt', 'DESC');

    if (filter?.role) qb.andWhere('user.role = :role', { role: filter.role });
    if (filter?.isActive !== undefined) qb.andWhere('user.isActive = :isActive', { isActive: filter.isActive });
    if (filter?.search) {
      qb.andWhere(
        '(user.firstName ILIKE :search OR user.lastName ILIKE :search OR user.phone ILIKE :search OR user.email ILIKE :search)',
        { search: `%${filter.search}%` },
      );
    }

    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return { items: items.map((u) => this.sanitize(u)), total, page, limit };
  }

  /**
   * No way to suspend or reactivate an account existed anywhere in the
   * codebase before this — a real gap for an admin dealing with an
   * abusive or fraudulent account. Deliberately just flips the flag
   * rather than also force-logging-out active sessions or cancelling
   * in-progress rides — those are real follow-up concerns for a genuine
   * production trust-and-safety flow, not something to bolt on silently
   * here without dedicated design.
   */
  async setActive(userId: string, isActive: boolean): Promise<User> {
    const user = await this.findById(userId);
    user.isActive = isActive;
    return this.usersRepo.save(user);
  }
}
