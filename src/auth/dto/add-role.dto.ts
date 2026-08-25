import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../common/enums/user-role.enum';

export class AddRoleDto {
  @ApiProperty({
    enum: [UserRole.PASSENGER, UserRole.DRIVER, UserRole.CORPORATE],
    example: UserRole.DRIVER,
    description: 'Role to add to the currently-authenticated account. Staff/admin roles cannot be self-added.',
  })
  @IsEnum(UserRole)
  role: UserRole;
}
