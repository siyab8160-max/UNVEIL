import React from "react";
import { SEPOLIA_CHAIN_ID } from "../../services/config";

interface NetworkMismatchBannerProps {
  currentChainId: number | null;
  onSwitchNetwork?: () => void;
}

export const NetworkMismatchBanner: React.FC<NetworkMismatchBannerProps> = ({
  currentChainId,
  onSwitchNetwork,
}) => {
  if (currentChainId === null || currentChainId === SEPOLIA_CHAIN_ID) {
    return null;
  }

  return (
    <aside
      className="network-mismatch-banner"
      role="alert"
      aria-label="Network Mismatch Alert"
    >
      <div className="banner-content">
        <span className="banner-icon" aria-hidden="true">⚠️</span>
        <div className="banner-text">
          <strong className="banner-title">
            Network Mismatch Detected (Chain ID: {currentChainId})
          </strong>
          <p className="banner-description">
            CertLedger operations require the <strong>Ethereum Sepolia</strong> testnet (Chain ID:{" "}
            <code>{SEPOLIA_CHAIN_ID}</code>). State-changing transactions are blocked while connected to an unsupported network.
          </p>
        </div>
      </div>
      {onSwitchNetwork && (
        <button
          type="button"
          onClick={onSwitchNetwork}
          className="btn btn-warning-outline btn-sm"
        >
          Request Network Switch
        </button>
      )}
    </aside>
  );
};

export default NetworkMismatchBanner;
