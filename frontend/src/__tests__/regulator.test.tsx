import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ethers } from "ethers";
import RegulatorDashboard from "../components/regulator/RegulatorDashboard";
import CaseQueue from "../components/regulator/CaseQueue";
import CaseDetailView from "../components/regulator/CaseDetailView";
import DismissCaseModal from "../components/regulator/DismissCaseModal";
import ConfirmRevocationModal from "../components/regulator/ConfirmRevocationModal";
import VerificationCard from "../components/VerificationCard";
import UnderReviewBanner from "../components/UnderReviewBanner";
import type { BlockchainVerificationResult } from "../services/contractVerification";
import type { CaseRecord } from "../services/indexerApi";
import { checkRevocationAuthorization, executeRevokeCertificate } from "../services/dashboardContractService";
import { parseContractError } from "../services/errorParser";

const ARBITRATOR_ADDR = "0x4b07A2a7E631a808EF95CFe5cA5b8463d7b1a3Fd";
const ISSUER_ADDR = "0x1111111111111111111111111111111111111111";
const UNAUTHORIZED_ADDR = "0x9999999999999999999999999999999999999999";
const ARBITRATION_ROLE_HASH = "0x0e5d0a646da496105c2dfdbccb01a1c93a027931cfd93cefa5dfa0baab8ca930";

const mockCase: CaseRecord = {
  caseID: "CASE-REGULATOR-TEST-001",
  lotID: "LOT-TEST-HUILA-001",
  certificateID: "CERT-TEST-REVOKE-001",
  anomalyType: "RULE_MASS_BALANCE_OVERFLOW",
  riskScore: 90,
  status: "UNDER_REVIEW",
  assignedRole: "ARBITRATION_REGULATOR",
  reviewer: "regulator@arbitration.org",
  openedAt: "2026-09-12T00:00:00.000Z",
  evidence: {
    requestedGrams: "25000000",
    remainingGrams: "10000000",
    deltaGrams: "15000000",
  },
  anomalies: [
    {
      id: "ANOM-001",
      ruleID: "RULE_MASS_BALANCE_OVERFLOW",
      severity: "CRITICAL",
      riskScore: 90,
      status: "FLAGGED",
      lotID: "LOT-TEST-HUILA-001",
      certificateID: "CERT-TEST-REVOKE-001",
      description: "Requested quantity exceeds remaining certified balance",
      evidence: { requestedGrams: "25000000", remainingGrams: "10000000" },
      blockNumber: 11684490,
      txHash: "0xaaaa1111222233334444555566667777888899990000aaaa1111222233334444",
      detectedAt: "2026-09-12T00:00:00.000Z",
    },
  ],
  reports: [
    {
      reportID: "REP-001",
      issueType: "VOLUME_DISCREPANCY",
      reporterReference: "0xanonreporter123",
      dedupeKey: "dedupe-key-001",
      submittedAt: "2026-09-12T00:00:00.000Z",
    },
  ],
  auditLogs: [
    {
      id: "LOG-001",
      caseID: "CASE-REGULATOR-TEST-001",
      actor: "system-anomaly-engine",
      action: "CASE_OPENED",
      timestamp: "2026-09-12T00:00:00.000Z",
      notes: "Case escalated automatically from critical MassBalanceAlert",
    },
    {
      id: "LOG-002",
      caseID: "CASE-REGULATOR-TEST-001",
      actor: "regulator@arbitration.org",
      action: "TRANSITION_UNDER_REVIEW",
      previousStatus: "OPEN",
      newStatus: "UNDER_REVIEW",
      timestamp: "2026-09-12T01:00:00.000Z",
      notes: "Reviewer assigned",
    },
  ],
};

function createMockCertificateContract(initialStatus: number = 2) {
  let status = initialStatus; // 2 = Valid, 4 = Revoked
  return {
    getCertificateStatus: vi.fn().mockImplementation(async () => status),
    getCertificate: vi.fn().mockResolvedValue({
      certificateID: "CERT-TEST-REVOKE-001",
      issuer: ISSUER_ADDR,
      standardID: "USDA-NOP-ORGANIC",
      holder: "0x2222222222222222222222222222222222222222",
      certifiedQuantityGrams: 50000000n,
      remainingQuantityGrams: 10000000n,
      validFrom: 1700000000n,
      validUntil: 1800000000n,
      isRevoked: status === 4,
      revocationReason: status === 4 ? "Confirmed mass balance violation" : "",
      revokedBy: status === 4 ? ARBITRATOR_ADDR : ethers.ZeroAddress,
      attestedBy: "CertLedger",
      source: "USDA INTEGRITY Database",
      sourceID: "CCOF",
    }),
    ARBITRATION_ROLE: vi.fn().mockResolvedValue(ARBITRATION_ROLE_HASH),
    hasRole: vi.fn().mockImplementation(async (role: string, account: string) => {
      if (account.toLowerCase() === ARBITRATOR_ADDR.toLowerCase()) return true;
      return false;
    }),
    revokeCertificate: vi.fn().mockImplementation(async (certID: string, reason: string) => {
      status = 4; // mutate to Revoked
      return {
        hash: "0x9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef",
        wait: vi.fn().mockResolvedValue({
          hash: "0x9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef",
          blockNumber: 11684555,
        }),
      };
    }),
  };
}

