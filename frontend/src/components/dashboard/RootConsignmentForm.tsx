import React, { useState } from "react";
import type { Signer } from "ethers";
import {
  lookupOnChainCertificate,
  executeCreateRootConsignment,
  kgToIntegerGrams,
  integerGramsToKg,
  type OnChainCertificateDetails,
} from "../../services/dashboardContractService";
import { parseContractError, type ParsedContractError } from "../../services/errorParser";
import { SEPOLIA_CHAIN_ID } from "../../services/config";

interface RootConsignmentFormProps {
  signer: Signer | null;
  chainId: number | null;
  connectedAddress: string | null;
  onLotCreated: (lotID: string, quantityKg: number, txHash: string) => void;
}

type TxStage = "idle" | "review" | "wallet_confirmation" | "pending_mining" | "confirmed" | "failed";

export const RootConsignmentForm: React.FC<RootConsignmentFormProps> = ({
  signer,
  chainId,
  connectedAddress,
  onLotCreated,
}) => {
  const isSepolia = chainId === SEPOLIA_CHAIN_ID;

  const [certificateID, setCertificateID] = useState<string>("CERT-COOP-HUILA-2026-001");
  const [lotID, setLotID] = useState<string>("LOT-COOP-HUILA-ROOT-001");
  const [quantityKg, setQuantityKg] = useState<number>(10000);

  // Inspected certificate details
  const [certDetails, setCertDetails] = useState<OnChainCertificateDetails | null>(null);
  const [isInspecting, setIsInspecting] = useState<boolean>(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  // Lifecycle
  const [txStage, setTxStage] = useState<TxStage>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [parsedError, setParsedError] = useState<ParsedContractError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const integerGrams = React.useMemo(() => {
    try {
      return kgToIntegerGrams(quantityKg);
    } catch {
      return 0n;
    }
  }, [quantityKg]);

  const handleLookupCertificate = async () => {
    if (!certificateID.trim()) return;
    setIsInspecting(true);
    setInspectError(null);
    try {
      const details = await lookupOnChainCertificate(certificateID.trim());
      if (!details) {
        setInspectError(`Certificate '${certificateID.trim()}' was not found on the blockchain.`);
        setCertDetails(null);
      } else {
        setCertDetails(details);
      }
    } catch (err: any) {
      setInspectError(err.message || "Failed to inspect certificate.");
    } finally {
      setIsInspecting(false);
    }
  };

  const isHolder = Boolean(
    connectedAddress &&
    certDetails?.holder &&
    connectedAddress.toLowerCase() === certDetails.holder.toLowerCase()
  );

  const remainingKg = certDetails ? integerGramsToKg(certDetails.remainingQuantityGrams) : 0;
  const resultingRemainingKg = remainingKg - quantityKg;
  const isOverClaim = quantityKg > remainingKg;

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setParsedError(null);

    if (!lotID.trim()) {
      setValidationError("Lot ID is required.");
      return;
    }
    if (!certificateID.trim()) {
      setValidationError("Certificate ID is required.");
      return;
    }
    if (quantityKg <= 0) {
      setValidationError("Quantity must be positive.");
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
      const result = await executeCreateRootConsignment(
        {
          lotID: lotID.trim(),
          certificateID: certificateID.trim(),
          quantityKg: Number(quantityKg),
        },
        signer
      );

      setTxHash(result.transactionHash);
      setTxStage("confirmed");
      onLotCreated(lotID.trim(), Number(quantityKg), result.transactionHash);
    } catch (err: any) {
      const parsed = parseContractError(err);
      setParsedError(parsed);
      setTxStage("failed");
    }
  };

  const handlePresetDemo = () => {
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    setCertificateID("CERT-COOP-HUILA-2026-001");
    setLotID(`LOT-ROOT-DEMO-${randomSuffix}`);
    setQuantityKg(10000);
    setValidationError(null);
    setParsedError(null);
  };

  return (
    <div className="card form-card">
      <div className="card-header">
        <div className="card-title-group">
          <span className="card-icon">🌱</span>
          <h2 className="card-title">Create Root Consignment</h2>
        </div>
        <button
          type="button"
          onClick={handlePresetDemo}
          className="btn btn-sm btn-outline demo-fill-btn"
        >
          Preset Demo Values
        </button>
      </div>

      <div className="card-body">
        <p className="section-description">
          The <strong>Root Consignment</strong> is the exclusive point where certified capacity is allocated from 
          <code>CertificateRegistry</code> into physical inventory on <code>ConsignmentRegistry</code>.
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
              <label htmlFor="root-cert-id" className="form-label">
                Originating Certificate ID <span className="required">*</span>
              </label>
              <div className="input-with-action">
                <input
                  id="root-cert-id"
                  type="text"
                  className="form-input"
                  value={certificateID}
                  onChange={(e) => setCertificateID(e.target.value)}
                  placeholder="e.g. CERT-COOP-HUILA-2026-001"
                  disabled={txStage === "pending_mining"}
                  required
                />
                <button
                  type="button"
                  onClick={handleLookupCertificate}
                  className="btn btn-secondary btn-input-action"
                  disabled={isInspecting || !certificateID.trim()}
                >
                  {isInspecting ? "Inspecting..." : "Check Capacity"}
                </button>
              </div>
              <span className="form-hint">Query live on-chain quota and verified holder address.</span>
            </div>

            {inspectError && (
              <div className="form-group full-width">
                <div className="alert alert-warning">
                  <span className="alert-icon">ℹ️</span>
                  <span className="alert-text">{inspectError}</span>
                </div>
              </div>
            )}

            {certDetails && (
              <div className="form-group full-width">
                <div className="capacity-preview-box">
                  <div className="capacity-metric">
                    <span className="metric-label">Registered Holder:</span>
                    <span className="metric-value"><code>{certDetails.holder}</code></span>
                    {connectedAddress && (
                      <span className={`holder-badge ${isHolder ? "match" : "mismatch"}`}>
                        {isHolder ? "✓ You are Holder" : "✕ Not Connected Holder"}
                      </span>
                    )}
                  </div>
                  <div className="capacity-metric">
                    <span className="metric-label">Remaining Certified Capacity:</span>
                    <span className="metric-value highlight">
                      {remainingKg.toLocaleString()} kg ({certDetails.remainingQuantityGrams.toLocaleString()} g)
                    </span>
                  </div>
                  <div className="capacity-metric">
                    <span className="metric-label">Status:</span>
                    <span className={`status-pill ${certDetails.status.toLowerCase()}`}>
                      {certDetails.status}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="root-lot-id" className="form-label">
                New Root Lot ID <span className="required">*</span>
              </label>
              <input
                id="root-lot-id"
                type="text"
                className="form-input"
                value={lotID}
                onChange={(e) => setLotID(e.target.value)}
                placeholder="e.g. LOT-COOP-HUILA-ROOT-001"
                disabled={txStage === "pending_mining"}
                required
              />
              <span className="form-hint">Unique identifier for the new physical harvest batch.</span>
            </div>

            <div className="form-group">
              <label htmlFor="root-quantity" className="form-label">
                Root Quantity (Kilograms) <span className="required">*</span>
              </label>
              <input
                id="root-quantity"
                type="number"
                step="any"
                min="0.001"
                className={`form-input ${isOverClaim ? "input-warning" : ""}`}
                value={quantityKg}
                onChange={(e) => setQuantityKg(parseFloat(e.target.value) || 0)}
                disabled={txStage === "pending_mining"}
                required
              />
              <span className="form-hint canonical-conversion-preview">
                On-Chain: <strong>{integerGrams.toLocaleString()} integer grams</strong>
                {certDetails && (
                  <span className={`resulting-balance ${resultingRemainingKg < 0 ? "negative" : ""}`}>
                    {" "}| Resulting Remaining: {resultingRemainingKg.toLocaleString()} kg
                  </span>
                )}
              </span>
            </div>
          </div>

          {certDetails && !isHolder && (
            <div className="alert alert-error" role="alert">
              <span className="alert-icon">🔒</span>
              <div className="alert-body">
                <strong>Authorization Mismatch:</strong> Connected wallet ({connectedAddress}) is not the registered holder of this certificate ({certDetails.holder}). The smart contract will strictly revert.
              </div>
            </div>
          )}

          {certDetails && isOverClaim && (
            <div className="alert alert-warning" role="alert">
              <span className="alert-icon">⚠️</span>
              <div className="alert-body">
                <strong>Capacity Exceeded:</strong> Requested quantity ({quantityKg.toLocaleString()} kg) exceeds remaining capacity ({remainingKg.toLocaleString()} kg). The smart contract will revert with <code>InsufficientCertifiedQuantity</code>.
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
                Review & Allocate Root Lot
              </button>
            </div>
          )}
        </form>

        {/* Review Box */}
        {txStage === "review" && (
          <div className="tx-lifecycle-box review-box">
            <h3 className="lifecycle-title">Review Root Consignment</h3>
            <div className="review-summary-grid">
              <div className="summary-item">
                <span className="item-label">Lot ID:</span>
                <span className="item-value">{lotID}</span>
              </div>
              <div className="summary-item">
                <span className="item-label">Originating Certificate:</span>
                <span className="item-value">{certificateID}</span>
              </div>
              <div className="summary-item">
                <span className="item-label">Allocated Quantity:</span>
                <span className="item-value highlight">{quantityKg.toLocaleString()} kg ({integerGrams.toLocaleString()} g)</span>
              </div>
              <div className="summary-item">
                <span className="item-label">Remaining Balance After:</span>
                <span className="item-value">{resultingRemainingKg.toLocaleString()} kg</span>
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
                Confirm On-Chain
              </button>
            </div>
          </div>
        )}

        {/* Mining Status */}
        {(txStage === "wallet_confirmation" || txStage === "pending_mining") && (
          <div className="tx-lifecycle-box pending-box">
            <div className="loading-spinner large"></div>
            <h3 className="lifecycle-title">
              {txStage === "wallet_confirmation" ? "Waiting for Wallet Approval..." : "Mining Root Consignment on Sepolia..."}
            </h3>
            <p className="lifecycle-note">
              Executing single-point mass-balance deduction against CertificateRegistry.
            </p>
          </div>
        )}

        {/* Confirmed Status */}
        {txStage === "confirmed" && txHash && (
          <div className="tx-lifecycle-box confirmed-box">
            <span className="confirmed-icon">✓</span>
            <h3 className="lifecycle-title">Root Consignment Successfully Created!</h3>
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
            <button
              type="button"
              className="btn btn-sm btn-outline mt-3"
              onClick={() => {
                setTxStage("idle");
                handlePresetDemo();
              }}
            >
              Create Another Root Consignment
            </button>
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

export default RootConsignmentForm;
