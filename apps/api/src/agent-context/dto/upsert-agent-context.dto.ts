import {
  IsString,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/** Hard cap on `content` size, enforced at the DTO layer (see `IsMaxByteLength` below). */
export const AGENT_CONTEXT_MAX_BYTES = 64 * 1024; // 64 KiB

/**
 * Custom class-validator decorator that rejects strings whose UTF-8 byte
 * length exceeds `maxBytes`. Plain `@MaxLength` counts UTF-16 code units,
 * which under-counts multi-byte characters (emoji, CJK, etc.) relative to
 * the actual on-disk/over-the-wire size — this document is meant to be
 * capped by *storage* size, so we measure bytes directly.
 */
function IsMaxByteLength(maxBytes: number, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMaxByteLength',
      target: (object as { constructor: Function }).constructor,
      propertyName,
      constraints: [maxBytes],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'string') return true; // let @IsString handle it
          const [limit] = args.constraints as [number];
          return Buffer.byteLength(value, 'utf8') <= limit;
        },
        defaultMessage(args: ValidationArguments) {
          const [limit] = args.constraints as [number];
          return `${args.property} must not exceed ${limit / 1024} KB (measured in UTF-8 bytes)`;
        },
      },
    });
  };
}

/** Body for `PUT /projects/:projectId/agent-context`. */
export class UpsertAgentContextDto {
  /**
   * The full markdown handoff document. This is a wholesale REPLACE, not a
   * merge/append — callers (agents especially) should read the current
   * content first via GET if they want to preserve any of it.
   */
  @IsString()
  @IsMaxByteLength(AGENT_CONTEXT_MAX_BYTES, {
    message: `content must not exceed ${AGENT_CONTEXT_MAX_BYTES / 1024} KB (measured in UTF-8 bytes)`,
  })
  content!: string;
}
