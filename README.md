# UNVEIL

**Blockchain-based verification for ethical sourcing claims — tying certification to traceable, quantity-bound consignments instead of a company logo.**

Built for: *Blockchain for Social Good* — PS #4: Ethical Sourcing Verification

---

## The Idea

Products claiming to be organic, fair trade, or ethically sourced rely on certificates issued far upstream in the supply chain — often at a farm, cooperative, or factory level. These certificates are static documents, disconnected from any specific batch of product, and nothing prevents a supplier from claiming more "certified" volume than they actually produced. A buyer or consumer has almost no practical way to check whether a claim printed on a label genuinely applies to the item in their hands.

CertLedger addresses this by:
- Recording certificates on-chain with a verifiable issuer, scope, and certified quantity
- Binding each certificate to specific, traceable consignments (lots) rather than an unlimited company-wide claim
- Enforcing a **mass-balance rule** in the smart contract itself — certified output can never exceed certified input, and this is checked automatically, not audited after the fact
- Letting anyone scan a QR code and see a certificate's live, real status — valid, expired, revoked, or under review — along with a plain-language explanation of what the certification does and doesn't guarantee
- Surfacing statistically implausible claims (e.g., output that exceeds plausible yield) as anomalies, routed through a review pipeline that can result in real, on-chain revocation

## The Vision

At full maturity, this is infrastructure that any accredited certifying body — Fairtrade, USDA Organic, FSC, or a smaller regional scheme — could plug into, so that "certified" becomes a claim anyone can verify in seconds rather than a claim that has to be trusted at face value. Chain-of-custody data would let a buyer trace a bag of coffee or a garment back through every processing and transfer step to its original certified batch, with confidence that the volumes at every step add up.

The end state isn't a single company's platform — it's closer to a shared, neutral registry that certifying bodies, brands, and regulators all read from and write to, the way domain name registries or public company registries work today: nobody owns "truth," but everybody can check the same record.

## What's Actually Built (Prototype Scope — Grounded)

This is a working prototype, not a production system. Here's what genuinely exists and works, deployed on a public testnet:

- **Smart contracts**: `IssuerRegistry`, `CertificateRegistry`, `ConsignmentRegistry` — with tested mass-balance logic that correctly handles root consignment creation, splits, merges, and processing, including a "consumed lot" lock that prevents the same physical volume from being double-counted
- **Real seed data**: issuer records mirrored from an actual public accreditation source (not fabricated), so the registry reflects real-world accreditation rather than invented examples
- **A consumer verification page** that reads certificate/consignment status **live, directly from the blockchain** — not from a cache — so a revocation is reflected instantly
- **An off-chain anomaly engine** that runs simple, explainable rules (mass-balance overflow, implausible yield, stale references to expired/revoked certs) and escalates confirmed issues into cases
- **A regulator dashboard** where a confirmed case triggers a real on-chain revocation, which the consumer page reflects immediately — this closed loop (detect → review → enforce → verify) is demonstrated end-to-end
- **A 3-of-5 multisig** governs registry changes, rather than a single admin key

### What This Prototype Deliberately Does Not Solve
- **The oracle problem**: the blockchain cannot independently verify that physical goods match what a producer enters. A false claim can still be entered; what the system does is make such claims **statistically visible and harder to sustain**, not impossible. This is disclosed as a structural limitation of any blockchain traceability system, not something unique to CertLedger.
- **Full accreditation delegation chains** (accreditor → regional auditor → producer) — designed for, not fully implemented
- **Automated dispute/appeal workflows** — case review is manual in this version
- **Physical sensor integration** (IoT weight/location capture) — out of scope entirely for now

## Setup

### Prerequisites
- Node.js (LTS)
- A personal Google account (for Antigravity, if using it to develop)
- A testnet wallet with funds (Polygon Amoy or Sepolia faucet)
- PostgreSQL (local or a free hosted tier, e.g., Neon/Railway)

### Repo Structure
```
certledger/
  contracts/     # Solidity contracts (Hardhat project)
  indexer/       # Node.js service: event listener + anomaly engine
  frontend/      # React app: consumer page, issuer dashboard, regulator dashboard
  docs/          # PRD and phase-by-phase build documents
```

