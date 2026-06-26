import clsx, { type ClassValue } from 'clsx';

/** Thin wrapper over clsx for conditional Tailwind class composition. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
