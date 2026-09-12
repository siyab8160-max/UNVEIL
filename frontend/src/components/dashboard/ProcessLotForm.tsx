import React, { useState } from "react";
import type { Signer } from "ethers";
import {
  lookupOnChainLot,
  executeProcessLot,
  integerGramsToKg,
  type OnChainLotDetails,
} from "../../services/dashboardContractService";
import { parseContractError, type ParsedContractError } from "../../services/errorParser";
import { SEPOLIA_CHAIN_ID } from "../../services/config";

interface ProcessLotFormProps {
  signer: Signer | null;
  chainId: number | null;
  connectedAddress: string | null;
  onLotCreated: (lotID: string, quantityKg: number, txHash: string) => void;
}

type TxStage = "idle" | "review" | "wallet_confirmation" | "pending_mining" | "confirmed" | "failed";

export const ProcessLotForm: React.FC<ProcessLotFormProps> = ({
  signer,
  chainId,
  connectedAddress: _connectedAddress,
  onLotCreated,
}) => {
  const isSepolia = chainId === SEPOLIA_CHAIN_ID;

  const [parentLotID, setParentLotID] = useState<string>("LOT-COOP-HUILA-ROOT-001");
  const [newLotID, setNewLotID] = useState<string>("LOT-COOP-HUILA-ROASTED-001");
  const [outputQuantityKg, setOutputQuantityKg] = useState<number>(8500);
  const [processDetails, setProcessDetails] = useState<string>(
    "Decortication, wet milling fermentation, and roasting (15% yield loss)"
  );

  // Inspected parent lot
  const [parentDetails, setParentDetails] = useState<OnChainLotDetails | null>(null);
  const [isInspecting, setIsInspecting] = useState<boolean>(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  // Lifecycle
  const [txStage, setTxStage] = useState<TxStage>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [parsedError, setParsedError] = useState<ParsedContractError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const inputKg = parentDetails ? integerGramsToKg(parentDetails.quantityGrams) : 10000;
  const massLossKg = inputKg - outputQuantityKg;
  const lossPercentage = inputKg > 0 ? ((massLossKg / inputKg) * 100).toFixed(2) : "0.00";
  const isExpansion = outputQuantityKg > inputKg;

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

  const handlePresetValidDemo = () => {
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    setParentLotID("LOT-COOP-HUILA-ROOT-001");
    setNewLotID(`LOT-ROASTED-${randomSuffix}`);
    setOutputQuantityKg(8500); // 15% valid loss from 10,000 kg
    setProcessDetails("Roasting green beans into specialty coffee (15% moisture loss)");
    setValidationError(null);
    setParsedError(null);
  };

  const handlePresetExpansionDemo = () => {
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    setParentLotID("LOT-COOP-HUILA-ROOT-001");
    setNewLotID(`LOT-EXPANSION-${randomSuffix}`);
    setOutputQuantityKg(12000); // Deliberate expansion: 12,000 > 10,000
    setProcessDetails("Illegal mass creation attempt (rejected on-chain)");
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
    if (!newLotID.trim()) {
      setValidationError("Derived lot ID is required.");
      return;
    }
    if (outputQuantityKg <= 0) {
      setValidationError("Output quantity must be strictly positive.");
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
      const result = await executeProcessLot(
        {
          parentLotID: parentLotID.trim(),
          newLotID: newLotID.trim(),
          outputQuantityKg: Number(outputQuantityKg),
          processDetails: processDetails.trim(),
        },
        signer
      );

      setTxHash(result.transactionHash);
      setTxStage("confirmed");
      onLotCreated(newLotID.trim(), Number(outputQuantityKg), result.transactionHash);
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
          <span className="card-icon">⚙️</span>
          <h2 className="card-title">Process Lot (Yield Loss Permitted)</h2>
        </div>
        <div className="demo-button-group">
          <button
            type="button"
            onClick={handlePresetValidDemo}
            className="btn btn-sm btn-outline demo-fill-btn"
          >
            Preset Valid Roasting (15% Loss)
          </button>
          <button
            type="button"
            onClick={handlePresetExpansionDemo}
            className="btn btn-sm btn-danger-outline demo-fill-btn"
            title="Demonstrate contract rejection of yield expansion"
          >
            Preset Mass Expansion (Intentional Rejection)
          </button>
        </div>
      </div>

      <div className="card-body">
        <p className="section-description">
          Transforms a parent consignment (e.g. wet milling, drying, roasting). Permitted yield loss is tracked on-chain.
          Physical yield expansion (<code>output &gt; input</code>) strictly reverts with <code>YieldExpansionNotAllowed</code>.
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
              <label htmlFor="process-parent-id" className="form-label">
                Parent Lot ID <span className="required">*</span>
              </label>
              <div className="input-with-action">
                <input
                  id="process-parent-id"
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
                  {isInspecting ? "Inspecting..." : "Inspect Parent"}
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
                    <span className="metric-label">Input Mass:</span>
                    <span className="metric-value highlight">
                      {integerGramsToKg(parentDetails.quantityGrams).toLocaleString()} kg
                    </span>
                  </div>
                  <div className="capacity-metric">
                    <span className="metric-label">Owner:</span>
                    <span className="metric-value"><code>{parentDetails.currentOwner}</code></span>
                  </div>
                  <div className="capacity-metric">
                    <span className="metric-label">Status:</span>
                    <span className={`status-pill ${parentDetails.status.toLowerCase()}`}>
                      {parentDetails.status}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="process-new-lot-id" className="form-label">
                Derived Lot ID <span className="required">*</span>
              </label>
              <input
                id="process-new-lot-id"
                type="text"
                className="form-input"
                value={newLotID}
                onChange={(e) => setNewLotID(e.target.value)}
                placeholder="e.g. LOT-COOP-HUILA-ROASTED-001"
                disabled={txStage === "pending_mining"}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="process-output-qty" className="form-label">
                Output Quantity (Kilograms) <span className="required">*</span>
              </label>
              <input
                id="process-output-qty"
                type="number"
                step="any"
                min="0.001"
                className={`form-input ${isExpansion ? "input-warning" : ""}`}
                value={outputQuantityKg}
                onChange={(e) => setOutputQuantityKg(parseFloat(e.target.value) || 0)}
                disabled={txStage === "pending_mining"}
                required
              />
            </div>

            {/* Mass Balance & Loss Calculations */}
            <div className="form-group full-width">
              <div className={`process-yield-summary ${isExpansion ? "expansion" : "valid-loss"}`}>
                <div className="yield-metric">
                  <span className="metric-title">Input Quantity:</span>
                  <span className="metric-number">{inputKg.toLocaleString()} kg</span>
                </div>
                <div className="yield-metric">
                  <span className="metric-title">Output Quantity:</span>
                  <span className="metric-number">{outputQuantityKg.toLocaleString()} kg</span>
                </div>
                <div className="yield-metric">
                  <span className="metric-title">Mass Loss:</span>
                  <span className={`metric-number ${isExpansion ? "text-danger" : "text-success"}`}>
                    {massLossKg.toLocaleString()} kg ({lossPercentage}%)
                  </span>
                </div>
              </div>

              {isExpansion && (
                <div className="alert alert-warning mt-2">
                  <span className="alert-icon">⚠️</span>
                  <div className="alert-body">
                    <strong>Yield Expansion Prohibited:</strong> Output ({outputQuantityKg.toLocaleString()} kg) exceeds input ({inputKg.toLocaleString()} kg). Smart contract will strictly reject with <code>YieldExpansionNotAllowed</code>.
                  </div>
                </div>
              )}
            </div>

            <div className="form-group full-width">
              <label htmlFor="process-details" className="form-label">
                Processing Specifications & Methodology <span className="required">*</span>
              </label>
              <textarea
                id="process-details"
                rows={2}
                className="form-textarea"
                value={processDetails}
                onChange={(e) => setProcessDetails(e.target.value)}
                disabled={txStage === "pending_mining"}
                required
              />
              <span className="form-hint">Stored permanently on-chain in event logs.</span>
            </div>
          </div>

          {txStage === "idle" && (
            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!signer || !isSepolia}
              >
                Review & Execute Processing
              </button>
            </div>
          )}
        </form>

        {/* Review Box */}
        {txStage === "review" && (
          <div className="tx-lifecycle-box review-box">
            <h3 className="lifecycle-title">Review Processing Step</h3>
            <div className="review-summary-grid">
              <div className="summary-item">
                <span className="item-label">Input Lot:</span>
                <span className="item-value">{parentLotID} ({inputKg.toLocaleString()} kg)</span>
              </div>
              <div className="summary-item">
                <span className="item-label">Output Lot:</span>
                <span className="item-value highlight">{newLotID} ({outputQuantityKg.toLocaleString()} kg)</span>
              </div>
              <div className="summary-item">
                <span className="item-label">Mass Loss:</span>
                <span className="item-value">{massLossKg.toLocaleString()} kg ({lossPercentage}%)</span>
              </div>
              <div className="summary-item">
                <span className="item-label">Expansion Status:</span>
                <span className={`item-value ${isExpansion ? "text-danger" : "text-success"}`}>
                  {isExpansion ? "Expansion Detected (Reverts On-Chain)" : "Valid Yield Loss"}
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
                Confirm Processing On-Chain
              </button>
            </div>
          </div>
        )}

        {/* Mining Status */}
        {(txStage === "wallet_confirmation" || txStage === "pending_mining") && (
          <div className="tx-lifecycle-box pending-box">
            <div className="loading-spinner large"></div>
            <h3 className="lifecycle-title">
              {txStage === "wallet_confirmation" ? "Waiting for Wallet Approval..." : "Mining Processing on Sepolia..."}
            </h3>
            <p className="lifecycle-note">
              Verifying yield invariants and locking parent lot.
            </p>
          </div>
        )}

        {/* Confirmed Status */}
        {txStage === "confirmed" && txHash && (
          <div className="tx-lifecycle-box confirmed-box">
            <span className="confirmed-icon">✓</span>
            <h3 className="lifecycle-title">Processing Successfully Mined!</h3>
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

export default ProcessLotForm;
