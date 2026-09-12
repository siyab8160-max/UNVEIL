import React from "react";
import type { BlockchainVerificationResult } from "../services/contractVerification";

interface VerificationCardProps {
  result: BlockchainVerificationResult | null;
  isLoading: boolean;
  onOpenReport: () => void;
  onScrollToQR: () => void;
}

export const VerificationCard: React.FC<VerificationCardProps> = ({
  result,
  isLoading,
  onOpenReport,
  onScrollToQR,
}) => {
  if (isLoading) {
    return (
      <section className="verification-card loading-card" aria-busy="true">
        <div className="skeleton skeleton-badge" />
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-grid" />
      </section>
    );
  }

  if (!result) {
    return null;
  }

  // 1. Blockchain RPC / Network Failure State
  // CRITICAL: An RPC failure is NEVER converted to EXPIRED or REVOKED
  if (!result.isAvailable) {
    return (
      <section className="verification-card error-card" role="alert">
        <div className="status-badge-container">
          <div className="status-badge badge-unavailable">
            <span className="badge-icon">⚡</span>
            <span>Verification Unavailable</span>
          </div>
        </div>
        <h2 className="error-title">Unable to read the blockchain right now.</h2>
        <p className="error-desc">
          {result.error ||
            "Could not connect to verified Ethereum Sepolia RPC nodes. Please check your network connection or try again shortly."}
        </p>
        <div className="rpc-notice-pill">
          <span>Target Network: Ethereum Sepolia (Chain ID 11155111)</span>
        </div>
      </section>
    );
  }

  // 1b. Lot / Record Not Found State (Blockchain connected, but requested lot was not found on-chain)
  if (result.error && (!result.lot || !result.certificate)) {
    return (
      <section className="verification-card error-card" role="alert">
        <div className="status-badge-container">
          <div className="status-badge badge-unavailable">
            <span className="badge-icon">🔍</span>
            <span>Consignment Not Found</span>
          </div>
        </div>
        <h2 className="error-title">Record Not Found on Blockchain</h2>
        <p className="error-desc">{result.error}</p>
        <div className="rpc-notice-pill">
          <span>Target Network: Ethereum Sepolia (Chain ID 11155111) — Verified Connected</span>
        </div>
      </section>
    );
  }

  const { status, lot, certificate } = result;

  // Helper formatting canonical grams to kilograms
  const formatGramsToKg = (grams: bigint) => {
    const kg = Number(grams) / 1000;
    return `${kg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg (${grams.toString()} g)`;
  };

  const getStatusBadge = () => {
    switch (status) {
      case "VALID":
        return (
          <div className="status-badge badge-valid">
            <span className="badge-icon">✓</span>
            <span>Certificate status: VALID</span>
          </div>
        );
      case "EXPIRED":
        return (
          <div className="status-badge badge-expired">
            <span className="badge-icon">⏳</span>
            <span>Certificate status: EXPIRED</span>
          </div>
        );
      case "REVOKED":
        return (
          <div className="status-badge badge-revoked">
            <span className="badge-icon">✕</span>
            <span>Certificate status: REVOKED</span>
          </div>
        );
      case "NOT_YET_ACTIVE":
        return (
          <div className="status-badge badge-pending">
            <span className="badge-icon">🕒</span>
            <span>Certificate status: NOT YET ACTIVE</span>
          </div>
        );
      default:
        return null;
    }
  };

  const getStatusHeadline = () => {
    switch (status) {
      case "VALID":
        return {
          tag: "AUTHENTICITY CONFIRMED",
          title: "Certified Organic Arabica Coffee",
          subtitle: `Verified Lot: ${lot?.lotID} • USDA National Organic Program (7 CFR Part 205)`,
          explanation:
            "This product lot is linked to an active, accredited organic certification on the Ethereum Sepolia blockchain. UNVEIL's mass-balance engine mathematically enforces that the claimed physical volume cannot exceed the certified harvest allocation.",
        };
      case "EXPIRED":
        return {
          tag: "TEMPORAL HORIZON LAPSED",
          title: "Organic Arabica Coffee (Expired Certificate)",
          subtitle: `Lot: ${lot?.lotID} • Validity window expired on ${certificate?.validUntil.toLocaleDateString()}`,
          explanation:
            "The organic certificate associated with this lot has reached its expiration timestamp on-chain. While harvest origin is preserved, active ethical sourcing certification must be renewed by the accredited certifier.",
        };
      case "REVOKED":
        return {
          tag: "CRITICAL VIOLATION • REVOKED",
          title: "Certificate Revoked — Claim Blocked",
          subtitle: `Lot: ${lot?.lotID} • Revoked by Authorized Certifier / Arbitration Authority`,
          explanation:
            "This certificate was explicitly revoked on-chain via CertificateRegistry.revokeCertificate(). The blockchain state marks this certification as permanently invalid. Downstream ethical claims for this consignment are strictly prohibited.",
        };
      case "NOT_YET_ACTIVE":
        return {
          tag: "PENDING ACTIVATION",
          title: "Organic Coffee Batch",
          subtitle: `Lot: ${lot?.lotID} • Awaiting validity window`,
          explanation:
            "This certificate has been registered on-chain but has not yet reached its validFrom temporal boundary.",
        };
      default:
        return {
          tag: "STATUS UNVERIFIED",
          title: "Certificate Status Unverified",
          subtitle: `Lot: ${lot?.lotID}`,
          explanation:
            "The certificate status returned by the blockchain does not match a known state.",
        };
    }
  };

  const headline = getStatusHeadline();

  return (
    <article className="verification-card success-card" aria-label="Authoritative Verification Result">
      {/* Top Status Header */}
      <div className="card-top-bar">
        <div className="status-badge-container">{getStatusBadge()}</div>
        <div className="on-chain-verified-pill">
          <span className="chain-pulse" />
          <span>Live Blockchain Truth (Sepolia)</span>
        </div>
      </div>

      {/* Main Authenticity Title Header */}
      <div className="stitch-hero-header">
        <div className="stitch-hero-info">
          <span className={`stitch-tag ${status === "VALID" ? "text-green" : status === "REVOKED" ? "text-red" : "text-amber"}`}>
            {headline.tag}
          </span>
          <h2 className="lot-id-heading">{headline.title}</h2>
          <p className="cert-id-subheading">
            Lot ID: <strong>{lot?.lotID}</strong> | Parent Cert: <strong>{certificate?.certificateID}</strong> ({certificate?.standardID})
          </p>
        </div>
        <div className="stitch-hero-badge">
          <span className="factual-proof-badge">Status read directly from Ethereum Sepolia</span>
        </div>
      </div>

      {/* Four Concise Trust Indicators */}
      <div className="trust-indicators-grid">
        <div className="trust-indicator-box">
          <div className="trust-indicator-title text-green">✓ Certified Source</div>
          <div className="trust-indicator-sub" title={certificate?.holder}>
            {certificate?.holder ? `${certificate.holder.slice(0, 8)}...${certificate.holder.slice(-6)}` : "Verified Holder"}
          </div>
          <div className="trust-indicator-caption">Producer / Farm Root</div>
        </div>

        <div className="trust-indicator-box">
          <div className="trust-indicator-title text-green">✓ Accredited Issuer</div>
          <div className="trust-indicator-sub" title={certificate?.issuer}>
            {certificate?.sourceID || (certificate?.issuer ? `${certificate.issuer.slice(0, 8)}...${certificate.issuer.slice(-6)}` : "USDA Certifier")}
          </div>
          <div className="trust-indicator-caption">Holds ISSUER_ROLE</div>
        </div>

        <div className="trust-indicator-box">
          <div className="trust-indicator-title text-green">✓ Quantity Verified</div>
          <div className="trust-indicator-sub">
            {certificate ? `${(Number(certificate.certifiedQuantityGrams) / 1000).toLocaleString()} kg Pool` : "Mass Balance"}
          </div>
          <div className="trust-indicator-caption">On-chain Quota Enforced</div>
        </div>

        {/* User Correction #3: Label explicitly as historical provenance indexed */}
        <div className="trust-indicator-box">
          <div className="trust-indicator-title text-green">✓ Traceable Path</div>
          <div className="trust-indicator-sub">Historical provenance indexed</div>
          <div className="trust-indicator-caption">Custody Lineage Graph</div>
        </div>
      </div>

      {/* Quantitative Proof Box */}
      <div className="quantitative-proof-box">
        <div className="proof-col">
          <span className="proof-col-label">CONSIGNMENT MASS (CANONICAL)</span>
          <span className="proof-col-value highlight-value">
            {lot ? formatGramsToKg(lot.quantityGrams) : "N/A"}
          </span>
        </div>
        <div className="proof-col">
          <span className="proof-col-label">REMAINING CERTIFIED QUOTA</span>
          <span className="proof-col-value font-mono">
            {certificate ? formatGramsToKg(certificate.remainingQuantityGrams) : "N/A"}
          </span>
        </div>
        <div className="proof-col">
          <span className="proof-col-label">CONSIGNMENT STATUS</span>
          <span className="proof-col-value">
            <span className={`lot-status-pill ${lot?.status === "ACTIVE" ? "lot-active" : "lot-consumed"}`}>
              {lot?.status}
            </span>
          </span>
        </div>
      </div>

      {/* Technical Detail Grid */}
      <div className="details-grid">
        <div className="detail-card">
          <span className="detail-label">Validity Window</span>
          <span className="detail-value">
            {certificate?.validFrom.toLocaleDateString()} — {certificate?.validUntil.toLocaleDateString()}
          </span>
          <span className="detail-subtext">Temporal boundary evaluated dynamically on-chain</span>
        </div>

        <div className="detail-card">
          <span className="detail-label">Authorized Producer / Holder</span>
          <span className="detail-value address-value" title={certificate?.holder}>
            {certificate?.holder}
          </span>
          <span className="detail-subtext">Custodial root creator on Ethereum Sepolia</span>
        </div>

        <div className="detail-card">
          <span className="detail-label">Certifier / Issuer Address</span>
          <span className="detail-value address-value" title={certificate?.issuer}>
            {certificate?.issuer}
          </span>
          <span className="detail-subtext">Accredited certifier holding ISSUER_ROLE</span>
        </div>

        <div className="detail-card">
          <span className="detail-label">Accreditation Database</span>
          <span className="detail-value">
            {certificate?.source || "USDA INTEGRITY Database"}
          </span>
          <span className="detail-subtext">Attested Standard: {certificate?.standardID}</span>
        </div>
      </div>

      {/* "What does this mean for you?" Plain Language Guarantee */}
      <div className="plain-language-box">
        <h4 className="plain-language-title">
          <span className="info-icon">ℹ️</span> What does this mean for you?
        </h4>
        <p className="plain-language-body">
          &ldquo;{headline.explanation}&rdquo;
        </p>
      </div>

      {/* Cryptographic Enterprise Ledger Record */}
      <div className="crypto-ledger-record">
        <div className="crypto-record-header">
          <span className="crypto-record-title">CRYPTOGRAPHIC ENTERPRISE LEDGER RECORD</span>
          <span className="crypto-record-badge">✓ IMMUTABLE STATE</span>
        </div>
        <div className="crypto-record-grid">
          <div className="crypto-item">
            <span className="crypto-label">CERTIFICATE ID</span>
            <span className="crypto-value font-mono break-all">{certificate?.certificateID || "N/A"}</span>
          </div>
          <div className="crypto-item">
            <span className="crypto-label">TARGET NETWORK</span>
            <span className="crypto-value font-mono">Ethereum Sepolia (11155111)</span>
          </div>
          <div className="crypto-item">
            <span className="crypto-label">CONSENSUS ARCHITECTURE</span>
            <span className="crypto-value font-mono">Proof of Stake (EIP-3675)</span>
          </div>
          <div className="crypto-item">
            <span className="crypto-label">AUTHORITATIVE SOURCE</span>
            <span className="crypto-value font-mono text-green">Direct Smart Contract RPC</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="card-actions">
        <button type="button" className="btn btn-secondary" onClick={onScrollToQR}>
          <span className="btn-icon">📱</span> View / Print QR Code
        </button>
        <button type="button" className="btn btn-outline" onClick={onOpenReport}>
          <span className="btn-icon">🚩</span> Report a Problem
        </button>
      </div>
    </article>
  );
};

export default VerificationCard;
