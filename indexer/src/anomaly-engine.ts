import { PrismaClient, Prisma } from "@prisma/client";
import { Contract, JsonRpcProvider } from "ethers";
import prisma from "./db";
import { CONFIG, YIELD_BENCHMARK_CONFIG } from "./config";
import { CERTIFICATE_REGISTRY_ABI } from "./abi";

export type AnomalyRuleID =
  | "RULE_MASS_BALANCE_OVERFLOW"
  | "RULE_YIELD_IMPLAUSIBILITY"
  | "RULE_STALE_CERTIFICATE_REFERENCE";

export type AnomalySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AnomalyStatus = "FLAGGED" | "INSUFFICIENT_DATA" | "EVALUATED";

export interface AnomalyEvaluationResult {
  ruleID: AnomalyRuleID;
  severity: AnomalySeverity;
  riskScore: number;
  status: AnomalyStatus;
  description: string;
  evidence: Record<string, any>;
  lotID?: string;
  certificateID?: string;
}

export class AnomalyEngine {
  private db: PrismaClient;
  private provider?: JsonRpcProvider;
  private certRegistryContract?: Contract;

  constructor(dbClient: PrismaClient = prisma, rpcUrl?: string) {
    this.db = dbClient;
    const url = rpcUrl || process.env.RPC_URL || CONFIG.RPC_URL;
    if (url && url.startsWith("http") && !url.includes("127.0.0.1:8545")) {
      try {
        this.provider = new JsonRpcProvider(url, undefined, { staticNetwork: true });
        this.certRegistryContract = new Contract(
          CONFIG.CERTIFICATE_REGISTRY_ADDRESS,
          CERTIFICATE_REGISTRY_ABI,
          this.provider
        );
      } catch {
        // Offline / testing fallback
      }
    }
  }

  /**
   * Evaluate Rule 1: RULE_MASS_BALANCE_OVERFLOW
   * Triggered by on-chain MassBalanceAlert event
   */
  public async evaluateMassBalanceOverflow(params: {
    certificateID: string;
    caller: string;
    requestedQuantityGrams: bigint;
    remainingQuantityGrams: bigint;
    reason: string;
    blockNumber: number;
    txHash: string;
  }): Promise<void> {
    const riskScore = 90;
    const severity: AnomalySeverity = "CRITICAL";
    const status: AnomalyStatus = "FLAGGED";
    const description = `On-chain MassBalanceAlert emitted: requested ${params.requestedQuantityGrams}g exceeds remaining quota ${params.remainingQuantityGrams}g. Reason: ${params.reason}`;

    const evidence = {
      certificateID: params.certificateID,
      caller: params.caller,
      requestedQuantityGrams: params.requestedQuantityGrams.toString(),
      remainingCapacityGrams: params.remainingQuantityGrams.toString(),
      reason: params.reason,
      blockNumber: params.blockNumber,
      txHash: params.txHash,
    };

    const flag = await this.db.anomalyFlag.create({
      data: {
        ruleID: "RULE_MASS_BALANCE_OVERFLOW",
        severity,
        riskScore,
        status,
        certificateID: params.certificateID,
        description,
        evidence,
        blockNumber: params.blockNumber,
        txHash: params.txHash,
      },
    });

    // Check if threshold reached to escalate into a Case
    await this.checkEscalation({ certificateID: params.certificateID });
  }