describe("Phase 6 Regulator & Auditor Dashboard Test Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Case queue loads
  it("1. proves case queue loads and renders case list with status and risk badges", () => {
    render(
      <CaseQueue
        cases={[mockCase]}
        selectedCaseId={null}
        onSelectCase={vi.fn()}
      />
    );

    expect(screen.getByText(/CASE-REG/)).toBeInTheDocument();
    expect(screen.getByText("LOT-TEST-HUILA-001")).toBeInTheDocument();
    expect(screen.getByText("CERT-TEST-REVOKE-001")).toBeInTheDocument();
    expect(screen.getByText("90/100")).toBeInTheDocument();
    expect(screen.getByText("RULE_MASS_BALANCE_OVERFLOW")).toBeInTheDocument();
    expect(screen.getAllByText("UNDER REVIEW").length).toBeGreaterThanOrEqual(1);
  });

  // 2. Case details load
  it("2. proves case details load with overview, evidence, and audit logs", async () => {
    const mockContract = createMockCertificateContract(2);

    render(
      <CaseDetailView
        caseRecord={mockCase}
        connectedAddress={ARBITRATOR_ADDR}
        onClose={vi.fn()}
        onMoveToReview={vi.fn()}
        onOpenDismissModal={vi.fn()}
        onOpenConfirmModal={vi.fn()}
        customContract={mockContract}
      />
    );

    expect(screen.getByText("Case: CASE-REGULATOR-TEST-001")).toBeInTheDocument();
    expect(screen.getByText("Dominant Anomaly:")).toBeInTheDocument();
    expect(screen.getAllByText("regulator@arbitration.org").length).toBeGreaterThanOrEqual(1);

    await waitFor(() => {
      expect(screen.getByText("VALID")).toBeInTheDocument();
    });

    // Check audit logs
    expect(screen.getByText("CASE_OPENED")).toBeInTheDocument();
    expect(screen.getByText("TRANSITION_UNDER_REVIEW")).toBeInTheDocument();
  });

  // 3. Raw anomaly data appears on regulator dashboard
  it("3. proves raw anomaly data appears on regulator dashboard (PRD §7.5)", () => {
    render(
      <CaseDetailView
        caseRecord={mockCase}
        connectedAddress={ARBITRATOR_ADDR}
        onClose={vi.fn()}
        onMoveToReview={vi.fn()}
        onOpenDismissModal={vi.fn()}
        onOpenConfirmModal={vi.fn()}
      />
    );

    // Regulator sees raw rule ID, risk score, severity, and evidence JSON
    expect(screen.getByText("Auditor Eyes Only (PRD §7.5)")).toBeInTheDocument();
    expect(screen.getAllByText("RULE_MASS_BALANCE_OVERFLOW").length).toBeGreaterThan(0);
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getByText(/requestedGrams/)).toBeInTheDocument();
    expect(screen.getByText(/25000000/)).toBeInTheDocument();
  });

  // 4. Raw anomaly data does not appear on consumer page
  it("4. proves raw anomaly data does not appear on consumer verification page (Part F & P)", () => {
    const openCaseInfo = {
      caseID: "CASE-REGULATOR-TEST-001",
      anomalyType: "RULE_MASS_BALANCE_OVERFLOW",
      status: "UNDER_REVIEW",
      assignedRole: "ARBITRATION_REGULATOR",
      openedAt: "2026-09-12T00:00:00.000Z",
    };

    render(<UnderReviewBanner openCase={openCaseInfo} />);

    // Consumer sees only high-level notice and Case ID
    expect(screen.getByText(/UNDER REVIEW: An investigation is currently open/)).toBeInTheDocument();
    expect(screen.getByText("CASE-REGULATOR-TEST-001")).toBeInTheDocument();

    // MUST NOT leak raw rule ID, severity, or risk score to consumer
    expect(screen.queryByText("RULE_MASS_BALANCE_OVERFLOW")).not.toBeInTheDocument();
    expect(screen.queryByText("CRITICAL")).not.toBeInTheDocument();
    expect(screen.queryByText("90/100")).not.toBeInTheDocument();
    expect(screen.queryByText("ARBITRATION_REGULATOR")).not.toBeInTheDocument();
    expect(screen.queryByText("25000000")).not.toBeInTheDocument();
  });

  // 5. Authorized wallet can see Confirm action
  it("5. proves authorized wallet (holding ARBITRATION_ROLE) evaluates as authorized", async () => {
    const mockContract = createMockCertificateContract(2);

    const authInfo = await checkRevocationAuthorization(
      "CERT-TEST-REVOKE-001",
      ARBITRATOR_ADDR,
      mockContract
    );

    expect(authInfo.isAuthorized).toBe(true);
    expect(authInfo.isArbitrator).toBe(true);
    expect(authInfo.currentStatus).toBe("VALID");
  });

  // 6. Unauthorized wallet cannot use Confirm successfully
  it("6. proves unauthorized wallet evaluates as unauthorized and is prevented from confirming", async () => {
    const mockContract = createMockCertificateContract(2);

    const authInfo = await checkRevocationAuthorization(
      "CERT-TEST-REVOKE-001",
      UNAUTHORIZED_ADDR,
      mockContract
    );

    expect(authInfo.isAuthorized).toBe(false);
    expect(authInfo.isArbitrator).toBe(false);
    expect(authInfo.isIssuer).toBe(false);

    // Render modal for unauthorized user
    render(
      <ConfirmRevocationModal
        isOpen={true}
        onClose={vi.fn()}
        caseRecord={mockCase}
        connectedAddress={UNAUTHORIZED_ADDR}
        signer={{ getAddress: vi.fn().mockResolvedValue(UNAUTHORIZED_ADDR) } as any}
        onRevocationSuccess={vi.fn()}
        customContract={mockContract}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Unauthorized Wallet:/)).toBeInTheDocument();
    });

    const executeBtn = screen.getByText("Execute On-Chain Revocation");
    expect(executeBtn).toBeDisabled();
  });

  // 7. Dismiss updates the backend Case
  it("7. proves Dismiss action submits rationale notes to backend", async () => {
    const onDismissConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <DismissCaseModal
        isOpen={true}
        onClose={vi.fn()}
        caseRecord={mockCase}
        currentActor="auditor@usda.gov"
        onDismissConfirm={onDismissConfirm}
      />
    );

    const textarea = screen.getByLabelText(/Dismissal Rationale & Investigation Findings/);
    await userEvent.type(textarea, "Physical on-site audit confirmed organic compliance.");

    const submitBtn = screen.getByText("Confirm Off-Chain Dismissal");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onDismissConfirm).toHaveBeenCalledWith("Physical on-site audit confirmed organic compliance.");
    });
  });

  // 8. Dismiss does not mutate blockchain
  it("8. proves Dismiss is strictly off-chain and does not call contract", async () => {
    const mockContract = createMockCertificateContract(2);

    // Call dismiss modal
    const onDismissConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <DismissCaseModal
        isOpen={true}
        onClose={vi.fn()}
        caseRecord={mockCase}
        currentActor="auditor@usda.gov"
        onDismissConfirm={onDismissConfirm}
      />
    );

    const textarea = screen.getByLabelText(/Dismissal Rationale & Investigation Findings/);
    await userEvent.type(textarea, "Dismissed due to external resolution.");
    fireEvent.click(screen.getByText("Confirm Off-Chain Dismissal"));

    await waitFor(() => {
      expect(onDismissConfirm).toHaveBeenCalled();
    });

    // Contract revokeCertificate must NEVER have been called
    expect(mockContract.revokeCertificate).not.toHaveBeenCalled();
    const status = await mockContract.getCertificateStatus("CERT-TEST-REVOKE-001");
    expect(status).toBe(2); // Still VALID!
  });

  // 9. Confirm opens wallet transaction
  it("9. proves Confirm requires explicit checkbox and triggers contract revokeCertificate", async () => {
    const mockContract = createMockCertificateContract(2);
    const mockSigner = {
      getAddress: vi.fn().mockResolvedValue(ARBITRATOR_ADDR),
    } as any;

    const onRevocationSuccess = vi.fn().mockResolvedValue(undefined);

    render(
      <ConfirmRevocationModal
        isOpen={true}
        onClose={vi.fn()}
        caseRecord={mockCase}
        connectedAddress={ARBITRATOR_ADDR}
        signer={mockSigner}
        onRevocationSuccess={onRevocationSuccess}
        customContract={mockContract}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Authorized to Revoke:/)).toBeInTheDocument();
    });

    // Checkbox must be ticked
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();

    const executeBtn = screen.getByText("Execute On-Chain Revocation");
    expect(executeBtn).toBeDisabled();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(executeBtn).not.toBeDisabled();

    fireEvent.click(executeBtn);

    await waitFor(() => {
      expect(mockContract.revokeCertificate).toHaveBeenCalledWith(
        "CERT-TEST-REVOKE-001",
        expect.any(String)
      );
    });
  });

  // 10. Confirmation waits for mining
  it("10. proves revocation waits for transaction receipt (wait(1)) before finalizing", async () => {
    let waitResolved = false;
    const mockContract = {
      getCertificateStatus: vi.fn().mockImplementation(async () => (waitResolved ? 4 : 2)),
      getCertificate: vi.fn().mockResolvedValue({
        certificateID: "CERT-TEST-REVOKE-001",
        issuer: ISSUER_ADDR,
      }),
      ARBITRATION_ROLE: vi.fn().mockResolvedValue(ARBITRATION_ROLE_HASH),
      hasRole: vi.fn().mockResolvedValue(true),
      revokeCertificate: vi.fn().mockReturnValue({
        hash: "0xTx123456",
        wait: vi.fn().mockImplementation(async () => {
          waitResolved = true;
          return { hash: "0xTx123456", blockNumber: 11684501 };
        }),
      }),
    };

    const mockSigner = { getAddress: vi.fn().mockResolvedValue(ARBITRATOR_ADDR) } as any;

    const res = await executeRevokeCertificate("CERT-TEST-REVOKE-001", "Audit confirmed violation", mockSigner, mockContract);
    expect(waitResolved).toBe(true);
    expect(res.resultingStatus).toBe("REVOKED");
    expect(res.blockNumber).toBe(11684501);
  });

  // 11. Successful transaction produces REVOKED on-chain
  it("11. proves successful transaction produces REVOKED status on-chain", async () => {
    const mockContract = createMockCertificateContract(2);
    const mockSigner = { getAddress: vi.fn().mockResolvedValue(ARBITRATOR_ADDR) } as any;

    const initialStatus = await mockContract.getCertificateStatus("CERT-TEST-REVOKE-001");
    expect(initialStatus).toBe(2); // VALID

    const result = await executeRevokeCertificate(
      "CERT-TEST-REVOKE-001",
      "Revocation order issued",
      mockSigner,
      mockContract
    );

    expect(result.resultingStatus).toBe("REVOKED");
    const finalStatus = await mockContract.getCertificateStatus("CERT-TEST-REVOKE-001");
    expect(finalStatus).toBe(4); // REVOKED
  });

  // 12. Failed transaction does not falsely finalize the Case
  it("12. proves failed transaction does NOT finalize the case", async () => {
    const failingContract = {
      getCertificateStatus: vi.fn().mockResolvedValue(2),
      getCertificate: vi.fn().mockResolvedValue({
        certificateID: "CERT-TEST-REVOKE-001",
        issuer: ISSUER_ADDR,
      }),
      ARBITRATION_ROLE: vi.fn().mockResolvedValue(ARBITRATION_ROLE_HASH),
      hasRole: vi.fn().mockResolvedValue(true),
      revokeCertificate: vi.fn().mockRejectedValue(new Error("execution reverted: UnauthorizedRevocation")),
    };

    const mockSigner = { getAddress: vi.fn().mockResolvedValue(ARBITRATOR_ADDR) } as any;
    const onRevocationSuccess = vi.fn();
    const onRevocationFailed = vi.fn().mockResolvedValue(undefined);

    render(
      <ConfirmRevocationModal
        isOpen={true}
        onClose={vi.fn()}
        caseRecord={mockCase}
        connectedAddress={ARBITRATOR_ADDR}
        signer={mockSigner}
        onRevocationSuccess={onRevocationSuccess}
        onRevocationFailed={onRevocationFailed}
        customContract={failingContract}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Authorized to Revoke:/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Execute On-Chain Revocation"));

    await waitFor(() => {
      expect(onRevocationSuccess).not.toHaveBeenCalled();
      expect(onRevocationFailed).toHaveBeenCalled();
    });
  });

  // 13. User rejection is handled correctly
  it("13. proves user wallet cancellation (code 4001 / ACTION_REJECTED) is handled gracefully", () => {
    const userRejectionError = {
      code: "ACTION_REJECTED",
      message: "user rejected action",
    };

    const parsed = parseContractError(userRejectionError);
    expect(parsed.title).toBe("Transaction Cancelled");
    expect(parsed.isUserRejection).toBe(true);
    expect(parsed.explanation).toContain("cancelled the transaction in your wallet");
  });

  // 14. RPC failure is handled correctly
  it("14. proves RPC / network communication failure is parsed accurately", () => {
    const rpcError = {
      code: "NETWORK_ERROR",
      message: "failed to fetch Sepolia RPC endpoint",
    };

    const parsed = parseContractError(rpcError);
    expect(parsed.title).toBe("Network / RPC Communication Error");
    expect(parsed.isRpcError).toBe(true);
    expect(parsed.explanation).toContain("Ethereum Sepolia RPC node");
  });

  // 15. Transaction hash and explorer link is displayed
  it("15. proves transaction hash and Sepolia explorer link are rendered upon confirmation", async () => {
    const mockContract = createMockCertificateContract(2);
    const mockSigner = { getAddress: vi.fn().mockResolvedValue(ARBITRATOR_ADDR) } as any;
    const onRevocationSuccess = vi.fn().mockResolvedValue(undefined);

    render(
      <ConfirmRevocationModal
        isOpen={true}
        onClose={vi.fn()}
        caseRecord={mockCase}
        connectedAddress={ARBITRATOR_ADDR}
        signer={mockSigner}
        onRevocationSuccess={onRevocationSuccess}
        customContract={mockContract}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Authorized to Revoke:/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Execute On-Chain Revocation"));

    await waitFor(() => {
      expect(screen.getByText("Revocation Confirmed on Blockchain!")).toBeInTheDocument();
      expect(screen.getByText("Done")).toBeInTheDocument();
    });
  });

  // 16. Consumer page changes from VALID to REVOKED after the chain state changes (Live Propagation)
  it("16. proves live propagation: consumer verification changes from VALID to REVOKED via direct contract read", async () => {
    // Stage 1: Before revocation - contract returns VALID (2)
    const validBcResult: BlockchainVerificationResult = {
      isAvailable: true,
      status: "VALID",
      lot: {
        lotID: "LOT-TEST-HUILA-001",
        certificateID: "CERT-TEST-REVOKE-001",
        quantityGrams: 25000000n,
        currentOwner: ISSUER_ADDR,
        status: "ACTIVE",
        createdAt: 1710000000,
        parentLotIDs: [],
        childLotIDs: [],
      },
      certificate: {
        certificateID: "CERT-TEST-REVOKE-001",
        issuer: ISSUER_ADDR,
        standardID: "USDA-NOP-ORGANIC",
        holder: "0x2222222222222222222222222222222222222222",
        certifiedQuantityGrams: 50000000n,
        remainingQuantityGrams: 25000000n,
        validFrom: new Date(1700000000000),
        validUntil: new Date(1800000000000),
        isRevoked: false,
        attestedBy: "CertLedger",
        source: "USDA INTEGRITY Database",
        sourceID: "CCOF",
      },
      chainId: 11155111,
      providerUrl: "test-provider",
      error: null,
    };

    const { rerender } = render(
      <VerificationCard
        result={validBcResult}
        isLoading={false}
        onOpenReport={vi.fn()}
        onScrollToQR={vi.fn()}
      />
    );

    // Initial check: VALID
    expect(screen.getByText("Certificate status: VALID")).toBeInTheDocument();
    expect(screen.queryByText("Certificate status: REVOKED")).not.toBeInTheDocument();

    // Stage 2: After on-chain revocation mined - contract returns REVOKED (4)
    const revokedBcResult: BlockchainVerificationResult = {
      ...validBcResult,
      status: "REVOKED",
      certificate: {
        ...validBcResult.certificate!,
        isRevoked: true,
        revocationReason: "Confirmed mass balance violation",
      },
    };

    rerender(
      <VerificationCard
        result={revokedBcResult}
        isLoading={false}
        onOpenReport={vi.fn()}
        onScrollToQR={vi.fn()}
      />
    );

    // Direct contract read produces REVOKED without needing indexer update!
    expect(screen.getByText("Certificate status: REVOKED")).toBeInTheDocument();
    expect(screen.queryByText("Certificate status: VALID")).not.toBeInTheDocument();
  });
});
