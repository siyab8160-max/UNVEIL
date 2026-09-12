import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const GNOSIS_SAFE_ABI = [
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
  "function nonce() view returns (uint256)",
  "function getThreshold() view returns (uint256)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com");
  const safeAddress = process.env.SAFE_MULTISIG_ADDRESS!;
  const rawPrivateKey = process.env.SEPOLIA_PRIVATE_KEY!.trim();
  const pk = rawPrivateKey.startsWith("0x") ? rawPrivateKey : "0x" + rawPrivateKey;
  const wallet = new ethers.Wallet(pk, provider);

  console.log("===============================================================");
  console.log("        UNVEIL Safe Issuer Execution (3-of-5 Multisig)         ");
  console.log("===============================================================");
  console.log("Safe Address:   ", safeAddress);
  console.log("Caller Account: ", wallet.address);

  const safe = new ethers.Contract(safeAddress, GNOSIS_SAFE_ABI, wallet);
  const currentNonce = Number(await safe.nonce());
  console.log("Current On-Chain Safe Nonce:", currentNonce);

  // Fetch queued transactions from Safe Transaction Service
  const url = `https://safe-transaction-sepolia.safe.global/api/v1/safes/${safeAddress}/multisig-transactions/`;
  const res = await fetch(url).then(r => r.json());

  // Filter unexecuted transactions sorted by nonce ascending
  const queuedTxs = res.results
    .filter((tx: any) => !tx.isExecuted)
    .sort((a: any, b: any) => a.nonce - b.nonce);

  if (queuedTxs.length === 0) {
    console.log("No queued unexecuted transactions found.");
    return;
  }

  for (const tx of queuedTxs) {
    console.log(`\n-------------------------------------------------------------`);
    console.log(`Processing Nonce ${tx.nonce}: ${tx.origin || "Seeding Transaction"}`);
    console.log(`SafeTxHash:     ${tx.safeTxHash}`);
    console.log(`Confirmations:  ${tx.confirmations ? tx.confirmations.length : 0} / ${tx.confirmationsRequired}`);

    // Check if additional owner private keys are configured locally in .env
    const localOwnerPks = [
      process.env.SAFE_OWNER_2_PRIVATE_KEY,
      process.env.SAFE_OWNER_3_PRIVATE_KEY,
      process.env.SAFE_OWNER_4_PRIVATE_KEY,
      process.env.SAFE_OWNER_5_PRIVATE_KEY,
    ].filter(Boolean) as string[];

    const domain = {
      chainId: 11155111n,
      verifyingContract: safeAddress
    };
    const types = {
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" }
      ]
    };
    const message = {
      to: tx.to,
      value: BigInt(tx.value),
      data: tx.data || "0x",
      operation: tx.operation,
      safeTxGas: BigInt(tx.safeTxGas),
      baseGas: BigInt(tx.baseGas),
      gasPrice: BigInt(tx.gasPrice),
      gasToken: tx.gasToken,
      refundReceiver: tx.refundReceiver,
      nonce: BigInt(tx.nonce)
    };

    const confirmationsMap: { [owner: string]: string } = {};
    if (tx.confirmations) {
      for (const conf of tx.confirmations) {
        confirmationsMap[conf.owner.toLowerCase()] = conf.signature;
      }
    }

    // Sign with any available local owner keys
    for (const rawPk of localOwnerPks) {
      const formattedPk = rawPk.trim().startsWith("0x") ? rawPk.trim() : "0x" + rawPk.trim();
      const localOwnerWallet = new ethers.Wallet(formattedPk, provider);
      const isOwner = await safe.isOwner(localOwnerWallet.address).catch(() => false);
      if (isOwner && !confirmationsMap[localOwnerWallet.address.toLowerCase()]) {
        console.log(`Signing nonce ${tx.nonce} with local owner ${localOwnerWallet.address}...`);
        const sig = await localOwnerWallet.signTypedData(domain, types, message);
        confirmationsMap[localOwnerWallet.address.toLowerCase()] = sig;
      }
    }

    const availableOwners = Object.keys(confirmationsMap);
    console.log(`Confirmations available: ${availableOwners.length} / ${tx.confirmationsRequired}`);

    if (availableOwners.length < tx.confirmationsRequired) {
      console.log(`⏳ Awaiting remaining signatures (need ${tx.confirmationsRequired}, currently have ${availableOwners.length}).`);
      console.log(`👉 Approve via Safe Web UI: https://app.safe.global/transactions/queue?safe=sep:${safeAddress}`);
      continue;
    }

    // Sort confirmations by owner address in ascending order (required by Safe contract)
    const sortedOwners = availableOwners.sort((a, b) => a.localeCompare(b));

    // Concatenate signatures
    let concatenatedSignatures = "0x";
    for (const owner of sortedOwners.slice(0, tx.confirmationsRequired)) {
      const sig = confirmationsMap[owner];
      const cleanSig = sig.startsWith("0x") ? sig.slice(2) : sig;
      concatenatedSignatures += cleanSig;
    }

    console.log(`Executing Safe transaction on Sepolia...`);
    const execTx = await safe.execTransaction(
      tx.to,
      tx.value,
      tx.data || "0x",
      tx.operation,
      tx.safeTxGas,
      tx.baseGas,
      tx.gasPrice,
      tx.gasToken,
      tx.refundReceiver,
      concatenatedSignatures
    );

    console.log(`Submitted execTransaction tx: ${execTx.hash}`);
    const receipt = await execTx.wait();
    console.log(`✔ Executed successfully in block ${receipt.blockNumber} (tx: ${execTx.hash})`);
  }
}

main().catch(err => {
  console.error("Execution error:", err);
  process.exitCode = 1;
});