  /**
   * Evaluate Rule 2: RULE_YIELD_IMPLAUSIBILITY
   * Benchmark-based analytical screening for certified organic Arabica coffee
   */
  public async evaluateYieldImplausibility(params: {
    lotID: string;
    certificateID: string;
    quantityGrams: bigint;
    reportedAreaHectares?: Prisma.Decimal | number | null;
    blockNumber: number;
    txHash: string;
  }): Promise<AnomalyEvaluationResult> {
    // 1. Check for missing/non-positive reported area
    if (
      params.reportedAreaHectares === null ||
      params.reportedAreaHectares === undefined ||
      Number(params.reportedAreaHectares) <= 0
    ) {
      const result: AnomalyEvaluationResult = {
        ruleID: "RULE_YIELD_IMPLAUSIBILITY",
        severity: "LOW",
        riskScore: 0,
        status: "INSUFFICIENT_DATA",
        lotID: params.lotID,
        certificateID: params.certificateID,
        description:
          "External reported production area (reportedAreaHectares) is not provided or non-positive. Yield implausibility cannot be calculated.",
        evidence: {
          lotID: params.lotID,
          certificateID: params.certificateID,
          quantityGrams: params.quantityGrams.toString(),
          reportedAreaHectares: null,
          dataStatus: "INSUFFICIENT_DATA",
          benchmarkContext: YIELD_BENCHMARK_CONFIG,
        },
      };

      await this.db.anomalyFlag.create({
        data: {
          ruleID: result.ruleID,
          severity: result.severity,
          riskScore: result.riskScore,
          status: result.status,
          lotID: params.lotID,
          certificateID: params.certificateID,
          description: result.description,
          evidence: result.evidence,
          blockNumber: params.blockNumber,
          txHash: params.txHash,
        },
      });

      return result;
    }

    const areaHa = Number(params.reportedAreaHectares);
    const quantityKg = Number(params.quantityGrams) / 1000;
    const yieldKgPerHa = quantityKg / areaHa;

    if (yieldKgPerHa > YIELD_BENCHMARK_CONFIG.thresholdKgPerHa) {
      const result: AnomalyEvaluationResult = {
        ruleID: "RULE_YIELD_IMPLAUSIBILITY",
        severity: "HIGH",
        riskScore: 75,
        status: "FLAGGED",
        lotID: params.lotID,
        certificateID: params.certificateID,
        description: `Implausible organic yield: ${yieldKgPerHa.toFixed(2)} kg/ha exceeds analytical benchmark threshold of ${YIELD_BENCHMARK_CONFIG.thresholdKgPerHa} kg/ha.`,
        evidence: {
          lotID: params.lotID,
          certificateID: params.certificateID,
          quantityGrams: params.quantityGrams.toString(),
          quantityKg,
          reportedAreaHectares: areaHa,
          calculatedYieldKgPerHa: yieldKgPerHa,
          benchmarkThresholdKgPerHa: YIELD_BENCHMARK_CONFIG.thresholdKgPerHa,
          benchmarkMetadata: YIELD_BENCHMARK_CONFIG,
        },
      };

      await this.db.anomalyFlag.create({
        data: {
          ruleID: result.ruleID,
          severity: result.severity,
          riskScore: result.riskScore,
          status: result.status,
          lotID: params.lotID,
          certificateID: params.certificateID,
          description: result.description,
          evidence: result.evidence,
          blockNumber: params.blockNumber,
          txHash: params.txHash,
        },
      });

      await this.checkEscalation({ lotID: params.lotID, certificateID: params.certificateID });
      return result;
    } else {
      const result: AnomalyEvaluationResult = {
        ruleID: "RULE_YIELD_IMPLAUSIBILITY",
        severity: "LOW",
        riskScore: 0,
        status: "EVALUATED",
        lotID: params.lotID,
        certificateID: params.certificateID,
        description: `Calculated yield of ${yieldKgPerHa.toFixed(2)} kg/ha is within plausible analytical benchmark (<= ${YIELD_BENCHMARK_CONFIG.thresholdKgPerHa} kg/ha).`,
        evidence: {
          lotID: params.lotID,
          certificateID: params.certificateID,
          quantityGrams: params.quantityGrams.toString(),
          reportedAreaHectares: areaHa,
          calculatedYieldKgPerHa: yieldKgPerHa,
          benchmarkThresholdKgPerHa: YIELD_BENCHMARK_CONFIG.thresholdKgPerHa,
        },
      };

      await this.db.anomalyFlag.create({
        data: {
          ruleID: result.ruleID,
          severity: result.severity,
          riskScore: result.riskScore,
          status: result.status,
          lotID: params.lotID,
          certificateID: params.certificateID,
          description: result.description,
          evidence: result.evidence,
          blockNumber: params.blockNumber,
          txHash: params.txHash,
        },
      });

      return result;
    }
  }

