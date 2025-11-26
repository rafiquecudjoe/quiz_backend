import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Enable CORS for frontend and Wix
  app.enableCors({
    origin: [
      'http://localhost:5173',  // Local dev
      'http://localhost:3000',  // Local dev alternate
      /\.vercel\.app$/,         // All Vercel deployments
      /\.wixsite\.com$/,        // Wix sites
      /\.editorx\.io$/,         // EditorX sites
      'https://c1d24112188d.ngrok-free.app'
    ],
    credentials: true,
  });

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

  const port = configService.get('PORT') || 3005;

  // Bind to 0.0.0.0 for Docker (essential for container networking)
  await app.listen(port, '0.0.0.0');

  console.log('\n' + '='.repeat(70));
  console.log('🚀 NestJS PDF Processor Backend');
  console.log('='.repeat(70));
  console.log(`📍 Server: http://0.0.0.0:${port}`);
  console.log(`📖 API Docs: http://0.0.0.0:${port}/api/docs`);
  console.log(`🗄️  Database: MongoDB`);
  console.log(`🐍 Python: ${configService.get('PYTHON_VENV_PATH')}`);
  console.log('='.repeat(70) + '\n');
}

bootstrap().catch((error) => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});

