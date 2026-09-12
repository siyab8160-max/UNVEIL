import React from "react";
import type { OnChainIssuerInfo } from "../../services/dashboardContractService";
import { SEPOLIA_CHAIN_ID } from "../../services/config";

interface DashboardHeaderProps {
  address: string | null;
  chainId: number | null;
  issuerInfo: OnChainIssuerInfo | null;
  isCheckingIssuer: boolean;
  onConnectWallet: () => void;
  onDisconnect: () => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  address,
  chainId,
  issuerInfo,
  isCheckingIssuer,
  onConnectWallet,
  onDisconnect,
}) => {
  const isSepolia = chainId === SEPOLIA_CHAIN_ID;
  const truncatedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  return (
    <header className="dashboard-header">
      <div className="dashboard-header-main">
        <div className="dashboard-title-wrapper">
          <h1 className="dashboard-heading">Producer & Issuer Portal</h1>
          <p className="dashboard-subheading">
            Authoritative lifecycle operations for ethical sourcing consignments and accredited certificates.
          </p>
        </div>

        <div className="dashboard-wallet-controls">
          {address ? (
            <div className="connected-wallet-card">
              <div className="wallet-meta-row">
                <span className="wallet-label">Connected Wallet:</span>
                <span className="wallet-address-pill" title={address}>
                  <span className="status-dot green"></span>
                  <code>{truncatedAddress}</code>
                </span>

                <span
                  className={`network-badge ${isSepolia ? "badge-sepolia" : "badge-mismatch"}`}
                >
                  {isSepolia ? "Sepolia (11155111)" : `Chain ${chainId}`}
                </span>

                <button
                  type="button"
                  onClick={onDisconnect}
                  className="btn btn-sm btn-ghost disconnect-btn"
                  title="Disconnect and log out"
                >
                  Disconnect
                </button>
              </div>

              {/* On-Chain Authorization Status */}
              <div className="onchain-roles-row">
                <span className="roles-title">On-Chain Roles:</span>

                {isCheckingIssuer ? (
                  <span className="role-chip checking">Checking IssuerRegistry...</span>
                ) : issuerInfo?.isActive ? (
                  <span className="role-chip issuer-active" title={`Accredited certifier: ${issuerInfo.name || issuerInfo.sourceID || "Mirrored certifier"}`}>
                    <span className="role-icon">✓</span> Accredited Issuer ({issuerInfo.sourceID || "Active"})
                  </span>
                ) : (
                  <span className="role-chip issuer-inactive" title="Not registered or inactive in IssuerRegistry. Certificate issuance disabled.">
                    <span className="role-icon">✕</span> Issuer: Inactive (Issuance Locked)
                  </span>
                )}

                <span className="role-chip producer-active">
                  <span className="role-icon">📦</span> Producer / Custodian
                </span>
              </div>
            </div>
          ) : (
            <div className="unauthenticated-prompt">
              <span className="unauth-notice">Wallet connection & SIWE authentication required to submit on-chain transactions.</span>
              <button
                type="button"
                onClick={onConnectWallet}
                className="btn btn-primary btn-connect"
              >
                Sign In with Ethereum
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
