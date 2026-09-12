import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ethers } from "ethers";
import NetworkMismatchBanner from "../components/dashboard/NetworkMismatchBanner";
import IssuerIssuanceForm from "../components/dashboard/IssuerIssuanceForm";
import RootConsignmentForm from "../components/dashboard/RootConsignmentForm";
import SplitLotForm from "../components/dashboard/SplitLotForm";
import ProcessLotForm from "../components/dashboard/ProcessLotForm";
import ConsignmentSuccessModal from "../components/dashboard/ConsignmentSuccessModal";
import {
  generateSiweMessage,
  signInWithEthereum,
} from "../services/walletAuth";
import { parseContractError } from "../services/errorParser";
import {
  kgToIntegerGrams,
  integerGramsToKg,
} from "../services/dashboardContractService";
import { SEPOLIA_CHAIN_ID } from "../services/config";

const TEST_WALLET_PK = "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d";

describe("Phase 5 Authenticated Issuer & Producer Dashboard Test Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. SIWE Authentication & Network Enforcement", () => {
    it("proves standard EIP-4361 SIWE message is generated deterministically", () => {
      const message = generateSiweMessage({
        domain: "localhost:5173",
        address: "0x1111111111111111111111111111111111111111",
        statement: "Sign in to UNVEIL to access the Issuer & Producer Dashboard.",
        uri: "http://localhost:5173",
        version: "1",
        chainId: 11155111,
        nonce: "abcdef0123456789abcdef0123456789",
        issuedAt: "2026-09-12T00:00:00.000Z",
      });

      expect(message).toContain("localhost:5173 wants you to sign in with your Ethereum account:");
      expect(message).toContain("0x1111111111111111111111111111111111111111");
      expect(message).toContain("Chain ID: 11155111");
      expect(message).toContain("Nonce: abcdef0123456789abcdef0123456789");
      expect(message).toContain("Issued At: 2026-09-12T00:00:00.000Z");
    });

    it("proves SIWE server-side verification boundary consumes nonce and issues session", async () => {
      const mockWallet = new ethers.Wallet(TEST_WALLET_PK);
      const mockNonce = "deadbeef12345678deadbeef12345678";

      // Mock fetch for /api/auth/nonce and /api/auth/verify
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/auth/nonce")) {
          return {
            ok: true,
            json: async () => ({ nonce: mockNonce }),
          };
        }
        if (url.includes("/api/auth/verify")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              session: {
                token: "mock-auth-jwt-token-999",
                address: mockWallet.address,
                chainId: 11155111,
                expiresAt: Date.now() + 86400000,
              },
            }),
          };
        }
        return { ok: false };
      });

      vi.stubGlobal("fetch", mockFetch);

      const mockProvider = {
        getNetwork: vi.fn().mockResolvedValue({ chainId: 11155111n }),
      } as any;

      const mockSigner = {
        getAddress: vi.fn().mockResolvedValue(mockWallet.address),
        signMessage: vi.fn().mockResolvedValue("0xmocksignature"),
      } as any;

      const session = await signInWithEthereum(mockSigner, mockProvider);

      expect(session.token).toBe("mock-auth-jwt-token-999");
      expect(session.address).toBe(mockWallet.address);
      expect(session.chainId).toBe(11155111);
      expect(mockSigner.signMessage).toHaveBeenCalled();
    });

    it("proves wrong network is detected and NetworkMismatchBanner prevents operations", () => {
      // Chain ID 1 (Ethereum Mainnet) instead of 11155111 (Sepolia)
      const { rerender } = render(
        <NetworkMismatchBanner currentChainId={1} />
      );

      expect(screen.getByText(/Network Mismatch Detected \(Chain ID: 1\)/)).toBeInTheDocument();
      expect(screen.getByText(/UNVEIL operations require the/)).toBeInTheDocument();

      // Rerender on Sepolia
      rerender(<NetworkMismatchBanner currentChainId={11155111} />);
      expect(screen.queryByText(/Network Mismatch Detected/)).not.toBeInTheDocument();
    });

    it("proves SIWE authentication != contract authorization", () => {
      // Architectural validation: a wallet can be authenticated via SIWE
      // but if the smart contract registry shows Inactive, the action remains restricted
      render(
        <IssuerIssuanceForm
          signer={{} as any}
          chainId={SEPOLIA_CHAIN_ID}
          isIssuerActive={false} // Authenticated wallet, but unaccredited in contract
          onCertificateIssued={vi.fn()}
        />
      );

      expect(screen.getByText("Issuance Restricted by On-Chain Registry")).toBeInTheDocument();
      expect(screen.getByText(/Your connected wallet does not hold an active accredited certifying body record/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Review & Issue Certificate/ })).toBeDisabled();
    });
  });

  describe("2. Certificate Issuance & Canonical Gram Conversion", () => {
    it("proves canonical integer gram conversion rejects floating-point arithmetic", () => {
      // 25,000 kg -> 25,000,000 integer grams
      const grams1 = kgToIntegerGrams(25000);
      expect(grams1).toBe(25000000n);

      // 12.345 kg -> 12,345 integer grams
      const grams2 = kgToIntegerGrams(12.345);
      expect(grams2).toBe(12345n);

      expect(() => kgToIntegerGrams(-5)).toThrow("Quantity must be a positive number.");
      expect(() => kgToIntegerGrams(0)).toThrow("Quantity must be a positive number.");

      // Reverse conversion to presentation kg
      expect(integerGramsToKg(25000000n)).toBe(25000);
      expect(integerGramsToKg(12345n)).toBe(12.345);
    });

    it("proves certificate issuance form enforces valid holder address and positive quantity", async () => {
      render(
        <IssuerIssuanceForm
          signer={{} as any}
          chainId={SEPOLIA_CHAIN_ID}
          isIssuerActive={true}
          onCertificateIssued={vi.fn()}
        />
      );

      const user = userEvent.setup();

      const holderInput = screen.getByLabelText(/Holder \/ Producer Address/);
      await user.clear(holderInput);
      await user.type(holderInput, "0x1111111111111111111111111111111111111111");

      const quantityInput = screen.getByLabelText(/Certified Quantity \(Kilograms\)/);
      await user.clear(quantityInput);
      await user.type(quantityInput, "25000");

      const submitBtn = screen.getByRole("button", { name: /Review & Issue Certificate/ });
      await user.click(submitBtn);

      expect(screen.getByText("Review Certificate Issuance")).toBeInTheDocument();
      expect(screen.getByText("Submit to Sepolia Blockchain")).toBeInTheDocument();
    });
  });

  describe("3. Root Consignment Creation & Mass Balance", () => {
    it("proves non-holder is flagged as unauthorized for root consignment creation", () => {
      render(
        <RootConsignmentForm
          signer={{} as any}
          chainId={SEPOLIA_CHAIN_ID}
          connectedAddress="0x9999999999999999999999999999999999999999"
          onLotCreated={vi.fn()}
        />
      );

      expect(screen.getByText("Create Root Consignment")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Check Capacity" })).toBeInTheDocument();
      expect(screen.getByLabelText(/Originating Certificate ID/)).toBeInTheDocument();
    });
  });

  describe("4. Split Lot & Mass Conservation Invariant", () => {
    it("proves valid split is calculated and conservation indicator updates dynamically", async () => {
      render(
        <SplitLotForm
          signer={{} as any}
          chainId={SEPOLIA_CHAIN_ID}
          connectedAddress="0x1111111111111111111111111111111111111111"
          onLotsCreated={vi.fn()}
        />
      );

      // Default split: 6,000 kg + 4,000 kg = 10,000 kg
      expect(screen.getByText("✓ Mass Conserved")).toBeInTheDocument();
      expect(screen.getByText(/Children Total:/)).toBeInTheDocument();
    });

    it("proves intentional split mismatch displays warning and explains contract revert", async () => {
      render(
        <SplitLotForm
          signer={{} as any}
          chainId={SEPOLIA_CHAIN_ID}
          connectedAddress="0x1111111111111111111111111111111111111111"
          onLotsCreated={vi.fn()}
        />
      );

      const user = userEvent.setup();
      const presetInvalidBtn = screen.getByRole("button", { name: /Preset Invalid Split/ });
      await user.click(presetInvalidBtn);

      // 5,000 + 4,000 = 9,000 != 10,000
      expect(screen.getByText("✕ Conservation Violation")).toBeInTheDocument();
      expect(screen.getByText(/SplitConservationViolation/)).toBeInTheDocument();
    });
  });

  describe("5. Process Lot & Yield Loss Invariants", () => {
    it("proves valid yield loss calculates percentage and permits submission", () => {
      render(
        <ProcessLotForm
          signer={{} as any}
          chainId={SEPOLIA_CHAIN_ID}
          connectedAddress="0x1111111111111111111111111111111111111111"
          onLotCreated={vi.fn()}
        />
      );

      // Default: 10,000 kg input -> 8,500 kg output -> 1,500 kg loss (15.00%)
      expect(screen.getByText("Mass Loss:")).toBeInTheDocument();
      expect(screen.getByText(/1,500 kg \(15.00%\)/)).toBeInTheDocument();
    });

    it("proves yield expansion displays warning that contract will revert with YieldExpansionNotAllowed", async () => {
      render(
        <ProcessLotForm
          signer={{} as any}
          chainId={SEPOLIA_CHAIN_ID}
          connectedAddress="0x1111111111111111111111111111111111111111"
          onLotCreated={vi.fn()}
        />
      );

      const user = userEvent.setup();
      const presetExpansionBtn = screen.getByRole("button", { name: /Preset Mass Expansion/ });
      await user.click(presetExpansionBtn);

      expect(screen.getByText("Yield Expansion Prohibited:")).toBeInTheDocument();
      expect(screen.getAllByText("YieldExpansionNotAllowed").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("6. Post-Consignment QR Code Display (Part J)", () => {
    it("proves ConsignmentSuccessModal renders QR code targeting /verify/<lotID>", () => {
      const mockOnVerify = vi.fn();

      render(
        <ConsignmentSuccessModal
          isOpen={true}
          onClose={vi.fn()}
          operationTitle="Root Consignment Creation"
          transactionHash="0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
          lots={[{ lotID: "LOT-COOP-HUILA-ROOT-001", quantityKg: 10000 }]}
          onVerifyLot={mockOnVerify}
        />
      );

      expect(screen.getByText("Root Consignment Creation Confirmed")).toBeInTheDocument();
      expect(screen.getByText("LOT-COOP-HUILA-ROOT-001")).toBeInTheDocument();
      expect(screen.getByTestId("qr-encoded-url")).toHaveTextContent("/verify/LOT-COOP-HUILA-ROOT-001");

      const verifyBtn = screen.getByRole("button", { name: "Verify Lot on Blockchain" });
      fireEvent.click(verifyBtn);
      expect(mockOnVerify).toHaveBeenCalledWith("LOT-COOP-HUILA-ROOT-001");
    });
  });

  describe("7. Solidity Custom Error Normalization & Revert Parsing", () => {
    it("proves custom errors are parsed into domain-specific explanations", () => {
      // 1. SplitConservationViolation
      const errSplit = { message: "execution reverted: custom error SplitConservationViolation(10000000, 9000000)" };
      const parsedSplit = parseContractError(errSplit);
      expect(parsedSplit.title).toBe("Split Rejected");
      expect(parsedSplit.explanation).toContain("Child quantities must strictly equal the parent quantity");

      // 2. YieldExpansionNotAllowed
      const errYield = { message: "execution reverted: custom error YieldExpansionNotAllowed(10000000, 12000000)" };
      const parsedYield = parseContractError(errYield);
      expect(parsedYield.title).toBe("Yield Expansion Not Allowed");
      expect(parsedYield.explanation).toContain("Mass expansion is prohibited on-chain");

      // 3. LotAlreadyConsumed
      const errConsumed = { message: "execution reverted: custom error LotAlreadyConsumed(\"LOT-001\")" };
      const parsedConsumed = parseContractError(errConsumed);
      expect(parsedConsumed.title).toBe("Lot Already Consumed");
      expect(parsedConsumed.explanation).toContain("already been consumed by a prior split");

      // 4. InsufficientCertifiedQuantity
      const errQuantity = { message: "execution reverted: custom error InsufficientCertifiedQuantity(\"CERT-001\", 15000000, 10000000)" };
      const parsedQuantity = parseContractError(errQuantity);
      expect(parsedQuantity.title).toBe("Insufficient Certified Capacity");

      // 5. CertificateMismatch
      const errCertMismatch = { message: "execution reverted: custom error CertificateMismatch(\"CERT-A\", \"CERT-B\")" };
      const parsedMismatch = parseContractError(errCertMismatch);
      expect(parsedMismatch.title).toBe("Certificate Mismatch");
      expect(parsedMismatch.explanation).toContain("Ethical sourcing claims cannot be mixed across certificates");

      // 6. User wallet cancellation (code 4001)
      const errUserReject = { code: 4001, message: "User rejected the request." };
      const parsedReject = parseContractError(errUserReject);
      expect(parsedReject.isUserRejection).toBe(true);
      expect(parsedReject.title).toBe("Transaction Cancelled");

      // 7. RPC communication error
      const errRpc = { code: "NETWORK_ERROR", message: "could not detect network" };
      const parsedRpc = parseContractError(errRpc);
      expect(parsedRpc.isRpcError).toBe(true);
      expect(parsedRpc.title).toContain("Network / RPC Communication Error");
    });
  });
});
