/**
 * Migration generation. `drizzle-kit generate` prints SQL from `schema.ts` — the direction
 * ARCHITECTURE §4 requires: "code schema prints DB schema, never the reverse". Nothing in this
 * repository introspects a live database to produce types.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  // Read at generate time only. There is no credential in this repository.
  dbCredentials: { url: process.env['DATABASE_URL'] ?? 'postgres://ada:ada@localhost:55432/ada' },
  strict: true,
  verbose: true,
});
