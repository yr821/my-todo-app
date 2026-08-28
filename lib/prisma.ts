import { PrismaClient } from "@prisma/client";

// 開発時はホットリロードのたびに PrismaClient が増えて接続を使い切るため、
// グローバルに1つだけ保持して使い回す
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
