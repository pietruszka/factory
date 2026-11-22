import { z } from 'zod';

import { EXIT_CODES } from './exit-codes.js';

/** One problem in the `--json` envelope. */
export const CliErrorEntrySchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  where: z.string().optional(),
  next: z.string().optional(),
});

/**
 * The single JSON document printed by every command in `--json` mode (NFR-39, P-9).
 * Run-related fields join this schema in the tickets that add run commands.
 */
export const CliOutputSchema = z
  .object({
    schema_version: z.literal(1),
    /** The command name; an empty string when none was given. */
    command: z.string(),
    ok: z.boolean(),
    exit_code: z.number().int().min(EXIT_CODES.ok).max(EXIT_CODES.internal),
    message: z.string(),
    errors: z.array(CliErrorEntrySchema),
    /** What to run next, for example `factory help`, or null. */
    next_command: z.string().nullable(),
    /** Command-specific payload. */
    data: z.unknown().optional(),
  })
  .refine((envelope) => envelope.ok === (envelope.exit_code === EXIT_CODES.ok), {
    message: 'ok must be true exactly when exit_code is 0',
  });

export type CliErrorEntry = z.infer<typeof CliErrorEntrySchema>;
export type CliOutput = z.infer<typeof CliOutputSchema>;