### Install & Run
```bash
# Contracts
cd contracts
npm install
npx hardhat compile
npx hardhat test          # run the mass-balance/conservation test suite
npx hardhat run scripts/deploy.js --network amoy

# Indexer
cd ../indexer
npm install
npx prisma migrate dev
npm run start             # starts event listener + anomaly engine

# Frontend
cd ../frontend
npm install
npm run dev
```

### Seeding Demo Data
A single script populates realistic pre-demo state — mirrored issuer records, a standards table, several certificates, a chain of split/transferred consignments, and one deliberately over-claimed consignment for the anomaly engine to catch naturally:
```bash
cd contracts
npx hardhat run scripts/seed-demo.js --network amoy
```
Run this once before demoing; do not perform multi-step setup live in front of an audience (see `docs/Phase7_Integration_and_Demo_Script.md`).

### Environment Variables
Each subfolder needs its own `.env` — testnet RPC URL, deployer/multisig signer keys, database connection string. Never commit these; see `.env.example` in each folder.

## Architecture Summary

- **On-chain (source of truth for status)**: issuer accreditation, certificates, and consignments — all status reads for the consumer page go straight to the contracts, live
- **Off-chain (analytics only, never authoritative for status)**: an indexer that watches chain events and runs anomaly rules, producing review cases — deliberately kept out of the path of anything the consumer sees as "true"
- **Governance**: a 3-of-5 multisig controls registry bootstrap actions, disclosed as an interim trust root rather than a claim of full decentralization

Full technical detail lives in `docs/PRD_Ethical_Sourcing_Verification_v1.1.md`, and the phase-by-phase build guides in `docs/Phase0` through `Phase7`.

## Future Scope (Realistic, Not Aspirational)

These are concrete next steps that follow naturally from what's built, not a wish list disconnected from the current architecture:

- **Delegation chains**: let an accreditation body register regional auditors who issue certificates on its behalf, with the chain of trust verifiable back to the root accreditor
- **Dispute/appeal flow**: let a flagged issuer contest a case before revocation, rather than the current one-directional review
- **Two-party attestation on transfers**: require both sender and receiver to sign off on a lot transfer, making a single bad actor's unilateral claims harder to sustain
- **Peer-outlier and velocity anomaly detection**: statistically compare a producer's claims against similarly-sized regional peers, and flag a single lot being cited by unusually many unrelated downstream buyers
- **On-chain hash-anchoring of anomaly reports**: already stubbed in the current build — extending this to a live, scheduled job would make the off-chain anomaly engine's history tamper-evident, not just its on-chain-enforced rules
- **Consortium/DAO governance**: replacing the current 3-of-5 multisig with a broader governance model involving multiple independent certifying bodies, as the registry grows beyond a small founding group
- **Real accreditation-body onboarding**: a self-service `claimIssuerRecord` flow (currently stubbed) so a real certifying body can take ownership of its mirrored record and issue certificates directly, rather than CertLedger mirroring data on their behalf indefinitely

None of these require re-architecting what's already built — they extend the existing contracts and pipeline rather than replacing them, which is the intended shape of a v1 that's honest about its limits while still being a genuine foundation.

## Known Limitations (Stated Upfront, Not Hidden)

- Trust root is a multisig of founding team/accreditors, not a decentralized governance body — an intentional, disclosed v1 shortcut
- Off-chain anomaly rules are protected against retroactive tampering (via hash-anchoring) but not against biased generation at the time they run — a known gap in the same category as the oracle problem
- Yield/plausibility thresholds used for anomaly detection are based on published averages for the demo commodity, not a comprehensive dataset — a production version would need continuously updated, region-specific benchmarks
- Only one certification standard and a small number of real issuer records are seeded for the demo; broader multi-standard support is straightforward to add but not built out

## Team & Acknowledgments

Built as a student project for the Blockchain for Social Good hackathon track (docrud.com). This project deliberately prioritized getting the core mass-balance and revocation logic *correct and tested* over breadth of features, given limited prior blockchain experience on the team — see `docs/` for the full design review that shaped this decision.
