# Phase 7 — UNVEIL Integration Pass & Demo Script

**Project**: UNVEIL (Enterprise Ethical Sourcing Verification Platform)  
**Network**: Ethereum Sepolia Testnet (Chain ID: `11155111`)  
**Status**: COMPLETE & VERIFIED  

---

## 1. Executive Summary

The **UNVEIL project** is an end-to-end cryptographic provenance and mass-balance enforcement platform for agricultural and commodity supply chains. Phase 7 represents the complete integration pass across all system layers:

1. **Layer 1 Authoritative Blockchain**: Three deployed Solidity smart contracts on Ethereum Sepolia:
   - `IssuerRegistry` (`0x7c787f9AbDE336c8A377f8fF08527B4e3B918dFA`)
   - `CertificateRegistry` (`0x021A1289Aa4589A1a4B83C8b878a91aDD0F0C83b`)
   - `ConsignmentRegistry` (`0xC1fF045DCB2731AaFee1d398509b022Ed1F51688`)
2. **Layer 2 Off-Chain Event Indexer & Anomaly Engine**: PostgreSQL-backed event listener processing live block logs, evaluating 5 deterministic fraud screening rules, and managing human-in-the-loop auditor workflows.
3. **Layer 3 Multi-Portal Web Application**: Built with React 19, Vite, and the Stitch Enterprise design system, providing:
   - **Consumer Verification Portal**: Sub-second direct smart contract query with QR code scanner and transparent mass-balance indicators.
   - **Producer & Issuer Dashboard**: EIP-4361 SIWE authenticated issuance, split, merge, processing, and transfer operations with on-chain mass conservation.
   - **Regulator & Auditor Console**: SIWE authenticated case management, statistical anomaly review, and on-chain arbitration revocation flows.

---

## 2. Global Branding & Verification

The project name has been officially unified across the entire repository to **UNVEIL**.

### Key Preservations
- **Source of Truth**: `PRD_Ethical_Sourcing_Verification_v1.1.md` preserved intact as the inviolable specification.
- **On-Chain Bytecode Fidelity**: `string public constant ATTESTED_BY = "CertLedger";` in `CertificateRegistry.sol` and `IssuerRegistry.sol` is preserved identically to match deployed Sepolia bytecode and prevent test regressions.
- **Database Schema**: Database container and schema names are preserved to prevent data migration downtime.
- **Smart Contract Logic**: Zero contract logic, addresses, or ABIs were modified.

---

## 3. End-to-End Live Demonstration Script

The following walkthrough demonstrates the end-to-end functionality of the UNVEIL platform on Ethereum Sepolia:

### Scenario A: Consumer Verification Flow (Direct RPC Read)
1. **Navigate to Consumer Verification**:
   - Open `http://localhost:5173/verify/LOT-SEPOLIA-DEMO-001`
2. **Observe Authoritative State**:
   - Status badge displays `VALID` (green ledger indicator).
   - "Status read directly from Ethereum Sepolia" confirms direct on-chain JSON-RPC execution.
   - Verified details display: Certificate `CERT-SEPOLIA-DEMO-001`, Standard `USDA-NOP-ORGANIC`, Accredited Issuer `CCOF (USDA OID: 1000000001)`.
3. **Observe 5-Stage Verification Pipeline**:
   - `01 Certificate` — On-chain Verified
   - `02 Lot Binding` — On-chain Verified
   - `03 Quantity Balance` — On-chain Verified
   - `04 Historical Provenance` — Indexed Projection
   - `05 QR Verification` — Cryptographic Access
4. **Mass-Balance Distribution**:
   - Initial Certified: `10,000 kg`
   - Consumed into Lots: `5,000 kg` (50%)
   - Remaining Quota: `5,000 kg` (50%)

---

### Scenario B: Controlled UI-to-UI Revocation Flow (Regulator to Consumer)
1. **Navigate to Regulator Console**:
   - Open `http://localhost:5173/regulator`
2. **Authenticate with SIWE**:
   - Click "Connect Authorized Wallet" (connect authorized reviewer holding `ARBITRATION_ROLE`).
   - Sign the EIP-4361 challenge: `"Sign in to UNVEIL to access the Regulator & Auditor Dashboard."`
3. **Select Disposable Investigation Case**:
   - Open disposable revocation case for `CERT-REVOKE-DEMO-001`.
   - Transition status from `OPEN` to `UNDER_REVIEW`.
4. **Execute On-Chain Revocation**:
   - Click "Confirm Violation & Revoke Certificate".
   - Review the modal warning confirming the permanent, irreversible nature of on-chain revocation.
   - Submit MetaMask transaction invoking `CertificateRegistry.revokeCertificate("CERT-REVOKE-DEMO-001", "Severe pesticide drift contamination detected on lot audit")`.
   - Wait for transaction mining on Sepolia.
5. **Instant Consumer Verification Update**:
   - Switch to Consumer Verification tab: `http://localhost:5173/verify/LOT-REVOKE-DEMO-001`.
   - Refresh or load the lot.
   - The status immediately reads `REVOKED` in high-visibility warning crimson directly from Sepolia without requiring any database refresh or indexer polling.

---

## 4. Test Suite Summary

All 144 unit and integration tests across the UNVEIL project pass with 100% success:

| Test Layer | Test Suite | Tests | Status |
| :--- | :--- | :---: | :---: |
| **Smart Contracts** | Hardhat (`contracts/test/`) | 65 | **PASS** |
| **Indexer & Anomaly Engine** | Mocha / Supertest (`indexer/test/`) | 36 | **PASS** |
| **Frontend Applications** | Vitest / Testing Library (`frontend/src/__tests__/`) | 43 | **PASS** |
| **Total Test Coverage** | **UNVEIL Monorepo** | **144** | **100% GREEN** |

---

## 5. Deployment & Configuration Invariance

- **Ethereum Sepolia Network**: Unchanged (`11155111`)
- **Safe Multisig 3-of-5**: `0xd5D9b244439c0d54020aEb787d5F09B1f3Ff0f87` (Unchanged)
- **IssuerRegistry Address**: `0x7c787f9AbDE336c8A377f8fF08527B4e3B918dFA` (Unchanged)
- **CertificateRegistry Address**: `0x021A1289Aa4589A1a4B83C8b878a91aDD0F0C83b` (Unchanged)
- **ConsignmentRegistry Address**: `0xC1fF045DCB2731AaFee1d398509b022Ed1F51688` (Unchanged)
- **Zero Smart Contract Re-deployment Required**: Bytecode and ABI compatibility preserved 100%.
