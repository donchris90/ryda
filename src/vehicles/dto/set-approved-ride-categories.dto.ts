import { IsArray, IsEnum } from 'class-validator';
import { RideCategory } from '../../common/enums/ride.enum';

export class SetApprovedRideCategoriesDto {
  @IsArray()
  @IsEnum(RideCategory, { each: true })
  categories: RideCategory[];
}
