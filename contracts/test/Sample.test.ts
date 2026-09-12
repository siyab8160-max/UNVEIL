import { expect } from "chai";
import { ethers } from "hardhat";

describe("Sample Contract Environment Verification", function () {
  it("Should deploy Sample contract and return initial status", async function () {
    const SampleFactory = await ethers.getContractFactory("Sample");
    const sample = await SampleFactory.deploy("Phase0_Ready");
    await sample.waitForDeployment();

    expect(await sample.getStatus()).to.equal("Phase0_Ready");
  });

  it("Should update status and emit StatusUpdated event", async function () {
    const [owner] = await ethers.getSigners();
    const SampleFactory = await ethers.getContractFactory("Sample");
    const sample = await SampleFactory.deploy("Initial");
    await sample.waitForDeployment();

    await expect(sample.updateStatus("Updated"))
      .to.emit(sample, "StatusUpdated")
      .withArgs("Updated", owner.address);

    expect(await sample.getStatus()).to.equal("Updated");
  });
});
