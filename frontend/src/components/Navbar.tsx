import React from "react";
import { DEMO_LOTS } from "../services/config";

interface NavbarProps {
  onSelectLot: (lotID: string) => void;
  activeLotID: string;
  activeView?: "consumer" | "dashboard" | "regulator";
  onSelectView?: (view: "consumer" | "dashboard" | "regulator") => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onSelectLot,
  activeLotID,
  activeView = "consumer",
  onSelectView,
}) => {
  const getBreadcrumb = () => {
    switch (activeView) {
      case "dashboard":
        return "Producer & Issuer Operations";
      case "regulator":
        return "Regulator & Audit Console";
      default:
        return "Universal Claim Verification";
    }
  };

  return (
    <header className="stitch-navbar">
      {/* Brand & Mission */}
      <div className="navbar-left">
        <div className="stitch-brand">
          <div className="stitch-logo-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="brand-svg">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <div className="stitch-brand-name">UNVEIL</div>
            <div className="stitch-brand-sub">Enterprise Compliance</div>
          </div>
        </div>

        {/* Breadcrumb path */}
        <div className="stitch-breadcrumbs">
          <span className="breadcrumb-root">Enterprise Ledger</span>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current">{getBreadcrumb()}</span>
        </div>
      </div>

      {/* Center: Mass-Balance Active Badge & Demo Lot Presets */}
      <div className="navbar-center-pill">
        <span className="mb-engine-badge">
          <svg className="mb-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span>Mass-Balance Engine: Active &amp; Enforced</span>
        </span>

        {activeView === "consumer" && (
          <div className="nav-lot-chips">
            <button
              type="button"
              className={`nav-lot-chip ${activeLotID === DEMO_LOTS.SEPOLIA ? "active" : ""}`}
              onClick={() => onSelectLot(DEMO_LOTS.SEPOLIA)}
              title="Verified Sepolia Coffee Lot"
            >
              <span className="chip-dot dot-green" />
              Valid Sepolia
            </button>
            <button
              type="button"
              className={`nav-lot-chip ${activeLotID === DEMO_LOTS.SEPOLIA_REVOKED ? "active" : ""}`}
              onClick={() => onSelectLot(DEMO_LOTS.SEPOLIA_REVOKED)}
              title="Revoked Sepolia Coffee Lot"
            >
              <span className="chip-dot dot-red" />
              Revoked Sepolia
            </button>
          </div>
        )}
      </div>

      {/* Right: View Switcher & Network Status */}
      <div className="navbar-right">
        {onSelectView && (
          <div className="stitch-view-switcher" role="tablist">
            <button
              type="button"
              className={`switcher-btn ${activeView === "consumer" ? "active" : ""}`}
              onClick={() => onSelectView("consumer")}
            >
              Consumer Verify
            </button>
            <button
              type="button"
              className={`switcher-btn ${activeView === "dashboard" ? "active" : ""}`}
              onClick={() => onSelectView("dashboard")}
            >
              Issuer Portal
            </button>
            <button
              type="button"
              className={`switcher-btn ${activeView === "regulator" ? "active" : ""}`}
              onClick={() => onSelectView("regulator")}
            >
              Regulator Console
            </button>
          </div>
        )}

        {/* Network Sync Indicator */}
        <div className="stitch-network-sync">
          <span className="sync-dot-container">
            <span className="sync-dot-pulse" />
            <span className="sync-dot" />
          </span>
          <span className="sync-label">SYNCED</span>
          <span className="sync-node font-mono">Sepolia #11155111</span>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
