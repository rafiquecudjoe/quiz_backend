import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Root endpoint' })
  getHello(): object {
    return this.appService.getHealth();
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint' })
  getHealth(): object {
    return this.appService.getHealth();
  }

  @Get('debug/config')
  @ApiOperation({ summary: 'Debug: Check configuration' })
  getConfig(): object {
    const resendApiKey = this.configService.get('RESEND_API_KEY');
    const resendFromEmail = this.configService.get('RESEND_FROM_EMAIL');
    return {
      resendApiKeyConfigured: !!resendApiKey,
      resendApiKeyLength: resendApiKey?.length || 0,
      resendApiKeyPrefix: resendApiKey?.substring(0, 10) + '...' || 'NOT SET',
      resendFromEmail: resendFromEmail || 'NOT SET',
      allKeys: Object.keys(process.env).filter(k => k.includes('RESEND') || k.includes('NODE')),
    };
  }
}

