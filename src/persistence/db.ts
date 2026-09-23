import { PrismaClient } from "@prisma/client";
const globalDb = globalThis as unknown as { prodplanDb?: PrismaClient };
export const db = globalDb.prodplanDb ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalDb.prodplanDb = db;