  /**
   * Evaluate Rule 3: RULE_STALE_CERTIFICATE_REFERENCE
   * Evaluates if referenced certificate is expired or revoked on-chain
   */
  public async evaluateStaleCertificateReference(params: {
    lotID: string;
    certificateID: string;
    blockNumber: number;
    txHash: string;
    mockStatus?: number; // For isolated unit testing: 0=None, 1=NotYetActive, 2=Valid, 3=Expired, 4=Revoked
  }): Promise<AnomalyEvaluationResult> {
    let statusCode: number = 2; // Default Valid

    if (params.mockStatus !== undefined) {
      statusCode = params.mockStatus;
    } else if (this.certRegistryContract) {
      try {
        const rawStatus = await this.certRegistryContract.getCertificateStatus(params.certificateID);
        statusCode = Number(rawStatus);
      } catch (err) {
        // Fallback to indexed projection if blockchain query fails
        const certIndex = await this.db.certificateIndex.findUnique({
          where: { certificateID: params.certificateID },
        });
        if (certIndex) {
          if (certIndex.isRevoked) statusCode = 4;
          else if (new Date() > certIndex.validUntil) statusCode = 3;
          else statusCode = 2;
        }
      }
    } else {
      const certIndex = await this.db.certificateIndex.findUnique({
        where: { certificateID: params.certificateID },
      });
      if (certIndex) {
        if (certIndex.isRevoked) statusCode = 4;
        else if (new Date() > certIndex.validUntil) statusCode = 3;
        else statusCode = 2;
      }
    }

    // Status: 3 = Expired, 4 = Revoked
    if (statusCode === 3 || statusCode === 4) {
      const statusLabel = statusCode === 3 ? "EXPIRED" : "REVOKED";
      const result: AnomalyEvaluationResult = {
        ruleID: "RULE_STALE_CERTIFICATE_REFERENCE",
        severity: "HIGH",
        riskScore: 80,
        status: "FLAGGED",
        lotID: params.lotID,
        certificateID: params.certificateID,
        description: `Lot ${params.lotID} references certificate ${params.certificateID} whose current on-chain status is ${statusLabel}.`,
        evidence: {
          lotID: params.lotID,
          certificateID: params.certificateID,
          onChainStatusCode: statusCode,
          onChainStatusLabel: statusLabel,
          blockNumber: params.blockNumber,
          txHash: params.txHash,
        },
      };

      await this.db.anomalyFlag.create({
        data: {
          ruleID: result.ruleID,
          severity: result.severity,
          riskScore: result.riskScore,
          status: result.status,
          lotID: params.lotID,
          certificateID: params.certificateID,
          description: result.description,
          evidence: result.evidence,
          blockNumber: params.blockNumber,
          txHash: params.txHash,
        },
      });

      await this.checkEscalation({ lotID: params.lotID, certificateID: params.certificateID });
      return result;
    } else {
      const result: AnomalyEvaluationResult = {
        ruleID: "RULE_STALE_CERTIFICATE_REFERENCE",
        severity: "LOW",
        riskScore: 0,
        status: "EVALUATED",
        lotID: params.lotID,
        certificateID: params.certificateID,
        description: `Referenced certificate ${params.certificateID} is valid on-chain (statusCode=${statusCode}).`,
        evidence: {
          lotID: params.lotID,
          certificateID: params.certificateID,
          onChainStatusCode: statusCode,
        },
      };

      await this.db.anomalyFlag.create({
        data: {
          ruleID: result.ruleID,
          severity: result.severity,
          riskScore: result.riskScore,
          status: result.status,
          lotID: params.lotID,
          certificateID: params.certificateID,
          description: result.description,
          evidence: result.evidence,
          blockNumber: params.blockNumber,
          txHash: params.txHash,
        },
      });

      return result;
    }
  }

