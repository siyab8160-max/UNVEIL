import React from "react";
import type { StandardData } from "../services/indexerApi";

interface StandardsExplainerProps {
  standard: StandardData | null;
  isBackendAvailable: boolean;
}

export const StandardsExplainer: React.FC<StandardsExplainerProps> = ({
  standard,
  isBackendAvailable,
}) => {
  if (!standard) return null;

  const formatDimensionName = (dim: string) => {
    return dim
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  return (
    <section className="standards-explainer" aria-labelledby="standards-heading">
      <div className="section-header">
        <div>
          <h2 id="standards-heading" className="section-title">
            Standard Scope & Boundaries
          </h2>
          <p className="section-subtitle">
            What this verification means according to authoritative federal regulations.
          </p>
        </div>
        {!isBackendAvailable && (
          <span className="offline-pill" title="Rendered from deterministic fallback reference data">
            Embedded Standard Spec
          </span>
        )}
      </div>

      <div className="standard-meta-card">
        <div className="standard-meta-row">
          <span className="meta-label">Standard Scheme:</span>
          <span className="meta-value standard-name">{standard.standardName}</span>
        </div>
        <div className="standard-meta-row">
          <span className="meta-label">Regulatory Citation:</span>
          <span className="meta-value citation-badge">{standard.regulatoryCitation}</span>
        </div>
        <div className="standard-meta-row">
          <span className="meta-label">Accrediting Authority:</span>
          <span className="meta-value">{standard.accreditingAuthority}</span>
        </div>
        <div className="standard-meta-row">
          <span className="meta-label">Authoritative Registry:</span>
          <a
            href={standard.authoritativeSourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="external-link"
          >
            {standard.authoritativeSource} ↗
          </a>
        </div>
      </div>

      <div className="standards-comparison-grid">
        {/* Covered Dimensions */}
        <div className="dimension-column covered-column">
          <div className="column-header">
            <span className="column-icon covered-icon">✓</span>
            <h3 className="column-title">This certification covers:</h3>
          </div>
          <ul className="dimension-list">
            {standard.coveredDimensions.map((dim) => {
              const citation = standard.coveredCitations[dim];
              return (
                <li key={dim} className="dimension-item covered-item">
                  <div className="dimension-name-row">
                    <span className="item-bullet">✓</span>
                    <strong className="item-name">{formatDimensionName(dim)}</strong>
                  </div>
                  {citation && <span className="citation-tag">{citation}</span>}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Excluded Dimensions */}
        <div className="dimension-column excluded-column">
          <div className="column-header">
            <span className="column-icon excluded-icon">✕</span>
            <h3 className="column-title">This certification does NOT guarantee:</h3>
          </div>
          <ul className="dimension-list">
            {standard.excludedDimensions.map((dim) => {
              const rationale = standard.excludedRationales[dim];
              return (
                <li key={dim} className="dimension-item excluded-item">
                  <div className="dimension-name-row">
                    <span className="item-bullet">✕</span>
                    <strong className="item-name">{formatDimensionName(dim)}</strong>
                  </div>
                  {rationale && <p className="rationale-text">{rationale}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
};

export default StandardsExplainer;
