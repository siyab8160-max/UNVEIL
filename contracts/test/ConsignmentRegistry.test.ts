import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  IssuerRegistry,
  CertificateRegistry,
  ConsignmentRegistry,
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ConsignmentRegistry Contract", function () {
  let admin: SignerWithAddress;
  let multisigSafe: SignerWithAddress;
  let arbitrator: SignerWithAddress;
  let activeIssuer: SignerWithAddress;
  let producerHolder: SignerWithAddress;
  let buyer1: SignerWithAddress;
  let buyer2: SignerWithAddress;
  let unauthorizedActor: SignerWithAddress;

  let issuerRegistry: IssuerRegistry;
  let certificateRegistry: CertificateRegistry;
  let consignmentRegistry: ConsignmentRegistry;

  const CONSIGNMENT_REGISTRY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CONSIGNMENT_REGISTRY_ROLE"));

  beforeEach(async function () {
    [
      admin,
      multisigSafe,
      arbitrator,
      activeIssuer,
      producerHolder,
      buyer1,
      buyer2,
      unauthorizedActor,
    ] = await ethers.getSigners();

    // 1. Deploy IssuerRegistry
    const IssuerRegistryFactory = await ethers.getContractFactory("IssuerRegistry");
    issuerRegistry = await IssuerRegistryFactory.deploy(admin.address, multisigSafe.address);
    await issuerRegistry.waitForDeployment();

    const now = await time.latest();
    await issuerRegistry
      .connect(multisigSafe)
      .registerIssuer(
        "IAF-ORGANIC-01",
        activeIssuer.address,
        "Oregon Tilth Certified Organic",
        "USDA NOP",
        now + 365 * 24 * 3600,
        "USDA Integrity Database"
      );

    // 2. Deploy CertificateRegistry
    const CertificateRegistryFactory = await ethers.getContractFactory("CertificateRegistry");
    certificateRegistry = await CertificateRegistryFactory.deploy(
      admin.address,
      await issuerRegistry.getAddress(),
      arbitrator.address
    );
    await certificateRegistry.waitForDeployment();

    // 3. Deploy ConsignmentRegistry
    const ConsignmentRegistryFactory = await ethers.getContractFactory("ConsignmentRegistry");
    consignmentRegistry = await ConsignmentRegistryFactory.deploy(
      await certificateRegistry.getAddress()
    );
    await consignmentRegistry.waitForDeployment();

    // Authorize ConsignmentRegistry on CertificateRegistry
    await certificateRegistry.grantRole(
      CONSIGNMENT_REGISTRY_ROLE,
      await consignmentRegistry.getAddress()
    );

    // Issue standard test certificate (10,000,000 grams = 10 metric tons)
    await certificateRegistry
      .connect(activeIssuer)
      .issueCertificate(
        "CERT-COFFEE-001",
        "FAIRTRADE-ORGANIC",
        producerHolder.address,
        10000000n,
        now + 10,
        now + 180 * 24 * 3600,
        "Fairtrade Registry",
        "FLO-ID-7788"
      );

    // Advance time into active validity window
    await time.increaseTo(now + 20);
  });

  describe("Root Consignment Creation (§7.3)", function () {
    it("Should allow certificate holder to create root consignment and deduct capacity", async function () {
      const rootQuantity = 4000000n; // 4,000 kg

      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .createRootConsignment("LOT-ROOT-001", "CERT-COFFEE-001", rootQuantity)
      )
        .to.emit(consignmentRegistry, "RootConsignmentCreated")
        .withArgs("LOT-ROOT-001", "CERT-COFFEE-001", producerHolder.address, rootQuantity);

      const lot = await consignmentRegistry.getLot("LOT-ROOT-001");
      expect(lot.lotID).to.equal("LOT-ROOT-001");
      expect(lot.certificateID).to.equal("CERT-COFFEE-001");
      expect(lot.quantityGrams).to.equal(rootQuantity);
      expect(lot.currentOwner).to.equal(producerHolder.address);
      expect(lot.status).to.equal(1); // Active
      expect(lot.parentLotIDs.length).to.equal(0);

      // Verify certificate remaining capacity deducted to 6,000,000g
      expect(await certificateRegistry.getRemainingQuantity("CERT-COFFEE-001")).to.equal(6000000n);
    });

    it("Should reject root consignment creation from non-holder", async function () {
      await expect(
        consignmentRegistry
          .connect(unauthorizedActor)
          .createRootConsignment("LOT-ROOT-UNAUTH", "CERT-COFFEE-001", 1000n)
      ).to.be.revertedWithCustomError(certificateRegistry, "CallerNotCertificateHolder");
    });

    it("Should reject duplicate lotID", async function () {
      await consignmentRegistry
        .connect(producerHolder)
        .createRootConsignment("LOT-ROOT-DUP", "CERT-COFFEE-001", 1000n);

      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .createRootConsignment("LOT-ROOT-DUP", "CERT-COFFEE-001", 2000n)
      ).to.be.revertedWithCustomError(consignmentRegistry, "LotAlreadyExists");
    });

    it("Should reject root consignment exceeding remaining certified capacity", async function () {
      // Certificate has 10,000,000g; requesting 10,000,001g must revert
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .createRootConsignment("LOT-ROOT-OVERFLOW", "CERT-COFFEE-001", 10000001n)
      ).to.be.revertedWithCustomError(certificateRegistry, "InsufficientCertifiedQuantity");
    });
  });

  describe("Lot Splitting Operations", function () {
    beforeEach(async function () {
      // Create root lot of 6,000,000g
      await consignmentRegistry
        .connect(producerHolder)
        .createRootConsignment("LOT-PARENT-SPLIT", "CERT-COFFEE-001", 6000000n);
    });

    it("Should split lot conserving mass and locking parent lot to Consumed", async function () {
      const childIDs = ["LOT-CHILD-A", "LOT-CHILD-B"];
      const childQuantities = [4000000n, 2000000n]; // 4,000g + 2,000g = 6,000g

      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .splitLot("LOT-PARENT-SPLIT", childIDs, childQuantities)
      )
        .to.emit(consignmentRegistry, "LotSplit")
        .withArgs("LOT-PARENT-SPLIT", childIDs, childQuantities, producerHolder.address);

      // Parent must be Consumed (2)
      const parent = await consignmentRegistry.getLot("LOT-PARENT-SPLIT");
      expect(parent.status).to.equal(2); // Consumed
      expect(await consignmentRegistry.getLotStatus("LOT-PARENT-SPLIT")).to.equal(2);

      // Children must be Active (1) and owned by producer
      const childA = await consignmentRegistry.getLot("LOT-CHILD-A");
      expect(childA.quantityGrams).to.equal(4000000n);
      expect(childA.status).to.equal(1); // Active
      expect(childA.currentOwner).to.equal(producerHolder.address);
      expect(childA.parentLotIDs[0]).to.equal("LOT-PARENT-SPLIT");

      const childB = await consignmentRegistry.getLot("LOT-CHILD-B");
      expect(childB.quantityGrams).to.equal(2000000n);
      expect(childB.status).to.equal(1); // Active
    });

    it("Should reject split if sum of child quantities does not equal parent quantity", async function () {
      // 3,000g + 2,000g = 5,000g != 6,000g (under-split)
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .splitLot("LOT-PARENT-SPLIT", ["C1", "C2"], [3000000n, 2000000n])
      ).to.be.revertedWithCustomError(consignmentRegistry, "SplitConservationViolation");

      // 4,000g + 3,000g = 7,000g != 6,000g (over-split / creation of mass)
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .splitLot("LOT-PARENT-SPLIT", ["C1", "C2"], [4000000n, 3000000n])
      ).to.be.revertedWithCustomError(consignmentRegistry, "SplitConservationViolation");
    });

    it("Should reject split from non-owner", async function () {
      await expect(
        consignmentRegistry
          .connect(unauthorizedActor)
          .splitLot("LOT-PARENT-SPLIT", ["C1", "C2"], [3000000n, 3000000n])
      ).to.be.revertedWithCustomError(consignmentRegistry, "CallerNotLotOwner");
    });
  });

  describe("Lot Merging Operations", function () {
    beforeEach(async function () {
      // Create root lot and split it into two components
      await consignmentRegistry
        .connect(producerHolder)
        .createRootConsignment("LOT-ROOT-FOR-MERGE", "CERT-COFFEE-001", 5000000n);

      await consignmentRegistry
        .connect(producerHolder)
        .splitLot("LOT-ROOT-FOR-MERGE", ["LOT-TO-MERGE-1", "LOT-TO-MERGE-2"], [2000000n, 3000000n]);
    });

    it("Should merge multiple parent lots into a single active lot and lock parents", async function () {
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .mergeLots(["LOT-TO-MERGE-1", "LOT-TO-MERGE-2"], "LOT-MERGED-RESULT")
      )
        .to.emit(consignmentRegistry, "LotsMerged")
        .withArgs(["LOT-TO-MERGE-1", "LOT-TO-MERGE-2"], "LOT-MERGED-RESULT", 5000000n, producerHolder.address);

      // Both parents must now be Consumed
      expect(await consignmentRegistry.getLotStatus("LOT-TO-MERGE-1")).to.equal(2);
      expect(await consignmentRegistry.getLotStatus("LOT-TO-MERGE-2")).to.equal(2);

      // Merged lot must be Active with 5,000,000g
      const mergedLot = await consignmentRegistry.getLot("LOT-MERGED-RESULT");
      expect(mergedLot.quantityGrams).to.equal(5000000n);
      expect(mergedLot.status).to.equal(1); // Active
      expect(mergedLot.parentLotIDs.length).to.equal(2);
      expect(mergedLot.parentLotIDs[0]).to.equal("LOT-TO-MERGE-1");
      expect(mergedLot.parentLotIDs[1]).to.equal("LOT-TO-MERGE-2");
    });

    it("Should reject merge if caller is not the owner of all parent lots", async function () {
      // Transfer LOT-TO-MERGE-1 to buyer1
      await consignmentRegistry
        .connect(producerHolder)
        .transferLot("LOT-TO-MERGE-1", buyer1.address);

      // producerHolder owns MERGE-2, but not MERGE-1 -> must revert
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .mergeLots(["LOT-TO-MERGE-1", "LOT-TO-MERGE-2"], "LOT-FAIL-MERGE")
      ).to.be.revertedWithCustomError(consignmentRegistry, "CallerNotLotOwner");
    });

    it("Should reject merge with fewer than two parent lots", async function () {
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .mergeLots(["LOT-TO-MERGE-1"], "LOT-SOLO")
      ).to.be.revertedWithCustomError(consignmentRegistry, "InvalidParentCount");
    });

    it("Should reject merge if parent lots originate from different certificates (CertificateMismatch)", async function () {
      // Issue a second certificate to the same producer for tea
      const now = await time.latest();
      await certificateRegistry
        .connect(activeIssuer)
        .issueCertificate(
          "CERT-TEA-002",
          "ORGANIC-TEA",
          producerHolder.address,
          5000000n,
          now - 100,
          now + 10000,
          "Tea Registry",
          "TEA-ID-01"
        );

      // Create root lot for the second certificate
      await consignmentRegistry
        .connect(producerHolder)
        .createRootConsignment("LOT-TEA-ROOT", "CERT-TEA-002", 1000000n);

      // Attempt to merge LOT-TO-MERGE-1 (CERT-COFFEE-001) with LOT-TEA-ROOT (CERT-TEA-002)
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .mergeLots(["LOT-TO-MERGE-1", "LOT-TEA-ROOT"], "MERGED-INVALID-CROSS-CERT")
      )
        .to.be.revertedWithCustomError(consignmentRegistry, "CertificateMismatch")
        .withArgs("CERT-COFFEE-001", "CERT-TEA-002");

      // Verify both parent lots remain Active (atomicity check)
      expect(await consignmentRegistry.getLotStatus("LOT-TO-MERGE-1")).to.equal(1); // Active
      expect(await consignmentRegistry.getLotStatus("LOT-TEA-ROOT")).to.equal(1);   // Active
    });

    it("Should verify atomicity: failed merge caused by later consumed parent leaves prior parents Active", async function () {
      // Create an already-consumed lot
      await consignmentRegistry
        .connect(producerHolder)
        .splitLot("LOT-TO-MERGE-2", ["LOT-TEMP-X", "LOT-TEMP-Y"], [1500000n, 1500000n]);

      // LOT-TO-MERGE-2 is now Consumed
      expect(await consignmentRegistry.getLotStatus("LOT-TO-MERGE-2")).to.equal(2); // Consumed
      // LOT-TO-MERGE-1 is still Active
      expect(await consignmentRegistry.getLotStatus("LOT-TO-MERGE-1")).to.equal(1); // Active

      // Attempt merge with LOT-TO-MERGE-1 (Active) first and LOT-TO-MERGE-2 (Consumed) second
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .mergeLots(["LOT-TO-MERGE-1", "LOT-TO-MERGE-2"], "MERGED-SHOULD-FAIL")
      )
        .to.be.revertedWithCustomError(consignmentRegistry, "LotAlreadyConsumed")
        .withArgs("LOT-TO-MERGE-2");

      // CRITICAL ATOMICITY CHECK: LOT-TO-MERGE-1 must remain Active, NOT Consumed
      expect(await consignmentRegistry.getLotStatus("LOT-TO-MERGE-1")).to.equal(1); // Active
      expect(await consignmentRegistry.getLotStatus("LOT-TO-MERGE-2")).to.equal(2); // Consumed

      // New lot was never created
      expect(await consignmentRegistry.getLotStatus("MERGED-SHOULD-FAIL")).to.equal(0); // None
    });
  });

  describe("Lot Processing Operations (Yield Loss)", function () {
    beforeEach(async function () {
      await consignmentRegistry
        .connect(producerHolder)
        .createRootConsignment("LOT-TO-PROCESS", "CERT-COFFEE-001", 1000000n); // 1,000 kg green beans
    });

    it("Should allow processing with yield loss (roasting green beans to roasted coffee)", async function () {
      // 1,000 kg green beans -> 850 kg roasted coffee (150 kg shrinkage / moisture loss)
      const outputQuantity = 850000n;

      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .processLot(
            "LOT-TO-PROCESS",
            "LOT-ROASTED-COFFEE",
            outputQuantity,
            "Roasting at 220C, 15% moisture shrinkage"
          )
      )
        .to.emit(consignmentRegistry, "LotProcessed")
        .withArgs(
          "LOT-TO-PROCESS",
          "LOT-ROASTED-COFFEE",
          1000000n,
          outputQuantity,
          "Roasting at 220C, 15% moisture shrinkage",
          producerHolder.address
        );

      // Parent must be Consumed
      expect(await consignmentRegistry.getLotStatus("LOT-TO-PROCESS")).to.equal(2);

      // Processed lot must be Active with 850,000g
      const processed = await consignmentRegistry.getLot("LOT-ROASTED-COFFEE");
      expect(processed.quantityGrams).to.equal(outputQuantity);
      expect(processed.status).to.equal(1);
    });

    it("Should allow processing with zero loss (output == input)", async function () {
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .processLot("LOT-TO-PROCESS", "LOT-CLEANED", 1000000n, "Cleaning & sorting")
      ).to.emit(consignmentRegistry, "LotProcessed");
    });

    it("Should strictly reject yield expansion (output > input)", async function () {
      // Attempting to produce 1,050 kg from 1,000 kg input (fabricated volume)
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .processLot("LOT-TO-PROCESS", "LOT-FABRICATED", 1050000n, "Implausible expansion")
      ).to.be.revertedWithCustomError(consignmentRegistry, "YieldExpansionNotAllowed");
    });
  });

  describe("Lot Custody Transfers", function () {
    beforeEach(async function () {
      await consignmentRegistry
        .connect(producerHolder)
        .createRootConsignment("LOT-TRANSFER-TEST", "CERT-COFFEE-001", 2000000n);
    });

    it("Should transfer ownership without changing mass or consuming lot", async function () {
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .transferLot("LOT-TRANSFER-TEST", buyer1.address)
      )
        .to.emit(consignmentRegistry, "LotTransferred")
        .withArgs("LOT-TRANSFER-TEST", producerHolder.address, buyer1.address);

      const lot = await consignmentRegistry.getLot("LOT-TRANSFER-TEST");
      expect(lot.currentOwner).to.equal(buyer1.address);
      expect(lot.quantityGrams).to.equal(2000000n); // Unchanged
      expect(lot.status).to.equal(1); // Still Active

      // Buyer1 can now perform operations as the new owner
      await expect(
        consignmentRegistry
          .connect(buyer1)
          .transferLot("LOT-TRANSFER-TEST", buyer2.address)
      ).to.emit(consignmentRegistry, "LotTransferred");
    });

    it("Should reject transfer from non-owner", async function () {
      await expect(
        consignmentRegistry
          .connect(unauthorizedActor)
          .transferLot("LOT-TRANSFER-TEST", buyer1.address)
      ).to.be.revertedWithCustomError(consignmentRegistry, "CallerNotLotOwner");
    });
  });

  describe("Consumed-Lot Anti-Double-Spending Exhaustive Matrix", function () {
    beforeEach(async function () {
      // Create root lot and split it to transition parent to Consumed
      await consignmentRegistry
        .connect(producerHolder)
        .createRootConsignment("LOT-ROOT-FOR-LOCK", "CERT-COFFEE-001", 4000000n);

      await consignmentRegistry
        .connect(producerHolder)
        .splitLot("LOT-ROOT-FOR-LOCK", ["CHILD-X", "CHILD-Y"], [2000000n, 2000000n]);

      // LOT-ROOT-FOR-LOCK is now in Consumed state
      expect(await consignmentRegistry.getLotStatus("LOT-ROOT-FOR-LOCK")).to.equal(2);
    });

    it("Matrix 1: Consumed lot CANNOT be split again", async function () {
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .splitLot("LOT-ROOT-FOR-LOCK", ["X1", "X2"], [2000000n, 2000000n])
      ).to.be.revertedWithCustomError(consignmentRegistry, "LotAlreadyConsumed");
    });

    it("Matrix 2: Consumed lot CANNOT be merged", async function () {
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .mergeLots(["LOT-ROOT-FOR-LOCK", "CHILD-X"], "NEW-MERGED")
      ).to.be.revertedWithCustomError(consignmentRegistry, "LotAlreadyConsumed");
    });

    it("Matrix 3: Consumed lot CANNOT be processed", async function () {
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .processLot("LOT-ROOT-FOR-LOCK", "PROCESSED-LOCK", 3500000n, "Process attempt")
      ).to.be.revertedWithCustomError(consignmentRegistry, "LotAlreadyConsumed");
    });

    it("Matrix 4: Consumed lot CANNOT be transferred", async function () {
      await expect(
        consignmentRegistry
          .connect(producerHolder)
          .transferLot("LOT-ROOT-FOR-LOCK", buyer1.address)
      ).to.be.revertedWithCustomError(consignmentRegistry, "LotAlreadyConsumed");
    });
  });
});
