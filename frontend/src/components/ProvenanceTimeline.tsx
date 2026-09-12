import React from "react";
import type { ProvenanceLineage } from "../services/indexerApi";

interface ProvenanceTimelineProps {
  currentLotID: string;
  lineage: ProvenanceLineage | null;
  isBackendAvailable: boolean;
}

export const ProvenanceTimeline: React.FC<ProvenanceTimelineProps> = ({
  currentLotID,
  lineage,
  isBackendAvailable,
}) => {
  const formatGrams = (gramsStr: string) => {
    try {
      const g = BigInt(gramsStr);
      const kg = Number(g) / 1000;
      return `${kg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
    } catch {
      return gramsStr;
    }
  };

  return (
    <section className="provenance-section" aria-labelledby="provenance-heading">
      <div className="section-header">
        <div>
          <h2 id="provenance-heading" className="section-title">
            Historical Provenance & Chain of Custody
          </h2>
          <p className="section-subtitle">
            Bidirectional graph reconstruction from on-chain transformation events.
          </p>
        </div>
        <span className="projection-pill">
          Indexed Projection (Phase 3)
        </span>
      </div>

      <div className="non-auth-disclaimer">
        <span className="disclaimer-icon">ℹ️</span>
        <p>
          <strong>Non-Authoritative Notice:</strong> This provenance timeline is an indexed projection
          provided for supply chain visibility. Authoritative verification of current consignment status
          is read directly from the smart contract above.
        </p>
      </div>

      {!isBackendAvailable ? (
        <div className="backend-unavailable-box">
          <p>
            Historical provenance graph is temporarily unavailable from the off-chain indexer.
            Blockchain certification status above remains fully verified.
          </p>
        </div>
      ) : !lineage || (lineage.ancestors.length === 0 && lineage.descendants.length === 0) ? (
        <div className="root-lot-box">
          <div className="root-icon">🌱</div>
          <div>
            <h3>Root Consignment (Origin Lot)</h3>
            <p>
              This is a certified origin lot created directly by the accredited producer. It has no
              prior parent splits or merges in the registry.
            </p>
          </div>
        </div>
      ) : (
        <div className="timeline-container">
          {/* Ancestors / Parent Lots */}
          {lineage.ancestors.length > 0 && (
            <div className="timeline-group">
              <h4 className="timeline-group-title">Parent Origin Lots</h4>
              <div className="timeline-cards">
                {lineage.ancestors.map((node, i) => (
                  <div key={i} className="timeline-card ancestor-card">
                    <div className="timeline-badge-row">
                      <span className="op-tag">{node.operationType}</span>
                      <span className="status-tag status-consumed">{node.status}</span>
                    </div>
                    <code className="lot-node-id">{node.parentLotID}</code>
                    <span className="mass-text">Initial Mass: {formatGrams(node.quantityGrams)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Current Consignment Node */}
          <div className="timeline-current-node">
            <div className="current-node-marker">
              <div className="marker-dot" />
            </div>
            <div className="current-node-card">
              <span className="current-label">Current Consignment Being Verified</span>
              <code className="current-lot-id">{currentLotID}</code>
            </div>
          </div>

          {/* Descendants / Derived Lots */}
          {lineage.descendants.length > 0 && (
            <div className="timeline-group">
              <h4 className="timeline-group-title">Derived Subsequent Lots</h4>
              <div className="timeline-cards">
                {lineage.descendants.map((node, i) => (
                  <div key={i} className="timeline-card descendant-card">
                    <div className="timeline-badge-row">
                      <span className="op-tag">{node.operationType}</span>
                      <span className={`status-tag ${node.status === "ACTIVE" ? "status-active" : "status-consumed"}`}>
                        {node.status}
                      </span>
                    </div>
                    <code className="lot-node-id">{node.childLotID}</code>
                    <span className="mass-text">Derived Mass: {formatGrams(node.quantityGrams)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default ProvenanceTimeline;
