import { IsOptional, IsString } from 'class-validator';

export class StartQuizDto {
    @IsOptional()
    @IsString()
    userName?: string;

    @IsOptional()
    @IsString()
    userEmail?: string;
}
