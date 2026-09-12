import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { IssuerRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("IssuerRegistry Contract", function () {
  let admin: SignerWithAddress;
  let multisigSafe: SignerWithAddress; // Represents 3-of-5 Gnosis Safe address
  let unauthorizedUser: SignerWithAddress;
  let certifyingBodyA: SignerWithAddress;
  let certifyingBodyB: SignerWithAddress;
  let issuerRegistry: IssuerRegistry;

  const MULTISIG_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MULTISIG_ROLE"));

  beforeEach(async function () {
    [admin, multisigSafe, unauthorizedUser, certifyingBodyA, certifyingBodyB] =
      await ethers.getSigners();

    const IssuerRegistryFactory = await ethers.getContractFactory("IssuerRegistry");
    issuerRegistry = await IssuerRegistryFactory.deploy(admin.address, multisigSafe.address);
    await issuerRegistry.waitForDeployment();
  });

  describe("Access Control & Role Initialization", function () {
    it("Should assign MULTISIG_ROLE to the designated multisig address", async function () {
      expect(await issuerRegistry.hasRole(MULTISIG_ROLE, multisigSafe.address)).to.be.true;
      expect(await issuerRegistry.hasRole(MULTISIG_ROLE, unauthorizedUser.address)).to.be.false;
    });

    it("Should reject issuer registration from unauthorized account", async function () {
      const now = await time.latest();
      const expiry = now + 365 * 24 * 3600;

      await expect(
        issuerRegistry
          .connect(unauthorizedUser)
          .registerIssuer(
            "IAF-001",
            certifyingBodyA.address,
            "Ecocert International",
            "IAF Accreditation Board",
            expiry,
            "IAF CertSearch"
          )
      ).to.be.revertedWithCustomError(issuerRegistry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Issuer Registration & Data Model (§7.1)", function () {
    it("Should allow multisig to register an issuer with all v1.1 provenance fields", async function () {
      const now = await time.latest();
      const expiry = now + 365 * 24 * 3600;

      await expect(
        issuerRegistry
          .connect(multisigSafe)
          .registerIssuer(
            "IAF-001",
            certifyingBodyA.address,
            "Ecocert International",
            "IAF Accreditation Board",
            expiry,
            "IAF CertSearch"
          )
      )
        .to.emit(issuerRegistry, "IssuerRegistered")
        .withArgs(
          "IAF-001",
          certifyingBodyA.address,
          "Ecocert International",
          "IAF Accreditation Board",
          expiry
        );

      const record = await issuerRegistry.getIssuerBySourceID("IAF-001");
      expect(record.sourceID).to.equal("IAF-001");
      expect(record.issuerAddress).to.equal(certifyingBodyA.address);
      expect(record.name).to.equal("Ecocert International");
      expect(record.accreditingBody).to.equal("IAF Accreditation Board");
      expect(record.accreditationExpiry).to.equal(expiry);
      expect(record.attestedBy).to.equal("CertLedger");
      expect(record.source).to.equal("IAF CertSearch");
      expect(record.verifiedOwner).to.equal(ethers.ZeroAddress);
      expect(record.isRevoked).to.be.false;
      expect(record.exists).to.be.true;
    });

    it("Should reject duplicate sourceID", async function () {
      const now = await time.latest();
      const expiry = now + 365 * 24 * 3600;

      await issuerRegistry
        .connect(multisigSafe)
        .registerIssuer(
          "IAF-001",
          certifyingBodyA.address,
          "Ecocert",
          "IAF",
          expiry,
          "IAF CertSearch"
        );

      await expect(
        issuerRegistry
          .connect(multisigSafe)
          .registerIssuer(
            "IAF-001",
            certifyingBodyB.address,
            "Other Certifier",
            "IAF",
            expiry,
            "IAF CertSearch"
          )
      ).to.be.revertedWithCustomError(issuerRegistry, "IssuerAlreadyExists");
    });

    it("Should reject address collision if address already mapped to another sourceID", async function () {
      const now = await time.latest();
      const expiry = now + 365 * 24 * 3600;

      await issuerRegistry
        .connect(multisigSafe)
        .registerIssuer(
          "IAF-001",
          certifyingBodyA.address,
          "Ecocert",
          "IAF",
          expiry,
          "IAF CertSearch"
        );

      await expect(
        issuerRegistry
          .connect(multisigSafe)
          .registerIssuer(
            "IAF-002",
            certifyingBodyA.address,
            "Ecocert Clone",
            "IAF",
            expiry,
            "IAF CertSearch"
          )
      ).to.be.revertedWithCustomError(issuerRegistry, "IssuerAddressAlreadyRegistered");
    });

    it("Should reject expired timestamp on registration", async function () {
      const now = await time.latest();
      const pastExpiry = now - 100;

      await expect(
        issuerRegistry
          .connect(multisigSafe)
          .registerIssuer(
            "IAF-PAST",
            certifyingBodyA.address,
            "Past Org",
            "IAF",
            pastExpiry,
            "IAF CertSearch"
          )
      ).to.be.revertedWithCustomError(issuerRegistry, "InvalidAccreditationExpiry");
    });
  });

  describe("Dynamic Status Determination", function () {
    it("Should report Inactive for unregistered addresses", async function () {
      expect(await issuerRegistry.getIssuerStatus(unauthorizedUser.address)).to.equal(0); // Inactive
      expect(await issuerRegistry.isIssuerActive(unauthorizedUser.address)).to.be.false;
    });

    it("Should report Active for valid accredited issuer", async function () {
      const now = await time.latest();
      const expiry = now + 1000;

      await issuerRegistry
        .connect(multisigSafe)
        .registerIssuer(
          "IAF-001",
          certifyingBodyA.address,
          "Ecocert",
          "IAF",
          expiry,
          "IAF CertSearch"
        );

      expect(await issuerRegistry.getIssuerStatus(certifyingBodyA.address)).to.equal(1); // Active
      expect(await issuerRegistry.isIssuerActive(certifyingBodyA.address)).to.be.true;
    });

    it("Should report Expired once accreditationExpiry timestamp has passed", async function () {
      const now = await time.latest();
      const expiry = now + 500;

      await issuerRegistry
        .connect(multisigSafe)
        .registerIssuer(
          "IAF-EXP",
          certifyingBodyA.address,
          "Expiring Org",
          "IAF",
          expiry,
          "IAF CertSearch"
        );

      expect(await issuerRegistry.getIssuerStatus(certifyingBodyA.address)).to.equal(1); // Active

      await time.increaseTo(expiry + 1);

      expect(await issuerRegistry.getIssuerStatus(certifyingBodyA.address)).to.equal(2); // Expired
      expect(await issuerRegistry.isIssuerActive(certifyingBodyA.address)).to.be.false;
    });
  });

  describe("Issuer Revocation", function () {
    it("Should allow multisig to revoke an issuer and transition status to Revoked", async function () {
      const now = await time.latest();
      const expiry = now + 10000;

      await issuerRegistry
        .connect(multisigSafe)
        .registerIssuer(
          "IAF-REV",
          certifyingBodyA.address,
          "Revokable Org",
          "IAF",
          expiry,
          "IAF CertSearch"
        );

      await expect(
        issuerRegistry
          .connect(multisigSafe)
          .revokeIssuer("IAF-REV", "Loss of accreditation credentials")
      )
        .to.emit(issuerRegistry, "IssuerRevoked")
        .withArgs("IAF-REV", certifyingBodyA.address, "Loss of accreditation credentials", multisigSafe.address);

      expect(await issuerRegistry.getIssuerStatus(certifyingBodyA.address)).to.equal(3); // Revoked
      expect(await issuerRegistry.isIssuerActive(certifyingBodyA.address)).to.be.false;
    });

    it("Should reject revocation from unauthorized caller", async function () {
      const now = await time.latest();
      const expiry = now + 10000;

      await issuerRegistry
        .connect(multisigSafe)
        .registerIssuer(
          "IAF-REV2",
          certifyingBodyA.address,
          "Org",
          "IAF",
          expiry,
          "IAF CertSearch"
        );

      await expect(
        issuerRegistry
          .connect(unauthorizedUser)
          .revokeIssuer("IAF-REV2", "Unauthorized attempt")
      ).to.be.revertedWithCustomError(issuerRegistry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Claim Issuer Record Stub (§7.1)", function () {
    it("Should allow real issuer to claim mirrored record with address(0)", async function () {
      const now = await time.latest();
      const expiry = now + 10000;

      // Register mirrored record without initial wallet address
      await issuerRegistry
        .connect(multisigSafe)
        .registerIssuer(
          "IAF-UNCLAIMED",
          ethers.ZeroAddress,
          "Fairtrade International",
          "IAF",
          expiry,
          "IAF CertSearch"
        );

      const proof = ethers.toUtf8Bytes("DNS_TXT_PROOF_VALID");
      await expect(
        issuerRegistry.connect(certifyingBodyA).claimIssuerRecord("IAF-UNCLAIMED", proof)
      )
        .to.emit(issuerRegistry, "IssuerRecordClaimed")
        .withArgs("IAF-UNCLAIMED", ethers.ZeroAddress, certifyingBodyA.address);

      const updated = await issuerRegistry.getIssuerBySourceID("IAF-UNCLAIMED");
      expect(updated.issuerAddress).to.equal(certifyingBodyA.address);
      expect(updated.verifiedOwner).to.equal(certifyingBodyA.address);
      expect(await issuerRegistry.isIssuerActive(certifyingBodyA.address)).to.be.true;
    });
  });
});
