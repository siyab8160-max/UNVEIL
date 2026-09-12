import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  IssuerRegistry,
  CertificateRegistry,
  ConsignmentRegistry,
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Consignment Provenance & Graph Traversal (§7.3)", function () {
  let admin: SignerWithAddress;
  let multisigSafe: SignerWithAddress;
  let activeIssuer: SignerWithAddress;
  let producerHolder: SignerWithAddress;

  let issuerRegistry: IssuerRegistry;
  let certificateRegistry: CertificateRegistry;
  let consignmentRegistry: ConsignmentRegistry;

  before(async function () {
    [admin, multisigSafe, activeIssuer, producerHolder] = await ethers.getSigners();

    const IssuerRegistryFactory = await ethers.getContractFactory("IssuerRegistry");
    issuerRegistry = await IssuerRegistryFactory.deploy(admin.address, multisigSafe.address);
    await issuerRegistry.waitForDeployment();

    const now = await time.latest();
    await issuerRegistry
      .connect(multisigSafe)
      .registerIssuer(
        "IAF-GRAPH",
        activeIssuer.address,
        "Graph Certifier",
        "IAF",
        now + 365 * 24 * 3600,
        "IAF"
      );

    const CertificateRegistryFactory = await ethers.getContractFactory("CertificateRegistry");
    certificateRegistry = await CertificateRegistryFactory.deploy(
      admin.address,
      await issuerRegistry.getAddress(),
      admin.address
    );
    await certificateRegistry.waitForDeployment();

    const ConsignmentRegistryFactory = await ethers.getContractFactory("ConsignmentRegistry");
    consignmentRegistry = await ConsignmentRegistryFactory.deploy(
      await certificateRegistry.getAddress()
    );
    await consignmentRegistry.waitForDeployment();

    const CONSIGNMENT_REGISTRY_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("CONSIGNMENT_REGISTRY_ROLE")
    );
    await certificateRegistry.grantRole(
      CONSIGNMENT_REGISTRY_ROLE,
      await consignmentRegistry.getAddress()
    );

    // Issue certificate with 50,000g capacity
    await certificateRegistry
      .connect(activeIssuer)
      .issueCertificate(
        "CERT-TREE-001",
        "ORGANIC-STD",
        producerHolder.address,
        50000n,
        now + 10,
        now + 365 * 24 * 3600,
        "SRC",
        "SRC-ID"
      );

    await time.increaseTo(now + 20);

    // Build the tree:
    // ROOT (20,000g)
    // ├── CHILD-1 (12,000g) ──► PROCESSED-1 (10,000g, 2000g loss) ──┐
    // └── CHILD-2 (8,000g)  ──► SUBCHILD-2A (5,000g) ──────────────┴──► MERGED-M (15,000g)
    //                       ──► SUBCHILD-2B (3,000g)

    // 1. Root
    await consignmentRegistry
      .connect(producerHolder)
      .createRootConsignment("ROOT-LOT", "CERT-TREE-001", 20000n);

    // 2. Split ROOT -> CHILD-1 & CHILD-2
    await consignmentRegistry
      .connect(producerHolder)
      .splitLot("ROOT-LOT", ["CHILD-1", "CHILD-2"], [12000n, 8000n]);

    // 3. Process CHILD-1 -> PROCESSED-1 (10,000g)
    await consignmentRegistry
      .connect(producerHolder)
      .processLot("CHILD-1", "PROCESSED-1", 10000n, "Milling grain");

    // 4. Split CHILD-2 -> SUBCHILD-2A (5,000g) & SUBCHILD-2B (3,000g)
    await consignmentRegistry
      .connect(producerHolder)
      .splitLot("CHILD-2", ["SUBCHILD-2A", "SUBCHILD-2B"], [5000n, 3000n]);

    // 5. Merge PROCESSED-1 (10,000g) + SUBCHILD-2A (5,000g) -> MERGED-M (15,000g)
    await consignmentRegistry
      .connect(producerHolder)
      .mergeLots(["PROCESSED-1", "SUBCHILD-2A"], "MERGED-M");
  });

  it("Should return direct parents and children in getConsignmentHistory", async function () {
    const history = await consignmentRegistry.getConsignmentHistory("CHILD-1");
    expect(history.lot.lotID).to.equal("CHILD-1");
    expect(history.lot.status).to.equal(2); // Consumed
    expect(history.parentLotIDs).to.deep.equal(["ROOT-LOT"]);
    expect(history.childLotIDs).to.deep.equal(["PROCESSED-1"]);
  });

  it("Should traverse backwards and retrieve all ancestors up to ROOT-LOT", async function () {
    const ancestors = await consignmentRegistry.getAncestors("MERGED-M");

    // Must include PROCESSED-1, SUBCHILD-2A, CHILD-1, CHILD-2, ROOT-LOT
    expect(ancestors).to.include("PROCESSED-1");
    expect(ancestors).to.include("SUBCHILD-2A");
    expect(ancestors).to.include("CHILD-1");
    expect(ancestors).to.include("CHILD-2");
    expect(ancestors).to.include("ROOT-LOT");
  });

  it("Should traverse forwards and retrieve all descendants from ROOT-LOT", async function () {
    const descendants = await consignmentRegistry.getDescendants("ROOT-LOT");

    // Must include all derived lots in the sub-tree
    expect(descendants).to.include("CHILD-1");
    expect(descendants).to.include("CHILD-2");
    expect(descendants).to.include("PROCESSED-1");
    expect(descendants).to.include("SUBCHILD-2A");
    expect(descendants).to.include("SUBCHILD-2B");
    expect(descendants).to.include("MERGED-M");
  });
});
