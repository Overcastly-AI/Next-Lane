import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { assertAuthConfig } from './auth/auth.config';

async function bootstrap() {
  // Fail fast on misconfigured secrets before doing any work or binding a port.
  assertAuthConfig();

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api', { exclude: ['health'] });
  // Restrict CORS to an explicit allowlist (comma-separated CORS_ORIGINS),
  // defaulting to the local web app. Credentials are only sent to allowed
  // origins — never reflect arbitrary origins.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Next Lane API')
    .setDescription('Open-source, self-hosted issue & project tracker')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Next Lane API listening on :${port} (docs at /api)`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start Next Lane API:', err);
  process.exit(1);
});
