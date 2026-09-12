import React, { useState } from "react";
import type { Signer } from "ethers";
import {
  lookupOnChainLot,
  executeSplitLot,
  integerGramsToKg,
  type OnChainLotDetails,
} from "../../services/dashboardContractService";
import { parseContractError, type ParsedContractError } from "../../services/errorParser";
import { SEPOLIA_CHAIN_ID } from "../../services/config";

interface ChildLotEntry {
  childLotID: string;
  quantityKg: number;
}

interface SplitLotFormProps {
  signer: Signer | null;
  chainId: number | null;
  connectedAddress: string | null;
  onLotsCreated: (lots: { lotID: string; quantityKg: number }[], txHash: string) => void;
}

type TxStage = "idle" | "review" | "wallet_confirmation" | "pending_mining" | "confirmed" | "failed";

export const SplitLotForm: React.FC<SplitLotFormProps> = ({
  signer,
  chainId,
  connectedAddress: _connectedAddress,
  onLotsCreated,
}) => {
  const isSepolia = chainId === SEPOLIA_CHAIN_ID;

  const [parentLotID, setParentLotID] = useState<string>("LOT-COOP-HUILA-ROOT-001");
  const [children, setChildren] = useState<ChildLotEntry[]>([
    { childLotID: "LOT-COOP-HUILA-CHILD-A", quantityKg: 6000 },
    { childLotID: "LOT-COOP-HUILA-CHILD-B", quantityKg: 4000 },
  ]);

  // Inspected parent lot
  const [parentDetails, setParentDetails] = useState<OnChainLotDetails | null>(null);
  const [isInspecting, setIsInspecting] = useState<boolean>(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  // Lifecycle
  const [txStage, setTxStage] = useState<TxStage>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [parsedError, setParsedError] = useState<ParsedContractError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Calculate sum of child quantities
  const childSumKg = children.reduce((sum, c) => sum + (Number(c.quantityKg) || 0), 0);
  const parentKg = parentDetails ? integerGramsToKg(parentDetails.quantityGrams) : 10000;
  const isConserved = Math.abs(childSumKg - parentKg) < 0.0001;

  const handleLookupParent = async () => {
    if (!parentLotID.trim()) return;
    setIsInspecting(true);
    setInspectError(null);
    try {
      const details = await lookupOnChainLot(parentLotID.trim());
      if (!details) {
        setInspectError(`Lot '${parentLotID.trim()}' was not found on the blockchain.`);
        setParentDetails(null);
      } else {
        setParentDetails(details);
      }
    } catch (err: any) {
      setInspectError(err.message || "Failed to inspect parent lot.");
    } finally {
      setIsInspecting(false);
    }
  };

  const handleAddChildRow = () => {
    const nextLetter = String.fromCharCode(65 + children.length);
    setChildren([
      ...children,
      { childLotID: `${parentLotID}-CHILD-${nextLetter}`, quantityKg: 0 },
    ]);
  };

  const handleRemoveChildRow = (index: number) => {
    if (children.length <= 2) return;
    setChildren(children.filter((_, i) => i !== index));
  };

  const handleUpdateChild = (index: number, field: keyof ChildLotEntry, val: any) => {
    const updated = [...children];
    updated[index] = { ...updated[index], [field]: val };
    setChildren(updated);
  };

  const handlePresetValidDemo = () => {
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    setParentLotID("LOT-COOP-HUILA-ROOT-001");
    setChildren([
      { childLotID: `LOT-SPLIT-${randomSuffix}-A`, quantityKg: 6000 },
      { childLotID: `LOT-SPLIT-${randomSuffix}-B`, quantityKg: 4000 },
    ]);
    setValidationError(null);
    setParsedError(null);
  };

  const handlePresetInvalidDemo = () => {
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    setParentLotID("LOT-COOP-HUILA-ROOT-001");
    // Deliberately unequal sum (5,000 + 4,000 = 9,000 != 10,000) to demonstrate contract rejection
    setChildren([
      { childLotID: `LOT-FAIL-${randomSuffix}-A`, quantityKg: 5000 },
      { childLotID: `LOT-FAIL-${randomSuffix}-B`, quantityKg: 4000 },
    ]);
    setValidationError(null);
    setParsedError(null);
  };

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setParsedError(null);

    if (!parentLotID.trim()) {
      setValidationError("Parent lot ID is required.");
      return;
    }
    if (children.length < 2) {
      setValidationError("Split requires at least 2 child lots.");
      return;
    }
    for (let i = 0; i < children.length; i++) {
      if (!children[i].childLotID.trim()) {
        setValidationError(`Child #${i + 1} requires a valid Lot ID.`);
        return;
      }
      if (children[i].quantityKg <= 0) {
        setValidationError(`Child #${i + 1} quantity must be strictly positive.`);
        return;
      }
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
      const result = await executeSplitLot(
        {
          parentLotID: parentLotID.trim(),
          childLotIDs: children.map((c) => c.childLotID.trim()),
          childQuantitiesKg: children.map((c) => Number(c.quantityKg)),
        },
        signer
      );

      setTxHash(result.transactionHash);
      setTxStage("confirmed");

      const createdLots = children.map((c) => ({
        lotID: c.childLotID.trim(),
        quantityKg: Number(c.quantityKg),
      }));

      onLotsCreated(createdLots, result.transactionHash);
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
          <span className="card-icon">✂️</span>
          <h2 className="card-title">Split Lot (Conserved Mass)</h2>
        </div>
        <div className="demo-button-group">
          <button
            type="button"
            onClick={handlePresetValidDemo}
            className="btn btn-sm btn-outline demo-fill-btn"
          >
            Preset Valid Split (10,000 kg)
          </button>
          <button
            type="button"
            onClick={handlePresetInvalidDemo}
            className="btn btn-sm btn-danger-outline demo-fill-btn"
            title="Demonstrate contract rejection of mismatched sum"
          >
            Preset Invalid Split (Intentional Rejection)
          </button>
        </div>
      </div>

      <div className="card-body">
        <p className="section-description">
          Splits an active parent consignment into two or more child lots. Invariant: <code>sum(children) == parent</code>.
          The parent lot transitions irreversibly to <code>Consumed</code>.
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
              <label htmlFor="split-parent-id" className="form-label">
                Parent Lot ID <span className="required">*</span>
              </label>
              <div className="input-with-action">
                <input
                  id="split-parent-id"
                  type="text"
                  className="form-input"
                  value={parentLotID}
                  onChange={(e) => setParentLotID(e.target.value)}
                  placeholder="e.g. LOT-COOP-HUILA-ROOT-001"
                  disabled={txStage === "pending_mining"}
                  required
                />
                <button
                  type="button"
                  onClick={handleLookupParent}
                  className="btn btn-secondary btn-input-action"
                  disabled={isInspecting || !parentLotID.trim()}
                >
                  {isInspecting ? "Inspecting..." : "Inspect Parent Lot"}
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

            {parentDetails && (
              <div className="form-group full-width">
                <div className="capacity-preview-box">
                  <div className="capacity-metric">
                    <span className="metric-label">Parent Mass:</span>
                    <span className="metric-value highlight">
                      {integerGramsToKg(parentDetails.quantityGrams).toLocaleString()} kg ({parentDetails.quantityGrams.toLocaleString()} g)
                    </span>
                  </div>
                  <div className="capacity-metric">
                    <span className="metric-label">Current Owner:</span>
                    <span className="metric-value"><code>{parentDetails.currentOwner}</code></span>
                  </div>
                  <div className="capacity-metric">
                    <span className="metric-label">Parent Status:</span>
                    <span className={`status-pill ${parentDetails.status.toLowerCase()}`}>
                      {parentDetails.status}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Child Lots Section */}
            <div className="form-group full-width">
              <div className="child-lots-header">
                <h3 className="subheading">Child Lots to Generate (Min 2)</h3>
                <button
                  type="button"
                  onClick={handleAddChildRow}
                  className="btn btn-sm btn-secondary"
                  disabled={txStage === "pending_mining"}
                >
                  + Add Child Lot
                </button>
              </div>

              <div className="child-lots-list">
                {children.map((child, idx) => (
                  <div key={idx} className="child-lot-row">
                    <div className="child-col-id">
                      <label className="form-label-sub">Child Lot ID #{idx + 1}</label>
                      <input
                        type="text"
                        className="form-input"
                        value={child.childLotID}
                        onChange={(e) => handleUpdateChild(idx, "childLotID", e.target.value)}
                        placeholder={`e.g. ${parentLotID}-CHILD-${String.fromCharCode(65 + idx)}`}
                        disabled={txStage === "pending_mining"}
                        required
                      />
                    </div>

                    <div className="child-col-qty">
                      <label className="form-label-sub">Quantity (kg)</label>
                      <input
                        type="number"
                        step="any"
                        min="0.001"
                        className="form-input"
                        value={child.quantityKg}
                        onChange={(e) => handleUpdateChild(idx, "quantityKg", parseFloat(e.target.value) || 0)}
                        disabled={txStage === "pending_mining"}
                        required
                      />
                    </div>

                    <div className="child-col-action">
                      {children.length > 2 && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger remove-btn"
                          onClick={() => handleRemoveChildRow(idx)}
                          disabled={txStage === "pending_mining"}
                          title="Remove child row"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Live Mass Conservation Indicator */}
              <div className={`conservation-status-bar ${isConserved ? "conserved" : "mismatched"}`}>
                <div className="conservation-text">
                  <span className="status-badge-inline">
                    {isConserved ? "✓ Mass Conserved" : "✕ Conservation Violation"}
                  </span>
                  <span className="conservation-details">
                    Parent: <strong>{parentKg.toLocaleString()} kg</strong> | Children Total: <strong>{childSumKg.toLocaleString()} kg</strong> | Delta: <strong>{(childSumKg - parentKg).toLocaleString()} kg</strong>
                  </span>
                </div>
                {!isConserved && (
                  <div className="conservation-warning">
                    ⚠️ Smart contract will strictly revert with <code>SplitConservationViolation</code> if submitted with mismatched sum.
                  </div>
                )}
              </div>
            </div>
          </div>

          {txStage === "idle" && (
            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!signer || !isSepolia}
              >
                Review & Execute Split
              </button>
            </div>
          )}
        </form>

        {/* Review Box */}
        {txStage === "review" && (
          <div className="tx-lifecycle-box review-box">
            <h3 className="lifecycle-title">Review Lot Split</h3>
            <p className="lifecycle-note">
              Executing split of {parentLotID} into {children.length} child lots.
            </p>
            <div className="review-summary-grid">
              <div className="summary-item">
                <span className="item-label">Parent Mass:</span>
                <span className="item-value">{parentKg.toLocaleString()} kg</span>
              </div>
              <div className="summary-item">
                <span className="item-label">Total Children:</span>
                <span className="item-value highlight">{childSumKg.toLocaleString()} kg</span>
              </div>
              <div className="summary-item">
                <span className="item-label">Invariant Check:</span>
                <span className={`item-value ${isConserved ? "text-success" : "text-danger"}`}>
                  {isConserved ? "Sum Equals Parent (Valid)" : "Mismatched (Contract Will Revert)"}
                </span>
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
                Submit Split to Sepolia
              </button>
            </div>
          </div>
        )}

        {/* Mining Status */}
        {(txStage === "wallet_confirmation" || txStage === "pending_mining") && (
          <div className="tx-lifecycle-box pending-box">
            <div className="loading-spinner large"></div>
            <h3 className="lifecycle-title">
              {txStage === "wallet_confirmation" ? "Waiting for Wallet Confirmation..." : "Mining Split Transaction..."}
            </h3>
            <p className="lifecycle-note">
              Enforcing conservation invariants on ConsignmentRegistry.
            </p>
          </div>
        )}

        {/* Confirmed Status */}
        {txStage === "confirmed" && txHash && (
          <div className="tx-lifecycle-box confirmed-box">
            <span className="confirmed-icon">✓</span>
            <h3 className="lifecycle-title">Lot Split Successfully Mined!</h3>
            <p className="lifecycle-note">
              Parent lot {parentLotID} is now permanently marked <code>Consumed</code>.
            </p>
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

export default SplitLotForm;
