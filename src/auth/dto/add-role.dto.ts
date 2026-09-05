import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole, SELF_REGISTERABLE_ROLES } from '../../common/enums/user-role.enum';

export class AddRoleDto {
  @ApiProperty({
    enum: SELF_REGISTERABLE_ROLES,
    example: UserRole.DRIVER,
    description: 'Role to add to the currently-authenticated account. Staff/admin roles cannot be self-added.',
  })
  @IsIn(SELF_REGISTERABLE_ROLES, { message: 'role must be one of: passenger, driver, corporate, fleet_owner' })
  role: UserRole;
}
