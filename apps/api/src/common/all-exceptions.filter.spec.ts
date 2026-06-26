import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter, ErrorEnvelope } from './all-exceptions.filter';

/**
 * DB-free unit tests for the global exception filter's mapping logic. We assert
 * the response status + envelope produced for each class of thrown value, and
 * that internal Prisma / stack detail is never leaked to the client.
 */

interface CapturedResponse {
  statusCode?: number;
  body?: ErrorEnvelope;
}

function makeHost(): { host: ArgumentsHost; captured: CapturedResponse } {
  const captured: CapturedResponse = {};
  const response = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(body: ErrorEnvelope) {
      captured.body = body;
      return this;
    },
  };
  const request = { method: 'POST', url: '/api/labels' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Prisma failure ${code}`, {
    code,
    clientVersion: 'test',
  });
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    // Silence the filter's logger during tests.
    jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('HttpException pass-through', () => {
    it('preserves status and message of a NotFoundException', () => {
      const { host, captured } = makeHost();
      filter.catch(new NotFoundException('Issue not found'), host);

      expect(captured.statusCode).toBe(HttpStatus.NOT_FOUND);
      expect(captured.body).toEqual({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Issue not found',
        error: 'Not Found',
      });
    });

    it('flattens class-validator message arrays into one line', () => {
      const { host, captured } = makeHost();
      filter.catch(
        new BadRequestException(['name must be shorter', 'color is invalid']),
        host,
      );

      expect(captured.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(captured.body?.message).toBe(
        'name must be shorter, color is invalid',
      );
      expect(captured.body?.error).toBe('Bad Request');
    });

    it('handles a string-only HttpException response', () => {
      const { host, captured } = makeHost();
      filter.catch(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT), host);

      expect(captured.statusCode).toBe(HttpStatus.I_AM_A_TEAPOT);
      expect(captured.body?.message).toBe('teapot');
    });

    it('keeps a ConflictException unchanged', () => {
      const { host, captured } = makeHost();
      filter.catch(new ConflictException('Already active'), host);

      expect(captured.statusCode).toBe(HttpStatus.CONFLICT);
      expect(captured.body?.message).toBe('Already active');
    });
  });

  describe('Prisma error mapping', () => {
    it('maps P2002 unique violation to 409', () => {
      const { host, captured } = makeHost();
      filter.catch(prismaError('P2002'), host);

      expect(captured.statusCode).toBe(HttpStatus.CONFLICT);
      expect(captured.body?.error).toBe('Conflict');
      // The raw Prisma message must never reach the client.
      expect(captured.body?.message).not.toContain('Prisma failure');
    });

    it('maps P2025 record-not-found to 404', () => {
      const { host, captured } = makeHost();
      filter.catch(prismaError('P2025'), host);

      expect(captured.statusCode).toBe(HttpStatus.NOT_FOUND);
      expect(captured.body?.error).toBe('Not Found');
      expect(captured.body?.message).not.toContain('Prisma failure');
    });

    it('maps P2003 FK violation to 400', () => {
      const { host, captured } = makeHost();
      filter.catch(prismaError('P2003'), host);

      expect(captured.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(captured.body?.error).toBe('Bad Request');
      expect(captured.body?.message).not.toContain('Prisma failure');
    });

    it('falls back to 500 for an unmapped Prisma code', () => {
      const { host, captured } = makeHost();
      filter.catch(prismaError('P2010'), host);

      expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(captured.body?.message).toBe('Internal server error');
      expect(captured.body?.message).not.toContain('Prisma failure');
    });
  });

  describe('unexpected error fallback', () => {
    it('maps an arbitrary Error to a clean 500 without leaking the message', () => {
      const { host, captured } = makeHost();
      filter.catch(new Error('rankBetween: cannot rank between equal keys'), host);

      expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(captured.body).toEqual({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        error: 'Internal Server Error',
      });
    });

    it('handles a thrown non-Error value', () => {
      const { host, captured } = makeHost();
      filter.catch('boom', host);

      expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(captured.body?.message).toBe('Internal server error');
    });

    it('suppresses the stack trace in production logs', () => {
      process.env.NODE_ENV = 'production';
      const errorSpy = jest.spyOn(filter['logger'], 'error');
      const { host } = makeHost();
      const err = new Error('secret internal detail');

      filter.catch(err, host);

      // Logged with no stack argument in production.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0].length).toBe(1);
    });

    it('includes the stack in non-production logs', () => {
      process.env.NODE_ENV = 'development';
      const errorSpy = jest.spyOn(filter['logger'], 'error');
      const { host } = makeHost();

      filter.catch(new Error('debuggable detail'), host);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0].length).toBe(2);
    });
  });
});
