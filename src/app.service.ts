import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth(): object {
    return {
      status: 'healthy',
      service: 'NestJS PDF Processor',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }
}

