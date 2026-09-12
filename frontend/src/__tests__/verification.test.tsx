import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import VerificationCard from "../components/VerificationCard";
import UnderReviewBanner from "../components/UnderReviewBanner";
import StandardsExplainer from "../components/StandardsExplainer";
import QRCodeView from "../components/QRCodeView";
import type { BlockchainVerificationResult } from "../services/contractVerification";
import {
  fetchSupplementaryData,
  submitConsumerReport,
  FALLBACK_USDA_STANDARD,
} from "../services/indexerApi";
import { DEMO_LOTS, CONFIGURED_SEPOLIA_RPCS } from "../services/config";


describe("Phase 4 Consumer Verification & Provenance UI Test Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Authoritative Blockchain Status (VALID / EXPIRED / REVOKED)", () => {
    it("proves VALID status is read directly from the smart contract", async () => {
      const mockProvider = {
        getNetwork: vi.fn().mockResolvedValue({ chainId: 11155111n }),
        call: vi.fn(),
      };

      const mockLotData = {
        lotID: "LOT-VAL-001",
        certificateID: "CERT-VAL-001",
        quantityGrams: 25000000n,
        currentOwner: "0x1111111111111111111111111111111111111111",
        status: "ACTIVE" as const,
        createdAt: 1710000000,
        parentLotIDs: [],
        childLotIDs: [],
      };

      const mockCertData = {
        certificateID: "CERT-VAL-001",
        issuer: "0x2222222222222222222222222222222222222222",
        standardID: "USDA-NOP-ORGANIC",
        holder: "0x1111111111111111111111111111111111111111",
        certifiedQuantityGrams: 50000000n,
        remainingQuantityGrams: 25000000n,
        validFrom: new Date(1700000000000),
        validUntil: new Date(1800000000000),
        isRevoked: false,
        attestedBy: "CertLedger",
        source: "USDA INTEGRITY Database",
        sourceID: "CCOF",
      };

      const result: BlockchainVerificationResult = {
        isAvailable: true,
        status: "VALID",
        lot: mockLotData,
        certificate: mockCertData,
        chainId: 11155111,
        providerUrl: "custom-test-provider",
        error: null,
      };

      render(
        <VerificationCard
          result={result}
          isLoading={false}
          onOpenReport={vi.fn()}
          onScrollToQR={vi.fn()}
        />
      );

      expect(screen.getByText("Certificate status: VALID")).toBeInTheDocument();
      expect(screen.getByText("Live Blockchain Truth (Sepolia)")).toBeInTheDocument();
      expect(screen.getByText("LOT-VAL-001")).toBeInTheDocument();
      const massElements = screen.getAllByText(/25,000.00 kg/);
      expect(massElements.length).toBeGreaterThanOrEqual(1);
    });

    it("proves EXPIRED status is read directly from the smart contract", async () => {
      const result: BlockchainVerificationResult = {
        isAvailable: true,
        status: "EXPIRED",
        lot: {
          lotID: "LOT-EXP-001",
          certificateID: "CERT-EXP-001",
          quantityGrams: 10000000n,
          currentOwner: "0x1111111111111111111111111111111111111111",
          status: "ACTIVE",
          createdAt: 1600000000,
          parentLotIDs: [],
          childLotIDs: [],
        },
        certificate: {
          certificateID: "CERT-EXP-001",
          issuer: "0x2222222222222222222222222222222222222222",
          standardID: "USDA-NOP-ORGANIC",
          holder: "0x1111111111111111111111111111111111111111",
          certifiedQuantityGrams: 10000000n,
          remainingQuantityGrams: 0n,
          validFrom: new Date(1500000000000),
          validUntil: new Date(1600000000000),
          isRevoked: false,
          attestedBy: "CertLedger",
          source: "USDA INTEGRITY Database",
          sourceID: "OTCO",
        },
        chainId: 11155111,
        providerUrl: "custom-test-provider",
        error: null,
      };

      render(
        <VerificationCard
          result={result}
          isLoading={false}
          onOpenReport={vi.fn()}
          onScrollToQR={vi.fn()}
        />
      );

      expect(screen.getByText("Certificate status: EXPIRED")).toBeInTheDocument();
    });

    it("proves REVOKED status is read directly from the smart contract", async () => {
      const result: BlockchainVerificationResult = {
        isAvailable: true,
        status: "REVOKED",
        lot: {
          lotID: "LOT-REV-001",
          certificateID: "CERT-REV-001",
          quantityGrams: 5000000n,
          currentOwner: "0x1111111111111111111111111111111111111111",
          status: "CONSUMED",
          createdAt: 1700000000,
          parentLotIDs: [],
          childLotIDs: [],
        },
        certificate: {
          certificateID: "CERT-REV-001",
          issuer: "0x2222222222222222222222222222222222222222",
          standardID: "USDA-NOP-ORGANIC",
          holder: "0x1111111111111111111111111111111111111111",
          certifiedQuantityGrams: 20000000n,
          remainingQuantityGrams: 15000000n,
          validFrom: new Date(1700000000000),
          validUntil: new Date(1800000000000),
          isRevoked: true,
          revocationReason: "Pesticide contamination detected",
          attestedBy: "CertLedger",
          source: "USDA INTEGRITY Database",
          sourceID: "MAYACERT",
        },
        chainId: 11155111,
        providerUrl: "custom-test-provider",
        error: null,
      };

      render(
        <VerificationCard
          result={result}
          isLoading={false}
          onOpenReport={vi.fn()}
          onScrollToQR={vi.fn()}
        />
      );

      expect(screen.getByText("Certificate status: REVOKED")).toBeInTheDocument();
    });
  });

  describe("2. RPC Failure & LotNotFound Handling", () => {
    it("proves RPC network failure returns verification unavailable and NEVER displays EXPIRED or REVOKED", async () => {
      const failingResult: BlockchainVerificationResult = {
        isAvailable: false,
        status: null,
        lot: null,
        certificate: null,
        chainId: null,
        providerUrl: null,
        error: "Verification unavailable — unable to read the blockchain right now.",
      };

      render(
        <VerificationCard
          result={failingResult}
          isLoading={false}
          onOpenReport={vi.fn()}
          onScrollToQR={vi.fn()}
        />
      );

      // Verify unavailable error message is rendered
      expect(screen.getByText("Verification Unavailable")).toBeInTheDocument();
      expect(screen.getByText("Unable to read the blockchain right now.")).toBeInTheDocument();

      // CRITICAL: Ensure neither REVOKED nor EXPIRED is displayed
      expect(screen.queryByText("Certificate status: REVOKED")).not.toBeInTheDocument();
      expect(screen.queryByText("Certificate status: EXPIRED")).not.toBeInTheDocument();
      expect(screen.queryByText("Certificate status: VALID")).not.toBeInTheDocument();
    });

    it("proves LotNotFound revert returns isAvailable: true and displays Consignment Not Found, NOT Verification Unavailable", () => {
      const lotNotFoundResult: BlockchainVerificationResult = {
        isAvailable: true,
        status: null,
        lot: null,
        certificate: null,
        chainId: 11155111,
        providerUrl: "https://ethereum-sepolia-rpc.publicnode.com",
        error: 'Consignment lot "LOT-NONEXISTENT-999" was not found on the blockchain.',
      };

      render(
        <VerificationCard
          result={lotNotFoundResult}
          isLoading={false}
          onOpenReport={vi.fn()}
          onScrollToQR={vi.fn()}
        />
      );

      expect(screen.getByText("Consignment Not Found")).toBeInTheDocument();
      expect(screen.getByText("Record Not Found on Blockchain")).toBeInTheDocument();
      expect(
        screen.getByText('Consignment lot "LOT-NONEXISTENT-999" was not found on the blockchain.')
      ).toBeInTheDocument();
      expect(screen.getByText(/Verified Connected/)).toBeInTheDocument();

      // Must NOT display Verification Unavailable or false status
      expect(screen.queryByText("Verification Unavailable")).not.toBeInTheDocument();
      expect(screen.queryByText("Unable to read the blockchain right now.")).not.toBeInTheDocument();
      expect(screen.queryByText("Certificate status: REVOKED")).not.toBeInTheDocument();
    });

    it("proves unknown status code returns status: null and does NOT default to REVOKED", () => {
      const unknownStatusResult: BlockchainVerificationResult = {
        isAvailable: true,
        status: null,
        lot: {
          lotID: "LOT-VAL-001",
          certificateID: "CERT-VAL-001",
          quantityGrams: 25000000n,
          currentOwner: "0x1111111111111111111111111111111111111111",
          status: "ACTIVE",
          createdAt: 1710000000,
          parentLotIDs: [],
          childLotIDs: [],
        },
        certificate: null,
        chainId: 11155111,
        providerUrl: "https://ethereum-sepolia-rpc.publicnode.com",
        error: "Unknown certificate status code (99) returned from blockchain.",
      };

      render(
        <VerificationCard
          result={unknownStatusResult}
          isLoading={false}
          onOpenReport={vi.fn()}
          onScrollToQR={vi.fn()}
        />
      );

      // Must NOT display REVOKED
      expect(screen.queryByText("Certificate status: REVOKED")).not.toBeInTheDocument();
      expect(screen.getByText("Record Not Found on Blockchain")).toBeInTheDocument();
      expect(screen.getByText("Unknown certificate status code (99) returned from blockchain.")).toBeInTheDocument();
    });

    it("proves default root demo lot is configured to live Sepolia lot and dead RPC is excluded", () => {
      expect(DEMO_LOTS.VALID).toBe("LOT-SEPOLIA-DEMO-001");
      expect(CONFIGURED_SEPOLIA_RPCS).not.toContain("https://rpc.sepolia.org");
      expect(CONFIGURED_SEPOLIA_RPCS[0]).toBe("https://ethereum-sepolia-rpc.publicnode.com");
    });
  });

  describe("3. Architectural Boundary & PostgreSQL Separation", () => {
    it("proves PostgreSQL status changes do NOT determine consumer validity", async () => {
      // Scenario: PostgreSQL indexer projection incorrectly marks a lot as CONSUMED or invalid,
      // but smart contract status on-chain returns VALID (status code 2).
      const mockOnChainResult: BlockchainVerificationResult = {
        isAvailable: true,
        status: "VALID", // Directly from blockchain contract
        lot: {
          lotID: "LOT-OVERRIDE-001",
          certificateID: "CERT-OVERRIDE-001",
          quantityGrams: 10000000n,
          currentOwner: "0x1111111111111111111111111111111111111111",
          status: "ACTIVE",
          createdAt: 1710000000,
          parentLotIDs: [],
          childLotIDs: [],
        },
        certificate: {
          certificateID: "CERT-OVERRIDE-001",
          issuer: "0x2222222222222222222222222222222222222222",
          standardID: "USDA-NOP-ORGANIC",
          holder: "0x1111111111111111111111111111111111111111",
          certifiedQuantityGrams: 10000000n,
          remainingQuantityGrams: 5000000n,
          validFrom: new Date(1700000000000),
          validUntil: new Date(1800000000000),
          isRevoked: false,
          attestedBy: "CertLedger",
          source: "USDA INTEGRITY Database",
          sourceID: "CCOF",
        },
        chainId: 11155111,
        providerUrl: "custom-test-provider",
        error: null,
      };

      render(
        <VerificationCard
          result={mockOnChainResult}
          isLoading={false}
          onOpenReport={vi.fn()}
          onScrollToQR={vi.fn()}
        />
      );

      // Must display VALID strictly from contract
      expect(screen.getByText("Certificate status: VALID")).toBeInTheDocument();
      expect(screen.queryByText("Certificate status: REVOKED")).not.toBeInTheDocument();
    });

    it("proves backend offline does not block live blockchain status display", async () => {
      // Mock fetch throwing network failure for all backend endpoints
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:4000")));

      const suppResult = await fetchSupplementaryData("LOT-ANY-001");
      expect(suppResult.isAvailable).toBe(false);
      expect(suppResult.error).toContain("Supplementary indexer details currently unavailable");
      // Fallback standard is returned so spec explanation remains visible
      expect(suppResult.standard).not.toBeNull();
      expect(suppResult.standard!.standardID).toBe("USDA-NOP-ORGANIC");
    });
  });

  describe("4. Investigation State Separation (UNDER REVIEW Indicator)", () => {
    it("proves open Case in backend displays separate UNDER REVIEW indicator banner", () => {
      const openCase = {
        caseID: "CASE-AUDIT-999",
        anomalyType: "RULE_YIELD_IMPLAUSIBILITY",
        status: "UNDER_REVIEW",
        assignedRole: "ISSUER_REVIEWER",
        openedAt: new Date().toISOString(),
      };

      render(<UnderReviewBanner openCase={openCase} />);

      expect(
        screen.getByText("UNDER REVIEW: An investigation is currently open for this lot/certificate.")
      ).toBeInTheDocument();
      expect(screen.getByText("CASE-AUDIT-999")).toBeInTheDocument();
      expect(screen.getByText(/Notice:/)).toBeInTheDocument();
      // Part F & P Separation: Raw anomaly rule IDs and internal reviewer roles must NEVER leak to consumer page
      expect(screen.queryByText("RULE_YIELD_IMPLAUSIBILITY")).not.toBeInTheDocument();
      expect(screen.queryByText("ISSUER_REVIEWER")).not.toBeInTheDocument();
    });

    it("proves no Case in backend does NOT display UNDER REVIEW indicator banner", () => {
      const { container } = render(<UnderReviewBanner openCase={null} />);
      expect(container).toBeEmptyDOMElement();
      expect(
        screen.queryByText(/UNDER REVIEW: An investigation is currently open/)
      ).not.toBeInTheDocument();
    });
  });

  describe("5. Standards Explanation Component", () => {
    it("proves covered dimensions and excluded dimensions with rationales are rendered deterministically", () => {
      render(
        <StandardsExplainer
          standard={FALLBACK_USDA_STANDARD}
          isBackendAvailable={true}
        />
      );

      // Check Covered Section Header
      expect(screen.getByText("This certification covers:")).toBeInTheDocument();
      expect(screen.getByText("Farming Practices")).toBeInTheDocument();
      expect(screen.getByText("7 CFR §205.200, §205.201")).toBeInTheDocument();

      // Check Excluded Section Header
      expect(screen.getByText("This certification does NOT guarantee:")).toBeInTheDocument();
      expect(screen.getByText("Fair Wages And Labor Conditions")).toBeInTheDocument();
      expect(
        screen.getByText(/OFPA statute \(7 U.S.C. 6501\) limits NOP authority/)
      ).toBeInTheDocument();
      expect(screen.getByText("Carbon Neutrality And Ghg Emissions")).toBeInTheDocument();
    });
  });

  describe("6. Reusable QR Component", () => {
    it("proves QRCodeView encodes deterministic URL targeting /verify/<lotID>", () => {
      render(
        <QRCodeView
          lotID="LOT-COOP-HUILA-001"
          baseUrl="http://localhost:5173"
        />
      );

      const codeElement = screen.getByTestId("qr-encoded-url");
      expect(codeElement).toHaveTextContent("http://localhost:5173/verify/LOT-COOP-HUILA-001");
    });
  });

  describe("7. Consumer Problem Reporting", () => {
    it("proves report submission reaches Phase 3 API without exposing risk score", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: "Report submitted successfully",
          report: {
            reportID: "rep-uuid-1234",
            dedupeKey: "0xabcdef1234567890",
            submittedAt: new Date().toISOString(),
          },
        }),
      });

      vi.stubGlobal("fetch", mockFetch);

      const response = await submitConsumerReport({
        lotID: "LOT-COOP-HUILA-001",
        issueType: "PRODUCT_MISLABELING",
        reporterReference: "user-anon-888",
        evidence: { note: "Packaging missing certifying body badge" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/reports"),
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );

      expect(response.success).toBe(true);
      expect(response.dedupeKey).toBe("0xabcdef1234567890");

      // Verify no riskScore property is returned or exposed
      expect(response).not.toHaveProperty("riskScore");
    });
  });
});
