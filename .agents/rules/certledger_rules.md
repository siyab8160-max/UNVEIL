# CertLedger Project Rules

These rules are mandatory for all work on the CertLedger project.

1. **Source of Truth**:
   `PRD_Ethical_Sourcing_Verification_v1.1.md` in the repository root is the absolute source of truth for the project. Do not modify the PRD.
2. **Read PRD First**:
   Always read the relevant section of `PRD_Ethical_Sourcing_Verification_v1.1.md` before implementing any feature, smart contract, indexer logic, or UI flow.
3. **Canonical Units**:
   All on-chain quantities MUST be stored and computed in integer grams.
4. **No Floating-Point On-Chain**:
   Never use floating-point numbers or operations on-chain. Conversion to human-readable units (kg, metric tons, lbs) occurs strictly at the presentation/UI layer.
5. **Test-Driven Rigor**:
   Write thorough tests alongside all smart-contract code. Validate positive flows, boundary conditions, conservation rules, and expected reverts.
6. **Deployment Safety**:
   Do NOT deploy to a public testnet or mainnet without explicit user approval. Local testnets (Hardhat network) must be used for testing and validation.
7. **No Unspecified Features**:
   Do NOT invent requirements or features that are not explicitly defined in the PRD.
8. **Architectural Fidelity**:
   Do NOT silently alter or compromise architectural decisions established in the PRD (such as single-point mass-balance consumption on root lots, split/merge parent conservation rules, and consumed-lot locking).
