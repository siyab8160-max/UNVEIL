import React, { useState, useEffect, useCallback } from "react";
import Navbar from "./components/Navbar";
import VerificationCard from "./components/VerificationCard";
import UnderReviewBanner from "./components/UnderReviewBanner";
import StandardsExplainer from "./components/StandardsExplainer";
import ProvenanceTimeline from "./components/ProvenanceTimeline";
import QRCodeView from "./components/QRCodeView";
import ReportModal from "./components/ReportModal";
import IssuerProducerDashboard from "./components/dashboard/IssuerProducerDashboard";
import RegulatorDashboard from "./components/regulator/RegulatorDashboard";
import VerificationPipeline from "./components/VerificationPipeline";
import {
  verifyOnChain,
  type BlockchainVerificationResult,
} from "./services/contractVerification";
import {
  fetchSupplementaryData,
  type SupplementaryDataResult,
} from "./services/indexerApi";
import { DEMO_LOTS, CONTRACT_ADDRESSES } from "./services/config";

export function App() {
  const [currentView, setCurrentView] = useState<"consumer" | "dashboard" | "regulator">("consumer");
  const [lotInput, setLotInput] = useState<string>(DEMO_LOTS.VALID);
  const [activeLotID, setActiveLotID] = useState<string>(DEMO_LOTS.VALID);

  const [blockchainResult, setBlockchainResult] = useState<BlockchainVerificationResult | null>(null);
  const [supplementaryResult, setSupplementaryResult] = useState<SupplementaryDataResult | null>(null);

  const [isBlockchainLoading, setIsBlockchainLoading] = useState<boolean>(true);
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);

  // Independent verification handler
  const runVerification = useCallback(async (lotID: string) => {
    const trimmed = lotID.trim();
    if (!trimmed) return;

    setActiveLotID(trimmed);
    setLotInput(trimmed);
    setIsBlockchainLoading(true);

    // 1. Authoritative Blockchain Verification Path
    // lotID -> ConsignmentRegistry -> certificateID -> CertificateRegistry.getCertificateStatus()
    const bcResult = await verifyOnChain(trimmed);
    setBlockchainResult(bcResult);
    setIsBlockchainLoading(false);

    // 2. Independent Supplementary Backend Path (Standards, Provenance, Open Cases)
    // CRITICAL: Backend failure MUST NOT block blockchain verification!
    const certID = bcResult.lot?.certificateID;
    const suppResult = await fetchSupplementaryData(trimmed, certID);
    setSupplementaryResult(suppResult);
  }, []);

  // Handle URL path / query param on mount (/verify/:lotID, /dashboard, /regulator or ?lotId=...)
  useEffect(() => {
    let initialLot = DEMO_LOTS.VALID;
    if (typeof window !== "undefined") {
      if (window.location.pathname.startsWith("/dashboard")) {
        setCurrentView("dashboard");
      } else if (window.location.pathname.startsWith("/regulator")) {
        setCurrentView("regulator");
      }

      const pathParts = window.location.pathname.split("/verify/");
      if (pathParts.length > 1 && pathParts[1]) {
        initialLot = decodeURIComponent(pathParts[1].replace(/\/$/, ""));
        setCurrentView("consumer");
      } else {
        const searchParams = new URLSearchParams(window.location.search);
        const queryLot = searchParams.get("lotId");
        if (queryLot) initialLot = queryLot;
        const queryView = searchParams.get("view");
        if (queryView === "dashboard") setCurrentView("dashboard");
        if (queryView === "regulator") setCurrentView("regulator");
      }
    }
    runVerification(initialLot);
  }, [runVerification]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (lotInput.trim()) {
      runVerification(lotInput.trim());
    }
  };

  const handleScrollToQR = () => {
    const element = document.getElementById("qr-section");
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleNavigateFromDashboard = (lotID: string) => {
    setCurrentView("consumer");
    runVerification(lotID);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="app-container">
      <Navbar
        onSelectLot={runVerification}
        activeLotID={activeLotID}
        activeView={currentView}
        onSelectView={setCurrentView}
      />

      {currentView === "dashboard" ? (
        <IssuerProducerDashboard
          onNavigateToConsumerVerify={handleNavigateFromDashboard}
        />
      ) : currentView === "regulator" ? (
        <RegulatorDashboard
          onNavigateToConsumerVerify={handleNavigateFromDashboard}
        />
      ) : (
        <main className="main-content">
          {/* Search Header */}
          <section className="search-section" aria-label="Consignment Lookup">
            <div className="search-wrapper">
              <h1 className="main-heading">Verify Agricultural Sourcing</h1>
              <p className="main-subheading">
                Cryptographically verified organic coffee provenance on the Ethereum Sepolia blockchain.
              </p>

              <form onSubmit={handleSearchSubmit} className="search-form">
                <div className="search-input-group">
                  <span className="search-icon">🔍</span>
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Enter Lot ID (e.g. LOT-SEPOLIA-DEMO-001)..."
                    value={lotInput}
                    onChange={(e) => setLotInput(e.target.value)}
                    aria-label="Enter Lot ID"
                  />
                  <button type="submit" className="btn btn-primary search-btn">
                    Verify Live
                  </button>
                </div>
              </form>

              <div className="quick-queries">
                <span className="quick-query-label">Quick Queries:</span>
                <button type="button" className="quick-query-btn" onClick={() => runVerification(DEMO_LOTS.SEPOLIA)}>
                  {DEMO_LOTS.SEPOLIA} (Valid)
                </button>
                <button type="button" className="quick-query-btn" onClick={() => runVerification(DEMO_LOTS.SEPOLIA_REVOKED)}>
                  {DEMO_LOTS.SEPOLIA_REVOKED} (Revoked)
                </button>
                <button type="button" className="quick-query-btn" onClick={() => runVerification(DEMO_LOTS.EXPIRED)}>
                  {DEMO_LOTS.EXPIRED} (Expired)
                </button>
              </div>
            </div>
          </section>

          {/* 0. Distinct Verification Pipeline Flow */}
          <VerificationPipeline
            status={blockchainResult?.status || null}
            lotID={blockchainResult?.lot?.lotID}
            certificateID={blockchainResult?.lot?.certificateID}
            hasLineage={!!supplementaryResult?.lineage}
          />

          {/* 1. Off-Chain Investigation Notice (Separate from certificate status) */}
          {supplementaryResult?.openCase && (
            <UnderReviewBanner openCase={supplementaryResult.openCase} />
          )}

          {/* 2. Authoritative On-Chain Verification Card */}
          <VerificationCard
            result={blockchainResult}
            isLoading={isBlockchainLoading}
            onOpenReport={() => setIsReportModalOpen(true)}
            onScrollToQR={handleScrollToQR}
          />

          {/* 3. Deterministic Standards Explanation (Covered vs Excluded Dimensions) */}
          <StandardsExplainer
            standard={supplementaryResult?.standard || null}
            isBackendAvailable={supplementaryResult?.isAvailable ?? true}
          />

          {/* 4. Historical Provenance Graph (Indexed Projection) */}
          <ProvenanceTimeline
            currentLotID={activeLotID}
            lineage={supplementaryResult?.lineage || null}
            isBackendAvailable={supplementaryResult?.isAvailable ?? true}
          />

          {/* 5. Reusable QR Code Component */}
          <QRCodeView lotID={activeLotID} />
        </main>
      )}

      {/* Consumer Problem Reporting Modal */}
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        lotID={activeLotID}
        certificateID={blockchainResult?.lot?.certificateID}
      />

      {/* Footer with Contract Registry Disclaimers */}
      <footer className="app-footer">
        <div className="footer-content">
          <p className="footer-text">
            <strong>CertLedger Protocol:</strong> Consumer verification evaluates live state directly against
            deployed smart contracts on Ethereum Sepolia.
          </p>
          <div className="contract-links">
            <span className="contract-tag">
              ConsignmentRegistry: <code>{CONTRACT_ADDRESSES.CONSIGNMENT_REGISTRY.slice(0, 8)}...</code>
            </span>
            <span className="contract-tag">
              CertificateRegistry: <code>{CONTRACT_ADDRESSES.CERTIFICATE_REGISTRY.slice(0, 8)}...</code>
            </span>
            <span className="contract-tag">
              IssuerRegistry: <code>{CONTRACT_ADDRESSES.ISSUER_REGISTRY.slice(0, 8)}...</code>
            </span>
          </div>
          <p className="footer-copyright">
            Canonical units: Integer grams on-chain. USDA National Organic Program 7 CFR Part 205 Reference.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
