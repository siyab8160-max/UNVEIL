import React, { useState } from "react";
import { BrowserProvider, type Signer } from "ethers";
import { signInWithEthereum, type SiweSession } from "../../services/walletAuth";
import { parseContractError } from "../../services/errorParser";

interface WalletAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (session: SiweSession, signer: Signer, provider: BrowserProvider) => void;
}

export const WalletAuthModal: React.FC<WalletAuthModalProps> = ({
  isOpen,
  onClose,
  onAuthenticated,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      if (typeof window === "undefined" || !(window as any).ethereum) {
        throw new Error(
          "No Ethereum wallet detected. Please install or enable MetaMask / Core / Coinbase Wallet."
        );
      }

      const provider = new BrowserProvider((window as any).ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();

      const session = await signInWithEthereum(signer, provider);
      onAuthenticated(session, signer, provider);
      onClose();
    } catch (err: any) {
      const parsed = parseContractError(err);
      setErrorMessage(parsed.explanation || err.message || "Failed to sign in with Ethereum.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="siwe-modal-title">
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon">🔐</span>
            <h2 id="siwe-modal-title" className="modal-title">
              Sign-In with Ethereum (SIWE)
            </h2>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="auth-explainer-box">
            <p className="auth-explainer-lead">
              CertLedger uses standard EIP-4361 cryptographic signatures for application authentication.
            </p>
            <div className="auth-distinction-badge">
              <span className="distinction-item">
                <strong>Authentication:</strong> SIWE proves wallet ownership to the backend.
              </span>
              <span className="distinction-divider">|</span>
              <span className="distinction-item">
                <strong>Authorization:</strong> On-chain smart contracts enforce all operational permissions.
              </span>
            </div>
          </div>

          {errorMessage && (
            <div className="alert alert-error" role="alert">
              <span className="alert-icon">⚠️</span>
              <div className="alert-body">
                <span className="alert-text">{errorMessage}</span>
              </div>
            </div>
          )}

          <div className="siwe-steps-preview">
            <div className="step-item">
              <span className="step-number">1</span>
              <span className="step-label">Connect wallet & verify network (Sepolia 11155111)</span>
            </div>
            <div className="step-item">
              <span className="step-number">2</span>
              <span className="step-label">Fetch single-use anti-replay nonce from backend</span>
            </div>
            <div className="step-item">
              <span className="step-number">3</span>
              <span className="step-label">Sign EIP-4361 authentication challenge with wallet</span>
            </div>
            <div className="step-item">
              <span className="step-number">4</span>
              <span className="step-label">Server verifies signature & establishes session</span>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSignIn}
            disabled={isLoading}
          >
            {isLoading ? "Awaiting Signature..." : "Sign In with Wallet"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WalletAuthModal;
