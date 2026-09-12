# UNVEIL — Enterprise Ethical Sourcing Verification Platform

[![Ethereum Sepolia](https://img.shields.io/badge/Network-Ethereum%20Sepolia%20(11155111)-3c3c3d?logo=ethereum)](https://sepolia.etherscan.io/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity)](https://soliditylang.org/)
[![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-5.2.0-4E5EE4?logo=openzeppelin)](https://openzeppelin.com/)
[![React](https://img.shields.io/badge/Frontend-React%2019%20%2B%20Vite-61DAFB?logo=react)](https://react.dev/)
[![Prisma](https://img.shields.io/badge/ORM-Prisma%205.22-2D3748?logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%2016-336791?logo=postgresql)](https://www.postgresql.org/)
[![Tests](https://img.shields.io/badge/Tests-144%2F144%20Passing-18794E?logo=checkmarx)](https://github.com/)

> **Cryptographically enforced ethical sourcing, mass-balance conservation, and transparent provenance for agricultural supply chains on Ethereum.**

---

## Table of Contents

1. [Executive Summary & The Main Idea](#1-executive-summary--the-main-idea)
2. [Data Authority Boundaries & Architecture](#2-data-authority-boundaries--architecture)
3. [Deployed Smart Contracts (Ethereum Sepolia)](#3-deployed-smart-contracts-ethereum-sepolia)
4. [Phase-by-Phase Implementation Journey](#4-phase-by-phase-implementation-journey)
   - [Phase 0: Environment & Foundation](#phase-0-environment--foundation)
   - [Phase 1: Core Smart Contracts](#phase-1-core-smart-contracts)
   - [Phase 2: Sepolia Deployment, Safe Multisig & Etherscan Verification](#phase-2-sepolia-deployment-safe-multisig--etherscan-verification)
   - [Phase 3: Event Indexer, Analytics & Anomaly Detection Engine](#phase-3-event-indexer-analytics--anomaly-detection-engine)
   - [Phase 4: Public Consumer Verification Portal](#phase-4-public-consumer-verification-portal)
   - [Phase 5: Authenticated Producer & Issuer Dashboard](#phase-5-authenticated-producer--issuer-dashboard)
   - [Phase 6: Authenticated Regulator & Auditor Console](#phase-6-authenticated-regulator--auditor-console)
   - [Phase 7: End-to-End Integration & Demo Script](#phase-7-end-to-end-integration--demo-script)
5. [The 5 Anomaly Detection Rules & Screening Benchmarks](#5-the-5-anomaly-detection-rules--screening-benchmarks)
6. [Complete Local Setup & Running Guide](#6-complete-local-setup--running-guide)
7. [Comprehensive Test Suite (144 / 144 Passing)](#7-comprehensive-test-suite-144--144-passing)
8. [Repository Directory Structure](#8-repository-directory-structure)
9. [Future Scope & Known Limitations](#9-future-scope--known-limitations)
10. [Regulatory Disclaimers & Legal Notice](#10-regulatory-disclaimers--legal-notice)
11. [Team & Acknowledgments](#11-team--acknowledgments)

---

## 1. Executive Summary & The Main Idea

### The Problem: "Certified at Harvest, Diluted by Delivery"
Global agricultural supply chains (organic coffee, fair-trade cacao, certified cotton) suffer from systemic structural integrity failures:
1. **Mass-Balance Dilution & Overselling**: Accredited farms harvest 10,000 kg of certified produce, but downstream aggregators and traders sell 50,000 kg under the same certificate through opaque paper transactions.
2. **Double-Counting & Re-Spends**: Physical consignments are split, blended, or processed across intermediaries without cryptographic mass conservation, enabling fraudulent volume multiplication.
3. **Delayed Paper Audits**: Audits occur annually in arrears. Revocations or standard violations take months to reach retailers and consumers, by which time tainted goods are already consumed.
4. **Consumer Disillusionment**: QR codes on packaging typically redirect to static marketing PDFs rather than verifiable, tamper-proof blockchain proofs.

### The Solution: UNVEIL
**UNVEIL** is an end-to-end supply chain verification platform built on **Ethereum Sepolia**. It replaces retroactive trust with proactive cryptographic enforcement:

* **Single-Point Mass-Balance Consumption**: Certified capacity can be deducted **only once** upon the creation of the root harvest lot (`parentLotIDs = []`). All subsequent operations (splits, merges, roasting, packaging) strictly conserve physical mass and cannot touch certificate capacity.
* **Irreversible Consumed-Lot Locking**: Once a consignment lot is split, merged, or processed, its on-chain status permanently transitions to `Consumed`, preventing double-spending of physical mass.
* **Separation of Authoritative Truth vs. Off-Chain Analytics**: Blockchain smart contracts are the sole arbiter of certificate validity, remaining quotas, and legal ownership. PostgreSQL and the event indexer project historical lineage, screen for anomalies, and manage auditor review workflows without corrupting blockchain truth.
* **Real USDA Database Mirroring**: Certified certifiers (CCOF, Oregon Tilth, MayaCert) are mirrored from the USDA Organic INTEGRITY Database (OID) under the authority of a 3-of-5 Gnosis Safe multisig trust root.
* **Sub-Second Public Verification**: Consumers scan physical QR codes to query live Sepolia smart contracts directly, rendering authoritative status (`VALID`, `EXPIRED`, `REVOKED`) with complete mass-balance proofs.
* **Human-in-the-Loop Revocation Loop**: Off-chain anomaly rules flag statistical irregularities to human auditors via SIWE-authenticated workflows, allowing authorized bodies to revoke compromised certificates on-chain in real-time.

---

## 2. Data Authority Boundaries & Architecture

UNVEIL strictly adheres to the architectural boundaries defined in **PRD v1.1 §8.1**:

```mermaid
graph TD
    subgraph "Layer 1: Authoritative Blockchain (Ethereum Sepolia)"
        IR[IssuerRegistry.sol<br/>Trust Root: Safe 3-of-5]
        CR[CertificateRegistry.sol<br/>Certified Capacity & Status]
        CO[ConsignmentRegistry.sol<br/>Physical Lots & Mass Conservation]
        IR -->|Validates Issuer| CR
        CR -->|CONSIGNMENT_REGISTRY_ROLE| CO
    end

    subgraph "Layer 2: Off-Chain Indexer & Anomaly Engine (Prisma/Postgres)"
        EV[Ethers.js Event Listener]
        DB[(PostgreSQL 16 Database)]
        AN[5 Anomaly Detection Rules]
        CS[Auditor Review Cases]
        EV -->|Ingests Blocks| DB
        DB -->|Evaluates Lineage| AN
        AN -->|Generates Alerts| CS
    end

    subgraph "Layer 3: User Presentation & Workflows"
        UI_C[Consumer Verification Portal<br/>Direct Sepolia RPC Read]
        UI_P[Producer & Issuer Dashboard<br/>SIWE Authenticated Actions]
        UI_R[Regulator Console<br/>SIWE Case Triage & Revocation]
    end

    CO -.->|Direct RPC Call| UI_C
    CR -.->|Direct RPC Call| UI_C
    UI_P -->|State Transactions| CO
    UI_P -->|State Transactions| CR
    CS -->|Workflow UI| UI_R
    UI_R -->|On-Chain Revocation Tx| CR
```

### Golden Authority Matrix

| Data Domain | Authoritative Primary Source | Presentation / Projection Role |
| :--- | :--- | :--- |
| **Accredited Issuers** | `IssuerRegistry.sol` on Sepolia | PostgreSQL indexed cache |
| **Certificate Capacity & Status** | `CertificateRegistry.sol` on Sepolia | PostgreSQL indexed cache |
| **Consignment Quantities & Ownership** | `ConsignmentRegistry.sol` on Sepolia | PostgreSQL indexed cache |
| **Parent/Child Provenance Graph** | `ConsignmentRegistry.sol` (`getConsignmentHistory`) | PostgreSQL recursive lineage projection |
| **Statistical Anomaly Scores** | Off-Chain Anomaly Engine | Internal auditor dashboard ONLY (zero consumer leakage) |
| **Auditor Review Workflows & Cases** | PostgreSQL `Case` & `CaseAuditLog` tables | Internal regulator console ONLY |

---

## 3. Deployed Smart Contracts (Ethereum Sepolia)

All contracts are fully compiled with Solidity `0.8.24` (Paris EVM), deployed to Ethereum Sepolia, wired with required roles, and verified on Etherscan:

| Contract | Sepolia Address | Etherscan Link | Primary Purpose |
| :--- | :--- | :--- | :--- |
| **IssuerRegistry** | `0x7c787f9AbDE336c8A377f8fF08527B4e3B918dFA` | [View on Etherscan](https://sepolia.etherscan.io/address/0x7c787f9AbDE336c8A377f8fF08527B4e3B918dFA#code) | Authoritative registry of accredited certifying bodies; 3-of-5 Safe multisig trust root. |
| **CertificateRegistry** | `0x021A1289Aa4589A1a4B83C8b878a91aDD0F0C83b` | [View on Etherscan](https://sepolia.etherscan.io/address/0x021A1289Aa4589A1a4B83C8b878a91aDD0F0C83b#code) | Authoritative single source of truth for certified quotas (grams), validity, and revocation. |
| **ConsignmentRegistry** | `0xC1fF045DCB2731AaFee1d398509b022Ed1F51688` | [View on Etherscan](https://sepolia.etherscan.io/address/0xC1fF045DCB2731AaFee1d398509b022Ed1F51688#code) | Physical lots, single-point quota deduction, split/merge conservation, and consumed-lot locks. |
| **Gnosis Safe 3-of-5** | `0xd5D9b244439c0d54020aEb787d5F09B1f3Ff0f87` | [View on Etherscan](https://sepolia.etherscan.io/address/0xd5D9b244439c0d54020aEb787d5F09B1f3Ff0f87) | Interim multisig governance threshold for registering accredited certifiers. |

### Live Demonstrator Records on Sepolia
* **Primary Valid Demo Lot**: `LOT-SEPOLIA-DEMO-001` (Active, 5,000 kg Arabica, CCOF certified)
* **Primary Valid Demo Certificate**: `CERT-SEPOLIA-DEMO-001` (Valid, 10,000 kg initial, 5,000 kg remaining)
* **Dedicated Revocation Lot**: `LOT-REVOKE-DEMO-001` (Used for controlled live revocation demo)
* **Dedicated Revocation Certificate**: `CERT-REVOKE-DEMO-001` (Revoked on Sepolia: Tx `0xbf85e50dbb008d5aa262be641c2c3666b6c0864319fb73d56f4e666993bb2dd0`)

---

## 4. Phase-by-Phase Implementation Journey

### Phase 0: Environment & Foundation
* Monorepo architecture initialized: `contracts/`, `indexer/`, and `frontend/`.
* Established canonical unit rules: **All on-chain quantities strictly stored in integer grams** ($1\text{ kg} = 1,000\text{ g}$; $1\text{ MT} = 1,000,000\text{ g}$). No floating-point operations on-chain.
* Tooling configured: Hardhat, TypeScript, Prisma ORM, React 19, and Vitest.
* Secrets Hygiene: Verified `.env` ignoring across all submodules.

### Phase 1: Core Smart Contracts
* Developed `IssuerRegistry.sol`, `CertificateRegistry.sol`, and `ConsignmentRegistry.sol`.
* Enforced bidirectional lineage graph traversal (`getAncestors`, `getDescendants`) within bounded recursion limits.
* Built the **Double-Counting Regression Test**: Validated that an initial 10,000 g capacity consumed to 6,000 g strictly maintained its 4,000 g remaining balance across subsequent Split $\to$ Custody Transfer $\to$ Roasting Process $\to$ Merge operations.
* 65 Hardhat unit tests passing.

### Phase 2: Sepolia Deployment, Safe Multisig & Etherscan Verification
* Formally audited contract bytecode, storage layouts, and role bindings (`PHASE_2_PREDEPLOYMENT_AUDIT.md`).
* Deployed all 3 contracts to Sepolia, initialized trust roots, and verified source code on Sepolia Etherscan.
* Created the Gnosis Safe 3-of-5 multisig trust root and queued the initial USDA certifier registrations on the Safe Transaction Service.

### Phase 3: Event Indexer, Analytics & Anomaly Detection Engine
* Developed real-time event listener ingesting `CertificateIssued`, `RootConsignmentCreated`, `LotSplit`, `LotMerged`, `LotProcessed`, `LotTransferred`, `CertificateRevoked`, and `MassBalanceAlert`.
* Implemented the Prisma PostgreSQL schema (12 relational models).
* Implemented 5 deterministic anomaly detection rules.
* Built the consumer problem reporting deduplication pipeline using canonical keccak256 dedupe keys and periodic batch hash integrity anchoring.
* 36 integration tests passing.

### Phase 4: Public Consumer Verification Portal
* Built the public consumer verification web interface at `/verify/:lotID`.
* Implemented the **5-Stage Verification Pipeline** distinguishing cryptographic on-chain checks from indexed projections:
  * `01 Certificate — On-chain`
  * `02 Lot Binding — On-chain`
  * `03 Quantity Balance — On-chain`
  * `04 Historical Provenance — Indexed Projection`
  * `05 QR Verification — Verification Access`
* Embedded the **Mass-Balance Bar** displaying Certified Ceiling, Allocated Downstream, and Unallocated Reserve.
* Added the **Deterministic Standards Explainer**: Displays 7 CFR Part 205 covered farming practices alongside statutory excluded dimensions (labor, pricing, carbon neutrality) without relying on generative AI.
* Reusable QR component generating optical scan frames encoding `/verify/:lotID`.

### Phase 5: Authenticated Producer & Issuer Dashboard
* Implemented the **SIWE (Sign-In with Ethereum, EIP-4361)** authentication pipeline with server-side nonce generation and single-use consumption.
* Built state-changing management forms for:
  * Certificate Issuance (8 on-chain parameters)
  * Root Consignment Creation (single-point quota deduction)
  * Consignment Splitting (mass-conserving child generation)
  * Consignment Merging (single-certificate origin enforcement)
  * Consignment Processing (yield loss calculation, zero expansion)
  * Legal Custody Transfer
* Built the **Solidity Custom Error Parser** in `errorParser.ts`: Decodes custom error selectors (`0x6ca8d60f` `LotNotFound`, `0x4f2ad22a` `CertificateNotFound`, `SplitConservationViolation`, `YieldExpansionNotAllowed`, `InsufficientCertifiedQuantity`, `LotAlreadyConsumed`, `CertificateMismatch`) into plain-language actionable feedback.

### Phase 6: Authenticated Regulator & Auditor Console
* Built the regulatory triage console at `/regulator`.
* Implemented strict SIWE security boundaries protecting raw regulator reads (`GET /api/cases`, `GET /api/anomalies`, `POST /api/cases/:id/resolve` return `401 Unauthorized` without a valid token).
* Enforced the case transition state machine: `OPEN` $\to$ `UNDER_REVIEW` $\to$ `REVOCATION_PENDING` $\to$ `RESOLVED` (or `DISMISSED`).
* Conducted the live UI-to-UI Sepolia demonstration: Proved an auditor confirming a case submits an on-chain transaction to `CertificateRegistry.revokeCertificate()`, and the consumer verification portal immediately displays `REVOKED` without waiting for indexer polling.

### Phase 7: End-to-End Integration & Demo Script
* Formatted the complete integration walkthrough and demo scripts in `PHASE_7_STATUS.md`.
* Global repository branding pass: unified all components under the **UNVEIL** name.
* Preserved bytecode constants and database models while ensuring all UI headers, banners, and documentation are aligned.

---

## 5. The 5 Anomaly Detection Rules & Screening Benchmarks

The off-chain indexer evaluates 5 deterministic rules against indexed events:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                               UNVEIL RULE ENGINE MATRIX                                     │
├──────────────────────────────┬──────────┬────────────┬──────────────────────────────────────┤
│ Rule Identifier              │ Severity │ Risk Score │ Trigger Condition                    │
├──────────────────────────────┼──────────┼────────────┼──────────────────────────────────────┤
│ RULE_MASS_BALANCE_OVERFLOW   │ CRITICAL │     90     │ On-chain MassBalanceAlert event      │
│ RULE_YIELD_IMPLAUSIBILITY    │ HIGH     │     75     │ Root lot yield > 2,500 kg/ha         │
│ RULE_STALE_CERT_REFERENCE    │ HIGH     │     80     │ Lot links to Expired/Revoked cert    │
│ RULE_MASS_EXPANSION_ATTEMPT  │ CRITICAL │     95     │ Output mass > Input mass             │
│ RULE_SPLIT_SUM_MISMATCH      │ HIGH     │     85     │ Child sum != Parent mass             │
└──────────────────────────────┴──────────┴────────────┴──────────────────────────────────────┘
```

### Analytical Screening Benchmark: Organic Coffee Yields
* **Commodity**: Certified Organic Green Coffee (*Coffea arabica*).
* **Reference Sources**: USDA Foreign Agricultural Service (FAS) GAIN Coffee Annual Reports & International Coffee Organization (ICO) Historical Production Statistics.
* **Agronomic Baseline**: Smallholder shade-grown organic coffee agroforestry systems typically yield between $500\text{--}1,200\text{ kg/ha}$. Optimal intensive organic management peaks at approximately $1,500\text{--}2,000\text{ kg/ha}$.
* **Screening Threshold**: **$2,500\text{ kg/ha}$** ($2,500,000\text{ g/ha}$).
* **Statutory Disclaimer**: *This threshold is strictly an analytical anomaly screening benchmark. It is NOT a regulatory maximum under USDA 7 CFR Part 205, nor a biological impossibility. Yield flags indicate a statistical deviation warranting auditor review of farm production logs.*

---

## 6. Complete Local Setup & Running Guide

### Prerequisites
* **Node.js**: v18.x or v20.x (`node --version`)
* **npm**: v9.x or v10.x (`npm --version`)
* **Docker & Docker Compose**: For local PostgreSQL database
* **Git**: Version control

---

### Step 1: Clone Repository
```bash
git clone https://github.com/siyab8160-max/UNVEIL.git
cd UNVEIL
```

---

### Step 2: Environment Configuration

Create `.env` files in each of the three workspaces:

#### 1. Contracts Environment (`contracts/.env`)
```bash
SEPOLIA_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
DEPLOYER_PRIVATE_KEY="0x0000000000000000000000000000000000000000000000000000000000000000"
ETHERSCAN_API_KEY="your_etherscan_api_key"
```

#### 2. Indexer Environment (`indexer/.env`)
```bash
PORT=4000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/certledger?schema=public"
SEPOLIA_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
ISSUER_REGISTRY_ADDRESS="0x7c787f9AbDE336c8A377f8fF08527B4e3B918dFA"
CERTIFICATE_REGISTRY_ADDRESS="0x021A1289Aa4589A1a4B83C8b878a91aDD0F0C83b"
CONSIGNMENT_REGISTRY_ADDRESS="0xC1fF045DCB2731AaFee1d398509b022Ed1F51688"
JWT_SECRET="unveil_super_secret_jwt_key_sepolia_2026"
```

#### 3. Frontend Environment (`frontend/.env`)
```bash
VITE_INDEXER_API_URL="http://localhost:4000"
```

---

### Step 3: Start PostgreSQL Database
```bash
# Start Dockerized PostgreSQL 16 Alpine
docker compose up -d

# Verify container health
docker compose ps
```

---

### Step 4: Setup & Start Indexer / Backend API
```bash
cd indexer

# Install dependencies
npm install

# Run database migrations
npx prisma migrate dev

# Seed USDA Standards into PostgreSQL
npm run seed:standards

# Start Indexer Server (Daemon on port 4000)
npm start
```

---

### Step 5: Setup & Start Frontend Web Application
```bash
cd ../frontend

# Install dependencies
npm install

# Start Vite Development Server (Port 5173)
npm run dev
```

The application is now accessible at `http://localhost:5173`.

---

## 7. Comprehensive Test Suite (144 / 144 Passing)

All 144 unit, integration, and end-to-end tests across the monorepo pass cleanly:

```bash
# 1. Run Smart Contract Test Suite (Hardhat)
cd contracts && npx hardhat test

# 2. Run Indexer & Anomaly Test Suite (Mocha)
cd ../indexer && npm test

# 3. Run Frontend UI & Verification Suite (Vitest)
cd ../frontend && npm test
```

### Complete Test Results Matrix

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               UNVEIL COMPREHENSIVE TEST SUITE                                    │
├──────────────────────────┬────────────────────────────────────────────┬───────┬──────────────────┤
│ Module                   │ Test File                                  │ Count │ Duration / Status│
├──────────────────────────┼────────────────────────────────────────────┼───────┼──────────────────┤
│ Smart Contracts          │ contracts/test/IssuerRegistry.test.ts      │   12  │ PASS             │
│ Smart Contracts          │ contracts/test/CertificateRegistry.test.ts │   14  │ PASS             │
│ Smart Contracts          │ contracts/test/ConsignmentRegistry.test.ts │   22  │ PASS             │
│ Smart Contracts          │ contracts/test/DoubleCountingRegression... │   10  │ PASS             │
│ Smart Contracts          │ contracts/test/ConsignmentProvenance...    │    3  │ PASS             │
│ Smart Contracts          │ contracts/test/SafeMultisigSeeding...      │    3  │ PASS             │
│ Smart Contracts          │ contracts/test/Sample.test.ts              │    1  │ PASS (Total 65)  │
├──────────────────────────┼────────────────────────────────────────────┼───────┼──────────────────┤
│ Indexer & Backend API    │ indexer/test/indexer.test.ts               │   18  │ PASS             │
│ Indexer & Backend API    │ indexer/test/auth.test.ts                  │    6  │ PASS             │
│ Indexer & Backend API    │ indexer/test/regulator-api.test.ts         │   12  │ PASS (Total 36)  │
├──────────────────────────┼────────────────────────────────────────────┼───────┼──────────────────┤
│ Frontend UI & Portals    │ frontend/src/__tests__/verification.test.ts│   14  │ PASS             │
│ Frontend UI & Portals    │ frontend/src/__tests__/dashboard.test.tsx  │   13  │ PASS             │
│ Frontend UI & Portals    │ frontend/src/__tests__/regulator.test.tsx  │   16  │ PASS (Total 43)  │
├──────────────────────────┴────────────────────────────────────────────┴───────┴──────────────────┤
│ TOTAL AUTOMATED TESTS PASSING ACROSS MONOREPO:                        144 / 144 TESTS (100%)    │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Repository Directory Structure

```
UNVEIL/
├── contracts/                        # Core Solidity Smart Contracts & Hardhat Suite
│   ├── contracts/
│   │   ├── interfaces/              # Formal interfaces (IIssuerRegistry, ICertificateRegistry, etc.)
│   │   ├── IssuerRegistry.sol       # Safe 3-of-5 trust root, mirrored certifier registry
│   │   ├── CertificateRegistry.sol  # Single source of truth for certified quota & status
│   │   └── ConsignmentRegistry.sol  # Traceable lots, mass-balance deduction, consumed lock
│   ├── scripts/                     # Deployment, role wiring & Sepolia verification scripts
│   └── test/                        # 65 automated Hardhat tests
│
├── indexer/                          # Off-Chain Event Indexer, Anomaly Engine & REST API
│   ├── prisma/
│   │   └── schema.prisma            # 12 relational models for PostgreSQL projection
│   ├── src/
│   │   ├── rules/                   # 5 deterministic anomaly detection rules
│   │   ├── routes/                  # Express API routes (auth, certificates, lots, cases, reports)
│   │   ├── services/                # Blockchain listener, anchoring & deduplication services
│   │   └── seed-standards.ts        # Ingests 7 CFR Part 205 legal references into PostgreSQL
│   └── test/                        # 36 automated integration and authorization tests
│
├── frontend/                         # Modern React 19 + Vite Enterprise Web Portal
│   ├── src/
│   │   ├── components/
│   │   │   ├── dashboard/           # Producer/Issuer operations (issue, split, merge, process, transfer)
│   │   │   ├── regulator/           # Regulator console (anomaly feed, case detail, revocation)
│   │   │   ├── Navbar.tsx           # Enterprise header, Sepolia node sync, view switcher
│   │   │   ├── VerificationCard.tsx # Authoritative status card, trust indicators, ledger record
│   │   │   ├── VerificationPipeline.tsx # 5-Stage verification authority pipeline
│   │   │   ├── MassBalanceBar.tsx   # 3-tier quantitative mass-balance allocation visualization
│   │   │   ├── StandardsExplainer.tsx # Deterministic covered vs. excluded legal dimensions
│   │   │   ├── ProvenanceTimeline.tsx # Historical custody lineage graph projection
│   │   │   ├── QRCodeView.tsx       # Reusable optical scan frame QR code generator
│   │   │   └── ReportModal.tsx      # Consumer problem reporting modal
│   │   ├── services/
│   │   │   ├── config.ts            # Sepolia RPCs, contract addresses, demo lot presets
│   │   │   ├── contractVerification.ts # Authoritative on-chain JSON-RPC pipeline
│   │   │   ├── errorParser.ts       # Solidity custom error decoder
│   │   │   └── indexerApi.ts        # Supplementary backend client & SIWE manager
│   │   ├── __tests__/               # 43 Vitest & Testing Library tests
│   │   ├── App.tsx                  # Root application router and layout
│   │   └── index.css                # Stitch enterprise design system (Graphite, Stone, Ledger Green)
│   └── vite.config.ts               # Vite configuration
│
├── docker-compose.yml                # Production-grade PostgreSQL 16 Alpine container
├── PHASE_7_STATUS.md                 # Phase 7 integration walkthrough & demo scripts
├── PRD_Ethical_Sourcing_Verification_v1.1.md # Absolute architectural source of truth
└── README.md                         # This unified documentation
```

---

## 9. Future Scope & Known Limitations

### Future Scope (Realistic, Not Aspirational)
These concrete next steps follow directly from the existing architecture:
- **Delegation chains**: Enable an accreditation body to register regional auditors who issue certificates on its behalf, with the chain of trust verifiable back to the root accreditor.
- **Dispute/appeal flow**: Allow a flagged issuer or producer to contest a case and provide counter-evidence before revocation.
- **Two-party attestation on transfers**: Require both sender and receiver to cryptographically co-sign lot custody transfers.
- **Peer-outlier and velocity anomaly detection**: Statistically compare a producer's harvest volumes against regional peers of similar acreage, and flag lots cited by disproportionate downstream entities.
- **On-chain batch anchoring**: Promote the consumer report keccak256 batch anchoring service into a periodic autonomous smart contract transaction.
- **Consortium/DAO governance**: Expand the interim 3-of-5 Safe multisig into broader multi-stakeholder DAO governance.
- **Real accreditation-body onboarding**: Complete the self-service `claimIssuerRecord` flow so certifying bodies can claim their mirrored records directly, rather than UNVEIL mirroring data on their behalf.

### Known Limitations (Stated Upfront, Not Hidden)
- **The Oracle Problem**: The blockchain cannot independently inspect physical coffee beans. False initial entries remain possible; UNVEIL's contribution is making volumetric discrepancies mathematically detectable and permanently auditable.
- **Interim Trust Root**: Registration of mirrored certifiers is gated by a 3-of-5 Gnosis Safe multisig rather than an autonomous decentralized oracle.
- **Analytical Thresholds**: Yield screening benchmarks are heuristic analytical baselines based on USDA FAS data, not biological impossibilities.
- **Demonstrator Scope**: Seeding focuses on USDA NOP Organic coffee to ensure deep end-to-end rigor rather than shallow multi-commodity breadth.

---

## 10. Regulatory Disclaimers & Legal Notice

1. **USDA National Organic Program (NOP)**:
   This software mirrors public data from the USDA Organic INTEGRITY Database under 7 CFR Part 205. The developers of UNVEIL are not affiliated with, endorsed by, or acting on behalf of the United States Department of Agriculture.
2. **Statutory Exclusions**:
   Per Organic Foods Production Act (OFPA) statutes (7 U.S.C. 6501 et seq.), USDA Organic certification covers farming practices, synthetic substance exclusions, and organic handling. It does **not** certify fair wages, labor conditions, minimum farmgate pricing, carbon neutrality, or transport packaging standards. UNVEIL explicitly discloses these statutory exclusions on every consumer verification page.
3. **Screening Benchmarks**:
   Yield benchmarks (e.g. $2,500\text{ kg/ha}$) are analytical heuristics derived from USDA FAS GAIN reports and the International Coffee Organization. They are used exclusively for internal anomaly screening and do not represent formal regulatory findings.
4. **On-Chain Immutability**:
   Smart contracts deployed to Ethereum Sepolia operate autonomously. While arbitration roles allow authorized certifiers to revoke compromised certificates, historical event logs and mined transaction hashes are permanently immutable on the public blockchain.

---

## 11. Team & Acknowledgments

Built as a project for the Blockchain for Social Good hackathon track ([docrud.com](https://docrud.com)). This project deliberately prioritized getting the core mass-balance and revocation logic *cryptographically correct and exhaustively tested* over superficial breadth of features.

*UNVEIL — Engineered with mathematical rigor for radical supply chain transparency.*
