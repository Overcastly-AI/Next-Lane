import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Minimal structural types for the HTTP request/response we touch. We avoid a
 * hard dependency on `express` types (not installed as a dev dep here) while
 * staying strictly typed against the surface we actually use.
 */
interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  json(body: unknown): unknown;
}

interface HttpRequestLike {
  method: string;
  url: string;
}

/**
 * Consistent error envelope returned to clients for every unhandled error.
 * Mirrors the shape Nest's built-in HttpException produces so existing
 * clients see no behavioural change for HTTP errors.
 */
export interface ErrorEnvelope {
  statusCode: number;
  message: string;
  error: string;
}

/**
 * Global catch-all exception filter.
 *
 * Responsibilities:
 *  - Pass through existing `HttpException`s unchanged (status + message), so
 *    deliberate 4xx responses from controllers/services keep their semantics.
 *  - Map known `PrismaClientKnownRequestError` codes to clean HTTP statuses:
 *      P2002 (unique constraint)   -> 409 Conflict
 *      P2025 (record not found)    -> 404 Not Found
 *      P2003 (FK constraint)       -> 400 Bad Request
 *  - Fall back to 500 for everything else (e.g. rankBetween edge cases,
 *    unexpected throws), NEVER leaking stack traces or internal Prisma detail
 *    to the client. Internal details are logged server-side instead.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  private get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponseLike>();
    const request = ctx.getRequest<HttpRequestLike>();

    const envelope = this.toEnvelope(exception, request);
    response.status(envelope.statusCode).json(envelope);
  }

  /**
   * Resolve any thrown value into a client-safe error envelope, logging
   * server-side detail for anything that isn't a deliberate HttpException.
   */
  private toEnvelope(exception: unknown, request?: HttpRequestLike): ErrorEnvelope {
    // 1) Deliberate HTTP errors: preserve status + message verbatim.
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    // 2) Known Prisma errors: map to a clean status + generic message.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.fromPrisma(exception);
      if (mapped) {
        // Log the underlying Prisma detail server-side for diagnosis; the
        // client only ever sees the generic mapped message.
        this.logger.warn(
          `Prisma ${exception.code} on ${this.describeRequest(request)}: ${exception.message}`,
        );
        return mapped;
      }
    }

    // 3) Everything else: 500, suppress internals (always to the client; and
    //    suppress server logs of full stack in production-style verbosity).
    this.logUnexpected(exception, request);
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }

  private fromHttpException(exception: HttpException): ErrorEnvelope {
    const status = exception.getStatus();
    const res = exception.getResponse();

    // HttpException responses are either a string or an object with
    // `message`/`error`. Normalise both into our envelope.
    if (typeof res === 'string') {
      return {
        statusCode: status,
        message: res,
        error: this.statusName(status),
      };
    }

    const obj = res as Record<string, unknown>;
    const message = this.normaliseMessage(obj.message) ?? exception.message;
    const error =
      typeof obj.error === 'string' ? obj.error : this.statusName(status);

    return { statusCode: status, message, error };
  }

  private fromPrisma(
    exception: Prisma.PrismaClientKnownRequestError,
  ): ErrorEnvelope | null {
    switch (exception.code) {
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'A record with this value already exists.',
          error: 'Conflict',
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'The requested record was not found.',
          error: 'Not Found',
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'The operation references a record that does not exist.',
          error: 'Bad Request',
        };
      default:
        return null;
    }
  }

  /** class-validator yields `message` as a string[]; flatten to one line. */
  private normaliseMessage(message: unknown): string | undefined {
    if (typeof message === 'string') {
      return message;
    }
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    return undefined;
  }

  private logUnexpected(exception: unknown, request?: HttpRequestLike): void {
    const where = this.describeRequest(request);
    if (exception instanceof Error) {
      // In production, suppress the noisy stack and log only the message; in
      // development, keep the stack to aid debugging. The client never sees
      // either way.
      if (this.isProduction) {
        this.logger.error(`Unhandled error on ${where}: ${exception.message}`);
      } else {
        this.logger.error(
          `Unhandled error on ${where}: ${exception.message}`,
          exception.stack,
        );
      }
    } else {
      this.logger.error(`Unhandled non-error thrown on ${where}`);
    }
  }

  private describeRequest(request?: HttpRequestLike): string {
    if (!request) {
      return 'unknown request';
    }
    return `${request.method} ${request.url}`;
  }

  private statusName(status: number): string {
    const name = HttpStatus[status] as string | undefined;
    if (!name) {
      return 'Error';
    }
    // HttpStatus enum keys are SCREAMING_SNAKE_CASE; produce "Bad Request".
    return name
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
