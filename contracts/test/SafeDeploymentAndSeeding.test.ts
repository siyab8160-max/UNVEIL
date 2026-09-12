import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  IssuerRegistry,
  CertificateRegistry,
  ConsignmentRegistry,
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { REAL_USDA_CERTIFIERS } from "../scripts/seed-issuers-safe";

/**
 * @notice Safe Multisig Seeding and Collision Verification Test
 *
 * Verifies:
 * 1. Safe multisig caller invariant: IssuerRegistry enforces `msg.sender == safeAddress` (MULTISIG_ROLE).
 * 2. An individual signer/wallet cannot directly call `registerIssuer()`.
 * 3. Multiple unclaimed real-world certifiers (CCOF, OTCO, Mayacert) can all be registered
 *    with `issuerAddress = address(0)` without collision or overwriting.
 * 4. Distinct records are retrievable by `sourceID`.
 * 5. Dynamic status for unclaimed records is Active via `getIssuerStatusBySourceID()`.
 * 6. Claiming an unclaimed record assigns verifiedOwner and maps the claiming address without collision.
 */
describe("Safe Multisig Seeding & Unclaimed Collision Test", function () {
  let admin: SignerWithAddress;
  let signer1: SignerWithAddress;
  let signer2: SignerWithAddress;
  let signer3: SignerWithAddress;
  let signer4: SignerWithAddress;
  let signer5: SignerWithAddress;
  let safeMultisigMock: SignerWithAddress; // Represents the 3-of-5 Safe contract address
  let demoClaimerCCOF: SignerWithAddress;
  let demoClaimerOTCO: SignerWithAddress;

  let issuerRegistry: IssuerRegistry;
  let certificateRegistry: CertificateRegistry;
  let consignmentRegistry: ConsignmentRegistry;

  const MULTISIG_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MULTISIG_ROLE"));

  beforeEach(async function () {
    [
      admin,
      signer1,
      signer2,
      signer3,
      signer4,
      signer5,
      safeMultisigMock,
      demoClaimerCCOF,
      demoClaimerOTCO,
    ] = await ethers.getSigners();

    // Deploy IssuerRegistry designating safeMultisigMock as the MULTISIG_ROLE holder
    const IssuerRegistryFactory = await ethers.getContractFactory("IssuerRegistry");
    issuerRegistry = await IssuerRegistryFactory.deploy(admin.address, safeMultisigMock.address);
    await issuerRegistry.waitForDeployment();

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

    // Grant CONSIGNMENT_REGISTRY_ROLE
    const CONSIGNMENT_REGISTRY_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("CONSIGNMENT_REGISTRY_ROLE")
    );
    await certificateRegistry.grantRole(
      CONSIGNMENT_REGISTRY_ROLE,
      await consignmentRegistry.getAddress()
    );
  });

  it("Should reject direct registration from individual Safe owners (must be executed by Safe contract)", async function () {
    const cert = REAL_USDA_CERTIFIERS[0];

    // Individual signer1 attempts direct call
    await expect(
      issuerRegistry
        .connect(signer1)
        .registerIssuer(
          cert.sourceID,
          cert.issuerAddress,
          cert.name,
          cert.accreditingBody,
          cert.accreditationExpiry,
          cert.source
        )
    ).to.be.revertedWithCustomError(issuerRegistry, "AccessControlUnauthorizedAccount");
  });

  it("Should allow Safe multisig to register all 3 real USDA certifiers with address(0) without collision", async function () {
    for (const cert of REAL_USDA_CERTIFIERS) {
      await expect(
        issuerRegistry
          .connect(safeMultisigMock)
          .registerIssuer(
            cert.sourceID,
            cert.issuerAddress, // address(0)
            cert.name,
            cert.accreditingBody,
            cert.accreditationExpiry,
            cert.source
          )
      )
        .to.emit(issuerRegistry, "IssuerRegistered")
        .withArgs(
          cert.sourceID,
          ethers.ZeroAddress,
          cert.name,
          cert.accreditingBody,
          cert.accreditationExpiry
        );
    }

    // Verify Record 1: CCOF
    const ccof = await issuerRegistry.getIssuerBySourceID("CCOF");
    expect(ccof.sourceID).to.equal("CCOF");
    expect(ccof.name).to.equal("CCOF Certification Services, LLC");
    expect(ccof.issuerAddress).to.equal(ethers.ZeroAddress);
    expect(ccof.verifiedOwner).to.equal(ethers.ZeroAddress);
    expect(await issuerRegistry.getIssuerStatusBySourceID("CCOF")).to.equal(1); // Active

    // Verify Record 2: OTCO
    const otco = await issuerRegistry.getIssuerBySourceID("OTCO");
    expect(otco.sourceID).to.equal("OTCO");
    expect(otco.name).to.equal("Oregon Tilth Certified Organic");
    expect(otco.issuerAddress).to.equal(ethers.ZeroAddress);
    expect(otco.verifiedOwner).to.equal(ethers.ZeroAddress);
    expect(await issuerRegistry.getIssuerStatusBySourceID("OTCO")).to.equal(1); // Active

    // Verify Record 3: MAYACERT
    const mayacert = await issuerRegistry.getIssuerBySourceID("MAYACERT");
    expect(mayacert.sourceID).to.equal("MAYACERT");
    expect(mayacert.name).to.equal("Mayacert, S.A.");
    expect(mayacert.issuerAddress).to.equal(ethers.ZeroAddress);
    expect(mayacert.verifiedOwner).to.equal(ethers.ZeroAddress);
    expect(await issuerRegistry.getIssuerStatusBySourceID("MAYACERT")).to.equal(1); // Active

    // Verify all 3 coexist distinctly under their respective sourceIDs
    expect(ccof.sourceID).to.not.equal(otco.sourceID);
    expect(otco.sourceID).to.not.equal(mayacert.sourceID);
  });

  it("Should allow a real certifier to claim their mirrored record without impacting other unclaimed records", async function () {
    // Register all 3 certifiers with address(0)
    for (const cert of REAL_USDA_CERTIFIERS) {
      await issuerRegistry
        .connect(safeMultisigMock)
        .registerIssuer(
          cert.sourceID,
          cert.issuerAddress,
          cert.name,
          cert.accreditingBody,
          cert.accreditationExpiry,
          cert.source
        );
    }

    // Demo claimer claims CCOF record with proof
    const proof = ethers.toUtf8Bytes("USDA_NOP_DOMAIN_VERIFICATION_CCOF_ORG");
    await expect(
      issuerRegistry.connect(demoClaimerCCOF).claimIssuerRecord("CCOF", proof)
    )
      .to.emit(issuerRegistry, "IssuerRecordClaimed")
      .withArgs("CCOF", ethers.ZeroAddress, demoClaimerCCOF.address);

    // CCOF is now mapped to demoClaimerCCOF
    const ccof = await issuerRegistry.getIssuerBySourceID("CCOF");
    expect(ccof.issuerAddress).to.equal(demoClaimerCCOF.address);
    expect(ccof.verifiedOwner).to.equal(demoClaimerCCOF.address);
    expect(await issuerRegistry.getIssuerStatus(demoClaimerCCOF.address)).to.equal(1); // Active
    expect(await issuerRegistry.isIssuerActive(demoClaimerCCOF.address)).to.be.true;

    // OTCO and MAYACERT remain unclaimed and unaffected
    const otco = await issuerRegistry.getIssuerBySourceID("OTCO");
    expect(otco.issuerAddress).to.equal(ethers.ZeroAddress);
    expect(otco.verifiedOwner).to.equal(ethers.ZeroAddress);
    expect(await issuerRegistry.getIssuerStatusBySourceID("OTCO")).to.equal(1); // Still Active by sourceID

    const mayacert = await issuerRegistry.getIssuerBySourceID("MAYACERT");
    expect(mayacert.issuerAddress).to.equal(ethers.ZeroAddress);
    expect(mayacert.verifiedOwner).to.equal(ethers.ZeroAddress);

    // Demo claimer claims OTCO record with a separate distinct address
    const proofOTCO = ethers.toUtf8Bytes("USDA_NOP_DOMAIN_VERIFICATION_TILTH_ORG");
    await issuerRegistry.connect(demoClaimerOTCO).claimIssuerRecord("OTCO", proofOTCO);

    const updatedOTCO = await issuerRegistry.getIssuerBySourceID("OTCO");
    expect(updatedOTCO.issuerAddress).to.equal(demoClaimerOTCO.address);
    expect(updatedOTCO.verifiedOwner).to.equal(demoClaimerOTCO.address);
    expect(await issuerRegistry.isIssuerActive(demoClaimerOTCO.address)).to.be.true;
  });
});
