import { ArrayNotEmpty, IsArray, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateWebhookSubscriptionDto {
  @IsString()
  partnerName: string;

  @IsUrl({ require_tld: false }) // require_tld:false so http://localhost URLs work for local testing
  url: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events: string[];
}

export class UpdateWebhookSubscriptionDto {
  @IsOptional()
  @IsString()
  partnerName?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events?: string[];
}
