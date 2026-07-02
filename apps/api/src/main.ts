import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { assertAuthConfig } from './auth/auth.config';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  // Fail fast on misconfigured secrets before doing any work or binding a port.
  assertAuthConfig();

  const app = await NestFactory.create(AppModule, {
    // Buffer Nest's own startup logs so they are flushed through pino after
    // the logger is initialised (rather than falling through to the default
    // console logger during bootstrap).
    bufferLogs: true,
    // Expose the exact request bytes on `req.rawBody` alongside the normal
    // parsed `req.body`. Required by the inbound GitHub webhook receiver
    // (`POST /api/github/webhook/:projectId`) to verify the `X-Hub-Signature-256`
    // HMAC against the precise bytes GitHub signed — re-serializing the parsed
    // JSON would not reproduce byte-identical output. No behavior change for
    // any other route; `req.body` is still populated as before.
    rawBody: true,
  });

  // Route all of Nest's internal logger calls through the pino logger so every
  // log line (framework + application) shares the same structured format.
  app.useLogger(app.get(Logger));

  // Security headers via Helmet (XSS, clickjacking, MIME sniff, etc.).
  app.use(helmet());

  // Catch-all filter: map Prisma errors and unexpected throws to clean,
  // consistent envelopes and suppress internal detail in production.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Note: X-Request-Id echo is handled by CorrelationIdMiddleware registered in
  // AppModule.configure().  It runs inside the NestJS middleware pipeline, after
  // pino-http has set req.id, ensuring all responses carry the correlation id.

  // Exclude both health endpoints from the /api prefix so they remain at
  // /health (readiness) and /health/live (liveness) — not /api/health/*.
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
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

  const logger = app.get(Logger);
  logger.log(`Next Lane API listening on :${port} (docs at /api)`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // Use process.stderr at this point — the pino logger may not be available
  // if bootstrap itself failed before the app was created.
  process.stderr.write(`Failed to start Next Lane API: ${String(err)}\n`);
  process.exit(1);
});
