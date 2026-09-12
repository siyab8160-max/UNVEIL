import React, { useState } from "react";
import { ethers, type Signer } from "ethers";
import {
  lookupOnChainLot,
  executeTransferLot,
  integerGramsToKg,
  type OnChainLotDetails,
} from "../../services/dashboardContractService";
import { parseContractError, type ParsedContractError } from "../../services/errorParser";
import { SEPOLIA_CHAIN_ID } from "../../services/config";

interface TransferLotFormProps {
  signer: Signer | null;
  chainId: number | null;
  connectedAddress: string | null;
  onLotTransferred: (lotID: string, prevOwner: string, newOwner: string, txHash: string) => void;
}

type TxStage = "idle" | "review" | "wallet_confirmation" | "pending_mining" | "confirmed" | "failed";

export const TransferLotForm: React.FC<TransferLotFormProps> = ({
  signer,
  chainId,
  connectedAddress,
  onLotTransferred,
}) => {
  const isSepolia = chainId === SEPOLIA_CHAIN_ID;

  const [lotID, setLotID] = useState<string>("LOT-COOP-HUILA-CHILD-A");
  const [newOwner, setNewOwner] = useState<string>("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

  // Inspected lot state
  const [lotDetails, setLotDetails] = useState<OnChainLotDetails | null>(null);
  const [isInspecting, setIsInspecting] = useState<boolean>(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  // Lifecycle
  const [txStage, setTxStage] = useState<TxStage>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [transferRecord, setTransferRecord] = useState<{ prevOwner: string; newOwner: string } | null>(null);
  const [parsedError, setParsedError] = useState<ParsedContractError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const isOwner = Boolean(
    connectedAddress &&
    lotDetails?.currentOwner &&
    connectedAddress.toLowerCase() === lotDetails.currentOwner.toLowerCase()
  );

  const handleLookupLot = async () => {
    if (!lotID.trim()) return;
    setIsInspecting(true);
    setInspectError(null);
    try {
      const details = await lookupOnChainLot(lotID.trim());
      if (!details) {
        setInspectError(`Lot '${lotID.trim()}' was not found on the blockchain.`);
        setLotDetails(null);
      } else {
        setLotDetails(details);
      }
    } catch (err: any) {
      setInspectError(err.message || "Failed to inspect lot.");
    } finally {
      setIsInspecting(false);
    }
  };

  const handlePresetDemo = () => {
    setLotID("LOT-COOP-HUILA-CHILD-A");
    setNewOwner("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    setValidationError(null);
    setParsedError(null);
  };

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setParsedError(null);

    if (!lotID.trim()) {
      setValidationError("Lot ID is required.");
      return;
    }
    if (!ethers.isAddress(newOwner) || newOwner === ethers.ZeroAddress) {
      setValidationError("A valid, non-zero destination address is required.");
      return;
    }
    if (connectedAddress && newOwner.toLowerCase() === connectedAddress.toLowerCase()) {
      setValidationError("Recipient address cannot be the same as the current owner.");
      return;
    }

    setTxStage("review");
  };

  const handleConfirmTransaction = async () => {
    if (!signer) {
      setValidationError("Wallet signer not available.");
      return;
    }

    setTxStage("wallet_confirmation");
    setParsedError(null);

    try {
      setTxStage("pending_mining");
      const prevOwner = lotDetails?.currentOwner || (await signer.getAddress());
      const result = await executeTransferLot(
        {
          lotID: lotID.trim(),
          newOwner: newOwner.trim(),
        },
        signer
      );

      setTxHash(result.transactionHash);
      setTransferRecord({ prevOwner, newOwner: newOwner.trim() });
      setTxStage("confirmed");
      onLotTransferred(lotID.trim(), prevOwner, newOwner.trim(), result.transactionHash);
    } catch (err: any) {
      const parsed = parseContractError(err);
      setParsedError(parsed);
      setTxStage("failed");
    }
  };

  return (
    <div className="card form-card">
      <div className="card-header">
        <div className="card-title-group">
          <span className="card-icon">🤝</span>
          <h2 className="card-title">Transfer Lot Custody</h2>
        </div>
        <button
          type="button"
          onClick={handlePresetDemo}
          className="btn btn-sm btn-outline demo-fill-btn"
        >
          Preset Demo Transfer
        </button>
      </div>

      <div className="card-body">
        <p className="section-description">
          Transfers legal custody / ownership of an active lot to another entity (e.g. cooperative to roaster, roaster to distributor).
          Does not consume mass or alter certificate capacity.
        </p>

        {validationError && (
          <div className="alert alert-error" role="alert">
            <span className="alert-icon">⚠️</span>
            <div className="alert-body">
              <span className="alert-text">{validationError}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleReview} className="operation-form">
          <div className="form-grid">
            <div className="form-group full-width">
              <label htmlFor="transfer-lot-id" className="form-label">
                Lot ID to Transfer <span className="required">*</span>
              </label>
              <div className="input-with-action">
                <input
                  id="transfer-lot-id"
                  type="text"
                  className="form-input"
                  value={lotID}
                  onChange={(e) => setLotID(e.target.value)}
                  placeholder="e.g. LOT-COOP-HUILA-CHILD-A"
                  disabled={txStage === "pending_mining"}
                  required
                />
                <button
                  type="button"
                  onClick={handleLookupLot}
                  className="btn btn-secondary btn-input-action"
                  disabled={isInspecting || !lotID.trim()}
                >
                  {isInspecting ? "Inspecting..." : "Check Custody"}
                </button>
              </div>
            </div>

            {inspectError && (
              <div className="form-group full-width">
                <div className="alert alert-warning">
                  <span className="alert-icon">ℹ️</span>
                  <span className="alert-text">{inspectError}</span>
                </div>
              </div>
            )}

            {lotDetails && (
              <div className="form-group full-width">
                <div className="capacity-preview-box">
                  <div className="capacity-metric">
                    <span className="metric-label">Current Custodian:</span>
                    <span className="metric-value"><code>{lotDetails.currentOwner}</code></span>
                    {connectedAddress && (
                      <span className={`holder-badge ${isOwner ? "match" : "mismatch"}`}>
                        {isOwner ? "✓ You are Owner" : "✕ Not Connected Owner"}
                      </span>
                    )}
                  </div>
                  <div className="capacity-metric">
                    <span className="metric-label">Mass:</span>
                    <span className="metric-value highlight">
                      {integerGramsToKg(lotDetails.quantityGrams).toLocaleString()} kg
                    </span>
                  </div>
                  <div className="capacity-metric">
                    <span className="metric-label">Status:</span>
                    <span className={`status-pill ${lotDetails.status.toLowerCase()}`}>
                      {lotDetails.status}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="form-group full-width">
              <label htmlFor="transfer-new-owner" className="form-label">
                New Recipient Address <span className="required">*</span>
              </label>
              <input
                id="transfer-new-owner"
                type="text"
                className="form-input"
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                placeholder="0x..."
                disabled={txStage === "pending_mining"}
                required
              />
              <span className="form-hint">Must be a valid, non-zero Ethereum address different from current owner.</span>
            </div>
          </div>

          {lotDetails && !isOwner && (
            <div className="alert alert-error" role="alert">
              <span className="alert-icon">🔒</span>
              <div className="alert-body">
                <strong>Unauthorized:</strong> Connected wallet ({connectedAddress}) is not the recorded owner ({lotDetails.currentOwner}). Smart contract will revert with <code>CallerNotLotOwner</code>.
              </div>
            </div>
          )}

          {txStage === "idle" && (
            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!signer || !isSepolia}
              >
                Review & Execute Transfer
              </button>
            </div>
          )}
        </form>

        {/* Review Box */}
        {txStage === "review" && (
          <div className="tx-lifecycle-box review-box">
            <h3 className="lifecycle-title">Review Custody Transfer</h3>
            <div className="review-summary-grid">
              <div className="summary-item">
                <span className="item-label">Lot ID:</span>
                <span className="item-value">{lotID}</span>
              </div>
              <div className="summary-item">
                <span className="item-label">Previous Custodian:</span>
                <span className="item-value"><code>{lotDetails?.currentOwner || connectedAddress}</code></span>
              </div>
              <div className="summary-item">
                <span className="item-label">New Custodian:</span>
                <span className="item-value highlight"><code>{newOwner}</code></span>
              </div>
            </div>

            <div className="lifecycle-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setTxStage("idle")}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={handleConfirmTransaction}
              >
                Confirm Custody Transfer
              </button>
            </div>
          </div>
        )}

        {/* Mining Status */}
        {(txStage === "wallet_confirmation" || txStage === "pending_mining") && (
          <div className="tx-lifecycle-box pending-box">
            <div className="loading-spinner large"></div>
            <h3 className="lifecycle-title">
              {txStage === "wallet_confirmation" ? "Waiting for Wallet Approval..." : "Mining Custody Transfer on Sepolia..."}
            </h3>
            <p className="lifecycle-note">
              Reassigning on-chain legal ownership of the consignment lot.
            </p>
          </div>
        )}

        {/* Confirmed Status */}
        {txStage === "confirmed" && txHash && transferRecord && (
          <div className="tx-lifecycle-box confirmed-box">
            <span className="confirmed-icon">✓</span>
            <h3 className="lifecycle-title">Custody Transfer Mined!</h3>
            <div className="transfer-summary-box">
              <div>Previous Owner: <code>{transferRecord.prevOwner}</code></div>
              <div>New Owner: <code>{transferRecord.newOwner}</code></div>
            </div>
            <div className="tx-hash-row mt-2">
              <span className="tx-hash-label">Tx Hash:</span>
              <a
                href={`https://sepolia.etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="tx-hash-link"
              >
                <code>{txHash}</code> ↗
              </a>
            </div>
          </div>
        )}

        {/* Failed Status & Revert Message */}
        {txStage === "failed" && parsedError && (
          <div className="tx-lifecycle-box failed-box">
            <span className="failed-icon">✕</span>
            <h3 className="lifecycle-title">{parsedError.title}</h3>
            <p className="failed-explanation">{parsedError.explanation}</p>
            {parsedError.errorName && (
              <div className="revert-name-tag">
                Solidity Custom Error: <code>{parsedError.errorName}</code>
              </div>
            )}
            <div className="lifecycle-actions mt-3">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setTxStage("idle")}
              >
                Modify Form & Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TransferLotForm;
