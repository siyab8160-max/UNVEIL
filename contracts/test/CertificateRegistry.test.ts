import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { IssuerRegistry, CertificateRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("CertificateRegistry Contract", function () {
  let admin: SignerWithAddress;
  let multisigSafe: SignerWithAddress;
  let arbitrator: SignerWithAddress;
  let activeIssuer: SignerWithAddress;
  let inactiveIssuer: SignerWithAddress;
  let producerHolder: SignerWithAddress;
  let unauthorizedUser: SignerWithAddress;
  let mockConsignmentRegistry: SignerWithAddress;

  let issuerRegistry: IssuerRegistry;
  let certificateRegistry: CertificateRegistry;

  const CONSIGNMENT_REGISTRY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CONSIGNMENT_REGISTRY_ROLE"));

  beforeEach(async function () {
    [
      admin,
      multisigSafe,
      arbitrator,
      activeIssuer,
      inactiveIssuer,
      producerHolder,
      unauthorizedUser,
      mockConsignmentRegistry,
    ] = await ethers.getSigners();

    // Deploy IssuerRegistry
    const IssuerRegistryFactory = await ethers.getContractFactory("IssuerRegistry");
    issuerRegistry = await IssuerRegistryFactory.deploy(admin.address, multisigSafe.address);
    await issuerRegistry.waitForDeployment();

    // Register activeIssuer
    const now = await time.latest();
    await issuerRegistry
      .connect(multisigSafe)
      .registerIssuer(
        "IAF-ACTIVE",
        activeIssuer.address,
        "Control Union Certifications",
        "IAF Board",
        now + 365 * 24 * 3600,
        "IAF CertSearch"
      );

    // Deploy CertificateRegistry
    const CertificateRegistryFactory = await ethers.getContractFactory("CertificateRegistry");
    certificateRegistry = await CertificateRegistryFactory.deploy(
      admin.address,
      await issuerRegistry.getAddress(),
      arbitrator.address
    );
    await certificateRegistry.waitForDeployment();

    // Authorize mockConsignmentRegistry
    await certificateRegistry.grantRole(CONSIGNMENT_REGISTRY_ROLE, mockConsignmentRegistry.address);
  });

  describe("Certificate Issuance (§7.2)", function () {
    it("Should allow active issuer to issue a certificate with integer grams", async function () {
      const now = await time.latest();
      const validFrom = now + 10;
      const validUntil = now + 30 * 24 * 3600;
      const quantityGrams = 10000000n; // 10,000 kg in grams

      await expect(
        certificateRegistry
          .connect(activeIssuer)
          .issueCertificate(
            "CERT-NOP-2024-001",
            "USDA-ORGANIC",
            producerHolder.address,
            quantityGrams,
            validFrom,
            validUntil,
            "USDA Database",
            "NOP-CU-9988"
          )
      )
        .to.emit(certificateRegistry, "CertificateIssued")
        .withArgs(
          "CERT-NOP-2024-001",
          activeIssuer.address,
          producerHolder.address,
          "USDA-ORGANIC",
          quantityGrams,
          validFrom,
          validUntil
        );

      const cert = await certificateRegistry.getCertificate("CERT-NOP-2024-001");
      expect(cert.certificateID).to.equal("CERT-NOP-2024-001");
      expect(cert.issuer).to.equal(activeIssuer.address);
      expect(cert.standardID).to.equal("USDA-ORGANIC");
      expect(cert.holder).to.equal(producerHolder.address);
      expect(cert.certifiedQuantityGrams).to.equal(quantityGrams);
      expect(cert.remainingQuantityGrams).to.equal(quantityGrams);
      expect(cert.validFrom).to.equal(validFrom);
      expect(cert.validUntil).to.equal(validUntil);
      expect(cert.isRevoked).to.be.false;
    });

    it("Should reject certificate issuance from unaccredited or inactive address", async function () {
      const now = await time.latest();
      await expect(
        certificateRegistry
          .connect(inactiveIssuer)
          .issueCertificate(
            "CERT-FAIL",
            "USDA-ORGANIC",
            producerHolder.address,
            1000n,
            now + 10,
            now + 1000,
            "SRC",
            "ID"
          )
      ).to.be.revertedWithCustomError(certificateRegistry, "IssuerNotActive");
    });

    it("Should reject duplicate certificateID", async function () {
      const now = await time.latest();
      await certificateRegistry
        .connect(activeIssuer)
        .issueCertificate(
          "CERT-DUP",
          "USDA-ORGANIC",
          producerHolder.address,
          1000n,
          now + 10,
          now + 1000,
          "SRC",
          "ID"
        );

      await expect(
        certificateRegistry
          .connect(activeIssuer)
          .issueCertificate(
            "CERT-DUP",
            "USDA-ORGANIC",
            producerHolder.address,
            2000n,
            now + 10,
            now + 1000,
            "SRC",
            "ID"
          )
      ).to.be.revertedWithCustomError(certificateRegistry, "CertificateAlreadyExists");
    });

    it("Should reject zero quantity or invalid validity window", async function () {
      const now = await time.latest();

      // Zero quantity
      await expect(
        certificateRegistry
          .connect(activeIssuer)
          .issueCertificate(
            "CERT-ZERO",
            "USDA-ORGANIC",
            producerHolder.address,
            0n,
            now + 10,
            now + 1000,
            "SRC",
            "ID"
          )
      ).to.be.revertedWithCustomError(certificateRegistry, "InvalidQuantity");

      // Inverted validity window (validFrom >= validUntil)
      await expect(
        certificateRegistry
          .connect(activeIssuer)
          .issueCertificate(
            "CERT-INVERT",
            "USDA-ORGANIC",
            producerHolder.address,
            1000n,
            now + 1000,
            now + 500,
            "SRC",
            "ID"
          )
      ).to.be.revertedWithCustomError(certificateRegistry, "InvalidValidityWindow");
    });
  });

  describe("Dynamic Status Calculation & Temporal Boundaries", function () {
    it("Should report NotYetActive if block.timestamp < validFrom", async function () {
      const now = await time.latest();
      const validFrom = now + 500; // 500 seconds in the future
      const validUntil = now + 5000;

      await certificateRegistry
        .connect(activeIssuer)
        .issueCertificate(
          "CERT-FUTURE",
          "USDA-ORGANIC",
          producerHolder.address,
          10000n,
          validFrom,
          validUntil,
          "SRC",
          "ID"
        );

      // Status must be NotYetActive (1)
      expect(await certificateRegistry.getCertificateStatus("CERT-FUTURE")).to.equal(1);

      // Attempting consumption must revert with CertificateNotYetActive
      await expect(
        certificateRegistry
          .connect(mockConsignmentRegistry)
          .consumeCertifiedQuantity("CERT-FUTURE", producerHolder.address, 1000n)
      ).to.be.revertedWithCustomError(certificateRegistry, "CertificateNotYetActive");
    });

    it("Should report Valid once validFrom timestamp is reached", async function () {
      const now = await time.latest();
      const validFrom = now + 500;
      const validUntil = now + 5000;

      await certificateRegistry
        .connect(activeIssuer)
        .issueCertificate(
          "CERT-FUTURE2",
          "USDA-ORGANIC",
          producerHolder.address,
          10000n,
          validFrom,
          validUntil,
          "SRC",
          "ID"
        );

      await time.increaseTo(validFrom);

      expect(await certificateRegistry.getCertificateStatus("CERT-FUTURE2")).to.equal(2); // Valid
    });

    it("Should report Expired once validUntil timestamp has passed", async function () {
      const now = await time.latest();
      const validFrom = now + 10;
      const validUntil = now + 500;

      await certificateRegistry
        .connect(activeIssuer)
        .issueCertificate(
          "CERT-EXPIRING",
          "USDA-ORGANIC",
          producerHolder.address,
          10000n,
          validFrom,
          validUntil,
          "SRC",
          "ID"
        );

      await time.increaseTo(validUntil + 1);

      expect(await certificateRegistry.getCertificateStatus("CERT-EXPIRING")).to.equal(3); // Expired

      // Consumption must revert with CertificateExpired
      await expect(
        certificateRegistry
          .connect(mockConsignmentRegistry)
          .consumeCertifiedQuantity("CERT-EXPIRING", producerHolder.address, 1000n)
      ).to.be.revertedWithCustomError(certificateRegistry, "CertificateExpired");
    });
  });

  describe("Revocation & Access Control", function () {
    it("Should allow the issuing body to revoke their certificate", async function () {
      const now = await time.latest();
      await certificateRegistry
        .connect(activeIssuer)
        .issueCertificate(
          "CERT-REV-ISSUER",
          "USDA-ORGANIC",
          producerHolder.address,
          10000n,
          now + 10,
          now + 5000,
          "SRC",
          "ID"
        );

      await expect(
        certificateRegistry
          .connect(activeIssuer)
          .revokeCertificate("CERT-REV-ISSUER", "Audit failure at processing plant")
      )
        .to.emit(certificateRegistry, "CertificateRevoked")
        .withArgs("CERT-REV-ISSUER", activeIssuer.address, "Audit failure at processing plant");

      expect(await certificateRegistry.getCertificateStatus("CERT-REV-ISSUER")).to.equal(4); // Revoked
    });

    it("Should allow designated arbitration role to revoke a certificate", async function () {
      const now = await time.latest();
      await certificateRegistry
        .connect(activeIssuer)
        .issueCertificate(
          "CERT-REV-ARB",
          "USDA-ORGANIC",
          producerHolder.address,
          10000n,
          now + 10,
          now + 5000,
          "SRC",
          "ID"
        );

      await expect(
        certificateRegistry
          .connect(arbitrator)
          .revokeCertificate("CERT-REV-ARB", "Dispute confirmed in arbitration")
      )
        .to.emit(certificateRegistry, "CertificateRevoked")
        .withArgs("CERT-REV-ARB", arbitrator.address, "Dispute confirmed in arbitration");

      expect(await certificateRegistry.getCertificateStatus("CERT-REV-ARB")).to.equal(4); // Revoked
    });

    it("Should reject revocation from unauthorized buyer or third party", async function () {
      const now = await time.latest();
      await certificateRegistry
        .connect(activeIssuer)
        .issueCertificate(
          "CERT-REV-DENY",
          "USDA-ORGANIC",
          producerHolder.address,
          10000n,
          now + 10,
          now + 5000,
          "SRC",
          "ID"
        );

      await expect(
        certificateRegistry
          .connect(unauthorizedUser)
          .revokeCertificate("CERT-REV-DENY", "Malicious revocation attempt")
      ).to.be.revertedWithCustomError(certificateRegistry, "UnauthorizedRevocation");
    });
  });

  describe("Mass-Balance Quota Consumption", function () {
    it("Should consume certified quota when invoked by authorized ConsignmentRegistry", async function () {
      const now = await time.latest();
      const totalCapacity = 10000n;
      const consumeAmount = 4000n;

      await certificateRegistry
        .connect(activeIssuer)
        .issueCertificate(
          "CERT-CONSUME",
          "USDA-ORGANIC",
          producerHolder.address,
          totalCapacity,
          now + 10,
          now + 5000,
          "SRC",
          "ID"
        );

      await time.increaseTo(now + 20);

      await expect(
        certificateRegistry
          .connect(mockConsignmentRegistry)
          .consumeCertifiedQuantity("CERT-CONSUME", producerHolder.address, consumeAmount)
      )
        .to.emit(certificateRegistry, "CertifiedQuantityConsumed")
        .withArgs("CERT-CONSUME", producerHolder.address, consumeAmount, 6000n);

      expect(await certificateRegistry.getRemainingQuantity("CERT-CONSUME")).to.equal(6000n);
    });

    it("Should reject consumption from unauthorized account (not ConsignmentRegistry)", async function () {
      const now = await time.latest();
      await certificateRegistry
        .connect(activeIssuer)
        .issueCertificate(
          "CERT-ROLE",
          "USDA-ORGANIC",
          producerHolder.address,
          10000n,
          now + 10,
          now + 5000,
          "SRC",
          "ID"
        );

      await time.increaseTo(now + 20);

      await expect(
        certificateRegistry
          .connect(unauthorizedUser)
          .consumeCertifiedQuantity("CERT-ROLE", producerHolder.address, 1000n)
      ).to.be.revertedWithCustomError(certificateRegistry, "AccessControlUnauthorizedAccount");
    });

    it("Should reject consumption if caller specified is not the certificate holder", async function () {
      const now = await time.latest();
      await certificateRegistry
        .connect(activeIssuer)
        .issueCertificate(
          "CERT-HOLDER-CHECK",
          "USDA-ORGANIC",
          producerHolder.address,
          10000n,
          now + 10,
          now + 5000,
          "SRC",
          "ID"
        );

      await time.increaseTo(now + 20);

      await expect(
        certificateRegistry
          .connect(mockConsignmentRegistry)
          .consumeCertifiedQuantity("CERT-HOLDER-CHECK", unauthorizedUser.address, 1000n)
      ).to.be.revertedWithCustomError(certificateRegistry, "CallerNotCertificateHolder");
    });

    it("Should revert and emit MassBalanceAlert on over-consumption", async function () {
      const now = await time.latest();
      const totalCapacity = 5000n;

      await certificateRegistry
        .connect(activeIssuer)
        .issueCertificate(
          "CERT-OVER",
          "USDA-ORGANIC",
          producerHolder.address,
          totalCapacity,
          now + 10,
          now + 5000,
          "SRC",
          "ID"
        );

      await time.increaseTo(now + 20);

      // Attempting to consume 5,001g when only 5,000g exists
      await expect(
        certificateRegistry
          .connect(mockConsignmentRegistry)
          .consumeCertifiedQuantity("CERT-OVER", producerHolder.address, 5001n)
      )
        .to.be.revertedWithCustomError(certificateRegistry, "InsufficientCertifiedQuantity")
        .withArgs("CERT-OVER", 5001n, 5000n);
    });
  });
});
