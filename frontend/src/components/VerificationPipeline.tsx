import React from "react";

interface VerificationPipelineProps {
  status: "VALID" | "EXPIRED" | "REVOKED" | "NOT_YET_ACTIVE" | null;
  lotID?: string;
  certificateID?: string;
  hasLineage?: boolean;
}

export const VerificationPipeline: React.FC<VerificationPipelineProps> = ({
  status,
  lotID,
  certificateID,
  hasLineage = true,
}) => {
  const getCertStatusTag = () => {
    switch (status) {
      case "VALID":
        return { label: "✓ Valid", className: "pipeline-tag-green" };
      case "EXPIRED":
        return { label: "⏳ Expired", className: "pipeline-tag-amber" };
      case "REVOKED":
        return { label: "✕ Revoked", className: "pipeline-tag-red" };
      case "NOT_YET_ACTIVE":
        return { label: "🕒 Pending", className: "pipeline-tag-blue" };
      default:
        return { label: "● Querying", className: "pipeline-tag-gray" };
    }
  };

  const certTag = getCertStatusTag();

  return (
    <section className="verification-pipeline-container" aria-label="Verification Pipeline Architecture">
      <div className="pipeline-header">
        <div>
          <h2 className="pipeline-title">VERIFICATION PIPELINE</h2>
          <p className="pipeline-subtitle">
            Distinct verification layers separating authoritative on-chain state, indexed historical projection, and public access.
          </p>
        </div>
        <div className="pipeline-badge">
          <span>USDA NOP (7 CFR §205) &amp; Mass-Balance Protocol</span>
        </div>
      </div>

      <div className="pipeline-grid">
        {/* Stage 1: Certificate — On-chain */}
        <div className="pipeline-card">
          <div className="pipeline-card-top">
            <span className="pipeline-stage-label">01. CERTIFICATE</span>
            <span className="pipeline-authority-tag authority-onchain">On-chain</span>
          </div>
          <div className="pipeline-card-status">
            <span className={`status-indicator ${certTag.className}`}>{certTag.label}</span>
          </div>
          <div className="pipeline-card-heading">Accreditation &amp; Validity</div>
          <div className="pipeline-card-detail">
            {certificateID ? `Certificate ${certificateID}` : "Direct JSON-RPC status verification"}
          </div>
        </div>

        {/* Stage 2: Lot Binding — On-chain */}
        <div className="pipeline-card">
          <div className="pipeline-card-top">
            <span className="pipeline-stage-label">02. LOT BINDING</span>
            <span className="pipeline-authority-tag authority-onchain">On-chain</span>
          </div>
          <div className="pipeline-card-status">
            <span className="status-indicator pipeline-tag-green">
              {lotID ? "✓ Bound" : "● Awaiting"}
            </span>
          </div>
          <div className="pipeline-card-heading">Consignment Match</div>
          <div className="pipeline-card-detail">
            {lotID ? `Lot ${lotID} bound on-chain` : "Authoritative ConsignmentRegistry"}
          </div>
        </div>

        {/* Stage 3: Quantity Balance — On-chain */}
        <div className="pipeline-card pipeline-card-highlight">
          <div className="pipeline-card-top">
            <span className="pipeline-stage-label">03. QUANTITY BALANCE</span>
            <span className="pipeline-authority-tag authority-onchain">On-chain</span>
          </div>
          <div className="pipeline-card-status">
            <span className="status-indicator pipeline-tag-blue">● Enforced</span>
          </div>
          <div className="pipeline-card-heading">Mass-Balance Rule</div>
          <div className="pipeline-card-detail">
            Single-point deduction: Root allocations ≤ Certified ceiling
          </div>
        </div>

        {/* Stage 4: Historical Provenance — Indexed Projection */}
        <div className="pipeline-card">
          <div className="pipeline-card-top">
            <span className="pipeline-stage-label">04. PROVENANCE</span>
            <span className="pipeline-authority-tag authority-indexed">Indexed Projection</span>
          </div>
          <div className="pipeline-card-status">
            <span className="status-indicator pipeline-tag-teal">
              {hasLineage ? "✓ Indexed Lineage" : "● Read Lineage"}
            </span>
          </div>
          <div className="pipeline-card-heading">Custody Handshakes</div>
          <div className="pipeline-card-detail">
            Historical events indexed from ConsignmentRegistry graph
          </div>
        </div>

        {/* Stage 5: QR Verification — Verification Access */}
        <div className="pipeline-card">
          <div className="pipeline-card-top">
            <span className="pipeline-stage-label">05. QR VERIFICATION</span>
            <span className="pipeline-authority-tag authority-access">Verification Access</span>
          </div>
          <div className="pipeline-card-status">
            <span className="status-indicator pipeline-tag-green">✓ Portal Live</span>
          </div>
          <div className="pipeline-card-heading">End-User Seal</div>
          <div className="pipeline-card-detail">
            Public consumer verification portal targeting immutable state
          </div>
        </div>
      </div>
    </section>
  );
};

export default VerificationPipeline;
