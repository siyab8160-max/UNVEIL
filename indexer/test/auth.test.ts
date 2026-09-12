import { expect } from "chai";
import request from "supertest";
import { ethers } from "ethers";
import { createApp } from "../src/server";
import { CONFIG } from "../src/config";

describe("UNVEIL Phase 5 Server-Side SIWE Authentication Boundary", () => {
  const app = createApp();

  function buildSiweMessage(params: {
    domain: string;
    address: string;
    statement: string;
    uri: string;
    version: string;
    chainId: number;
    nonce: string;
    issuedAt: string;
  }): string {
    return (
      `${params.domain} wants you to sign in with your Ethereum account:\n` +
      `${params.address}\n\n` +
      `${params.statement}\n\n` +
      `URI: ${params.uri}\n` +
      `Version: ${params.version}\n` +
      `Chain ID: ${params.chainId}\n` +
      `Nonce: ${params.nonce}\n` +
      `Issued At: ${params.issuedAt}`
    );
  }

  it("1. should issue a fresh cryptographically random nonce", async () => {
    const res = await request(app).get("/api/auth/nonce");
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property("nonce");
    expect(res.body.nonce).to.be.a("string").with.lengthOf(32);
  });

  it("2. should verify a valid SIWE signature and issue an authenticated session token", async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonceRes = await request(app).get("/api/auth/nonce");
    const nonce = nonceRes.body.nonce;

    const message = buildSiweMessage({
      domain: "localhost:5173",
      address: wallet.address,
      statement: "Sign in to UNVEIL to access the Issuer & Producer Dashboard.",
      uri: "http://localhost:5173",
      version: "1",
      chainId: CONFIG.CHAIN_ID, // 11155111 Sepolia
      nonce,
      issuedAt: new Date().toISOString(),
    });

    const signature = await wallet.signMessage(message);

    const verifyRes = await request(app)
      .post("/api/auth/verify")
      .send({ message, signature });

    expect(verifyRes.status).to.equal(200);
    expect(verifyRes.body.success).to.equal(true);
    expect(verifyRes.body.session).to.have.property("token");
    expect(verifyRes.body.session.address.toLowerCase()).to.equal(wallet.address.toLowerCase());
    expect(verifyRes.body.session.chainId).to.equal(CONFIG.CHAIN_ID);
    expect(verifyRes.body.notice).to.include("SIWE authenticates wallet ownership");
  });

  it("3. should enforce replay protection: reusing the same nonce must fail", async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonceRes = await request(app).get("/api/auth/nonce");
    const nonce = nonceRes.body.nonce;

    const message = buildSiweMessage({
      domain: "localhost:5173",
      address: wallet.address,
      statement: "Sign in to UNVEIL to access the Issuer & Producer Dashboard.",
      uri: "http://localhost:5173",
      version: "1",
      chainId: CONFIG.CHAIN_ID,
      nonce,
      issuedAt: new Date().toISOString(),
    });

    const signature = await wallet.signMessage(message);

    // First attempt succeeds and consumes the nonce
    const firstRes = await request(app)
      .post("/api/auth/verify")
      .send({ message, signature });
    expect(firstRes.status).to.equal(200);

    // Second replay attempt with consumed nonce must fail
    const replayRes = await request(app)
      .post("/api/auth/verify")
      .send({ message, signature });
    expect(replayRes.status).to.equal(401);
    expect(replayRes.body.error).to.include("already-consumed nonce");
  });

  it("4. should enforce network check: rejecting non-Sepolia chain ID", async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonceRes = await request(app).get("/api/auth/nonce");
    const nonce = nonceRes.body.nonce;

    const message = buildSiweMessage({
      domain: "localhost:5173",
      address: wallet.address,
      statement: "Sign in to UNVEIL to access the Issuer & Producer Dashboard.",
      uri: "http://localhost:5173",
      version: "1",
      chainId: 1, // Mainnet instead of Sepolia
      nonce,
      issuedAt: new Date().toISOString(),
    });

    const signature = await wallet.signMessage(message);

    const res = await request(app)
      .post("/api/auth/verify")
      .send({ message, signature });

    expect(res.status).to.equal(401);
    expect(res.body.error).to.include("Network mismatch: expected chain ID 11155111 (Sepolia)");
  });

  it("5. should reject tampered signatures or address mismatch", async () => {
    const wallet1 = ethers.Wallet.createRandom();
    const wallet2 = ethers.Wallet.createRandom();
    const nonceRes = await request(app).get("/api/auth/nonce");
    const nonce = nonceRes.body.nonce;

    const message = buildSiweMessage({
      domain: "localhost:5173",
      address: wallet1.address,
      statement: "Sign in to UNVEIL to access the Issuer & Producer Dashboard.",
      uri: "http://localhost:5173",
      version: "1",
      chainId: CONFIG.CHAIN_ID,
      nonce,
      issuedAt: new Date().toISOString(),
    });

    // Signed by wallet2 instead of wallet1
    const tamperedSig = await wallet2.signMessage(message);

    const res = await request(app)
      .post("/api/auth/verify")
      .send({ message, signature: tamperedSig });

    expect(res.status).to.equal(401);
    expect(res.body.error).to.include("Signature recovery mismatch");
  });

  it("6. should validate active session and support logout", async () => {
    const wallet = ethers.Wallet.createRandom();
    const nonceRes = await request(app).get("/api/auth/nonce");
    const nonce = nonceRes.body.nonce;

    const message = buildSiweMessage({
      domain: "localhost:5173",
      address: wallet.address,
      statement: "Sign in to UNVEIL to access the Issuer & Producer Dashboard.",
      uri: "http://localhost:5173",
      version: "1",
      chainId: CONFIG.CHAIN_ID,
      nonce,
      issuedAt: new Date().toISOString(),
    });

    const signature = await wallet.signMessage(message);
    const verifyRes = await request(app)
      .post("/api/auth/verify")
      .send({ message, signature });

    const token = verifyRes.body.session.token;

    // Check active session
    const sessionRes = await request(app)
      .get("/api/auth/session")
      .set("Authorization", `Bearer ${token}`);
    expect(sessionRes.status).to.equal(200);
    expect(sessionRes.body.authenticated).to.equal(true);
    expect(sessionRes.body.session.address.toLowerCase()).to.equal(wallet.address.toLowerCase());

    // Logout
    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(logoutRes.status).to.equal(200);

    // After logout, session is invalid
    const revokedCheck = await request(app)
      .get("/api/auth/session")
      .set("Authorization", `Bearer ${token}`);
    expect(revokedCheck.status).to.equal(401);
    expect(revokedCheck.body.authenticated).to.equal(false);
  });
});
