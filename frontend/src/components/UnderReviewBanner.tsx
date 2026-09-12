import React from "react";
import type { OpenCaseInfo } from "../services/indexerApi";

interface UnderReviewBannerProps {
  openCase: OpenCaseInfo | null;
}

export const UnderReviewBanner: React.FC<UnderReviewBannerProps> = ({ openCase }) => {
  if (!openCase) return null;

  return (
    <aside className="under-review-banner" aria-label="Investigation notice" role="alert">
      <div className="banner-header">
        <div className="banner-icon-badge">⚠️</div>
        <div className="banner-title-group">
          <h2 className="banner-title">
            UNDER REVIEW: An investigation is currently open for this lot/certificate.
          </h2>
          <p className="banner-caption">
            Off-chain regulatory review initiated by accredited certifying authority.
          </p>
        </div>
        <span className="case-status-badge">{openCase.status}</span>
      </div>

      <div className="banner-meta-grid">
        <div className="meta-item">
          <span className="meta-label">Case ID:</span>
          <code className="meta-code">{openCase.caseID}</code>
        </div>
        <div className="meta-item">
          <span className="meta-label">Investigation Scope:</span>
          <span className="meta-value">Ethical Sourcing Verification</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Investigation Opened:</span>
          <span className="meta-value">{new Date(openCase.openedAt).toLocaleDateString()}</span>
        </div>
      </div>

      <div className="banner-footer-disclaimer">
        <span className="info-icon">ℹ️</span>
        <p>
          <strong>Notice:</strong> This investigation indicator is an off-chain compliance record
          maintained by auditors in Phase 3. It does not alter or revoke the on-chain certificate
          status unless confirmed through official arbitration.
        </p>
      </div>
    </aside>
  );
};

export default UnderReviewBanner;
