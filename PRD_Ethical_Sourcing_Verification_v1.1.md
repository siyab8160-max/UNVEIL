# Product Requirements Document
## Ethical Sourcing Verification Platform ("CertLedger")

**Problem Statement:** PS #4 — Ethical Sourcing Verification
**Theme:** Blockchain for Social Good
**Document status:** v1.1 — incorporates Design Review changes prior to implementation

---

## 1. Background

Products claiming to be organic, fair trade, or ethically sourced rely on certificates issued far upstream in the supply chain. These certificates are static documents (PDFs, printed papers) that are:
- Rarely linked to the specific consignment/batch in front of the buyer
- Not quantity-bound, allowing over-claiming beyond what was actually certified
- Difficult for consumers or downstream buyers to verify at all

## 2. Problem Statement

Build a system that lets customers and buyers verify whether ethical/sustainability claims genuinely apply to the specific product they are purchasing, by tying certification to traceable consignments rather than to a company logo.

## 3. Goals

| Goal | Description |
|---|---|
| G1 | Give any accredited certifying body a way to issue verifiable, tamper-resistant certificates |
| G2 | Bind certificates to specific, quantity-bounded consignments, not blanket company claims |
| G3 | Prevent certified-output claims from exceeding certified-input capacity (mass balance), correctly accounting for splits/merges/transfers |
| G4 | Let anyone verify issuer accreditation and certificate validity in real time |
| G5 | Explain certification scope to consumers in plain language, grounded in structured, non-fabricated data |
| G6 | Surface certificates whose claimed volumes are statistically implausible, and route confirmed cases to enforcement |

## 4. Non-Goals (Explicit Limitations)

This system does not attempt to solve the "oracle problem" — it cannot independently verify that physical goods match what a producer enters. It also does not inherit blockchain-level tamper-resistance for off-chain statistical anomaly detection (§7.5.3); this is disclosed rather than implied.

## 5. Users

Certifying/accreditation bodies, producers/suppliers, downstream B2B buyers, consumers, auditors/regulators, and a reviewer role in the escalation pipeline (issuer first, arbitration on SLA lapse or conflict of interest).

## 6. Scope Triage

### 6.1 Build now (v1)
- Issuer Registry, seeded from real external accreditation data (§7.1), not self-registration or admin fabrication
- Certificate Registry with `holder` field
- Consignment Registry with correct single-point mass-balance consumption (§7.2) and split/merge conservation rules
- Duplicate lot/certificate ID prevention as a **hard contract constraint**, not a detection rule
- Automatic expiry (time-based, on-chain)
- Consumer verification page reading **live contract state**, four-state status: valid / expired / revoked / under review
- "Report a problem" action feeding the escalation pipeline
- Anomaly rules: mass-balance overflow (on-chain, hard-enforced), yield implausibility, stale reference (off-chain, soft)
- Manual case creation/escalation (no full workflow engine required for demo)
- 3-of-5 multisig for registry bootstrap actions
- QR code generation per consignment

### 6.2 Design for, describe in writeup, stub implementation
- `claimIssuerRecord()` self-verification flow for real issuers to take ownership of mirrored records
- Full escalation SLA automation (auto-timeout to arbitration)
- Velocity anomaly, peer-outlier detection
- Periodic on-chain hash-anchoring of off-chain anomaly report batches

### 6.3 Explicitly out of scope
- Physical verification of goods (oracle problem) — mitigated by process, not solved by the chain
- IoT sensor integration
- Payment/settlement functionality
- Full DAO/consortium governance (v1 uses multisig, disclosed as an interim trust root)

## 7. Functional Requirements

