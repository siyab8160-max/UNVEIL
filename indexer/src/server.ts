import express, { Request, Response } from "express";
import prisma from "./db";
import { CONFIG, YIELD_BENCHMARK_CONFIG } from "./config";
import ConsumerReportService from "./consumer-reports";
import ReportAnchoringService from "./anchoring";
import AnomalyEngine from "./anomaly-engine";
import authService from "./auth";
import { seedStandards } from "./seed-standards";

export function createApp() {
  const app = express();
  app.use(express.json());

  // CORS middleware for frontend UI access
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  const anomalyEngine = new AnomalyEngine(prisma);
  const reportService = new ConsumerReportService(prisma, anomalyEngine);
  const anchoringService = new ReportAnchoringService(prisma);

  // Authentication Middleware: Enforce valid SIWE session for regulator/auditor access
  const requireSiweAuth = (req: Request, res: Response, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "SIWE authentication required to access regulator/auditor data and workflows.",
      });
    }
    const token = authHeader.substring(7);
    const session = authService.getSession(token);
    if (!session) {
      return res.status(401).json({
        error: "Invalid or expired SIWE authentication session.",
      });
    }
    (req as any).siweSession = session;
    next();
  };

  // Helper to inspect optional SIWE authentication on projection endpoints
  const getOptionalSiweSession = (req: Request) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      return authService.getSession(token);
    }
    return null;
  };

  // 1. Health & Sync Status
  app.get("/api/health", async (_req: Request, res: Response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const syncState = await prisma.indexerState.findMany();
      res.json({
        status: "healthy",
        database: "connected",
        syncedContracts: syncState,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ status: "unhealthy", error: err.message });
    }
  });

  // 2. Standards Structured Reference Data
  app.get("/api/standards", async (_req: Request, res: Response) => {
    try {
      const standards = await prisma.standard.findMany();
      res.json({
        standards,
        yieldBenchmark: YIELD_BENCHMARK_CONFIG,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/standards/:id", async (req: Request, res: Response) => {
    try {
      const standard = await prisma.standard.findUnique({
        where: { standardID: req.params.id },
      });
      if (!standard) {
        return res.status(404).json({ error: "Standard not found" });
      }
      res.json(standard);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2b. Public Sanitized Investigation Indicator (Consumer Page)
  app.get("/api/investigations/status", async (req: Request, res: Response) => {
    try {
      const { lotID, certificateID } = req.query;
      if (!lotID && !certificateID) {
        return res.status(400).json({ error: "lotID or certificateID required" });
      }

      const activeStatusFilter = { in: ["OPEN", "UNDER_REVIEW", "REVOCATION_PENDING"] };
      let activeCase = null;

      if (lotID && certificateID) {
        activeCase = await prisma.case.findFirst({
          where: {
            status: activeStatusFilter,
            OR: [{ lotID: String(lotID) }, { certificateID: String(certificateID) }],
          },
          orderBy: { openedAt: "desc" },
        });
      } else if (lotID) {
        activeCase = await prisma.case.findFirst({
          where: {
            lotID: String(lotID),
            status: activeStatusFilter,
          },
          orderBy: { openedAt: "desc" },
        });
      } else {
        activeCase = await prisma.case.findFirst({
          where: {
            certificateID: String(certificateID),
            status: activeStatusFilter,
          },
          orderBy: { openedAt: "desc" },
        });
      }

      if (!activeCase) {
        return res.json({
          isUnderInvestigation: false,
          case: null,
          notice:
            "Sanitized public investigation status indicator. Internal case details, risk scores, rule IDs, evidence, and audit logs are restricted to authenticated regulators.",
        });
      }

      // Sanitized public output: strictly omit risk scores, rule IDs, reviewer identity, reports, and evidence
      res.json({
        isUnderInvestigation: true,
        case: {
          caseID: activeCase.caseID,
          status: activeCase.status === "OPEN" ? "OPEN" : "UNDER_REVIEW",
          openedAt: activeCase.openedAt,
        },
        notice:
          "Sanitized public investigation status indicator. Internal case details, risk scores, rule IDs, evidence, and audit logs are restricted to authenticated regulators.",
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Non-Authoritative Certificate Projection
  app.get("/api/certificates/:id", async (req: Request, res: Response) => {
    const cert = await prisma.certificateIndex.findUnique({
      where: { certificateID: req.params.id },
    });

    if (!cert) {
      return res.status(404).json({ error: "Certificate projection not found" });
    }

    const lots = await prisma.lotIndex.findMany({
      where: { certificateID: req.params.id },
    });
    const cases = await prisma.case.findMany({
      where: { certificateID: req.params.id },
    });
    const activeCases = cases.filter(
      (c) => c.status === "OPEN" || c.status === "UNDER_REVIEW" || c.status === "REVOCATION_PENDING"
    );

    const session = getOptionalSiweSession(req);

    // If authenticated regulator/auditor session present, return full projection
    if (session) {
      const anomalies = await prisma.anomalyFlag.findMany({
        where: { certificateID: req.params.id },
      });
      const reports = await prisma.consumerReport.findMany({
        where: { certificateID: req.params.id },
      });

      return res.json({
        notice: "NON-AUTHORITATIVE INDEXED PROJECTION. Consumer verification status must be queried directly from the deployed smart contract on-chain.",
        data: {
          ...cert,
          certifiedQuantityGrams: cert.certifiedQuantityGrams.toString(),
          remainingQuantityGrams: cert.remainingQuantityGrams.toString(),
          lots,
          anomalies,
          cases,
          reports,
        },
      });
    }

    // Public sanitized consumer projection (omits raw anomalies, rule IDs, risk scores, and reports)
    res.json({
      notice: "NON-AUTHORITATIVE INDEXED PROJECTION. Consumer verification status must be queried directly from the deployed smart contract on-chain.",
      data: {
        certificateID: cert.certificateID,
        standardID: cert.standardID,
        issuer: cert.issuer,
        holder: cert.holder,
        certifiedQuantityGrams: cert.certifiedQuantityGrams.toString(),
        remainingQuantityGrams: cert.remainingQuantityGrams.toString(),
        validFrom: cert.validFrom,
        validUntil: cert.validUntil,
        isRevoked: cert.isRevoked,
        lots,
        investigation: {
          isUnderInvestigation: activeCases.length > 0,
          status: activeCases.length > 0 ? "UNDER_REVIEW" : null,
        },
      },
    });
  });

  // 4. Non-Authoritative Lot Projection with Lineage Graph
  app.get("/api/lots/:id", async (req: Request, res: Response) => {
    const lot = await prisma.lotIndex.findUnique({
      where: { lotID: req.params.id },
    });

    if (!lot) {
      return res.status(404).json({ error: "Lot projection not found" });
    }

    const parentLinks = await prisma.lotLineage.findMany({
      where: { childLotID: req.params.id },
    });
    const childLinks = await prisma.lotLineage.findMany({
      where: { parentLotID: req.params.id },
    });

    const ancestors = await Promise.all(
      parentLinks.map(async (pl) => {
        const parentLot = await prisma.lotIndex.findUnique({ where: { lotID: pl.parentLotID } });
        return {
          parentLotID: pl.parentLotID,
          operationType: pl.operationType,
          quantityGrams: parentLot ? parentLot.quantityGrams.toString() : "0",
          status: parentLot ? parentLot.status : "UNKNOWN",
        };
      })
    );

    const descendants = await Promise.all(
      childLinks.map(async (cl) => {
        const childLot = await prisma.lotIndex.findUnique({ where: { lotID: cl.childLotID } });
        return {
          childLotID: cl.childLotID,
          operationType: cl.operationType,
          quantityGrams: childLot ? childLot.quantityGrams.toString() : "0",
          status: childLot ? childLot.status : "UNKNOWN",
        };
      })
    );

    const cases = await prisma.case.findMany({
      where: { lotID: req.params.id },
    });
    const activeCases = cases.filter(
      (c) => c.status === "OPEN" || c.status === "UNDER_REVIEW" || c.status === "REVOCATION_PENDING"
    );

    const session = getOptionalSiweSession(req);

    if (session) {
      const anomalies = await prisma.anomalyFlag.findMany({
        where: { lotID: req.params.id },
      });
      return res.json({
        notice: "NON-AUTHORITATIVE INDEXED PROJECTION. Live consignment validity must be verified on-chain.",
        dataSourceNotice: {
          reportedAreaHectares: "External source-reported data; NOT on-chain truth.",
        },
        data: {
          ...lot,
          quantityGrams: lot.quantityGrams.toString(),
          anomalies,
          cases,
          lineage: {
            ancestors,
            descendants,
          },
        },
      });
    }

    // Public sanitized consumer view:
    // Raw anomalies, risk scores, rule IDs, and internal case details are strictly omitted.
    res.json({
      notice: "NON-AUTHORITATIVE INDEXED PROJECTION. Live consignment validity must be verified on-chain.",
      dataSourceNotice: {
        reportedAreaHectares: "External source-reported data; NOT on-chain truth.",
      },
      data: {
        lotID: lot.lotID,
        certificateID: lot.certificateID,
        quantityGrams: lot.quantityGrams.toString(),
        currentOwner: lot.currentOwner,
        status: lot.status,
        createdAtTimestamp: lot.createdAtTimestamp,
        lineage: {
          ancestors,
          descendants,
        },
        investigation: {
          isUnderInvestigation: activeCases.length > 0,
          status: activeCases.length > 0 ? "UNDER_REVIEW" : null,
        },
      },
    });
  });

  // 5. Auditor/Regulator Raw Anomaly Flags (PROTECTED: Requires SIWE Auth)
  app.get("/api/anomalies", requireSiweAuth, async (req: Request, res: Response) => {
    const { ruleID, severity, status } = req.query;
    const where: any = {};
    if (ruleID) where.ruleID = String(ruleID);
    if (severity) where.severity = String(severity);
    if (status) where.status = String(status);

    const anomalies = await prisma.anomalyFlag.findMany({
      where,
      orderBy: { detectedAt: "desc" },
    });
    res.json({ anomalies });
  });

  // 6. Auditor/Regulator Cases (PROTECTED: Requires SIWE Auth)
  app.get("/api/cases", requireSiweAuth, async (req: Request, res: Response) => {
    const { status } = req.query;
    const where: any = {};
    if (status) where.status = String(status);

    const cases = await prisma.case.findMany({
      where,
      include: {
        anomalies: true,
        reports: true,
        auditLogs: { orderBy: { timestamp: "asc" } },
      },
      orderBy: { openedAt: "desc" },
    });
    res.json({ cases });
  });

  app.get("/api/cases/:id", requireSiweAuth, async (req: Request, res: Response) => {
    const caseRecord = await prisma.case.findUnique({
      where: { caseID: req.params.id },
      include: {
        anomalies: true,
        reports: true,
        auditLogs: { orderBy: { timestamp: "asc" } },
      },
    });

    if (!caseRecord) {
      return res.status(404).json({ error: "Case not found" });
    }

    res.json(caseRecord);
  });

  // 7. Case Status Transitions (PROTECTED: Requires SIWE Auth)
  app.post("/api/cases/:id/transition", requireSiweAuth, async (req: Request, res: Response) => {

    const { actor, newStatus, notes } = req.body;
    if (!actor || !newStatus) {
      return res.status(400).json({ error: "actor and newStatus are required" });
    }

    const currentCase = await prisma.case.findUnique({
      where: { caseID: req.params.id },
    });

    if (!currentCase) {
      return res.status(404).json({ error: "Case not found" });
    }

    // Allowed status transitions
    const validTransitions: Record<string, string[]> = {
      OPEN: ["UNDER_REVIEW", "DISMISSED"],
      UNDER_REVIEW: ["RESOLVED", "DISMISSED", "ESCALATED", "REVOCATION_PENDING"],
      REVOCATION_PENDING: ["RESOLVED", "UNDER_REVIEW"],
      ESCALATED: ["UNDER_REVIEW", "RESOLVED", "DISMISSED"],
      RESOLVED: [],
      DISMISSED: [],
    };

    const allowed = validTransitions[currentCase.status] || [];
    if (!allowed.includes(newStatus)) {
      return res.status(400).json({
        error: `Invalid transition from ${currentCase.status} to ${newStatus}. Allowed: ${allowed.join(", ")}`,
      });
    }

    const updated = await prisma.case.update({
      where: { caseID: req.params.id },
      data: {
        status: newStatus,
        reviewer: actor,
      },
    });

    await prisma.caseAuditLog.create({
      data: {
        caseID: req.params.id,
        actor,
        action: `TRANSITION_${newStatus}`,
        previousStatus: currentCase.status,
        newStatus,
        notes: notes || `Case transitioned from ${currentCase.status} to ${newStatus}`,
      },
    });

    res.json({
      message: "Case transitioned successfully",
      case: updated,
      note: "CRITICAL: Off-chain case transition does not alter blockchain state or revoke on-chain certificates.",
    });
  });

  // 8. Case Resolution (PROTECTED: Requires SIWE Auth)
  app.post("/api/cases/:id/resolve", requireSiweAuth, async (req: Request, res: Response) => {
    const { actor, resolution, notes } = req.body;
    if (!actor || !resolution) {
      return res.status(400).json({ error: "actor and resolution are required" });
    }

    const currentCase = await prisma.case.findUnique({
      where: { caseID: req.params.id },
    });

    if (!currentCase) {
      return res.status(404).json({ error: "Case not found" });
    }

    if (currentCase.status === "RESOLVED" || currentCase.status === "DISMISSED") {
      return res.status(400).json({
        error: `Cannot resolve case that is already ${currentCase.status}`,
      });
    }

    const updated = await prisma.case.update({
      where: { caseID: req.params.id },
      data: {
        status: "RESOLVED",
        resolution,
        resolvedAt: new Date(),
        reviewer: actor,
      },
    });

    await prisma.caseAuditLog.create({
      data: {
        caseID: req.params.id,
        actor,
        action: "CASE_RESOLVED",
        previousStatus: currentCase.status,
        newStatus: "RESOLVED",
        notes: notes || `Resolved with decision: ${resolution}`,
      },
    });

    res.json({
      message: "Case resolved successfully",
      case: updated,
      note: "CRITICAL: Off-chain resolution does not alter blockchain state or revoke on-chain certificates.",
    });
  });

  // 9. Consumer Report Submission
  app.post("/api/reports", async (req: Request, res: Response) => {
    try {
      const { lotID, certificateID, issueType, reporterReference, evidence } = req.body;
      if (!issueType || !reporterReference || (!lotID && !certificateID)) {
        return res.status(400).json({
          error: "reporterReference, issueType, and either lotID or certificateID are required",
        });
      }

      const report = await reportService.submitReport({
        lotID,
        certificateID,
        issueType,
        reporterReference,
        evidence,
      });

      res.status(201).json({
        message: "Report submitted successfully",
        report: {
          reportID: report.reportID,
          dedupeKey: report.dedupeKey,
          submittedAt: report.submittedAt,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 10. Consumer Report Batch Anchoring (PRD §7.5.3 Stub)
  app.post("/api/anchors", async (_req: Request, res: Response) => {
    try {
      const anchor = await anchoringService.createBatchAnchor();
      if (!anchor) {
        return res.json({ message: "No new unanchored reports found to anchor." });
      }
      res.json({
        message: "Batch anchor generated successfully",
        anchor,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 11. SIWE Application Authentication (Server-Side Verification Boundary)
  // Request single-use nonce
  app.get("/api/auth/nonce", (_req: Request, res: Response) => {
    const nonce = authService.generateNonce();
    res.json({ nonce });
  });

  // Verify SIWE signature and issue authenticated session
  app.post("/api/auth/verify", (req: Request, res: Response) => {
    const { message, signature } = req.body;
    if (!message || !signature) {
      return res.status(400).json({ error: "message and signature are required" });
    }

    const result = authService.verifySignature(message, signature);
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    res.json({
      success: true,
      session: result.session,
      notice: "SIWE authenticates wallet ownership. Smart-contract authorization remains the final enforcement layer.",
    });
  });

  // Verify active session
  app.get("/api/auth/session", (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ authenticated: false, error: "Missing or invalid authorization header" });
    }

    const token = authHeader.substring(7);
    const session = authService.getSession(token);
    if (!session) {
      return res.status(401).json({ authenticated: false, error: "Invalid or expired session" });
    }

    res.json({
      authenticated: true,
      session,
    });
  });

  // Revoke session (logout)
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      authService.revokeSession(token);
    }
    res.json({ message: "Logged out successfully" });
  });

  return app;
}

export const app = createApp();

if (require.main === module) {
  seedStandards()
    .then(() => {
      app.listen(CONFIG.PORT, () => {
        console.log(`[CertLedger Indexer] Server listening on port ${CONFIG.PORT}`);
      });
    })
    .catch((err) => {
      console.error("[CertLedger Indexer] Standards seeding error:", err);
      app.listen(CONFIG.PORT, () => {
        console.log(`[CertLedger Indexer] Server listening on port ${CONFIG.PORT}`);
      });
    });
}
