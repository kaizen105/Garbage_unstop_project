import "server-only";
import { prisma } from "@/lib/db/prisma";

/**
 * live reports with isSynthetic = false and createdAt after asOf fall outside these windows by design.
 */
export async function getAsOf(): Promise<Date> {
  try {
    const aggregate = await prisma.report.aggregate({
      where: { isSynthetic: true },
      _max: { createdAt: true },
    });

    const maxCreatedAt = aggregate._max.createdAt;
    if (!maxCreatedAt) {
      return new Date();
    }

    return maxCreatedAt;
  } catch (error: unknown) {
    console.error("Failed to query getAsOf from database, falling back to new Date():", error);
    return new Date();
  }
}

/**
 * Window end = asOf plus 1 second.
 * W0 = [end - 7d, end), W1 = [end - 14d, end - 7d), and so on.
 */
export function computeWindowEnd(asOf: Date): Date {
  return new Date(asOf.getTime() + 1000);
}
