import React, { useState } from "react";
import { submitConsumerReport, type ConsumerReportResponse } from "../services/indexerApi";

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  lotID: string;
  certificateID?: string;
}

const ISSUE_TYPES = [
  { value: "PRODUCT_MISLABELING", label: "Product Mislabeling (Seal or logo discrepancy)" },
  { value: "TAMPERED_SEAL", label: "Tampered Physical Seal or Bag Packaging" },
  { value: "SUSPECTED_NON_ORGANIC", label: "Suspected Non-Organic Commingling / Conventional Aroma" },
  { value: "VOLUME_DISCREPANCY", label: "Weight or Volume Mismatch against Packaging" },
] as const;

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  lotID,
  certificateID,
}) => {
  const [issueType, setIssueType] = useState<"PRODUCT_MISLABELING" | "TAMPERED_SEAL" | "SUSPECTED_NON_ORGANIC" | "VOLUME_DISCREPANCY">("PRODUCT_MISLABELING");
  const [reporterReference, setReporterReference] = useState("");
  const [details, setDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<ConsumerReportResponse | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    // If reporter identifier is blank, generate a pseudonymous client device hash
    const reporterRef = reporterReference.trim() || `anon-consumer-${Math.random().toString(36).substring(2, 10)}`;

    const response = await submitConsumerReport({
      lotID,
      certificateID,
      issueType,
      reporterReference: reporterRef,
      evidence: {
        consumerNote: details.trim(),
        submittedVia: "CertLedger Public Verification Web UI",
        submittedTimestamp: new Date().toISOString(),
      },
    });

    setIsSubmitting(false);
    setResult(response);
  };

  const handleResetAndClose = () => {
    setResult(null);
    setDetails("");
    setReporterReference("");
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title-row">
            <span className="modal-icon">🚩</span>
            <h3 id="report-modal-title" className="modal-title">Report a Supply Chain Concern</h3>
          </div>
          <button type="button" className="btn-close" onClick={handleResetAndClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {result?.success ? (
          <div className="modal-success-box" role="status">
            <div className="success-icon">✓</div>
            <h4 className="success-title">Concern Submitted Successfully</h4>
            <p className="success-desc">
              Your report has been securely registered in the compliance pipeline.
            </p>
            <div className="dedupe-pill">
              <span className="dedupe-label">Submission Integrity Key:</span>
              <code className="dedupe-code">{result.dedupeKey}</code>
            </div>
            <p className="neutral-note">
              <em>
                Note: Submissions are queued for independent review by accredited certifying agents.
                A consumer submission does not presume or prove wrongdoing.
              </em>
            </p>
            <button type="button" className="btn btn-primary btn-block" onClick={handleResetAndClose}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="modal-form">
            <p className="modal-intro">
              Help preserve organic integrity. If you suspect packaging tampering, mislabeling, or volume
              irregularities for lot <strong>{lotID}</strong>, please submit details below.
            </p>

            {result?.error && (
              <div className="form-error-alert" role="alert">
                {result.error}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="issue-type-select" className="form-label">
                Discrepancy Category <span className="required">*</span>
              </label>
              <select
                id="issue-type-select"
                className="form-select"
                value={issueType}
                onChange={(e) => setIssueType(e.target.value as any)}
                required
              >
                {ISSUE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="reporter-ref-input" className="form-label">
                Reporter Reference (Optional)
              </label>
              <input
                id="reporter-ref-input"
                type="text"
                className="form-input"
                placeholder="e.g. buyer@coop.org or pseudonym (blank for anonymous)"
                value={reporterReference}
                onChange={(e) => setReporterReference(e.target.value)}
              />
              <span className="field-help">
                Stored safely as a pseudonymous hash to deduplicate spam reports.
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="details-input" className="form-label">
                Observed Details (Optional)
              </label>
              <textarea
                id="details-input"
                className="form-textarea"
                rows={3}
                placeholder="Describe what you observed (e.g., seal broken on delivery, missing certification code)..."
                value={details}
                onChange={(e) => setDetails(e.target.value)}
              />
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline"
                onClick={handleResetAndClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-danger"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Submitting..." : "Submit Concern"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ReportModal;
