import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsPhoneNumber, Min } from 'class-validator';

export class CreateSplitFareDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsPhoneNumber(undefined, { each: true })
  participantPhones: string[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  amounts?: number[];
}
