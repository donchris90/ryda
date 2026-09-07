import { UsersService } from './users.service';
import { UserRole } from '../common/enums/user-role.enum';

function makeQueryBuilder() {
  const qb: any = {
    select: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
  };
  return qb;
}

describe('UsersService.listForAdmin() - role filter', () => {
  it(
    'filters by array-overlap against roles, not equality against the legacy singular role field - an ' +
      'account created as a passenger and later also granted admin access must still be found when ' +
      'searching for role=admin, which an equality check on the legacy field would silently miss',
    async () => {
      const qb = makeQueryBuilder();
      const usersRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
      const service = new UsersService(usersRepo as any);

      await service.listForAdmin({ role: UserRole.ADMIN });

      expect(qb.andWhere).toHaveBeenCalledWith('user.roles && :roles', { roles: [UserRole.ADMIN] });
      expect(qb.andWhere).not.toHaveBeenCalledWith('user.role = :role', expect.anything());
    },
  );

  it('selects user.roles so the admin dashboard can actually display every role an account holds', async () => {
    const qb = makeQueryBuilder();
    const usersRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const service = new UsersService(usersRepo as any);

    await service.listForAdmin();

    expect(qb.select).toHaveBeenCalledWith(expect.arrayContaining(['user.roles']));
  });

  it('does not apply a role filter at all when none is given', async () => {
    const qb = makeQueryBuilder();
    const usersRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const service = new UsersService(usersRepo as any);

    await service.listForAdmin({});

    expect(qb.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('roles'), expect.anything());
  });
});
