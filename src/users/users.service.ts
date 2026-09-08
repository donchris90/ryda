import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

  /**
   * The first self-service "edit your own name/email/phone" endpoint in
   * the app - previously an account's basic info was fixed at
   * registration with no way to correct it later (a typo'd name, a
   * changed number) short of a direct database edit.
   *
   * Email/phone changes reset the corresponding isVerified flag rather
   * than leaving it true - a verified badge on a value nobody has
   * actually confirmed yet would be actively misleading (and this
   * mirrors registration itself, where a fresh email/phone always
   * starts unverified). The driver/passenger apps already have a
   * resend-verification flow from onboarding; this doesn't duplicate
   * that, it just puts the account back into the same "needs
   * verification" state a first-time signup would be in.
   *
   * Uniqueness is checked explicitly (not just left to the DB's unique
   * constraint) so a genuinely-taken email/phone comes back as a clear
   * BadRequestException instead of a raw constraint-violation error
   * leaking through as an unhandled 500.
   */
  async updateProfile(
    userId: string,
    dto: { firstName?: string; lastName?: string; email?: string; phone?: string },
  ): Promise<User> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.firstName !== undefined) user.firstName = dto.firstName;
    if (dto.lastName !== undefined) user.lastName = dto.lastName;

    if (dto.email !== undefined && dto.email !== user.email) {
      const existing = await this.findByEmail(dto.email);
      if (existing && existing.id !== userId) {
        throw new BadRequestException('That email is already in use by another account.');
      }
      user.email = dto.email;
      user.isEmailVerified = false;
    }

    if (dto.phone !== undefined && dto.phone !== user.phone) {
      const existing = await this.findByPhone(dto.phone);
      if (existing && existing.id !== userId) {
        throw new BadRequestException('That phone number is already in use by another account.');
      }
      user.phone = dto.phone;
      user.isPhoneVerified = false;
    }

    return this.usersRepo.save(user);
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

  /** Every user holding at least one of the given roles - `roles` is a Postgres array column, so this uses the `&&` overlap operator, not a plain equality match. */
  async findByRoles(roles: UserRole[]): Promise<User[]> {
    return this.usersRepo
      .createQueryBuilder('user')
      .where('user.roles && :roles', { roles })
      .getMany();
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
        // roles (the array) added alongside the legacy role column -
        // the admin dashboard's user list needs it to show every role an
        // account actually holds, not just whichever one it was created
        // with (see the User entity's own comment on why those can
        // diverge). Previously missing entirely, meaning the frontend
        // had no way to display this even if it wanted to.
        'user.id', 'user.phone', 'user.email', 'user.role', 'user.roles', 'user.firstName', 'user.lastName',
        'user.isPhoneVerified', 'user.isEmailVerified', 'user.isActive', 'user.rating', 'user.ratingCount',
        'user.referralCode', 'user.createdAt',
      ])
      .orderBy('user.createdAt', 'DESC');

    // Array-overlap against roles, not an equality check against the
    // legacy singular field (see listByRoles()'s `user.roles && :roles`
    // above for the established correct pattern in this same file) -
    // filtering by role = :role would silently miss any account that
    // holds that role but was created with a different one, which is
    // exactly backwards for an admin search whose purpose is finding
    // everyone who currently has a given role.
    if (filter?.role) qb.andWhere('user.roles && :roles', { roles: [filter.role] });
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
