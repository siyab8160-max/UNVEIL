import { PrismaClient } from "@prisma/client";
import { keccak256, toUtf8Bytes } from "ethers";
import prisma from "./db";
import { AnomalyEngine } from "./anomaly-engine";

export interface CreateConsumerReportInput {
  lotID?: string;
  certificateID?: string;
  issueType: string;
  reporterReference: string;
  evidence?: Record<string, any>;
}

export function computeDedupeKey(reporterReference: string, targetId: string, issueType: string): string {
  const normalizedTarget = targetId.trim().toLowerCase();
  const normalizedReporter = reporterReference.trim().toLowerCase();
  const normalizedIssue = issueType.trim().toUpperCase();
  const rawKey = `${normalizedReporter}:${normalizedTarget}:${normalizedIssue}`;
  return keccak256(toUtf8Bytes(rawKey));
}

export class ConsumerReportService {
  private db: PrismaClient;
  private anomalyEngine: AnomalyEngine;

  constructor(dbClient: PrismaClient = prisma, anomalyEngine?: AnomalyEngine) {
    this.db = dbClient;
    this.anomalyEngine = anomalyEngine || new AnomalyEngine(dbClient);
  }

  public async submitReport(input: CreateConsumerReportInput) {
    if (!input.lotID && !input.certificateID) {
      throw new Error("Either lotID or certificateID must be specified");
    }

    const targetId = input.lotID || input.certificateID!;
    const dedupeKey = computeDedupeKey(input.reporterReference, targetId, input.issueType);

    // Create report
    const report = await this.db.consumerReport.create({
      data: {
        lotID: input.lotID || null,
        certificateID: input.certificateID || null,
        issueType: input.issueType,
        reporterReference: input.reporterReference,
        dedupeKey,
        evidence: input.evidence || {},
      },
    });

    // Trigger escalation check
    await this.anomalyEngine.checkEscalation({
      lotID: input.lotID,
      certificateID: input.certificateID,
    });

    return report;
  }
}

export default ConsumerReportService;
