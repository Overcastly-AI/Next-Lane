import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { assertAuthConfig } from './auth/auth.config';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { APP_VERSION } from './common/app-version';

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

  /*
   * The API reference.
   *
   * Two surfaces from one document: `/api` is the Swagger UI a person reads,
   * `/api-json` is the OpenAPI spec a generator, Postman or an agent consumes.
   * The JSON one is arguably the more important of the two for this product
   * and was previously undocumented anywhere — it is now named in the
   * description, in the README and in the docs site.
   *
   * `.setVersion(APP_VERSION)` rather than a literal: this said `0.1.0` for
   * fifteen minor releases, so every client generated from it carried a
   * version that had not been true since the first week.
   *
   * THE BODIES COME FROM `apps/api/nest-cli.json`. Every request schema in
   * this document is synthesised by the `@nestjs/swagger` CLI plugin from the
   * DTO's TypeScript types, its `class-validator` decorators and the JSDoc
   * above each property. Without that plugin every schema emits as a bare
   * `{"type": "object"}` with no properties — which is what shipped until
   * v0.17: the reference listed 89 DTOs by name and not one of their fields,
   * so nobody could tell what to put in a request body. Do not remove the
   * plugin, and do not set `removeComments` back to true in tsconfig.json.
   */
  const config = new DocumentBuilder()
    .setTitle('Next Lane API')
    .setDescription(
      [
        'Open-source, self-hosted issue & project tracker.',
        '',
        '**Authenticating.** Every route below takes a bearer token. Create a',
        'Personal Access Token in the app under Settings → API tokens, then send',
        'it as `Authorization: Bearer nlp_...`. Tokens can be scoped (for example',
        '`issues:read` only), and a project can be locked to read-only for tokens',
        'in Project settings → Agent access.',
        '',
        '**Machine-readable spec.** `GET /api-json` returns this document as',
        'OpenAPI 3, for client generators, Postman/Insomnia, or an agent reading',
        'the surface directly.',
        '',
        '**Request bodies.** Each endpoint below documents its body field by',
        'field — type, whether it is required, allowed enum values and length or',
        'range limits — and *Try it out* pre-fills a skeleton you can edit. Two',
        'things to know before you send one: bodies are validated strictly, so an',
        'unknown property is a `400` rather than being ignored, and anything not',
        'marked required may simply be omitted.',
        '',
        '**Events.** For push rather than poll, subscribe a webhook in Project',
        'settings → Webhooks.',
      ].join('\n'),
    )
    .setVersion(APP_VERSION)
    /*
     * Named 'bearer' deliberately — that is the default name the bare
     * `@ApiBearerAuth()` on every controller refers to, and renaming the
     * scheme here would leave those decorators pointing at a scheme that no
     * longer exists (operations silently lose their padlock).
     *
     * `bearerFormat` said 'JWT', which is only half true and the misleading
     * half: a browser session uses a JWT, but a script — the audience of this
     * page — uses a Personal Access Token, and someone reading 'JWT' goes
     * looking for a login endpoint they do not need.
     */
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Personal Access Token',
        description:
          'Paste a Personal Access Token (`nlp_...`) from Settings → API ' +
          'tokens. Do not include the word "Bearer" — it is added for you. ' +
          'A session JWT works here too, but a token is what a script wants.',
      },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);

  /*
   * Exposure is a deployment decision, so it is a switch rather than a
   * constant — but it defaults to ON. This is a self-hosted, open-source
   * tracker whose own README sends people to `/api`, and an install where the
   * reference silently vanished would be a worse surprise than one that
   * publishes its API surface to whoever can already reach the API origin.
   * Set `API_DOCS_ENABLED=false` to turn both surfaces off on an
   * internet-facing deployment that would rather not advertise them.
   */
  const docsEnabled = process.env.API_DOCS_ENABLED !== 'false';
  if (docsEnabled) {
    /*
     * 253 operations is a lot to scroll. `filter` gives the reader a search
     * box, the sorters make the list predictable rather than
     * registration-ordered, and `persistAuthorization` keeps the token you
     * pasted across a reload — without it, the embedded reference on
     * /developers logs you out every time the page re-renders, which reads as
     * "Try it out is broken".
     */
    SwaggerModule.setup('api', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        filter: true,
        docExpansion: 'list',
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        defaultModelsExpandDepth: 3,
        defaultModelExpandDepth: 3,
      },
      customSiteTitle: 'Next Lane API reference',
    });
  }

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(
    docsEnabled
      ? `Next Lane API listening on :${port} — reference at /api, OpenAPI at /api-json`
      : `Next Lane API listening on :${port} — API reference disabled (API_DOCS_ENABLED=false)`,
    'Bootstrap',
  );
}

bootstrap().catch((err) => {
  // Use process.stderr at this point — the pino logger may not be available
  // if bootstrap itself failed before the app was created.
  process.stderr.write(`Failed to start Next Lane API: ${String(err)}\n`);
  process.exit(1);
});
