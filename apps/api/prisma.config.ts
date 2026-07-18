import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Client generation does not need a live database URL. Commands that do
    // connect receive DATABASE_URL from the API env or the startup scripts.
    url:
      process.env.DATABASE_URL ??
      'postgresql://prisma:prisma@127.0.0.1:5432/prisma',
  },
});
