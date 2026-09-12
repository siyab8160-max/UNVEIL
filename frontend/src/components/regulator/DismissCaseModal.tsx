import React, { useState } from "react";
import type { CaseRecord } from "../../services/indexerApi";

interface DismissCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  caseRecord: CaseRecord;
  currentActor: string;
  onDismissConfirm: (reasonNotes: string) => Promise<void>;
}

export const DismissCaseModal: React.FC<DismissCaseModalProps> = ({
  isOpen,
  onClose,
  caseRecord,
  currentActor,
  onDismissConfirm,
}) => {
  const [notes, setNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim()) {
      setError("Please provide dismissal rationale/investigation notes.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onDismissConfirm(notes.trim());
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to dismiss case");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="dismiss-modal-title">
      <div className="modal-content dismiss-modal">
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-badge-dismiss">⚖️ Case Dismissal</span>
            <h2 id="dismiss-modal-title" className="modal-title">
              Dismiss Case {caseRecord.caseID.slice(0, 8)}...
            </h2>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="dismiss-summary-box">
            <div className="summary-item">
              <span className="label">Case ID:</span>
              <code className="value">{caseRecord.caseID}</code>
            </div>
            {caseRecord.lotID && (
              <div className="summary-item">
                <span className="label">Target Lot ID:</span>
                <span className="value">{caseRecord.lotID}</span>
              </div>
            )}
            {caseRecord.certificateID && (
              <div className="summary-item">
                <span className="label">Target Certificate ID:</span>
                <span className="value">{caseRecord.certificateID}</span>
              </div>
            )}
            <div className="summary-item">
              <span className="label">Reviewer / Actor:</span>
              <span className="value">{currentActor || "Auditor / Regulator"}</span>
            </div>
            <div className="summary-item">
              <span className="label">Trigger Anomaly:</span>
              <span className="value">{caseRecord.anomalyType}</span>
            </div>
          </div>

          <div className="dismiss-notice-callout">
            <span className="callout-icon">ℹ️</span>
            <div>
              <strong>Off-Chain Workflow Decision:</strong>
              <p>
                Dismissing this case records an immutable audit log entry in PostgreSQL with your identity
                and rationalization. Dismissal <strong>never calls the blockchain</strong>; the on-chain certificate
                status remains completely unchanged.
              </p>
            </div>
          </div>

          {error && (
            <div className="error-callout" role="alert">
              <strong>Error:</strong> {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="dismissal-notes" className="form-label">
              Dismissal Rationale & Investigation Findings *
            </label>
            <textarea
              id="dismissal-notes"
              className="form-textarea"
              rows={4}
              placeholder="Detail reasons for dismissal (e.g., Physical on-site audit confirmed organic handling separation was maintained; mass balance discrepancy resolved with valid supplier attestation)..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              required
            />
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-warning"
              disabled={isSubmitting || !notes.trim()}
            >
              {isSubmitting ? "Recording Dismissal..." : "Confirm Off-Chain Dismissal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DismissCaseModal;
