import React, { useState, useEffect, useCallback } from "react";
import { BrowserProvider, type Signer } from "ethers";
import DashboardHeader from "./DashboardHeader";
import NetworkMismatchBanner from "./NetworkMismatchBanner";
import WalletAuthModal from "./WalletAuthModal";
import ConsignmentSuccessModal from "./ConsignmentSuccessModal";
import IssuerIssuanceForm from "./IssuerIssuanceForm";
import RootConsignmentForm from "./RootConsignmentForm";
import SplitLotForm from "./SplitLotForm";
import MergeLotsForm from "./MergeLotsForm";
import ProcessLotForm from "./ProcessLotForm";
import TransferLotForm from "./TransferLotForm";
import MassBalanceBar from "../MassBalanceBar";
import {
  getCachedSession,
  getNetworkInfo,
  signOut,
  type SiweSession,
} from "../../services/walletAuth";
import {
  checkOnChainIssuerStatus,
  type OnChainIssuerInfo,
} from "../../services/dashboardContractService";
import { SEPOLIA_CHAIN_ID } from "../../services/config";

export type DashboardTab = "issue" | "root" | "split" | "merge" | "process" | "transfer";

interface CreatedSuccessState {
  title: string;
  txHash: string;
  lots: { lotID: string; quantityKg?: number }[];
}

interface IssuerProducerDashboardProps {
  onNavigateToConsumerVerify: (lotID: string) => void;
}

