import { PrismaClient } from "@prisma/client";
import { keccak256, toUtf8Bytes } from "ethers";
import prisma from "./db";

export class ReportAnchoringService {
  private db: PrismaClient;

  constructor(dbClient: PrismaClient = prisma) {
    this.db = dbClient;
  }

  /**
   * Generates a batch integrity anchor for reports submitted up to `untilTimestamp`.
   * Follows canonical deterministic serialization and keccak256 hashing.
   */
  public async createBatchAnchor(untilTimestamp: Date = new Date()): Promise<any> {
    // 1. Find last batch anchor to determine fromTimestamp
    const lastBatch = await this.db.reportBatchAnchor.findFirst({
      orderBy: { batchNumber: "desc" },
    });

    const nextBatchNumber = lastBatch ? lastBatch.batchNumber + 1 : 1;
    const fromTimestamp = lastBatch ? lastBatch.toTimestamp : new Date(0);

    // 2. Fetch all reports in interval [fromTimestamp, untilTimestamp]
    const reports = await this.db.consumerReport.findMany({
      where: {
        submittedAt: {
          gt: fromTimestamp,
          lte: untilTimestamp,
        },
      },
      orderBy: {
        reportID: "asc", // Deterministic canonical order
      },
    });

    if (reports.length === 0) {
      return null;
    }

    // 3. Canonically serialize report payloads
    const serializedReports = reports.map((r) => {
      return JSON.stringify({
        reportID: r.reportID,
        lotID: r.lotID,
        certificateID: r.certificateID,
        issueType: r.issueType,
        submittedAt: r.submittedAt.toISOString(),
        dedupeKey: r.dedupeKey,
      });
    });

    // 4. Compute composite keccak256 canonical hash
    const compositePayload = serializedReports.join("\n");
    const canonicalHash = keccak256(toUtf8Bytes(compositePayload));

    // 5. Store anchor
    const anchor = await this.db.reportBatchAnchor.create({
      data: {
        batchNumber: nextBatchNumber,
        fromTimestamp,
        toTimestamp: untilTimestamp,
        reportCount: reports.length,
        canonicalHash,
      },
    });

    console.log(
      `[AnchoringService] Anchored batch #${nextBatchNumber} with ${reports.length} reports. Hash: ${canonicalHash}`
    );

    return anchor;
  }
}

export default ReportAnchoringService;
