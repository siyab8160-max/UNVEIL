import { expect } from "chai";
import request from "supertest";
import prisma from "../src/db";
import { IndexerService } from "../src/indexer";
import { AnomalyEngine } from "../src/anomaly-engine";
import { ConsumerReportService, computeDedupeKey } from "../src/consumer-reports";
import { ReportAnchoringService } from "../src/anchoring";
import { createApp } from "../src/server";
import { seedStandards } from "../src/seed-standards";
import { CONFIG, YIELD_BENCHMARK_CONFIG } from "../src/config";
import authService from "../src/auth";

describe("UNVEIL Phase 3 Indexer & Anomaly Engine Test Suite", () => {
  let app: any;
  let indexer: IndexerService;
  let anomalyEngine: AnomalyEngine;
  let reportService: ConsumerReportService;
  let anchoringService: ReportAnchoringService;

  before(async () => {
    // Clean all tables before running suite
    await prisma.caseAuditLog.deleteMany();
    await prisma.consumerReport.deleteMany();
    await prisma.anomalyFlag.deleteMany();
    await prisma.case.deleteMany();
    await prisma.lotLineage.deleteMany();
    await prisma.lotIndex.deleteMany();
    await prisma.certificateIndex.deleteMany();
    await prisma.issuerIndex.deleteMany();
    await prisma.indexedEvent.deleteMany();
    await prisma.reportBatchAnchor.deleteMany();
    await prisma.standard.deleteMany();
    await prisma.indexerState.deleteMany();

    // Seed standards
    await seedStandards();

    anomalyEngine = new AnomalyEngine(prisma);
    indexer = new IndexerService(prisma, anomalyEngine);
    reportService = new ConsumerReportService(prisma, anomalyEngine);
    anchoringService = new ReportAnchoringService(prisma);
    app = createApp();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  describe("1. Event Deduplication & Replay Safety", () => {
    it("should process an event once and skip duplicate (chainId, transactionHash, logIndex)", async () => {
      const eventParams = {
        chainId: 11155111,
        contractAddress: "0x021A1289Aa4589A1a4B83C8b878a91aDD0F0C83b",
        transactionHash: "0xaaaa1111222233334444555566667777888899990000aaaa1111222233334444",
        blockNumber: 11684485,
        logIndex: 0,
        blockTimestamp: new Date(),
        eventName: "CertificateIssued",
        payload: {
          certificateID: "CERT-DEDUP-001",
          issuer: "0x1111111111111111111111111111111111111111",
          holder: "0x2222222222222222222222222222222222222222",
          standardID: "USDA-NOP-ORGANIC",
          certifiedQuantityGrams: "50000000",
          validFrom: Math.floor(Date.now() / 1000),
          validUntil: Math.floor(Date.now() / 1000) + 365 * 86400,
        },
      };

      const firstResult = await indexer.processEvent(eventParams);
      expect(firstResult).to.be.true;

      // Process identical event second time
      const secondResult = await indexer.processEvent(eventParams);
      expect(secondResult).to.be.false;

      const eventsCount = await prisma.indexedEvent.count({
        where: {
          chainId: eventParams.chainId,
          transactionHash: eventParams.transactionHash,
          logIndex: eventParams.logIndex,
        },
      });
      expect(eventsCount).to.equal(1);
    });
  });

  describe("2. Rule 1: RULE_MASS_BALANCE_OVERFLOW", () => {
    it("should trigger raw anomaly flag and escalate into an open Case when on-chain MassBalanceAlert is received", async () => {
      const certID = "CERT-MBA-001";
      // Create initial certificate projection
      await indexer.processEvent({
        chainId: 11155111,
        contractAddress: CONFIG.CERTIFICATE_REGISTRY_ADDRESS,
        transactionHash: "0xbbbb1111222233334444555566667777888899990000bbbb1111222233334444",
        blockNumber: 11684486,
        logIndex: 0,
        blockTimestamp: new Date(),
        eventName: "CertificateIssued",
        payload: {
          certificateID: certID,
          issuer: "0x1111111111111111111111111111111111111111",
          holder: "0x2222222222222222222222222222222222222222",
          standardID: "USDA-NOP-ORGANIC",
          certifiedQuantityGrams: "10000000",
          validFrom: Math.floor(Date.now() / 1000),
          validUntil: Math.floor(Date.now() / 1000) + 365 * 86400,
        },
      });

      // Emitting MassBalanceAlert
      await indexer.processEvent({
        chainId: 11155111,
        contractAddress: CONFIG.CERTIFICATE_REGISTRY_ADDRESS,
        transactionHash: "0xcccc1111222233334444555566667777888899990000cccc1111222233334444",
        blockNumber: 11684487,
        logIndex: 1,
        blockTimestamp: new Date(),
        eventName: "MassBalanceAlert",
        payload: {
          certificateID: certID,
          caller: "0x2222222222222222222222222222222222222222",
          requestedQuantityGrams: "15000000",
          remainingQuantityGrams: "10000000",
          reason: "Requested quantity exceeds remaining certificate quota",
        },
      });

      // Check AnomalyFlag
      const flag = await prisma.anomalyFlag.findFirst({
        where: { certificateID: certID, ruleID: "RULE_MASS_BALANCE_OVERFLOW" },
      });
      expect(flag).to.not.be.null;
      expect(flag!.severity).to.equal("CRITICAL");
      expect(flag!.riskScore).to.equal(90);

      // Check Case escalation (score 90 >= threshold 80)
      const openedCase = await prisma.case.findFirst({
        where: { certificateID: certID },
        include: { auditLogs: true },
      });
      expect(openedCase).to.not.be.null;
      expect(openedCase!.status).to.equal("OPEN");
      expect(openedCase!.assignedRole).to.equal("ISSUER_REVIEWER");
      expect(openedCase!.riskScore).to.equal(90);
      expect(openedCase!.auditLogs).to.have.lengthOf(1);
      expect(openedCase!.auditLogs[0].action).to.equal("CASE_OPENED");
    });
  });

  describe("3. Rule 2: RULE_YIELD_IMPLAUSIBILITY", () => {
    it("should flag implausible yield exceeding USDA FAS/ICO benchmark of 2,500 kg/ha", async () => {
      const lotID = "LOT-HIGH-YIELD-001";
      const certID = "CERT-YIELD-001";

      await indexer.processEvent({
        chainId: 11155111,
        contractAddress: CONFIG.CONSIGNMENT_REGISTRY_ADDRESS,
        transactionHash: "0xdddd1111222233334444555566667777888899990000dddd1111222233334444",
        blockNumber: 11684488,
        logIndex: 0,
        blockTimestamp: new Date(),
        eventName: "RootConsignmentCreated",
        payload: {
          lotID,
          certificateID: certID,
          holder: "0x2222222222222222222222222222222222222222",
          quantityGrams: "30000000", // 30,000 kg
        },
        reportedAreaHectares: 10.0, // 10 ha => 3,000 kg/ha > 2,500 kg/ha
      });

      const flag = await prisma.anomalyFlag.findFirst({
        where: { lotID, ruleID: "RULE_YIELD_IMPLAUSIBILITY" },
      });
      expect(flag).to.not.be.null;
      expect(flag!.status).to.equal("FLAGGED");
      expect(flag!.severity).to.equal("HIGH");
      expect(flag!.riskScore).to.equal(75);
      expect(flag!.description).to.include("3000.00 kg/ha exceeds analytical benchmark threshold of 2500 kg/ha");

      // Verify analytical benchmark semantics are embedded
      const evidence = flag!.evidence as any;
      expect(evidence.benchmarkMetadata.benchmarkType).to.equal("ANALYTICAL_SCREENING_BENCHMARK");
      expect(evidence.benchmarkMetadata.thresholdKgPerHa).to.equal(2500);
      expect(evidence.benchmarkMetadata.regulatoryDisclaimer).to.include("NOT a regulatory maximum codified in USDA Organic 7 CFR Part 205");

      // Risk score 75 is below default threshold 80, so no Case created yet
      const lotCase = await prisma.case.findFirst({ where: { lotID } });
      expect(lotCase).to.be.null;
    });

    it("should evaluate normal plausible yield within benchmark range as EVALUATED with score 0", async () => {
      const lotID = "LOT-NORMAL-YIELD-001";
      const certID = "CERT-YIELD-001";

      await indexer.processEvent({
        chainId: 11155111,
        contractAddress: CONFIG.CONSIGNMENT_REGISTRY_ADDRESS,
        transactionHash: "0xeeee1111222233334444555566667777888899990000eeee1111222233334444",
        blockNumber: 11684489,
        logIndex: 0,
        blockTimestamp: new Date(),
        eventName: "RootConsignmentCreated",
        payload: {
          lotID,
          certificateID: certID,
          holder: "0x2222222222222222222222222222222222222222",
          quantityGrams: "8000000", // 8,000 kg
        },
        reportedAreaHectares: 10.0, // 10 ha => 800 kg/ha <= 2,500 kg/ha
      });

      const flag = await prisma.anomalyFlag.findFirst({
        where: { lotID, ruleID: "RULE_YIELD_IMPLAUSIBILITY" },
      });
      expect(flag).to.not.be.null;
      expect(flag!.status).to.equal("EVALUATED");
      expect(flag!.riskScore).to.equal(0);
    });

    it("should return INSUFFICIENT_DATA with risk score 0 when reported area is missing or non-positive", async () => {
      const lotID = "LOT-NO-AREA-001";
      const certID = "CERT-YIELD-001";

      await indexer.processEvent({
        chainId: 11155111,
        contractAddress: CONFIG.CONSIGNMENT_REGISTRY_ADDRESS,
        transactionHash: "0xffff1111222233334444555566667777888899990000ffff1111222233334444",
        blockNumber: 11684490,
        logIndex: 0,
        blockTimestamp: new Date(),
        eventName: "RootConsignmentCreated",
        payload: {
          lotID,
          certificateID: certID,
          holder: "0x2222222222222222222222222222222222222222",
          quantityGrams: "15000000",
        },
        reportedAreaHectares: null, // Missing reported area
      });

      const flag = await prisma.anomalyFlag.findFirst({
        where: { lotID, ruleID: "RULE_YIELD_IMPLAUSIBILITY" },
      });
      expect(flag).to.not.be.null;
      expect(flag!.status).to.equal("INSUFFICIENT_DATA");
      expect(flag!.riskScore).to.equal(0);
      expect(flag!.description).to.include("reportedAreaHectares) is not provided or non-positive");
    });
  });

  describe("4. Rule 3: RULE_STALE_CERTIFICATE_REFERENCE", () => {
    it("should flag lots pointing to Expired or Revoked certificates and escalate when risk score >= 80", async () => {
      const lotID = "LOT-STALE-001";
      const certID = "CERT-STALE-001";

      const result = await anomalyEngine.evaluateStaleCertificateReference({
        lotID,
        certificateID: certID,
        blockNumber: 11684491,
        txHash: "0x1111222233334444555566667777888899990000111122223333444455556666",
        mockStatus: 3, // Expired
      });

      expect(result.status).to.equal("FLAGGED");
      expect(result.riskScore).to.equal(80);
      expect(result.description).to.include("EXPIRED");

      // Score 80 >= threshold 80 triggers Case escalation
      const staleCase = await prisma.case.findFirst({ where: { lotID } });
      expect(staleCase).to.not.be.null;
      expect(staleCase!.status).to.equal("OPEN");
      expect(staleCase!.riskScore).to.equal(80);
    });

    it("should evaluate valid certificate references as EVALUATED with score 0", async () => {
      const lotID = "LOT-VALID-CERT-001";
      const certID = "CERT-VALID-001";

      const result = await anomalyEngine.evaluateStaleCertificateReference({
        lotID,
        certificateID: certID,
        blockNumber: 11684492,
        txHash: "0x2222333344445555666677778888999900001111222233334444555566667777",
        mockStatus: 2, // Valid
      });

      expect(result.status).to.equal("EVALUATED");
      expect(result.riskScore).to.equal(0);
    });
  });

  describe("5. Consumer Reports Deduplication & Threshold Escalation", () => {
    const lotTarget = "LOT-REPORT-TARGET-001";

    it("should accept a consumer report and compute transparent dedupeKey without opening a case for 1 report", async () => {
      const res = await request(app)
        .post("/api/reports")
        .send({
          lotID: lotTarget,
          issueType: "PRODUCT_MISLABELING",
          reporterReference: "user-alice-anon-01",
          evidence: { note: "Packaging lacks certification agency logo" },
        })
        .expect(201);

      expect(res.body.report).to.have.property("reportID");
      expect(res.body.report).to.have.property("dedupeKey");

      const expectedDedupeKey = computeDedupeKey("user-alice-anon-01", lotTarget, "PRODUCT_MISLABELING");
      expect(res.body.report.dedupeKey).to.equal(expectedDedupeKey);

      // Single report does not meet report threshold (3)
      const activeCase = await prisma.case.findFirst({ where: { lotID: lotTarget } });
      expect(activeCase).to.be.null;
    });

    it("should suppress duplicate submissions from same reporter so they do not artificially increment distinct report count", async () => {
      // Alice submits duplicate report for same lot & issue
      await request(app)
        .post("/api/reports")
        .send({
          lotID: lotTarget,
          issueType: "PRODUCT_MISLABELING",
          reporterReference: "user-alice-anon-01",
          evidence: { note: "Submitting again" },
        })
        .expect(201);

      // Still only 1 distinct dedupeKey, no case opened
      const activeCase = await prisma.case.findFirst({ where: { lotID: lotTarget } });
      expect(activeCase).to.be.null;
    });

    it("should escalate to open Case when distinct reports reach configured threshold of 3", async () => {
      // Bob submits report (distinct)
      await request(app)
        .post("/api/reports")
        .send({
          lotID: lotTarget,
          issueType: "SUSPECTED_NON_ORGANIC",
          reporterReference: "user-bob-anon-02",
        })
        .expect(201);

      // Charlie submits report (distinct => count reaches 3)
      await request(app)
        .post("/api/reports")
        .send({
          lotID: lotTarget,
          issueType: "PRODUCT_MISLABELING",
          reporterReference: "user-charlie-anon-03",
        })
        .expect(201);

      // Threshold of 3 distinct reports breached => Case created
      const activeCase = await prisma.case.findFirst({
        where: { lotID: lotTarget },
        include: { reports: true, auditLogs: true },
      });
      expect(activeCase).to.not.be.null;
      expect(activeCase!.status).to.equal("OPEN");
      expect(activeCase!.assignedRole).to.equal("ISSUER_REVIEWER");
      expect(activeCase!.reports).to.have.lengthOf(4); // 4 submissions, 3 distinct
      expect(activeCase!.auditLogs).to.have.lengthOf(1);
    });
  });

  describe("6. Case Workflow Transitions & Resolution", () => {
    let caseID: string;
    let reviewerToken: string;

    before(async () => {
      // Find an open case (CERT-MBA-001) to test transitions on, keeping LOT-REPORT-TARGET-001 open for Section 10
      const c = await prisma.case.findFirst({ where: { certificateID: "CERT-MBA-001" } });
      expect(c).to.not.be.null;
      caseID = c!.caseID;
      const session = authService.createSession("0x4b07A2a7E631a808EF95CFe5cA5b8463d7b1a3Fd");
      reviewerToken = session.token;
    });

    it("should reject unauthenticated transition attempt without SIWE token (401)", async () => {
      await request(app)
        .post(`/api/cases/${caseID}/transition`)
        .send({
          actor: "auditor@ccof.org",
          newStatus: "UNDER_REVIEW",
        })
        .expect(401);
    });

    it("should reject invalid status jump directly from OPEN to RESOLVED", async () => {
      const res = await request(app)
        .post(`/api/cases/${caseID}/transition`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({
          actor: "auditor@ccof.org",
          newStatus: "RESOLVED",
        })
        .expect(400);

      expect(res.body.error).to.include("Invalid transition");
    });

    it("should allow valid transition from OPEN to UNDER_REVIEW and log audit trail", async () => {
      const res = await request(app)
        .post(`/api/cases/${caseID}/transition`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({
          actor: "auditor@ccof.org",
          newStatus: "UNDER_REVIEW",
          notes: "Reviewer assigned and investigation opened",
        })
        .expect(200);

      expect(res.body.case.status).to.equal("UNDER_REVIEW");
      expect(res.body.case.reviewer).to.equal("auditor@ccof.org");

      const logs = await prisma.caseAuditLog.findMany({
        where: { caseID },
        orderBy: { timestamp: "asc" },
      });
      expect(logs).to.have.lengthOf(2);
      expect(logs[1].action).to.equal("TRANSITION_UNDER_REVIEW");
      expect(logs[1].actor).to.equal("auditor@ccof.org");
    });

    it("should resolve case with official auditor decision and notes", async () => {
      const res = await request(app)
        .post(`/api/cases/${caseID}/resolve`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({
          actor: "auditor@ccof.org",
          resolution: "NO_VIOLATION_FOUND",
          notes: "On-site audit confirmed organic handling separation was maintained",
        })
        .expect(200);

      expect(res.body.case.status).to.equal("RESOLVED");
      expect(res.body.case.resolution).to.equal("NO_VIOLATION_FOUND");

      const updatedCase = await prisma.case.findUnique({ where: { caseID } });
      expect(updatedCase!.status).to.equal("RESOLVED");
      expect(updatedCase!.resolvedAt).to.not.be.null;
    });

    it("should support REVOCATION_PENDING workflow transitions and rejection on invalid SIWE token", async () => {
      // Create a fresh test case
      const testCase = await prisma.case.create({
        data: {
          caseID: "CASE-REVOCATION-WORKFLOW-TEST",
          anomalyType: "RULE_MASS_BALANCE_OVERFLOW",
          riskScore: 90,
          status: "UNDER_REVIEW",
          assignedRole: "ARBITRATION_REGULATOR",
          reviewer: "regulator@usda.gov",
          evidence: { reason: "Severe mass-balance violation" },
        },
      });

      // 1. Should reject if invalid Bearer token provided
      await request(app)
        .post(`/api/cases/${testCase.caseID}/transition`)
        .set("Authorization", "Bearer invalid-or-expired-token")
        .send({
          actor: "regulator@usda.gov",
          newStatus: "REVOCATION_PENDING",
        })
        .expect(401);

      // 2. Should allow valid transition UNDER_REVIEW -> REVOCATION_PENDING
      const pendingRes = await request(app)
        .post(`/api/cases/${testCase.caseID}/transition`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({
          actor: "regulator@usda.gov",
          newStatus: "REVOCATION_PENDING",
          notes: "On-chain revocation initiated, awaiting blockchain mining confirmation",
        })
        .expect(200);

      expect(pendingRes.body.case.status).to.equal("REVOCATION_PENDING");

      // 3. Should allow rollback from REVOCATION_PENDING back to UNDER_REVIEW if tx fails
      const rollbackRes = await request(app)
        .post(`/api/cases/${testCase.caseID}/transition`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({
          actor: "regulator@usda.gov",
          newStatus: "UNDER_REVIEW",
          notes: "Transaction failed or rejected by wallet; rolled back to UNDER_REVIEW",
        })
        .expect(200);

      expect(rollbackRes.body.case.status).to.equal("UNDER_REVIEW");

      // 4. Transition again to REVOCATION_PENDING, then resolve to RESOLVED
      await request(app)
        .post(`/api/cases/${testCase.caseID}/transition`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({
          actor: "regulator@usda.gov",
          newStatus: "REVOCATION_PENDING",
        })
        .expect(200);

      const resolveRes = await request(app)
        .post(`/api/cases/${testCase.caseID}/resolve`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({
          actor: "regulator@usda.gov",
          resolution: "REVOCATION_CONFIRMED: Tx 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          notes: "Certificate successfully revoked on Sepolia blockchain",
        })
        .expect(200);

      expect(resolveRes.body.case.status).to.equal("RESOLVED");
      expect(resolveRes.body.case.resolution).to.include("REVOCATION_CONFIRMED");
    });
  });

  describe("7. Report Batch Hash Integrity Anchoring", () => {
    it("should generate a canonical keccak256 batch hash anchor over submitted consumer reports", async () => {
      const res = await request(app)
        .post("/api/anchors")
        .expect(200);

      expect(res.body.anchor).to.have.property("batchNumber");
      expect(res.body.anchor).to.have.property("canonicalHash");
      expect(res.body.anchor.canonicalHash).to.match(/^0x[a-fA-F0-9]{64}$/);
      expect(res.body.anchor.reportCount).to.be.greaterThan(0);

      const dbAnchor = await prisma.reportBatchAnchor.findUnique({
        where: { batchNumber: res.body.anchor.batchNumber },
      });
      expect(dbAnchor).to.not.be.null;
      expect(dbAnchor!.canonicalHash).to.equal(res.body.anchor.canonicalHash);
    });
  });

  describe("8. Lineage Graph Projection (Split Operation)", () => {
    it("should record parent as CONSUMED and children as ACTIVE with graph lineage edges", async () => {
      const parentLotID = "LOT-PARENT-SPLIT-001";
      const childLotA = "LOT-CHILD-A-001";
      const childLotB = "LOT-CHILD-B-001";
      const certID = "CERT-SPLIT-001";

      // 1. Create root parent lot
      await indexer.processEvent({
        chainId: 11155111,
        contractAddress: CONFIG.CONSIGNMENT_REGISTRY_ADDRESS,
        transactionHash: "0x1234111122223333444455556666777788889999000012341111222233334444",
        blockNumber: 11684495,
        logIndex: 0,
        blockTimestamp: new Date(),
        eventName: "RootConsignmentCreated",
        payload: {
          lotID: parentLotID,
          certificateID: certID,
          holder: "0x3333333333333333333333333333333333333333",
          quantityGrams: "20000000",
        },
      });

      // 2. Perform Split on-chain event
      await indexer.processEvent({
        chainId: 11155111,
        contractAddress: CONFIG.CONSIGNMENT_REGISTRY_ADDRESS,
        transactionHash: "0x5678111122223333444455556666777788889999000056781111222233334444",
        blockNumber: 11684496,
        logIndex: 1,
        blockTimestamp: new Date(),
        eventName: "LotSplit",
        payload: {
          parentLotID,
          childLotIDs: [childLotA, childLotB],
          childQuantitiesGrams: ["12000000", "8000000"],
          owner: "0x3333333333333333333333333333333333333333",
        },
      });

      // Query parent lot
      const parentRes = await request(app).get(`/api/lots/${parentLotID}`).expect(200);
      expect(parentRes.body.data.status).to.equal("CONSUMED");
      expect(parentRes.body.data.lineage.descendants).to.have.lengthOf(2);

      // Query child lot A
      const childRes = await request(app).get(`/api/lots/${childLotA}`).expect(200);
      expect(childRes.body.data.status).to.equal("ACTIVE");
      expect(childRes.body.data.quantityGrams).to.equal("12000000");
      expect(childRes.body.data.lineage.ancestors).to.have.lengthOf(1);
      expect(childRes.body.data.lineage.ancestors[0].parentLotID).to.equal(parentLotID);
    });
  });

  describe("9. Non-Authoritative Projection Notices & Benchmark Semantics", () => {
    it("should return explicit non-authoritative projection disclaimer on certificate API", async () => {
      const res = await request(app).get("/api/certificates/CERT-DEDUP-001").expect(200);
      expect(res.body.notice).to.include("NON-AUTHORITATIVE INDEXED PROJECTION");
      expect(res.body.notice).to.include("Consumer verification status must be queried directly from the deployed smart contract");
    });

    it("should return explicit non-authoritative projection and source-reported area disclaimers on lot API", async () => {
      const res = await request(app).get("/api/lots/LOT-HIGH-YIELD-001").expect(200);
      expect(res.body.notice).to.include("NON-AUTHORITATIVE INDEXED PROJECTION");
      expect(res.body.dataSourceNotice.reportedAreaHectares).to.include("External source-reported data; NOT on-chain truth");
    });

    it("should serve structured standards and published benchmark parameters", async () => {
      const res = await request(app).get("/api/standards").expect(200);
      expect(res.body.standards).to.have.lengthOf.at.least(1);
      expect(res.body.standards[0].standardID).to.equal("USDA-NOP-ORGANIC");
      expect(res.body.yieldBenchmark.thresholdKgPerHa).to.equal(2500);
      expect(res.body.yieldBenchmark.benchmarkType).to.equal("ANALYTICAL_SCREENING_BENCHMARK");
      expect(res.body.yieldBenchmark.regulatoryDisclaimer).to.include("NOT a regulatory maximum codified in USDA Organic 7 CFR Part 205");
    });
  });

  describe("10. Regulator/Auditor Endpoint Authorization & Data Protection Boundaries", () => {
    let authSessionToken: string;
    let sampleCaseID: string;

    before(async () => {
      const session = authService.createSession("0x4b07A2a7E631a808EF95CFe5cA5b8463d7b1a3Fd");
      authSessionToken = session.token;

      const c = await prisma.case.findFirst();
      sampleCaseID = c ? c.caseID : "CASE-REVOCATION-WORKFLOW-TEST";
    });

    it("should reject unauthenticated GET /api/cases with 401", async () => {
      const res = await request(app).get("/api/cases").expect(401);
      expect(res.body.error).to.include("SIWE authentication required");
    });

    it("should allow authenticated GET /api/cases with valid SIWE Bearer token", async () => {
      const res = await request(app)
        .get("/api/cases")
        .set("Authorization", `Bearer ${authSessionToken}`)
        .expect(200);
      expect(res.body.cases).to.be.an("array");
    });

    it("should reject unauthenticated GET /api/cases/:id with 401", async () => {
      const res = await request(app).get(`/api/cases/${sampleCaseID}`).expect(401);
      expect(res.body.error).to.include("SIWE authentication required");
    });

    it("should allow authenticated GET /api/cases/:id with valid SIWE Bearer token", async () => {
      const res = await request(app)
        .get(`/api/cases/${sampleCaseID}`)
        .set("Authorization", `Bearer ${authSessionToken}`)
        .expect(200);
      expect(res.body.caseID).to.equal(sampleCaseID);
    });

    it("should reject unauthenticated GET /api/anomalies with 401", async () => {
      const res = await request(app).get("/api/anomalies").expect(401);
      expect(res.body.error).to.include("SIWE authentication required");
    });

    it("should allow authenticated GET /api/anomalies with valid SIWE Bearer token", async () => {
      const res = await request(app)
        .get("/api/anomalies")
        .set("Authorization", `Bearer ${authSessionToken}`)
        .expect(200);
      expect(res.body.anomalies).to.be.an("array");
    });

    it("should reject unauthenticated POST /api/cases/:id/resolve with 401", async () => {
      await request(app)
        .post(`/api/cases/${sampleCaseID}/resolve`)
        .send({ actor: "0x123", resolution: "TEST" })
        .expect(401);
    });

    it("should protect raw regulator data on public GET /api/certificates/:id (no raw anomalies, cases, or reports)", async () => {
      const res = await request(app).get("/api/certificates/CERT-DEDUP-001").expect(200);
      // Unauthenticated response must strictly omit raw anomalies, raw cases, and reports
      expect(res.body.data).to.not.have.property("anomalies");
      expect(res.body.data).to.not.have.property("cases");
      expect(res.body.data).to.not.have.property("reports");
      // Must contain sanitized investigation indicator
      expect(res.body.data).to.have.property("investigation");
      expect(res.body.data.investigation).to.have.property("isUnderInvestigation");
    });

    it("should protect raw regulator data on public GET /api/lots/:id (no raw anomalies or internal case records)", async () => {
      const res = await request(app).get("/api/lots/LOT-HIGH-YIELD-001").expect(200);
      // Unauthenticated response must strictly omit raw anomalies and internal cases
      expect(res.body.data).to.not.have.property("anomalies");
      expect(res.body.data).to.not.have.property("cases");
      // Must still contain provenance lineage for consumer graph
      expect(res.body.data).to.have.property("lineage");
      // Must contain sanitized investigation indicator
      expect(res.body.data).to.have.property("investigation");
      expect(res.body.data.investigation).to.have.property("isUnderInvestigation");
    });

    it("should serve public sanitized investigation indicator at GET /api/investigations/status with zero raw data leakage", async () => {
      const res = await request(app)
        .get("/api/investigations/status?lotID=LOT-REPORT-TARGET-001")
        .expect(200);

      expect(res.body).to.have.property("isUnderInvestigation");
      expect(res.body.isUnderInvestigation).to.equal(true);
      expect(res.body).to.have.property("notice");
      expect(res.body.notice).to.include("Sanitized public investigation");

      // Verify ZERO leakage of sensitive regulator attributes
      expect(res.body).to.not.have.property("riskScore");
      expect(res.body).to.not.have.property("ruleID");
      expect(res.body).to.not.have.property("evidence");
      expect(res.body).to.not.have.property("assignedRole");
      expect(res.body).to.not.have.property("reviewer");
      expect(res.body).to.not.have.property("auditLogs");
      if (res.body.case) {
        expect(res.body.case).to.have.property("caseID");
        expect(res.body.case).to.have.property("status");
        expect(res.body.case).to.not.have.property("riskScore");
        expect(res.body.case).to.not.have.property("ruleID");
        expect(res.body.case).to.not.have.property("evidence");
        expect(res.body.case).to.not.have.property("reviewer");
        expect(res.body.case).to.not.have.property("auditLogs");
      }
    });
  });
});