export const IssuerProducerDashboard: React.FC<IssuerProducerDashboardProps> = ({
  onNavigateToConsumerVerify,
}) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>("issue");
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  // Wallet & Session State
  const [session, setSession] = useState<SiweSession | null>(null);
  const [, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [currentChainId, setCurrentChainId] = useState<number | null>(null);

  // On-Chain Issuer Authorization State (strictly on-chain)
  const [issuerInfo, setIssuerInfo] = useState<OnChainIssuerInfo | null>(null);
  const [isCheckingIssuer, setIsCheckingIssuer] = useState<boolean>(false);

  // Post-Consignment Success State with QR
  const [successState, setSuccessState] = useState<CreatedSuccessState | null>(null);

  // Refresh on-chain issuer role
  const refreshIssuerRole = useCallback(async (address: string) => {
    setIsCheckingIssuer(true);
    try {
      const info = await checkOnChainIssuerStatus(address);
      setIssuerInfo(info);
    } catch {
      setIssuerInfo(null);
    } finally {
      setIsCheckingIssuer(false);
    }
  }, []);

  // Initialize wallet & restore session on mount
  useEffect(() => {
    const initWallet = async () => {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        try {
          const prov = new BrowserProvider((window as any).ethereum);
          setProvider(prov);

          const net = await getNetworkInfo(prov);
          setCurrentChainId(net.chainId);

          // Listen to network change
          (window as any).ethereum.on("chainChanged", (hexChain: string) => {
            const newChainId = parseInt(hexChain, 16);
            setCurrentChainId(newChainId);
          });

          // Listen to account change
          (window as any).ethereum.on("accountsChanged", (accounts: string[]) => {
            if (accounts.length === 0) {
              handleDisconnect();
            } else {
              setConnectedAddress(accounts[0]);
              refreshIssuerRole(accounts[0]);
            }
          });

          // Check cached SIWE session
          const cached = getCachedSession();
          if (cached) {
            setSession(cached);
            setConnectedAddress(cached.address);
            try {
              const sig = await prov.getSigner();
              setSigner(sig);
              refreshIssuerRole(cached.address);
            } catch {
              // Signer not yet permitted
            }
          }
        } catch (err) {
          console.error("Wallet initialization error:", err);
        }
      }
    };

    initWallet();
  }, [refreshIssuerRole]);

  const handleAuthenticated = (
    newSession: SiweSession,
    newSigner: Signer,
    newProvider: BrowserProvider
  ) => {
    setSession(newSession);
    setSigner(newSigner);
    setProvider(newProvider);
    setConnectedAddress(newSession.address);
    setCurrentChainId(newSession.chainId);
    refreshIssuerRole(newSession.address);
  };

  const handleDisconnect = async () => {
    await signOut(session?.token);
    setSession(null);
    setSigner(null);
    setConnectedAddress(null);
    setIssuerInfo(null);
  };

  const handleRequestNetworkSwitch = async () => {
    if (typeof window !== "undefined" && (window as any).ethereum) {
      try {
        await (window as any).ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}` }],
        });
      } catch (switchError: any) {
        // Chain not added to wallet
        if (switchError.code === 4902) {
          try {
            await (window as any).ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}`,
                  chainName: "Ethereum Sepolia",
                  nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
                  rpcUrls: ["https://rpc.sepolia.org"],
                  blockExplorerUrls: ["https://sepolia.etherscan.io"],
                },
              ],
            });
          } catch {
            // User rejected
          }
        }
      }
    }
  };

  return (
    <div className="dashboard-container">
      {/* Network Guard Banner */}
      <NetworkMismatchBanner
        currentChainId={currentChainId}
        onSwitchNetwork={handleRequestNetworkSwitch}
      />

      {/* Header with Account & On-Chain Role Badges */}
      <DashboardHeader
        address={connectedAddress}
        chainId={currentChainId}
        issuerInfo={issuerInfo}
        isCheckingIssuer={isCheckingIssuer}
        onConnectWallet={() => setIsAuthModalOpen(true)}
        onDisconnect={handleDisconnect}
      />

      {/* Mass-Balance Pool Overview (Stitch Visual Pattern) */}
      <section className="dashboard-mb-section" aria-label="Certified Allocation Quota Balance">
        <MassBalanceBar
          certifiedGrams={1000000n}
          remainingGrams={250000n}
          certificateID="CERT-SEPOLIA-DEMO-001"
        />
      </section>

      {/* Operations Tab Navigation */}
      <nav className="dashboard-tabs" aria-label="Dashboard Operations">
        <button
          type="button"
          className={`tab-btn ${activeTab === "issue" ? "active" : ""}`}
          onClick={() => setActiveTab("issue")}
        >
          <span className="tab-icon">📜</span>
          <span className="tab-title">Issue Certificate</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === "root" ? "active" : ""}`}
          onClick={() => setActiveTab("root")}
        >
          <span className="tab-icon">🌱</span>
          <span className="tab-title">Create Root Lot</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === "split" ? "active" : ""}`}
          onClick={() => setActiveTab("split")}
        >
          <span className="tab-icon">✂️</span>
          <span className="tab-title">Split Lot</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === "merge" ? "active" : ""}`}
          onClick={() => setActiveTab("merge")}
        >
          <span className="tab-icon">🔗</span>
          <span className="tab-title">Merge Lots</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === "process" ? "active" : ""}`}
          onClick={() => setActiveTab("process")}
        >
          <span className="tab-icon">⚙️</span>
          <span className="tab-title">Process Lot</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === "transfer" ? "active" : ""}`}
          onClick={() => setActiveTab("transfer")}
        >
          <span className="tab-icon">🤝</span>
          <span className="tab-title">Transfer Custody</span>
        </button>
      </nav>

      {/* Active Form Display */}
      <main className="dashboard-main">
        {activeTab === "issue" && (
          <IssuerIssuanceForm
            signer={signer}
            chainId={currentChainId}
            isIssuerActive={issuerInfo?.isActive ?? false}
            onCertificateIssued={(_certID, _txHash) => {
              // Switch to Root tab to immediately create consignment
              setActiveTab("root");
            }}
          />
        )}

        {activeTab === "root" && (
          <RootConsignmentForm
            signer={signer}
            chainId={currentChainId}
            connectedAddress={connectedAddress}
            onLotCreated={(lotID, quantityKg, txHash) => {
              setSuccessState({
                title: "Root Consignment Creation",
                txHash,
                lots: [{ lotID, quantityKg }],
              });
            }}
          />
        )}

        {activeTab === "split" && (
          <SplitLotForm
            signer={signer}
            chainId={currentChainId}
            connectedAddress={connectedAddress}
            onLotsCreated={(createdLots, txHash) => {
              setSuccessState({
                title: "Lot Split Operation",
                txHash,
                lots: createdLots,
              });
            }}
          />
        )}

        {activeTab === "merge" && (
          <MergeLotsForm
            signer={signer}
            chainId={currentChainId}
            connectedAddress={connectedAddress}
            onLotCreated={(lotID, quantityKg, txHash) => {
              setSuccessState({
                title: "Lot Merge Operation",
                txHash,
                lots: [{ lotID, quantityKg }],
              });
            }}
          />
        )}

        {activeTab === "process" && (
          <ProcessLotForm
            signer={signer}
            chainId={currentChainId}
            connectedAddress={connectedAddress}
            onLotCreated={(lotID, quantityKg, txHash) => {
              setSuccessState({
                title: "Lot Processing Step",
                txHash,
                lots: [{ lotID, quantityKg }],
              });
            }}
          />
        )}

        {activeTab === "transfer" && (
          <TransferLotForm
            signer={signer}
            chainId={currentChainId}
            connectedAddress={connectedAddress}
            onLotTransferred={(_lotID, _prevOwner, _newOwner, _txHash) => {
              // Transfer confirmed
            }}
          />
        )}
      </main>

      {/* SIWE Wallet Authentication Modal */}
      <WalletAuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthenticated={handleAuthenticated}
      />

      {/* Post-Consignment QR Code Modal (Part J) */}
      {successState && (
        <ConsignmentSuccessModal
          isOpen={Boolean(successState)}
          onClose={() => setSuccessState(null)}
          operationTitle={successState.title}
          transactionHash={successState.txHash}
          lots={successState.lots}
          onVerifyLot={(lotID) => {
            setSuccessState(null);
            onNavigateToConsumerVerify(lotID);
          }}
        />
      )}
    </div>
  );
};

export default IssuerProducerDashboard;
