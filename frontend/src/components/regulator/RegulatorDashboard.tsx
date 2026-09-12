import React, { useState, useEffect, useCallback } from "react";
import { BrowserProvider, type Signer } from "ethers";
import { CaseQueue } from "./CaseQueue";
import { CaseDetailView } from "./CaseDetailView";
import { DismissCaseModal } from "./DismissCaseModal";
import { ConfirmRevocationModal } from "./ConfirmRevocationModal";
import NetworkMismatchBanner from "../dashboard/NetworkMismatchBanner";
import {
  fetchCases,
  fetchCaseById,
  transitionCaseStatus,
  resolveCaseRecord,
  type CaseRecord,
} from "../../services/indexerApi";
import {
  signInWithEthereum,
  getCachedSession,
  signOut,
  type SiweSession,
} from "../../services/walletAuth";

interface RegulatorDashboardProps {
  onNavigateToConsumerVerify?: (lotID: string) => void;
  customCases?: CaseRecord[]; // For test mocking
  customSigner?: Signer | null; // For test mocking
  customProvider?: any; // For test mocking
  customContract?: any; // For test mocking
}

export const RegulatorDashboard: React.FC<RegulatorDashboardProps> = ({
  onNavigateToConsumerVerify,
  customCases,
  customSigner,
  customProvider,
  customContract,
}) => {
  const [cases, setCases] = useState<CaseRecord[]>(customCases || []);
  const [selectedCase, setSelectedCase] = useState<CaseRecord | null>(null);
  const [isLoadingCases, setIsLoadingCases] = useState<boolean>(!customCases);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Wallet & SIWE Auth state
  const [signer, setSigner] = useState<Signer | null>(customSigner || null);
  const [connectedAddress, setConnectedAddress] = useState<string>("");
  const [currentChainId, setCurrentChainId] = useState<number | null>(null);
  const [siweSession, setSiweSession] = useState<SiweSession | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);

  // Modals state
  const [isDismissModalOpen, setIsDismissModalOpen] = useState<boolean>(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);
  const [targetModalCase, setTargetModalCase] = useState<CaseRecord | null>(null);

  // Load cases from Phase 3 API
  const refreshCases = useCallback(async () => {
    if (customCases) {
      setCases(customCases);
      setIsLoadingCases(false);
      return;
    }

    setIsLoadingCases(true);
    try {
      const fetched = await fetchCases();
      setCases(fetched);
      if (selectedCase) {
        const updated = fetched.find((c) => c.caseID === selectedCase.caseID);
        if (updated) setSelectedCase(updated);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to load case queue");
    } finally {
      setIsLoadingCases(false);
    }
  }, [customCases, selectedCase]);

  useEffect(() => {
    refreshCases();
  }, [refreshCases]);

  // Initial wallet & session inspection
  useEffect(() => {
    if (customSigner) {
      customSigner.getAddress().then((addr) => {
        setConnectedAddress(addr);
        setSigner(customSigner);
      });
      return;
    }

    const cached = getCachedSession();
    if (cached) {
      setSiweSession(cached);
      setConnectedAddress(cached.address);
      setCurrentChainId(cached.chainId);
    }

    if (typeof window !== "undefined" && (window as any).ethereum) {
      const eth = (window as any).ethereum;
      const provider = new BrowserProvider(eth);

      provider.getNetwork().then((net) => {
        setCurrentChainId(Number(net.chainId));
      }).catch(() => {});

      provider.listAccounts().then((accounts) => {
        if (accounts.length > 0) {
          provider.getSigner().then((s) => {
            setSigner(s);
            s.getAddress().then((addr) => setConnectedAddress(addr));
          });
        }
      }).catch(() => {});

      const handleChainChanged = (chainIdHex: string) => {
        setCurrentChainId(parseInt(chainIdHex, 16));
      };
      const handleAccountsChanged = (accs: string[]) => {
        if (accs.length > 0) {
          setConnectedAddress(accs[0]);
          provider.getSigner().then((s) => setSigner(s));
        } else {
          setConnectedAddress("");
          setSigner(null);
          setSiweSession(null);
        }
      };

      eth.on?.("chainChanged", handleChainChanged);
      eth.on?.("accountsChanged", handleAccountsChanged);

      return () => {
        eth.removeListener?.("chainChanged", handleChainChanged);
        eth.removeListener?.("accountsChanged", handleAccountsChanged);
      };
    }
  }, [customSigner]);

  // Handle SIWE Sign In
  const handleSignIn = async () => {
    setIsAuthenticating(true);
    setErrorMessage(null);
    try {
      let activeSigner = signer;
      let activeProvider = customProvider;

      if (!activeProvider && typeof window !== "undefined" && (window as any).ethereum) {
        activeProvider = new BrowserProvider((window as any).ethereum);
      }

      if (!activeSigner && activeProvider) {
        activeSigner = await activeProvider.getSigner();
        setSigner(activeSigner);
      }

      if (!activeSigner || !activeProvider) {
        throw new Error("Please install or unlock an Ethereum wallet (e.g. MetaMask).");
      }

      const session = await signInWithEthereum(activeSigner, activeProvider);
      setSiweSession(session);
      setConnectedAddress(session.address);
      setCurrentChainId(session.chainId);
    } catch (err: any) {
      console.error("SIWE sign-in failed:", err);
      setErrorMessage(err.message || "Failed to sign in with Ethereum.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(siweSession?.token);
    setSiweSession(null);
  };

  // Workflow actions
  const handleSelectCase = async (caseRecord: CaseRecord) => {
    setSelectedCase(caseRecord);
    // Fetch full case details including audit logs and anomalies
    const full = await fetchCaseById(caseRecord.caseID);
    if (full) {
      setSelectedCase(full);
    }
  };

  const handleMoveToReview = async (caseID: string) => {
    const actor = connectedAddress || "regulator-auditor";
    const token = siweSession?.token;
    const res = await transitionCaseStatus(caseID, "UNDER_REVIEW", actor, "Investigation opened by regulator/auditor", token);
    if (!res.success) {
      alert(`Error moving case to review: ${res.error}`);
      return;
    }
    await refreshCases();
    if (selectedCase && selectedCase.caseID === caseID) {
      const updated = await fetchCaseById(caseID);
      if (updated) setSelectedCase(updated);
    }
  };

  const handleOpenDismissModal = (caseRecord: CaseRecord) => {
    setTargetModalCase(caseRecord);
    setIsDismissModalOpen(true);
  };

  const handleDismissConfirm = async (notes: string) => {
    if (!targetModalCase) return;
    const actor = connectedAddress || "regulator-auditor";
    const token = siweSession?.token;
    const res = await transitionCaseStatus(targetModalCase.caseID, "DISMISSED", actor, notes, token);
    if (!res.success) {
      throw new Error(res.error || "Failed to dismiss case");
    }
    await refreshCases();
    if (selectedCase && selectedCase.caseID === targetModalCase.caseID) {
      const updated = await fetchCaseById(targetModalCase.caseID);
      if (updated) setSelectedCase(updated);
    }
  };

  const handleOpenConfirmModal = async (caseRecord: CaseRecord) => {
    setTargetModalCase(caseRecord);
    // Move to REVOCATION_PENDING in backend before opening transaction prompt
    const actor = connectedAddress || "regulator-auditor";
    const token = siweSession?.token;
    await transitionCaseStatus(caseRecord.caseID, "REVOCATION_PENDING", actor, "Preparing on-chain revocation transaction", token);
    await refreshCases();
    setIsConfirmModalOpen(true);
  };

  const handleRevocationSuccess = async (txHash: string, blockNumber: number) => {
    if (!targetModalCase) return;
    const actor = connectedAddress || "regulator-auditor";
    const token = siweSession?.token;
    const resolution = `REVOCATION_CONFIRMED: Tx ${txHash}`;
    const notes = `Certificate successfully revoked on Sepolia blockchain at block #${blockNumber}`;

    await resolveCaseRecord(targetModalCase.caseID, resolution, actor, notes, token);
    await refreshCases();
    if (selectedCase && selectedCase.caseID === targetModalCase.caseID) {
      const updated = await fetchCaseById(targetModalCase.caseID);
      if (updated) setSelectedCase(updated);
    }
  };

  const handleRevocationFailed = async (errText: string) => {
    if (!targetModalCase) return;
    // Rollback from REVOCATION_PENDING to UNDER_REVIEW
    const actor = connectedAddress || "regulator-auditor";
    const token = siweSession?.token;
    await transitionCaseStatus(
      targetModalCase.caseID,
      "UNDER_REVIEW",
      actor,
      `Revocation transaction failed or cancelled (${errText}); reverted status to UNDER_REVIEW`,
      token
    );
    await refreshCases();
    if (selectedCase && selectedCase.caseID === targetModalCase.caseID) {
      const updated = await fetchCaseById(targetModalCase.caseID);
      if (updated) setSelectedCase(updated);
    }
  };

  return (
    <div className="regulator-portal-container">
      {/* Network mismatch warning */}
      <NetworkMismatchBanner currentChainId={currentChainId} />

      {/* Regulator Portal Header */}
      <header className="regulator-header">
        <div className="regulator-title-block">
          <div className="regulator-badge">⚖️ REGULATOR / AUDITOR CONSOLE</div>
          <h1 className="regulator-heading">Ethical Sourcing Oversight & Case Resolution</h1>
          <p className="regulator-description">
            Human review workspace for Phase 3 anomalies, consumer complaints, and on-chain certificate revocation.
          </p>
        </div>

        {/* Authentication Box */}
        <div className="regulator-auth-box">
          {siweSession ? (
            <div className="auth-connected-pill">
              <span className="dot dot-green" />
              <div className="auth-meta">
                <span className="auth-label">Authenticated Reviewer:</span>
                <code className="auth-address">{connectedAddress.slice(0, 8)}...{connectedAddress.slice(-4)}</code>
              </div>
              <button type="button" className="btn-auth-action" onClick={handleSignOut}>
                Sign Out
              </button>
            </div>
          ) : (
            <div className="auth-connect-group">
              {connectedAddress && (
                <span className="wallet-unauth-tag">Wallet: {connectedAddress.slice(0, 6)}...</span>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSignIn}
                disabled={isAuthenticating}
              >
                {isAuthenticating ? "Verifying..." : "Sign In with Ethereum (SIWE)"}
              </button>
            </div>
          )}
        </div>
      </header>

      {errorMessage && (
        <div className="error-callout" role="alert">
          <strong>Notice:</strong> {errorMessage}
        </div>
      )}

      {/* Main Workspace: Queue or Selected Case Detail */}
      <main className="regulator-main">
        {selectedCase ? (
          <CaseDetailView
            caseRecord={selectedCase}
            connectedAddress={connectedAddress}
            onClose={() => setSelectedCase(null)}
            onMoveToReview={handleMoveToReview}
            onOpenDismissModal={handleOpenDismissModal}
            onOpenConfirmModal={handleOpenConfirmModal}
            customContract={customContract}
          />
        ) : (
          <CaseQueue
            cases={cases}
            selectedCaseId={selectedCase ? (selectedCase as CaseRecord).caseID : null}
            onSelectCase={handleSelectCase}
            isLoading={isLoadingCases}
          />
        )}
      </main>

      {/* Dismissal Modal */}
      {isDismissModalOpen && targetModalCase && (
        <DismissCaseModal
          isOpen={isDismissModalOpen}
          onClose={() => setIsDismissModalOpen(false)}
          caseRecord={targetModalCase}
          currentActor={connectedAddress || "auditor"}
          onDismissConfirm={handleDismissConfirm}
        />
      )}

      {/* Confirm Revocation Modal */}
      {isConfirmModalOpen && targetModalCase && (
        <ConfirmRevocationModal
          isOpen={isConfirmModalOpen}
          onClose={() => setIsConfirmModalOpen(false)}
          caseRecord={targetModalCase}
          connectedAddress={connectedAddress}
          signer={signer}
          onRevocationSuccess={handleRevocationSuccess}
          onRevocationFailed={handleRevocationFailed}
          onNavigateToConsumerVerify={onNavigateToConsumerVerify}
          customContract={customContract}
        />
      )}
    </div>
  );
};

export default RegulatorDashboard;
