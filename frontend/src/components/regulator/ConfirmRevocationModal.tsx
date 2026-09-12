import React, { useState, useEffect } from "react";
import type { Signer } from "ethers";
import type { CaseRecord } from "../../services/indexerApi";
import {
  checkRevocationAuthorization,
  executeRevokeCertificate,
  type RevocationAuthorizationInfo,
} from "../../services/dashboardContractService";
import { parseContractError, type ParsedContractError } from "../../services/errorParser";
import { CONTRACT_ADDRESSES } from "../../services/config";

interface ConfirmRevocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  caseRecord: CaseRecord;
  connectedAddress: string;
  signer: Signer | null;
  onRevocationSuccess: (txHash: string, blockNumber: number) => Promise<void>;
  onRevocationFailed?: (error: string) => Promise<void>;
  onNavigateToConsumerVerify?: (lotID: string) => void;
  customContract?: any; // For test injection
}

type TxStage = "IDLE" | "WALLET_PROMPT" | "MINING" | "CONFIRMED" | "FAILED";

export const ConfirmRevocationModal: React.FC<ConfirmRevocationModalProps> = ({
  isOpen,
  onClose,
  caseRecord,
  connectedAddress,
  signer,
  onRevocationSuccess,
  onRevocationFailed,
  onNavigateToConsumerVerify,
  customContract,
}) => {
  const [reason, setReason] = useState<string>("Severe ethical sourcing non-compliance confirmed through regulatory audit.");
  const [isConfirmedCheckbox, setIsConfirmedCheckbox] = useState<boolean>(false);
  const [authInfo, setAuthInfo] = useState<RevocationAuthorizationInfo | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [txStage, setTxStage] = useState<TxStage>("IDLE");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const [parsedError, setParsedError] = useState<ParsedContractError | null>(null);

  const certID = caseRecord.certificateID || "";

  // Check on-chain authorization whenever modal opens
  useEffect(() => {
    if (!isOpen || !certID) return;

    let isMounted = true;
    setIsCheckingAuth(true);
    setTxStage("IDLE");
    setParsedError(null);
    setTxHash(null);
    setBlockNumber(null);
    setIsConfirmedCheckbox(false);

    checkRevocationAuthorization(certID, connectedAddress, customContract)
      .then((info) => {
        if (isMounted) {
          setAuthInfo(info);
          setIsCheckingAuth(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error("Auth check error:", err);
          setIsCheckingAuth(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, certID, connectedAddress, customContract]);

  if (!isOpen) return null;

  const handleExecuteRevocation = async () => {
    if (!signer) {
      setParsedError({
        title: "Wallet Not Connected",
        explanation: "Please connect an authorized Ethereum wallet to submit this on-chain transaction.",
        isUserRejection: false,
        isRpcError: false,
      });
      return;
    }

    if (!reason.trim()) {
      setParsedError({
        title: "Missing Revocation Reason",
        explanation: "A specific justification/reason must be provided for immutable on-chain recording.",
        isUserRejection: false,
        isRpcError: false,
      });
      return;
    }

    setParsedError(null);
    setTxStage("WALLET_PROMPT");

    try {
      // Execute on-chain revocation: triggers signer personal sign -> broadcast -> wait(1) -> contract verification
      setTxStage("MINING");
      const result = await executeRevokeCertificate(certID, reason.trim(), signer, customContract);
      
      setTxHash(result.transactionHash);
      setBlockNumber(result.blockNumber);
      setTxStage("CONFIRMED");

      // Finalize backend Case resolution
      await onRevocationSuccess(result.transactionHash, result.blockNumber);
    } catch (err: any) {
      console.error("Revocation error:", err);
      const parsed = parseContractError(err);
      setParsedError(parsed);
      setTxStage("FAILED");

      if (onRevocationFailed) {
        await onRevocationFailed(parsed.explanation);
      }
    }
  };

  const getExplorerUrl = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="revoke-modal-title">
      <div className="modal-content confirm-revocation-modal">
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-badge-danger">🚨 On-Chain Revocation</span>
            <h2 id="revoke-modal-title" className="modal-title">
              Confirm Certificate Revocation
            </h2>
          </div>
          {txStage !== "MINING" && txStage !== "WALLET_PROMPT" && (
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close modal">
              ✕
            </button>
          )}
        </div>

        <div className="modal-body">
          {/* Target Identity & On-Chain Status Card */}
          <div className="revoke-target-card">
            <div className="target-item">
              <span className="target-label">Target Certificate ID:</span>
              <code className="target-value highlight">{certID || "UNKNOWN"}</code>
            </div>
            {caseRecord.lotID && (
              <div className="target-item">
                <span className="target-label">Associated Lot ID:</span>
                <code className="target-value">{caseRecord.lotID}</code>
              </div>
            )}
            <div className="target-item">
              <span className="target-label">Current On-Chain Status:</span>
              <span className={`status-badge-live ${authInfo?.currentStatus === "VALID" ? "live-valid" : "live-revoked"}`}>
                {isCheckingAuth ? "Checking..." : authInfo?.currentStatus || "UNKNOWN"}
              </span>
            </div>
            <div className="target-item">
              <span className="target-label">Target Smart Contract:</span>
              <code className="target-value small">{CONTRACT_ADDRESSES.CERTIFICATE_REGISTRY}</code>
            </div>
          </div>

          {/* On-Chain Authorization Verification Card */}
          <div className="auth-verification-card">
            <div className="auth-header">
              <span className="auth-icon">🛡️</span>
              <span className="auth-title">On-Chain Role Authorization:</span>
            </div>
            {isCheckingAuth ? (
              <p className="auth-status-text">Verifying connected wallet against CertificateRegistry contract...</p>
            ) : authInfo?.isAuthorized ? (
              <div className="auth-success-badge">
                <span>✅ Authorized to Revoke:</span>
                <strong>
                  {authInfo.isArbitrator ? "ARBITRATION_ROLE (Dispute Authority)" : "Original Issuing Body"}
                </strong>
                <span className="wallet-address-sub">({connectedAddress.slice(0, 10)}...{connectedAddress.slice(-6)})</span>
              </div>
            ) : (
              <div className="auth-denied-badge" role="alert">
                <span>⛔ Unauthorized Wallet:</span>
                <p>
                  Connected wallet is neither the original Certificate Issuer nor assigned the ARBITRATION_ROLE on-chain.
                  Revocation cannot be executed by this account.
                </p>
              </div>
            )}
          </div>

          {/* Critical Public Warning Notice */}
          <div className="public-impact-warning" role="alert">
            <span className="warning-icon">⚠️</span>
            <div>
              <strong>Irreversible Blockchain Mutation:</strong>
              <p>
                Confirming this action will invoke <code>CertificateRegistry.revokeCertificate()</code> on the
                Ethereum Sepolia blockchain. Once mined, the certificate status permanently becomes <strong>REVOKED</strong>.
                All consumer verification queries worldwide will immediately read REVOKED.
              </p>
            </div>
          </div>

          {/* Error Callout */}
          {parsedError && (
            <div className="error-callout" role="alert">
              <strong>{parsedError.title}:</strong>
              <p>{parsedError.explanation}</p>
            </div>
          )}

          {/* Transaction Stage Feedback */}
          {txStage === "WALLET_PROMPT" && (
            <div className="tx-lifecycle-box stage-prompt">
              <span className="spinner" />
              <p><strong>Awaiting Wallet Signature:</strong> Please approve the transaction in your connected wallet...</p>
            </div>
          )}

          {txStage === "MINING" && (
            <div className="tx-lifecycle-box stage-mining">
              <span className="spinner" />
              <p><strong>Transaction Submitted:</strong> Mining block on Ethereum Sepolia...</p>
              {txHash && (
                <a href={getExplorerUrl(txHash)} target="_blank" rel="noopener noreferrer" className="explorer-link">
                  View on Sepolia Etherscan ↗
                </a>
              )}
            </div>
          )}

          {txStage === "CONFIRMED" && (
            <div className="tx-lifecycle-box stage-confirmed" role="status">
              <span className="success-icon">✅</span>
              <div>
                <strong>Revocation Confirmed on Blockchain!</strong>
                <p>Certificate {certID} is now permanently REVOKED on-chain.</p>
                {txHash && (
                  <p className="tx-hash-meta">
                    Tx: <a href={getExplorerUrl(txHash)} target="_blank" rel="noopener noreferrer"><code>{txHash.slice(0, 16)}...</code></a>
                    {blockNumber && <span> (Block #{blockNumber})</span>}
                  </p>
                )}
                <p className="status-note">Resulting On-Chain Status: <strong>REVOKED</strong></p>
              </div>
            </div>
          )}

          {/* Input & Confirmation Form (Active when IDLE or FAILED) */}
          {(txStage === "IDLE" || txStage === "FAILED") && (
            <>
              <div className="form-group">
                <label htmlFor="revocation-reason" className="form-label">
                  Official Revocation Reason (Recorded On-Chain) *
                </label>
                <input
                  id="revocation-reason"
                  type="text"
                  className="form-input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Mass balance quota violation confirmed by official audit"
                  required
                  disabled={!authInfo?.isAuthorized}
                />
              </div>

              <div className="confirmation-checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={isConfirmedCheckbox}
                    onChange={(e) => setIsConfirmedCheckbox(e.target.checked)}
                    disabled={!authInfo?.isAuthorized}
                  />
                  <span>
                    Confirming this action will revoke certificate <strong>{certID}</strong> on the Sepolia blockchain.
                  </span>
                </label>
              </div>
            </>
          )}

          <div className="modal-actions">
            {txStage === "CONFIRMED" ? (
              <>
                {caseRecord.lotID && onNavigateToConsumerVerify && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      onClose();
                      onNavigateToConsumerVerify(caseRecord.lotID!);
                    }}
                  >
                    Verify Live on Consumer Page ↗
                  </button>
                )}
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Done
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={onClose}
                  disabled={txStage === "WALLET_PROMPT" || txStage === "MINING"}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleExecuteRevocation}
                  disabled={
                    isCheckingAuth ||
                    !authInfo?.isAuthorized ||
                    !isConfirmedCheckbox ||
                    !reason.trim() ||
                    txStage === "WALLET_PROMPT" ||
                    txStage === "MINING"
                  }
                >
                  Execute On-Chain Revocation
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmRevocationModal;
