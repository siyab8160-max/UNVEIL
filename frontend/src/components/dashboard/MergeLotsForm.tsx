import React, { useState } from "react";
import type { Signer } from "ethers";
import {
  lookupOnChainLot,
  executeMergeLots,
  integerGramsToKg,
  type OnChainLotDetails,
} from "../../services/dashboardContractService";
import { parseContractError, type ParsedContractError } from "../../services/errorParser";
import { SEPOLIA_CHAIN_ID } from "../../services/config";

interface MergeLotsFormProps {
  signer: Signer | null;
  chainId: number | null;
  connectedAddress: string | null;
  onLotCreated: (lotID: string, quantityKg: number, txHash: string) => void;
}

type TxStage = "idle" | "review" | "wallet_confirmation" | "pending_mining" | "confirmed" | "failed";

export const MergeLotsForm: React.FC<MergeLotsFormProps> = ({
  signer,
  chainId,
  connectedAddress: _connectedAddress,
  onLotCreated,
}) => {
  const isSepolia = chainId === SEPOLIA_CHAIN_ID;

  const [parentLotIDs, setParentLotIDs] = useState<string[]>([
    "LOT-COOP-HUILA-CHILD-A",
    "LOT-COOP-HUILA-CHILD-B",
  ]);
  const [newLotID, setNewLotID] = useState<string>("LOT-COOP-HUILA-MERGED-001");

  // Inspected parents state
  const [inspectedParents, setInspectedParents] = useState<Record<string, OnChainLotDetails | null>>({});
  const [isInspecting, setIsInspecting] = useState<boolean>(false);

  // Lifecycle
  const [txStage, setTxStage] = useState<TxStage>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [parsedError, setParsedError] = useState<ParsedContractError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleAddParentRow = () => {
    setParentLotIDs([...parentLotIDs, ""]);
  };

  const handleRemoveParentRow = (index: number) => {
    if (parentLotIDs.length <= 2) return;
    setParentLotIDs(parentLotIDs.filter((_, i) => i !== index));
  };

  const handleUpdateParent = (index: number, val: string) => {
    const updated = [...parentLotIDs];
    updated[index] = val;
    setParentLotIDs(updated);
  };

  const handleInspectAll = async () => {
    setIsInspecting(true);
    const results: Record<string, OnChainLotDetails | null> = {};
    for (const pID of parentLotIDs) {
      if (pID.trim()) {
        const details = await lookupOnChainLot(pID.trim());
        results[pID.trim()] = details;
      }
    }
    setInspectedParents(results);
    setIsInspecting(false);
  };

  // Compute total merged mass from inspected parents or estimated
  const totalMergedKg = Object.values(inspectedParents).reduce((sum, p) => {
    return sum + (p ? integerGramsToKg(p.quantityGrams) : 0);
  }, 0);

  // Check if certificates match
  const certificates = Object.values(inspectedParents)
    .filter(Boolean)
    .map((p) => p!.certificateID);
  const uniqueCerts = Array.from(new Set(certificates));
  const hasCertificateMismatch = uniqueCerts.length > 1;

  const handlePresetDemo = () => {
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    setParentLotIDs(["LOT-COOP-HUILA-CHILD-A", "LOT-COOP-HUILA-CHILD-B"]);
    setNewLotID(`LOT-MERGED-DEMO-${randomSuffix}`);
    setValidationError(null);
    setParsedError(null);
  };

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setParsedError(null);

    if (parentLotIDs.length < 2) {
      setValidationError("Merge requires at least 2 parent lots.");
      return;
    }
    for (let i = 0; i < parentLotIDs.length; i++) {
      if (!parentLotIDs[i].trim()) {
        setValidationError(`Parent lot #${i + 1} cannot be empty.`);
        return;
      }
    }
    if (!newLotID.trim()) {
      setValidationError("New merged lot ID is required.");
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
      const result = await executeMergeLots(
        {
          parentLotIDs: parentLotIDs.map((id) => id.trim()),
          newLotID: newLotID.trim(),
        },
        signer
      );

      setTxHash(result.transactionHash);
      setTxStage("confirmed");
      onLotCreated(newLotID.trim(), totalMergedKg || 10000, result.transactionHash);
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
          <span className="card-icon">🔗</span>
          <h2 className="card-title">Merge Lots (Consolidation)</h2>
        </div>
        <button
          type="button"
          onClick={handlePresetDemo}
          className="btn btn-sm btn-outline demo-fill-btn"
        >
          Preset Demo Merge
        </button>
      </div>

      <div className="card-body">
        <p className="section-description">
          Merges two or more active consignments into a single consolidated lot. All parent lots must originate from the 
          <strong> exact same certificate</strong> (anti-cross-attribution rule).
        </p>

        {validationError && (
          <div className="alert alert-error" role="alert">
            <span className="alert-icon">⚠️</span>
            <div className="alert-body">
              <span className="alert-text">{validationError}</span>
            </div>
          </div>
        )}

        {hasCertificateMismatch && (
          <div className="alert alert-warning" role="alert">
            <span className="alert-icon">⚠️</span>
            <div className="alert-body">
              <strong>Certificate Mismatch Detected:</strong> Selected parent lots originate from different certificates:
              <code> {uniqueCerts.join(" vs ")}</code>. Smart contract will revert with <code>CertificateMismatch</code>.
            </div>
          </div>
        )}

        <form onSubmit={handleReview} className="operation-form">
          <div className="form-grid">
            <div className="form-group full-width">
              <div className="child-lots-header">
                <h3 className="subheading">Parent Lots to Consolidate (Min 2)</h3>
                <div className="button-group-inline">
                  <button
                    type="button"
                    onClick={handleInspectAll}
                    className="btn btn-sm btn-secondary"
                    disabled={isInspecting || txStage === "pending_mining"}
                  >
                    {isInspecting ? "Inspecting..." : "Inspect Lots On-Chain"}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddParentRow}
                    className="btn btn-sm btn-outline"
                    disabled={txStage === "pending_mining"}
                  >
                    + Add Parent Lot
                  </button>
                </div>
              </div>

              <div className="child-lots-list">
                {parentLotIDs.map((id, idx) => {
                  const details = inspectedParents[id.trim()];
                  return (
                    <div key={idx} className="child-lot-row">
                      <div className="child-col-id full-flex">
                        <label className="form-label-sub">Parent Lot ID #{idx + 1}</label>
                        <input
                          type="text"
                          className="form-input"
                          value={id}
                          onChange={(e) => handleUpdateParent(idx, e.target.value)}
                          placeholder="e.g. LOT-COOP-HUILA-CHILD-A"
                          disabled={txStage === "pending_mining"}
                          required
                        />
                        {details && (
                          <div className="inspected-mini-badge">
                            <span>Mass: {integerGramsToKg(details.quantityGrams).toLocaleString()} kg</span> |
                            <span> Cert: {details.certificateID}</span> |
                            <span className={`status-text ${details.status.toLowerCase()}`}> {details.status}</span>
                          </div>
                        )}
                      </div>

                      <div className="child-col-action">
                        {parentLotIDs.length > 2 && (
                          <button
                            type="button"
                            className="btn btn-sm btn-danger remove-btn"
                            onClick={() => handleRemoveParentRow(idx)}
                            disabled={txStage === "pending_mining"}
                            title="Remove parent row"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="form-group full-width">
              <label htmlFor="merge-new-lot-id" className="form-label">
                New Merged Lot ID <span className="required">*</span>
              </label>
              <input
                id="merge-new-lot-id"
                type="text"
                className="form-input"
                value={newLotID}
                onChange={(e) => setNewLotID(e.target.value)}
                placeholder="e.g. LOT-COOP-HUILA-MERGED-001"
                disabled={txStage === "pending_mining"}
                required
              />
              <span className="form-hint">
                New consolidated consignment identifier. Total mass will equal exactly sum of active parents ({totalMergedKg > 0 ? `${totalMergedKg.toLocaleString()} kg` : "computed automatically on-chain"}).
              </span>
            </div>
          </div>

          {txStage === "idle" && (
            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!signer || !isSepolia}
              >
                Review & Execute Merge
              </button>
            </div>
          )}
        </form>

        {/* Review Box */}
        {txStage === "review" && (
          <div className="tx-lifecycle-box review-box">
            <h3 className="lifecycle-title">Review Lot Merge</h3>
            <div className="review-summary-grid">
              <div className="summary-item">
                <span className="item-label">Parent Lots ({parentLotIDs.length}):</span>
                <span className="item-value">{parentLotIDs.join(", ")}</span>
              </div>
              <div className="summary-item">
                <span className="item-label">New Merged Lot:</span>
                <span className="item-value highlight">{newLotID}</span>
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
                Submit Merge to Sepolia
              </button>
            </div>
          </div>
        )}

        {/* Mining Status */}
        {(txStage === "wallet_confirmation" || txStage === "pending_mining") && (
          <div className="tx-lifecycle-box pending-box">
            <div className="loading-spinner large"></div>
            <h3 className="lifecycle-title">
              {txStage === "wallet_confirmation" ? "Waiting for Wallet Approval..." : "Mining Merge on Sepolia..."}
            </h3>
            <p className="lifecycle-note">
              Consolidating parent consignments and locking them to Consumed.
            </p>
          </div>
        )}

        {/* Confirmed Status */}
        {txStage === "confirmed" && txHash && (
          <div className="tx-lifecycle-box confirmed-box">
            <span className="confirmed-icon">✓</span>
            <h3 className="lifecycle-title">Lots Successfully Merged!</h3>
            <div className="tx-hash-row">
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

export default MergeLotsForm;
