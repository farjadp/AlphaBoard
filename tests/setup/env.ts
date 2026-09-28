// Point Prisma at the isolated test schema before any module creates a client.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