  /**
   * Separation of Raw Anomaly Flags and Cases (§7.5)
   * Escalates into an open Case ONLY when:
   * 1. Accumulated risk score >= CONFIG.CASE_ESCALATION_RISK_THRESHOLD (80), OR
   * 2. Distinct consumer reports >= CONFIG.CASE_ESCALATION_REPORT_THRESHOLD (3).
   */
  public async checkEscalation(params: { lotID?: string; certificateID?: string }): Promise<string | null> {
    const { lotID, certificateID } = params;
    if (!lotID && !certificateID) return null;

    // 1. Check if an active case already exists for this entity
    const existingCase = await this.db.case.findFirst({
      where: {
        OR: [
          lotID ? { lotID, status: { in: ["OPEN", "UNDER_REVIEW"] } } : {},
          certificateID ? { certificateID, status: { in: ["OPEN", "UNDER_REVIEW"] } } : {},
        ],
      },
    });

    if (existingCase) {
      // Re-link any unassociated flags/reports to the active case
      await this.linkUnassociatedArtifacts(existingCase.caseID, lotID, certificateID);
      return existingCase.caseID;
    }

    // 2. Query all unassociated FLAGGED anomaly flags for this entity
    const flags = await this.db.anomalyFlag.findMany({
      where: {
        caseID: null,
        status: "FLAGGED",
        OR: [
          lotID ? { lotID } : {},
          certificateID ? { certificateID } : {},
        ],
      },
    });

    const cumulativeRiskScore = flags.reduce((sum, f) => sum + f.riskScore, 0);

    // 3. Query all unassociated distinct consumer reports for this entity
    const reports = await this.db.consumerReport.findMany({
      where: {
        caseID: null,
        OR: [
          lotID ? { lotID } : {},
          certificateID ? { certificateID } : {},
        ],
      },
    });

    // Deduplicate distinct reporters/reports by dedupeKey
    const distinctDedupeKeys = new Set(reports.map((r) => r.dedupeKey));
    const distinctReportCount = distinctDedupeKeys.size;

    const riskThresholdMet = cumulativeRiskScore >= CONFIG.CASE_ESCALATION_RISK_THRESHOLD;
    const reportThresholdMet = distinctReportCount >= CONFIG.CASE_ESCALATION_REPORT_THRESHOLD;

    if (!riskThresholdMet && !reportThresholdMet) {
      return null;
    }

    // Determine dominant anomaly type
    let dominantType = "RISK_SCORE_ESCALATION";
    if (flags.length > 0) {
      dominantType = flags[0].ruleID;
    } else if (reportThresholdMet) {
      dominantType = "CONSUMER_REPORTS_THRESHOLD";
    }

    // Create new Case
    const newCase = await this.db.case.create({
      data: {
        lotID: lotID || null,
        certificateID: certificateID || null,
        anomalyType: dominantType,
        riskScore: cumulativeRiskScore,
        status: "OPEN",
        assignedRole: "ISSUER_REVIEWER",
        evidence: {
          trigger: riskThresholdMet ? "RISK_THRESHOLD_EXCEEDED" : "REPORT_THRESHOLD_EXCEEDED",
          cumulativeRiskScore,
          distinctReportCount,
          riskThreshold: CONFIG.CASE_ESCALATION_RISK_THRESHOLD,
          reportThreshold: CONFIG.CASE_ESCALATION_REPORT_THRESHOLD,
          flagCount: flags.length,
          reportCount: reports.length,
        },
      },
    });

    // Create immutable audit log
    await this.db.caseAuditLog.create({
      data: {
        caseID: newCase.caseID,
        actor: "SYSTEM_ESCALATION_ENGINE",
        action: "CASE_OPENED",
        previousStatus: null,
        newStatus: "OPEN",
        notes: `Automated escalation triggered. RiskScore: ${cumulativeRiskScore}/${CONFIG.CASE_ESCALATION_RISK_THRESHOLD}, DistinctReports: ${distinctReportCount}/${CONFIG.CASE_ESCALATION_REPORT_THRESHOLD}`,
      },
    });

    // Link triggering anomaly flags and reports to the case
    await this.linkUnassociatedArtifacts(newCase.caseID, lotID, certificateID);

    console.log(`[AnomalyEngine] Created Case ${newCase.caseID} for ${lotID || certificateID} (Risk: ${cumulativeRiskScore}, Reports: ${distinctReportCount})`);
    return newCase.caseID;
  }

  private async linkUnassociatedArtifacts(caseID: string, lotID?: string, certificateID?: string) {
    if (lotID) {
      await this.db.anomalyFlag.updateMany({
        where: { lotID, caseID: null },
        data: { caseID },
      });
      await this.db.consumerReport.updateMany({
        where: { lotID, caseID: null },
        data: { caseID },
      });
    }
    if (certificateID) {
      await this.db.anomalyFlag.updateMany({
        where: { certificateID, caseID: null },
        data: { caseID },
      });
      await this.db.consumerReport.updateMany({
        where: { certificateID, caseID: null },
        data: { caseID },
      });
    }
  }
}

export default AnomalyEngine;
