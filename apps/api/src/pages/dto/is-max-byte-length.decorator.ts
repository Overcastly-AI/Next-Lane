import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Custom class-validator decorator that rejects strings whose UTF-8 byte
 * length exceeds `maxBytes`. Plain `@MaxLength` counts UTF-16 code units,
 * which under-counts multi-byte characters (emoji, CJK, etc.) relative to
 * the actual on-disk/over-the-wire size — a page body is meant to be capped
 * by *storage* size, so we measure bytes directly.
 *
 * Mirrors `agent-context`'s `IsMaxByteLength` (not shared/extracted — it's a
 * small, self-contained decorator and duplicating it once here keeps each
 * DTO file independently readable, same tradeoff already made there).
 */
export function IsMaxByteLength(
  maxBytes: number,
  validationOptions?: ValidationOptions,
) {
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
          return `${args.property} must not exceed ${Math.floor(limit / 1024)} KB (measured in UTF-8 bytes)`;
        },
      },
    });
  };
}
