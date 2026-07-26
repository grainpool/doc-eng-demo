/** Contractual exit codes (contracts.md §7): thrown as CliError, mapped in main(). */

export const EXIT = {
  OK: 0,
  UNEXPECTED: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  VALIDATION: 5,
  REMOTE_UNAVAILABLE: 6,
} as const;

export class CliError extends Error {
  constructor(
    public readonly exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/** HTTP status → contractual exit code. */
export function exitCodeForStatus(status: number): number {
  if (status === 401 || status === 403) return EXIT.AUTH;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    return EXIT.VALIDATION;
  }
  if (status >= 500) return EXIT.REMOTE_UNAVAILABLE;
  return EXIT.UNEXPECTED;
}
