import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/Schema.ts',
  out: './src/lib/db/migrations',
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
