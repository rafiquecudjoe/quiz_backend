import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Enable CORS
  app.enableCors();

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('PDF Processor API')
    .setDescription('NestJS backend for processing exam PDFs with Gemini AI')
    .setVersion('1.0')
    .addTag('pdf')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get('PORT') || 3000;
  await app.listen(port);

  console.log('\n' + '='.repeat(70));
  console.log('🚀 NestJS PDF Processor Backend');
  console.log('='.repeat(70));
  console.log(`📍 Server: http://localhost:${port}`);
  console.log(`📖 API Docs: http://localhost:${port}/api/docs`);
  console.log(`🗄️  Database: MongoDB`);
  console.log('='.repeat(70) + '\n');
}

bootstrap();

