import React from "react";
import QRCodeView from "../QRCodeView";

interface CreatedLotItem {
  lotID: string;
  quantityKg?: number;
}

interface ConsignmentSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  operationTitle: string;
  transactionHash: string;
  lots: CreatedLotItem[];
  onVerifyLot: (lotID: string) => void;
}

export const ConsignmentSuccessModal: React.FC<ConsignmentSuccessModalProps> = ({
  isOpen,
  onClose,
  operationTitle,
  transactionHash,
  lots,
  onVerifyLot,
}) => {
  if (!isOpen) return null;

  const etherscanTxUrl = `https://sepolia.etherscan.io/tx/${transactionHash}`;
  const primaryLotID = lots.length > 0 ? lots[0].lotID : "";

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="success-modal-title">
      <div className="modal-card success-modal-card">
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-icon success">✓</span>
            <h2 id="success-modal-title" className="modal-title">
              {operationTitle} Confirmed
            </h2>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="tx-meta-box">
            <div className="tx-row">
              <span className="tx-label">Transaction Hash:</span>
              <a
                href={etherscanTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="tx-hash-link"
                title="View on Sepolia Etherscan"
              >
                <code>{transactionHash.slice(0, 10)}...{transactionHash.slice(-8)}</code> ↗
              </a>
            </div>
            <p className="tx-note">
              Transaction successfully mined and permanently recorded on Ethereum Sepolia.
            </p>
          </div>

          <div className="lots-created-section">
            <h3 className="section-title">
              {lots.length > 1 ? `Created Child Consignments (${lots.length}):` : "Created Consignment Lot:"}
            </h3>

            <div className="lots-qr-grid">
              {lots.map((item) => (
                <div key={item.lotID} className="lot-qr-card">
                  <div className="lot-badge-row">
                    <span className="lot-id-badge">
                      <strong>{item.lotID}</strong>
                    </span>
                    {item.quantityKg !== undefined && (
                      <span className="lot-quantity-badge">
                        {item.quantityKg.toLocaleString()} kg
                      </span>
                    )}
                  </div>

                  {/* Reusable Phase 4 QR Component targeting /verify/<lotID> */}
                  <div className="qr-wrapper-compact">
                    <QRCodeView lotID={item.lotID} />
                  </div>

                  <button
                    type="button"
                    className="btn btn-outline btn-sm verify-btn"
                    onClick={() => {
                      onVerifyLot(item.lotID);
                      onClose();
                    }}
                  >
                    Inspect in Consumer Portal 🔍
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            Done
          </button>
          {primaryLotID && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onVerifyLot(primaryLotID);
                onClose();
              }}
            >
              Verify Lot on Blockchain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConsignmentSuccessModal;