### 7.1 Issuer Registry — sourced, not fabricated
- Records are seeded by **mirroring real public accreditation data** (e.g., IAF CertSearch, or the relevant scheme-specific source once confirmed — see Open Questions) rather than invented by a platform admin.
- Schema: `address (nullable until claimed), name, accreditingBody, accreditationExpiry, attestedBy: "CertLedger", source, sourceID, verifiedOwner (nullable)`.
- `claimIssuerRecord(sourceID, proof)` — stub in v1: lets a real issuer take control of a mirrored record by proving control of a known domain/contact on file with the accreditor.
- `getIssuerStatus(address)` → active / expired / revoked.
- Registry write actions (adding a mirrored record) require **3-of-5 multisig** approval from founding accreditors/team, not a single admin key.
- **Open item:** confirm the correct public accreditation source for the actual demo standard, since IAF CertSearch covers ISO/IEC 17021-1 management-system certs, not agri-schemes like Fairtrade/USDA Organic directly.

### 7.2 Certificate Registry
- `issueCertificate(issuer, standardID, holder, certifiedQuantityGrams, validFrom, validUntil)` → `certificateID`. Caller must have `active` issuer status. Reverts if `certificateID` already exists.
- `scope` is no longer free text — it references a `standardID` in the new **Standards** table (§7.6), with optional free-text notes only.
- All quantities stored as **integer grams** (canonical unit); UI layer converts on input/display, so unit-mismatch corruption is structurally impossible.
- `revokeCertificate(certificateID, reason)` — caller must be the certificate's `issuer` or the arbitration role (only reachable via a confirmed escalation case in v1; see §7.5).
- `getCertificateStatus(certificateID)` → **live read against the contract**, not a cached value.

### 7.3 Consignment Registry — corrected mass-balance model
This is the core fix from the design review.

- **Root consignment** (`parentLotIDs = []`, the "Produced" event): the *only* point where `certifiedQuantity` is checked and consumed. Caller must be the certificate's `holder`.
- **Derived consignments** (splits, merges, transfers, processing): never touch the certificate's balance. They only touch their parent lot(s)' balance, enforcing a **conservation rule**:
  - *Split:* sum of child quantities = parent quantity consumed
  - *Merge:* sum of parent quantities = new merged quantity
  - *Processing (`processLot`):* output ≤ input (yield loss allowed, creation of volume is not); this is the only op allowed to reduce quantity
- **Consumed-parent lock:** once a lot is split, merged, or processed, its `status` flips to `consumed` — it can never be split, merged, or transferred again, preventing double-spending the same physical volume.
- Caller for any derived-consignment operation must be the parent lot's `currentOwner`.
- Reverts if the new `lotID` already exists (duplicate prevention as a hard constraint).
- `getConsignmentHistory(lotID)` walks the tree **bidirectionally** (ancestors and descendants) for a full audit trail.

### 7.4 Consumer Verification
- Input: `lotID` via QR scan or manual entry.
- **Live contract read**, not served from the indexer/cache.
- Four-state status: `valid / expired / revoked / under review`. `under review` appears only once a raw anomaly has been escalated into an open **Case** (§7.5) — not on every rule trigger, so an unverified hypothesis is never shown with the same weight as a confirmed fact.
- Plain-language explanation generated from the structured `Standards` entry (§7.6), with a raw covered/excluded-list fallback if generation fails.
- "Report a problem" button feeds the crowd-reported escalation path.

### 7.5 Anomaly Detection & Escalation Pipeline
**Raw flags → Case → Reviewer → Resolution → Enforcement**

- **Hard rule violations** (mass-balance overflow, expired-cert usage, duplicate ID) are contract-enforced and emit on-chain events (e.g. `MassBalanceAlert`) at the point of rejection — tamper-resistant by construction.
- **Soft/statistical anomalies** (yield implausibility, stale reference, and v1.1-scope velocity/peer-outlier checks) run off-chain in the indexer. Their integrity is protected **retroactively**: the engine periodically hashes each report batch and writes the hash on-chain, making after-the-fact tampering with historical anomaly records detectable (not preventing biased generation, which is disclosed as a limitation alongside the oracle problem).
- **Case escalation triggers** (either opens a case):
  1. Cumulative risk score (weighted combination of rule triggers) crosses a threshold
  2. **N** distinct user reports on the same lot/certificate arrive within a window
- **Reviewer assignment:**
  1. Certificate's issuing body reviews first, SLA (e.g. 72 hours)
  2. Auto-escalates to arbitration/regulator role if the SLA lapses, or immediately if the flag implicates the issuer itself
