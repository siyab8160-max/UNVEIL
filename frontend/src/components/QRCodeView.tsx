import React, { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface QRCodeViewProps {
  lotID: string;
  baseUrl?: string;
}

export const QRCodeView: React.FC<QRCodeViewProps> = ({ lotID, baseUrl }) => {
  const [copied, setCopied] = useState(false);

  // Deterministic verification URL targeting /verify/<lotID>
  const host = baseUrl || (typeof window !== "undefined" ? window.location.origin : "http://localhost:5173");
  const verificationUrl = `${host}/verify/${encodeURIComponent(lotID)}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(verificationUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleDownloadSvg = () => {
    const svgElement = document.getElementById("lot-verification-qr");
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `CertLedger-QR-${lotID}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <section id="qr-section" className="qr-card" aria-labelledby="qr-heading">
      <div className="qr-content">
        {/* Stitch Optical Frame Box */}
        <div className="optical-frame-container">
          <div className="optical-frame-border">
            <div className="qr-svg-wrapper">
              <QRCodeSVG
                id="lot-verification-qr"
                value={verificationUrl}
                size={160}
                level="H"
                includeMargin={true}
                bgColor="#ffffff"
                fgColor="#172033"
              />
              <div className="scan-ready-overlay">
                <span className="scan-ready-badge">SCAN READY</span>
              </div>
            </div>
          </div>
          <span className="optical-frame-caption">Physical Packaging QR Verification Seal</span>
        </div>

        <div className="qr-meta">
          <span className="stitch-sub-eyebrow text-blue font-semibold">SCAN • VERIFY • TRUST</span>
          <h3 id="qr-heading" className="qr-title">Consumer Verification QR</h3>
          <p className="qr-desc">
            Direct cryptographic proof link encoded for physical packaging and consumer mobile scanning.
          </p>

          <div className="qr-url-box">
            <span className="url-label">Encoded Verification Endpoint:</span>
            <code className="url-code" data-testid="qr-encoded-url">{verificationUrl}</code>
          </div>

          <div className="qr-buttons">
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopyLink}>
              {copied ? "✓ Copied to Clipboard" : "📋 Copy Verification Link"}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={handleDownloadSvg}>
              ⬇ Download Packaging SVG
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default QRCodeView;
