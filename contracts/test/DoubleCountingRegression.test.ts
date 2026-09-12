import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  IssuerRegistry,
  CertificateRegistry,
  ConsignmentRegistry,
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * @notice Critical Regression Test for PRD §7.3 Mass-Balance Accounting
 *
 * GOAL:
 * Prove conclusively that derived lot operations (split, transfer, processing, merge)
 * NEVER modify or consume CertificateRegistry.remainingQuantityGrams.
 *
 * SCENARIO:
 * - Certificate initial quota = 10,000g
 * - Root consignment created for 6,000g
 * - Remaining certificate capacity becomes 4,000g
 * - Step 1: Split derived lot -> assert remaining == 4,000g
 * - Step 2: Transfer derived lot -> assert remaining == 4,000g
 * - Step 3: Process derived lot with yield loss -> assert remaining == 4,000g
 * - Step 4: Merge derived lots -> assert remaining == 4,000g
 * - Step 5: Exhaust remaining quota with second root consignment for exactly 4,000g -> remaining == 0g
 * - Step 6: Over-claiming by even 1g reverts with InsufficientCertifiedQuantity
 */
describe("Double-Counting Regression Test (§7.3 Mass-Balance Correctness)", function () {
  let admin: SignerWithAddress;
  let multisigSafe: SignerWithAddress;
  let activeIssuer: SignerWithAddress;
  let farmer: SignerWithAddress;
  let cooperative: SignerWithAddress;
  let roaster: SignerWithAddress;
  let retailer: SignerWithAddress;

  let issuerRegistry: IssuerRegistry;
  let certificateRegistry: CertificateRegistry;
  let consignmentRegistry: ConsignmentRegistry;

  const CERT_ID = "CERT-FAIRTRADE-ORGANIC-10KG";
  const INITIAL_CERTIFIED_GRAMS = 10000n; // 10,000 grams
  const ROOT_CONSIGNMENT_GRAMS = 6000n;   // 6,000 grams
  const EXPECTED_REMAINING_GRAMS = 4000n; // 4,000 grams

  before(async function () {
    [admin, multisigSafe, activeIssuer, farmer, cooperative, roaster, retailer] =
      await ethers.getSigners();

    // Deploy IssuerRegistry
    const IssuerRegistryFactory = await ethers.getContractFactory("IssuerRegistry");
    issuerRegistry = await IssuerRegistryFactory.deploy(admin.address, multisigSafe.address);
    await issuerRegistry.waitForDeployment();

    const now = await time.latest();
    await issuerRegistry
      .connect(multisigSafe)
      .registerIssuer(
        "IAF-REGRESSION",
        activeIssuer.address,
        "Fairtrade International Certifier",
        "IAF Accreditor",
        now + 365 * 24 * 3600,
        "IAF Database"
      );

    // Deploy CertificateRegistry
    const CertificateRegistryFactory = await ethers.getContractFactory("CertificateRegistry");
    certificateRegistry = await CertificateRegistryFactory.deploy(
      admin.address,
      await issuerRegistry.getAddress(),
      admin.address
    );
    await certificateRegistry.waitForDeployment();

    // Deploy ConsignmentRegistry
    const ConsignmentRegistryFactory = await ethers.getContractFactory("ConsignmentRegistry");
    consignmentRegistry = await ConsignmentRegistryFactory.deploy(
      await certificateRegistry.getAddress()
    );
    await consignmentRegistry.waitForDeployment();

    // Authorize ConsignmentRegistry on CertificateRegistry
    const CONSIGNMENT_REGISTRY_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("CONSIGNMENT_REGISTRY_ROLE")
    );
    await certificateRegistry.grantRole(
      CONSIGNMENT_REGISTRY_ROLE,
      await consignmentRegistry.getAddress()
    );

    // Issue Certificate with 10,000g capacity to farmer
    await certificateRegistry
      .connect(activeIssuer)
      .issueCertificate(
        CERT_ID,
        "FAIRTRADE-COFFEE",
        farmer.address,
        INITIAL_CERTIFIED_GRAMS,
        now + 10,
        now + 365 * 24 * 3600,
        "FLO-CERT",
        "FLO-REG-99"
      );

    await time.increaseTo(now + 20);
  });

  it("Step 0: Verify initial certified quantity is 10,000g", async function () {
    const cert = await certificateRegistry.getCertificate(CERT_ID);
    expect(cert.certifiedQuantityGrams).to.equal(INITIAL_CERTIFIED_GRAMS);
    expect(cert.remainingQuantityGrams).to.equal(INITIAL_CERTIFIED_GRAMS);
  });

  it("Step 1: Create Root Consignment of 6,000g -> Certificate remaining becomes 4,000g", async function () {
    await consignmentRegistry
      .connect(farmer)
      .createRootConsignment("LOT-ROOT-6KG", CERT_ID, ROOT_CONSIGNMENT_GRAMS);

    const remaining = await certificateRegistry.getRemainingQuantity(CERT_ID);
    expect(remaining).to.equal(EXPECTED_REMAINING_GRAMS);

    const rootLot = await consignmentRegistry.getLot("LOT-ROOT-6KG");
    expect(rootLot.quantityGrams).to.equal(ROOT_CONSIGNMENT_GRAMS);
    expect(rootLot.currentOwner).to.equal(farmer.address);
    expect(rootLot.status).to.equal(1); // Active
  });

  it("Step 2: Split 6,000g Root Lot into Child 1 (3,500g) and Child 2 (2,500g) -> Certificate remaining MUST STILL be 4,000g", async function () {
    await consignmentRegistry
      .connect(farmer)
      .splitLot("LOT-ROOT-6KG", ["CHILD-1-3500G", "CHILD-2-2500G"], [3500n, 2500n]);

    // Root lot is consumed
    expect(await consignmentRegistry.getLotStatus("LOT-ROOT-6KG")).to.equal(2);

    // Certificate remaining capacity must be completely untouched
    const remaining = await certificateRegistry.getRemainingQuantity(CERT_ID);
    expect(remaining).to.equal(EXPECTED_REMAINING_GRAMS);
  });

  it("Step 3: Transfer Child 1 (3,500g) to Cooperative -> Certificate remaining MUST STILL be 4,000g", async function () {
    await consignmentRegistry
      .connect(farmer)
      .transferLot("CHILD-1-3500G", cooperative.address);

    const transferredLot = await consignmentRegistry.getLot("CHILD-1-3500G");
    expect(transferredLot.currentOwner).to.equal(cooperative.address);
    expect(transferredLot.quantityGrams).to.equal(3500n);

    // Certificate remaining capacity must be completely untouched
    const remaining = await certificateRegistry.getRemainingQuantity(CERT_ID);
    expect(remaining).to.equal(EXPECTED_REMAINING_GRAMS);
  });

  it("Step 4: Process Child 2 (2,500g) into Roasted Batch (2,200g, 300g loss) -> Certificate remaining MUST STILL be 4,000g", async function () {
    // Transfer Child 2 to roaster
    await consignmentRegistry
      .connect(farmer)
      .transferLot("CHILD-2-2500G", roaster.address);

    // Roaster processes 2,500g green beans into 2,200g roasted beans
    await consignmentRegistry
      .connect(roaster)
      .processLot(
        "CHILD-2-2500G",
        "ROASTED-BATCH-2200G",
        2200n,
        "Artisan drum roasting at 215C"
      );

    const processedLot = await consignmentRegistry.getLot("ROASTED-BATCH-2200G");
    expect(processedLot.quantityGrams).to.equal(2200n);
    expect(processedLot.status).to.equal(1); // Active

    // Certificate remaining capacity must be completely untouched
    const remaining = await certificateRegistry.getRemainingQuantity(CERT_ID);
    expect(remaining).to.equal(EXPECTED_REMAINING_GRAMS);
  });

  it("Step 5: Split Child 1 (3,500g) into Sub-lot A (2,000g) & Sub-lot B (1,500g) -> Certificate remaining MUST STILL be 4,000g", async function () {
    await consignmentRegistry
      .connect(cooperative)
      .splitLot("CHILD-1-3500G", ["SUBLOT-A-2000G", "SUBLOT-B-1500G"], [2000n, 1500n]);

    const remaining = await certificateRegistry.getRemainingQuantity(CERT_ID);
    expect(remaining).to.equal(EXPECTED_REMAINING_GRAMS);
  });

  it("Step 6: Transfer Sub-lot B (1,500g) to Roaster and Merge with 2,200g Batch -> Certificate remaining MUST STILL be 4,000g", async function () {
    // Transfer SUBLOT-B to roaster
    await consignmentRegistry
      .connect(cooperative)
      .transferLot("SUBLOT-B-1500G", roaster.address);

    // Roaster merges 2,200g roasted batch + 1,500g companion batch = 3,700g blend
    await consignmentRegistry
      .connect(roaster)
      .mergeLots(["ROASTED-BATCH-2200G", "SUBLOT-B-1500G"], "MERGED-BLEND-3700G");

    const mergedLot = await consignmentRegistry.getLot("MERGED-BLEND-3700G");
    expect(mergedLot.quantityGrams).to.equal(3700n);
    expect(mergedLot.status).to.equal(1); // Active

    // CRITICAL ASSERTION: Certificate capacity remains unchanged
    const remaining = await certificateRegistry.getRemainingQuantity(CERT_ID);
    expect(remaining).to.equal(EXPECTED_REMAINING_GRAMS);
  });

  it("Step 7: Transfer Merged Blend to Retailer -> Certificate remaining MUST STILL be 4,000g", async function () {
    await consignmentRegistry
      .connect(roaster)
      .transferLot("MERGED-BLEND-3700G", retailer.address);

    const remaining = await certificateRegistry.getRemainingQuantity(CERT_ID);
    expect(remaining).to.equal(EXPECTED_REMAINING_GRAMS);
  });

  it("Step 8: Farmer creates Second Root Consignment for EXACT remaining 4,000g -> Certificate balance becomes 0g", async function () {
    await consignmentRegistry
      .connect(farmer)
      .createRootConsignment("LOT-ROOT-SECOND-4KG", CERT_ID, 4000n);

    // Remaining capacity is now exactly 0g
    const remaining = await certificateRegistry.getRemainingQuantity(CERT_ID);
    expect(remaining).to.equal(0n);
  });

  it("Step 9: Over-claiming attempt of even 1 gram REVERTS with InsufficientCertifiedQuantity", async function () {
    await expect(
      consignmentRegistry
        .connect(farmer)
        .createRootConsignment("LOT-ROOT-OVERCLAIM-1G", CERT_ID, 1n)
    ).to.be.revertedWithCustomError(certificateRegistry, "InsufficientCertifiedQuantity");
  });
});
