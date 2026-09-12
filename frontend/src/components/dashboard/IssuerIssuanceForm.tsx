import React, { useState } from "react";
import { ethers, type Signer } from "ethers";
import {
  executeIssueCertificate,
  kgToIntegerGrams,
  lookupOnChainCertificate,
} from "../../services/dashboardContractService";
import { parseContractError, type ParsedContractError } from "../../services/errorParser";
import { SEPOLIA_CHAIN_ID } from "../../services/config";

interface IssuerIssuanceFormProps {
  signer: Signer | null;
  chainId: number | null;
  isIssuerActive: boolean;
  onCertificateIssued: (certificateID: string, txHash: string) => void;
}

type TxStage = "idle" | "review" | "wallet_confirmation" | "pending_mining" | "confirmed" | "failed";

export const IssuerIssuanceForm: React.FC<IssuerIssuanceFormProps> = ({
  signer,
  chainId,
  isIssuerActive,
  onCertificateIssued,
}) => {
  const isSepolia = chainId === SEPOLIA_CHAIN_ID;

  // Exact 8 fields accepted by CertificateRegistry.issueCertificate()
  const [certificateID, setCertificateID] = useState<string>("CERT-COOP-HUILA-2026-001");
  const [standardID, setStandardID] = useState<string>("USDA-NOP-ORGANIC");
  const [holder, setHolder] = useState<string>("0x1111111111111111111111111111111111111111");
  const [quantityKg, setQuantityKg] = useState<number>(25000);
  const [validFromDate, setValidFromDate] = useState<string>(
    new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [validUntilDate, setValidUntilDate] = useState<string>(
    new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [source, setSource] = useState<string>("USDA Organic INTEGRITY Database");
  const [sourceID, setSourceID] = useState<string>("CCOF");

  // Transaction Lifecycle state
  const [txStage, setTxStage] = useState<TxStage>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [parsedError, setParsedError] = useState<ParsedContractError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Canonical grams preview
  const integerGrams = React.useMemo(() => {
    try {
      return kgToIntegerGrams(quantityKg);
    } catch {
      return 0n;
    }
  }, [quantityKg]);

  const handleFillDemo = () => {
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    setCertificateID(`CERT-SEPOLIA-DEMO-${randomSuffix}`);
    setStandardID("USDA-NOP-ORGANIC");
    setHolder("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
    setQuantityKg(25000);
    setSource("USDA Organic INTEGRITY Database");
    setSourceID("CCOF");
    setValidationError(null);
    setParsedError(null);
  };

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setParsedError(null);

    // Frontend validation
    if (!certificateID.trim()) {
      setValidationError("Certificate ID is required.");
      return;
    }
    if (!standardID.trim()) {
      setValidationError("Standard ID is required.");
      return;
    }
    if (!ethers.isAddress(holder) || holder === ethers.ZeroAddress) {
      setValidationError("A valid, non-zero Ethereum holder address is required.");
      return;
    }
    if (quantityKg <= 0) {
      setValidationError("Certified quantity must be a strictly positive number.");
      return;
    }

    const fromTs = Math.floor(new Date(validFromDate).getTime() / 1000);
    const untilTs = Math.floor(new Date(validUntilDate).getTime() / 1000);
    if (fromTs >= untilTs) {
      setValidationError("Validity start date must be strictly before expiration date.");
      return;
    }

    setTxStage("review");
  };

  const handleConfirmTransaction = async () => {
    if (!signer) {
      setValidationError("Wallet signer not available. Please connect your wallet.");
      return;
    }

    setTxStage("wallet_confirmation");
    setParsedError(null);

    try {
      const fromTs = Math.floor(new Date(validFromDate).getTime() / 1000);
      const untilTs = Math.floor(new Date(validUntilDate).getTime() / 1000);

      // Execute on-chain transaction
      setTxStage("pending_mining");
      const result = await executeIssueCertificate(
        {
          certificateID: certificateID.trim(),
          standardID: standardID.trim(),
          holder: holder.trim(),
          certifiedQuantityKg: Number(quantityKg),
          validFromTimestamp: fromTs,
          validUntilTimestamp: untilTs,
          source: source.trim(),
          sourceID: sourceID.trim(),
        },
        signer
      );

      setTxHash(result.transactionHash);

      // Read resulting state from blockchain to guarantee confirmation
      await lookupOnChainCertificate(certificateID.trim());

      setTxStage("confirmed");
      onCertificateIssued(certificateID.trim(), result.transactionHash);
    } catch (err: any) {
      const parsed = parseContractError(err);
      setParsedError(parsed);
      setTxStage("failed");
    }
  };

  const canSubmit = Boolean(signer && isSepolia && isIssuerActive && txStage !== "wallet_confirmation" && txStage !== "pending_mining");

  return (
    <div className="card form-card">
      <div className="card-header">
        <div className="card-title-group">
          <span className="card-icon">📜</span>
          <h2 className="card-title">Issue Ethical Sourcing Certificate</h2>
        </div>
        <button
          type="button"
          onClick={handleFillDemo}
          className="btn btn-sm btn-outline demo-fill-btn"
          disabled={!isIssuerActive}
        >
          Preset Demo Values
        </button>
      </div>

      <div className="card-body">
        {/* On-chain authorization check warning */}
        {!isIssuerActive && (
          <div className="alert alert-warning" role="alert">
            <span className="alert-icon">🔒</span>
            <div className="alert-body">
              <strong>Issuance Restricted by On-Chain Registry</strong>
              <p className="alert-text">
                Your connected wallet does not hold an active accredited certifying body record in the deployed <code>IssuerRegistry</code>. 
                Smart contract calls to <code>issueCertificate()</code> will strictly revert with <code>IssuerNotActive</code>.
              </p>
            </div>
          </div>
        )}

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
            <div className="form-group">
              <label htmlFor="issue-cert-id" className="form-label">
                Certificate ID <span className="required">*</span>
              </label>
              <input
                id="issue-cert-id"
                type="text"
                className="form-input"
                value={certificateID}
                onChange={(e) => setCertificateID(e.target.value)}
                placeholder="e.g. CERT-COOP-HUILA-2026-001"
                disabled={!isIssuerActive || txStage === "pending_mining"}
                required
              />
              <span className="form-hint">Unique on-chain certificate identifier.</span>
            </div>

            <div className="form-group">
              <label htmlFor="issue-standard-id" className="form-label">
                Standard ID <span className="required">*</span>
              </label>
              <select
                id="issue-standard-id"
                className="form-select"
                value={standardID}
                onChange={(e) => setStandardID(e.target.value)}
                disabled={!isIssuerActive || txStage === "pending_mining"}
              >
                <option value="USDA-NOP-ORGANIC">USDA-NOP-ORGANIC (7 CFR Part 205)</option>
                <option value="FAIRTRADE-FLO-CERT">FAIRTRADE-FLO-CERT</option>
                <option value="RAINFOREST-ALLIANCE">RAINFOREST-ALLIANCE</option>
              </select>
              <span className="form-hint">Accredited standard reference.</span>
            </div>

            <div className="form-group full-width">
              <label htmlFor="issue-holder" className="form-label">
                Holder / Producer Address <span className="required">*</span>
              </label>
              <input
                id="issue-holder"
                type="text"
                className="form-input"
                value={holder}
                onChange={(e) => setHolder(e.target.value)}
                placeholder="0x..."
                disabled={!isIssuerActive || txStage === "pending_mining"}
                required
              />
              <span className="form-hint">
                Authorized producer wallet address eligible to create root consignments against this quota.
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="issue-quantity" className="form-label">
                Certified Quantity (Kilograms) <span className="required">*</span>
              </label>
              <input
                id="issue-quantity"
                type="number"
                step="any"
                min="0.001"
                className="form-input"
                value={quantityKg}
                onChange={(e) => setQuantityKg(parseFloat(e.target.value) || 0)}
                disabled={!isIssuerActive || txStage === "pending_mining"}
                required
              />
              <span className="form-hint canonical-conversion-preview">
                On-Chain Canonical Value: <strong>{integerGrams.toLocaleString()} integer grams</strong>
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="issue-source-id" className="form-label">
                Certifier Source ID <span className="required">*</span>
              </label>
              <input
                id="issue-source-id"
                type="text"
                className="form-input"
                value={sourceID}
                onChange={(e) => setSourceID(e.target.value)}
                placeholder="e.g. CCOF, OTCO, MAYACERT"
                disabled={!isIssuerActive || txStage === "pending_mining"}
                required
              />
              <span className="form-hint">Public registry certifying agent identifier.</span>
            </div>

            <div className="form-group">
              <label htmlFor="issue-valid-from" className="form-label">
                Valid From <span className="required">*</span>
              </label>
              <input
                id="issue-valid-from"
                type="date"
                className="form-input"
                value={validFromDate}
                onChange={(e) => setValidFromDate(e.target.value)}
                disabled={!isIssuerActive || txStage === "pending_mining"}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="issue-valid-until" className="form-label">
                Valid Until <span className="required">*</span>
              </label>
              <input
                id="issue-valid-until"
                type="date"
                className="form-input"
                value={validUntilDate}
                onChange={(e) => setValidUntilDate(e.target.value)}
                disabled={!isIssuerActive || txStage === "pending_mining"}
                required
              />
            </div>

            <div className="form-group full-width">
              <label htmlFor="issue-source" className="form-label">
                Attestation Source Registry
              </label>
              <input
                id="issue-source"
                type="text"
                className="form-input"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                disabled={!isIssuerActive || txStage === "pending_mining"}
              />
              <span className="form-hint">Stored on-chain for provenance auditing.</span>
            </div>
          </div>

          {txStage === "idle" && (
            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!canSubmit}
              >
                Review & Issue Certificate
              </button>
            </div>
          )}
        </form>

        {/* Review & Confirmation Lifecycle Box */}
        {txStage === "review" && (
          <div className="tx-lifecycle-box review-box">
            <h3 className="lifecycle-title">Review Certificate Issuance</h3>
            <div className="review-summary-grid">
              <div className="summary-item">
                <span className="item-label">Certificate ID:</span>
                <span className="item-value">{certificateID}</span>
              </div>
              <div className="summary-item">
                <span className="item-label">Standard:</span>
                <span className="item-value">{standardID}</span>
              </div>
              <div className="summary-item">
                <span className="item-label">Holder:</span>
                <span className="item-value"><code>{holder}</code></span>
              </div>
              <div className="summary-item">
                <span className="item-label">Certified Capacity:</span>
                <span className="item-value highlight">{quantityKg.toLocaleString()} kg ({integerGrams.toLocaleString()} g)</span>
              </div>
              <div className="summary-item">
                <span className="item-label">Source ID:</span>
                <span className="item-value">{sourceID}</span>
              </div>
              <div className="summary-item">
                <span className="item-label">Validity Window:</span>
                <span className="item-value">{validFromDate} to {validUntilDate}</span>
              </div>
            </div>

            <div className="lifecycle-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setTxStage("idle")}
              >
                Back to Edit
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={handleConfirmTransaction}
              >
                Submit to Sepolia Blockchain
              </button>
            </div>
          </div>
        )}

        {/* Wallet Confirmation / Mining Status */}
        {(txStage === "wallet_confirmation" || txStage === "pending_mining") && (
          <div className="tx-lifecycle-box pending-box">
            <div className="loading-spinner large"></div>
            <h3 className="lifecycle-title">
              {txStage === "wallet_confirmation" ? "Waiting for Wallet Approval..." : "Mining Transaction on Sepolia..."}
            </h3>
            <p className="lifecycle-note">
              {txStage === "wallet_confirmation"
                ? "Please confirm the transaction in your connected wallet."
                : "Transaction broadcast. Waiting for block confirmation on Ethereum Sepolia."}
            </p>
          </div>
        )}

        {/* Confirmed Status */}
        {txStage === "confirmed" && txHash && (
          <div className="tx-lifecycle-box confirmed-box">
            <span className="confirmed-icon">✓</span>
            <h3 className="lifecycle-title">Certificate Successfully Issued!</h3>
            <p className="lifecycle-note">
              Permanent on-chain capacity of {integerGrams.toLocaleString()} grams has been allocated.
            </p>
            <div className="tx-hash-row">
              <span className="tx-hash-label">Transaction:</span>
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
                handleFillDemo();
              }}
            >
              Issue Another Certificate
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

export default IssuerIssuanceForm;
