import React, { useState, useEffect } from "react";
import type { CaseRecord } from "../../services/indexerApi";
import { CONTRACT_ADDRESSES } from "../../services/config";
import { checkRevocationAuthorization, type RevocationAuthorizationInfo } from "../../services/dashboardContractService";

interface CaseDetailViewProps {
  caseRecord: CaseRecord;
  connectedAddress: string;
  onClose: () => void;
  onMoveToReview: (caseID: string) => Promise<void>;
  onOpenDismissModal: (caseRecord: CaseRecord) => void;
  onOpenConfirmModal: (caseRecord: CaseRecord) => void;
  customContract?: any; // For test injection
}

export const CaseDetailView: React.FC<CaseDetailViewProps> = ({
  caseRecord,
  connectedAddress,
  onClose,
  onMoveToReview,
  onOpenDismissModal,
  onOpenConfirmModal,
  customContract,
}) => {
  const [authInfo, setAuthInfo] = useState<RevocationAuthorizationInfo | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(true);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);

  const certID = caseRecord.certificateID;

  useEffect(() => {
    if (!certID) {
      setIsLoadingAuth(false);
      return;
    }

    let isMounted = true;
    setIsLoadingAuth(true);

    checkRevocationAuthorization(certID, connectedAddress, customContract)
      .then((info) => {
        if (isMounted) {
          setAuthInfo(info);
          setIsLoadingAuth(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error("Error reading live on-chain status:", err);
          setIsLoadingAuth(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [certID, connectedAddress, customContract]);

  const handleStartReview = async () => {
    setIsTransitioning(true);
    try {
      await onMoveToReview(caseRecord.caseID);
    } finally {
      setIsTransitioning(false);
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "OPEN":
        return "badge-status-open";
      case "UNDER_REVIEW":
        return "badge-status-review";
      case "REVOCATION_PENDING":
        return "badge-status-pending";
      case "RESOLVED":
        return "badge-status-resolved";
      case "DISMISSED":
        return "badge-status-dismissed";
      default:
        return "badge-status-default";
    }
  };

  // Helper for parsing mass balance evidence for comparison bar
  const requestedKg = caseRecord.evidence?.requestedGrams
    ? Number(BigInt(caseRecord.evidence.requestedGrams)) / 1000
    : null;
  const remainingKg = caseRecord.evidence?.remainingGrams
    ? Number(BigInt(caseRecord.evidence.remainingGrams)) / 1000
    : null;
  const deltaKg = caseRecord.evidence?.deltaGrams
    ? Number(BigInt(caseRecord.evidence.deltaGrams)) / 1000
    : null;

  return (
    <div className="case-detail-pane" role="region" aria-label="Case Details">
      {/* Pane Header */}
      <div className="detail-pane-header">
        <div className="detail-title-group">
          <button type="button" className="btn-back" onClick={onClose} aria-label="Back to Queue">
            ← Back to Queue
          </button>
          <div className="detail-id-line">
            <h2 className="detail-case-id">Case: {caseRecord.caseID}</h2>
            <span className={`status-pill ${getStatusBadgeClass(caseRecord.status)}`}>
              {caseRecord.status.replace("_", " ")}
            </span>
            <span className={`risk-pill ${caseRecord.riskScore >= 80 ? "badge-risk-critical" : "badge-risk-high"}`}>
              Risk: {caseRecord.riskScore}/100
            </span>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="detail-actions-toolbar">
          {caseRecord.status === "OPEN" && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleStartReview}
                disabled={isTransitioning}
              >
                {isTransitioning ? "Assigning..." : "Assign & Move to Review"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onOpenDismissModal(caseRecord)}
              >
                Dismiss Case
              </button>
            </>
          )}

          {caseRecord.status === "UNDER_REVIEW" && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onOpenDismissModal(caseRecord)}
              >
                Dismiss Case
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => onOpenConfirmModal(caseRecord)}
                title={
                  authInfo?.isAuthorized
                    ? "Proceed to on-chain certificate revocation"
                    : "Connected wallet is not authorized to revoke this certificate"
                }
              >
                Confirm Violation &amp; Revoke
              </button>
            </>
          )}

          {caseRecord.status === "REVOCATION_PENDING" && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => onOpenConfirmModal(caseRecord)}
            >
              Resume / Finalize Revocation
            </button>
          )}
        </div>
      </div>

      {/* Stitch Anomaly Inspection Card: Comparison Bar & Rule Checklist */}
      <div className="stitch-anomaly-card">
        <div className="stitch-anomaly-header">
          <div className="stitch-anomaly-title-group">
            <span className="anomaly-warning-icon">✕</span>
            <div>
              <span className="anomaly-eyebrow text-red font-semibold">
                {caseRecord.riskScore >= 80 ? "CRITICAL RISK AUDIT" : "REGULATORY AUDIT"}
              </span>
              <h3 className="anomaly-title">
                {caseRecord.anomalyType.replace(/_/g, " ")} — {caseRecord.lotID || caseRecord.certificateID}
              </h3>
            </div>
          </div>
          <div className="anomaly-status-tag">
            STATUS: {caseRecord.status.replace("_", " ")}
          </div>
        </div>

        {/* Comparison Bar (Mass Balance or Yield) */}
        {requestedKg !== null && remainingKg !== null && (
          <div className="stitch-comparison-box">
            <div className="comparison-header">
              <span className="comparison-label">MASS-BALANCE QUANTITY COMPARISON</span>
              {deltaKg && deltaKg > 0 && (
                <span className="delta-callout text-red">
                  +{deltaKg.toLocaleString()} KG OVER CERTIFIED LIMIT
                </span>
              )}
            </div>

            <div className="comparison-bars">
              <div className="comparison-row">
                <div className="bar-label-group">
                  <span>CERTIFIED CAPACITY:</span>
                  <strong>{remainingKg.toLocaleString()} KG</strong>
                </div>
                <div className="bar-track">
                  <div className="bar-fill bar-fill-capacity" style={{ width: "70%" }} />
                </div>
              </div>

              <div className="comparison-row">
                <div className="bar-label-group text-red">
                  <span>REQUESTED ALLOCATION:</span>
                  <strong>{requestedKg.toLocaleString()} KG</strong>
                </div>
                <div className="bar-track">
                  <div className="bar-fill bar-fill-requested" style={{ width: "95%" }} />
                </div>
              </div>
            </div>

            {/* Why Flagged Explanation */}
            <div className="why-flagged-box">
              <span className="why-flagged-title">WHY WAS THIS FLAGGED?</span>
              <p className="why-flagged-desc">
                {caseRecord.anomalies?.[0]?.description ||
                  `Requested consignment allocation exceeds remaining certified capacity on-chain. Single-point mass-balance rule violated.`}
              </p>
            </div>
          </div>
        )}

        {/* 5-Step Rule Engine Checklist */}
        <div className="rule-engine-checklist">
          <span className="checklist-heading">VERIFICATION RULE ENGINE CHECKLIST</span>
          <div className="checklist-grid">
            <div className="checklist-card">
              <div className="checklist-card-top">
                <span className="chk-step">1. Certificate</span>
                <span className="chk-result text-green">✓ Bound</span>
              </div>
              <div className="chk-detail">{certID || "Standard Registered"}</div>
            </div>

            <div className="checklist-card">
              <div className="checklist-card-top">
                <span className="chk-step">2. Issuer</span>
                <span className="chk-result text-green">✓ Accredited</span>
              </div>
              <div className="chk-detail">USDA NOP Certifier</div>
            </div>

            <div className="checklist-card checklist-card-violation">
              <div className="checklist-card-top">
                <span className="chk-step">3. Balance/Yield</span>
                <span className="chk-result text-red">✕ Flagged</span>
              </div>
              <div className="chk-detail">{caseRecord.anomalyType}</div>
            </div>

            <div className="checklist-card">
              <div className="checklist-card-top">
                <span className="chk-step">4. Cryptography</span>
                <span className="chk-result text-green">✓ Verified</span>
              </div>
              <div className="chk-detail">Sepolia POSt Consensus</div>
            </div>

            <div className="checklist-card checklist-card-verdict">
              <div className="checklist-card-top">
                <span className="chk-step">Final Verdict</span>
                <span className={`chk-result ${caseRecord.status === "RESOLVED" ? "text-green" : "text-amber"}`}>
                  {caseRecord.status === "RESOLVED" ? "✓ Cleared" : "● Under Review"}
                </span>
              </div>
              <div className="chk-detail">Human Auditor Oversight</div>
            </div>
          </div>
        </div>
      </div>

      <div className="detail-content-grid">
        {/* Section 1: Case Overview */}
        <section className="detail-card">
          <h3 className="card-heading">1. Case Overview</h3>
          <div className="detail-meta-grid">
            <div className="meta-field">
              <span className="meta-name">Dominant Anomaly:</span>
              <code className="meta-val highlight">{caseRecord.anomalyType}</code>
            </div>
            <div className="meta-field">
              <span className="meta-name">Assigned Role:</span>
              <span className="meta-val">{caseRecord.assignedRole}</span>
            </div>
            <div className="meta-field">
              <span className="meta-name">Reviewer:</span>
              <span className="meta-val">{caseRecord.reviewer || "Unassigned"}</span>
            </div>
            <div className="meta-field">
              <span className="meta-name">Opened Timestamp:</span>
              <span className="meta-val">{new Date(caseRecord.openedAt).toLocaleString()}</span>
            </div>
            {caseRecord.resolvedAt && (
              <div className="meta-field">
                <span className="meta-name">Resolved Timestamp:</span>
                <span className="meta-val">{new Date(caseRecord.resolvedAt).toLocaleString()}</span>
              </div>
            )}
            {caseRecord.resolution && (
              <div className="meta-field full-width">
                <span className="meta-name">Final Resolution:</span>
                <code className="meta-val resolution-box">{caseRecord.resolution}</code>
              </div>
            )}
          </div>
        </section>

        {/* Section 2: Authoritative Blockchain Status (Contract Truth) */}
        <section className="detail-card">
          <h3 className="card-heading">2. Authoritative Blockchain Status</h3>
          <div className="blockchain-status-box">
            <div className="chain-row">
              <span className="chain-label">Target Certificate ID:</span>
              <code className="chain-value">{certID || "No Certificate Linked"}</code>
            </div>
            {caseRecord.lotID && (
              <div className="chain-row">
                <span className="chain-label">Target Consignment Lot ID:</span>
                <code className="chain-value">{caseRecord.lotID}</code>
              </div>
            )}
            <div className="chain-row">
              <span className="chain-label">Live Smart Contract Status:</span>
              <span className={`status-badge-live ${authInfo?.currentStatus === "VALID" ? "live-valid" : "live-revoked"}`}>
                {isLoadingAuth ? "Querying Sepolia..." : authInfo?.currentStatus || "UNKNOWN"}
              </span>
            </div>
            <div className="chain-row">
              <span className="chain-label">Certificate Registry:</span>
              <a
                href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.CERTIFICATE_REGISTRY}`}
                target="_blank"
                rel="noopener noreferrer"
                className="chain-link"
              >
                <code>{CONTRACT_ADDRESSES.CERTIFICATE_REGISTRY}</code> ↗
              </a>
            </div>
            <div className="chain-row">
              <span className="chain-label">Wallet Revocation Authorization:</span>
              <span className={`auth-badge ${authInfo?.isAuthorized ? "auth-granted" : "auth-denied"}`}>
                {isLoadingAuth
                  ? "Evaluating on-chain roles..."
                  : authInfo?.isAuthorized
                  ? `Authorized (${authInfo.isArbitrator ? "ARBITRATION_ROLE" : "Issuer"})`
                  : "Unauthorized to Revoke"}
              </span>
            </div>
          </div>
        </section>

        {/* Section 3: Raw Anomaly Flags & Evidence (Regulator Only) */}
        <section className="detail-card full-width">
          <div className="card-header-with-badge">
            <h3 className="card-heading">3. Regulatory Evidence &amp; Anomaly Flags</h3>
            <span className="badge-regulator-only">Auditor Eyes Only (PRD §7.5)</span>
          </div>

          {caseRecord.anomalies && caseRecord.anomalies.length > 0 ? (
            <div className="anomalies-table-wrapper">
              <table className="anomalies-table">
                <thead>
                  <tr>
                    <th>Rule ID</th>
                    <th>Severity</th>
                    <th>Risk Score</th>
                    <th>Description</th>
                    <th>Detected At</th>
                    <th>Block / Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {caseRecord.anomalies.map((anom) => (
                    <tr key={anom.id}>
                      <td><code>{anom.ruleID}</code></td>
                      <td>
                        <span className={`severity-tag severity-${anom.severity.toLowerCase()}`}>
                          {anom.severity}
                        </span>
                      </td>
                      <td><strong>{anom.riskScore}</strong></td>
                      <td>{anom.description}</td>
                      <td>{new Date(anom.detectedAt).toLocaleString()}</td>
                      <td>
                        <a
                          href={`https://sepolia.etherscan.io/tx/${anom.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="chain-link"
                        >
                          #{anom.blockNumber} ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-subtext">No raw anomaly flags linked directly to this case.</p>
          )}

          {/* Evidence JSON inspection */}
          {caseRecord.evidence && Object.keys(caseRecord.evidence).length > 0 && (
            <div className="evidence-json-viewer">
              <span className="json-label">Parsed Evidence Payload:</span>
              <pre className="json-code">
                {JSON.stringify(caseRecord.evidence, null, 2)}
              </pre>
            </div>
          )}

          {/* Linked Consumer Reports */}
          {caseRecord.reports && caseRecord.reports.length > 0 && (
            <div className="linked-reports-box">
              <h4 className="sub-heading">Linked Consumer Reports ({caseRecord.reports.length})</h4>
              <ul className="reports-list">
                {caseRecord.reports.map((rep) => (
                  <li key={rep.reportID} className="report-item">
                    <span className="report-issue">{rep.issueType}</span>
                    <span className="report-ref">Reporter: <code>{rep.reporterReference}</code></span>
                    <span className="report-time">{new Date(rep.submittedAt).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Section 4: Immutable Case Audit Trail */}
        <section className="detail-card full-width">
          <h3 className="card-heading">4. Case Audit Trail (Immutable Log)</h3>
          {caseRecord.auditLogs && caseRecord.auditLogs.length > 0 ? (
            <div className="audit-timeline">
              {caseRecord.auditLogs.map((log) => (
                <div key={log.id} className="timeline-item">
                  <div className="timeline-marker" />
                  <div className="timeline-content">
                    <div className="timeline-header">
                      <span className="timeline-action">{log.action}</span>
                      <span className="timeline-actor">by <code>{log.actor}</code></span>
                      <span className="timeline-time">{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                    {log.previousStatus && log.newStatus && (
                      <p className="timeline-transition">
                        Transition: <strong>{log.previousStatus}</strong> → <strong>{log.newStatus}</strong>
                      </p>
                    )}
                    {log.notes && <p className="timeline-notes">&ldquo;{log.notes}&rdquo;</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-subtext">No audit logs recorded for this case yet.</p>
          )}
        </section>
      </div>
    </div>
  );
};

export default CaseDetailView;
