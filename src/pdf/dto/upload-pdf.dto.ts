import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsNumber, Min, Max } from 'class-validator';

export class UploadPdfDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'PDF file to process',
  })
  file: any;

  @ApiProperty({
    description: 'Number of pages to process per API call',
    minimum: 1,
    maximum: 10,
    default: 5,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  batchSize?: number;
}