- Confirmed case → triggers `revokeCertificate`. This is the only enforcement path in v1 — there is no direct buyer/auditor/engine call to revoke; it must route through a confirmed case.
- Raw flags and rule triggers are visible only on the regulator/auditor dashboard, never on the consumer page, to avoid presenting a hypothesis as a fact.

### 7.6 Standards Table (new)
`standard_id, standard_name, covered_dimensions[], excluded_dimensions[]`
Example — Organic: covers `["farming_practices","processing"]`; excludes `["shipping_emissions","packaging","fair_trade","carbon_neutrality"]`.
The consumer-facing explanation is generated by an AI call constrained to these structured fields only — it may rephrase, not invent facts. Generated text is cached **per standard**, regenerated only when the standard entry changes (not per scan).

## 8. Technical Architecture

- **Smart contracts** (Solidity): `IssuerRegistry` (multisig-gated writes), `CertificateRegistry`, `ConsignmentRegistry` (with conservation + consumed-lock logic), deployed to testnet/local chain for demo.
- **Indexer/backend**: scoped strictly to anomaly detection, analytics, dashboards, and historical/aggregate queries — **not** in the path of any status the consumer sees. Short lag here is an accepted, documented limitation, not a broken promise.
- **Frontend**: Issuer/Producer dashboard (auth'd, role-restricted per §7 access table below), Consumer verification page (public, live contract reads), Regulator/Auditor dashboard (case queue, raw flags).
- **QR generation**: encodes `lotID` → consumer verification page.

### 8.1 Access Control Summary

| Function | Authorized caller |
|---|---|
| `registerIssuer` (mirror record) | 3-of-5 multisig |
| `claimIssuerRecord` | Verified real issuer (proof of control) |
| `issueCertificate` | Address with `active` issuer status |
| `revokeCertificate` | Certificate's `issuer`, or arbitration role via confirmed case |
| `createConsignment` (root) | Certificate's `holder` |
| `createConsignment` (derived) | Parent lot's `currentOwner` |

## 9. Success Metrics (for demo/judging)

- End-to-end flow: issuer record mirrored → certificate issued → root consignment created → split/transfer chain built → consumer scans QR → sees accurate, live status
- Mass-balance rule correctly rejects an over-claimed **root** consignment, and separately, conservation rule rejects a split/merge that doesn't balance
- Consumed-lot lock correctly prevents re-splitting an already-split lot
- A confirmed case correctly triggers `revokeCertificate`, and the consumer page reflects `revoked` immediately (live read, no cache lag — this claim is now actually true of the architecture)
- At least one seeded anomaly correctly opens a case and appears on the regulator dashboard, distinct from consumer-facing status

## 10. Data Model Summary (New/Changed Fields)

| Entity | Field | Purpose |
|---|---|---|
| `Certificate` | `holder` | Authorized producer for root consignment creation |
| `Certificate` | `attestedBy`, `source`, `sourceID` | Provenance of issuer accreditation data |
| `Certificate` | `verifiedOwner` (nullable) | Set once real issuer claims the mirrored record |
| `Lot` | `currentOwner` | Authorized caller for derived consignment operations |
| `Lot` | `status` (`active` / `consumed`) | Prevents re-use of split/merged lots |
| `Standard` (new table) | `standard_id, standard_name, covered_dimensions[], excluded_dimensions[]` | Structured input for AI-generated scope explanations |
| `Case` (new table) | `lotID/certID, status, assignedRole, openedAt, resolution` | Anomaly escalation and review tracking |

*(All quantity fields are integer grams; no separate unit field required.)*

## 11. Open Questions / Risks

- Correct public accreditation source for the actual demo standard (IAF CertSearch doesn't directly cover agri-schemes) — needs confirmation before seeding the Issuer Registry.
- Governance beyond v1: multisig is disclosed as an interim trust root; production would need consortium/DAO governance.
- Adoption incentive for certifying bodies to engage with `claimIssuerRecord` rather than ignore the mirrored record — out of scope technically, but worth a line in the pitch.
