import { PrismaClient, Prisma } from "@prisma/client";
import { Contract, JsonRpcProvider, Log } from "ethers";
import prisma from "./db";
import { CONFIG } from "./config";
import { parseContractLog, ParsedEvent } from "./event-parser";
import { AnomalyEngine } from "./anomaly-engine";

export interface ProcessEventParams {
  chainId: number;
  contractAddress: string;
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
  blockTimestamp: Date;
  eventName: string;
  payload: Record<string, any>;
  reportedAreaHectares?: Prisma.Decimal | number | null;
}

export class IndexerService {
  private db: PrismaClient;
  private provider?: JsonRpcProvider;
  private anomalyEngine: AnomalyEngine;

  constructor(
    dbClient: PrismaClient = prisma,
    anomalyEngine?: AnomalyEngine,
    rpcUrl?: string
  ) {
    this.db = dbClient;
    this.anomalyEngine = anomalyEngine || new AnomalyEngine(dbClient, rpcUrl);
    const url = rpcUrl || process.env.RPC_URL || CONFIG.RPC_URL;
    if (url && url.startsWith("http") && !url.includes("127.0.0.1:8545")) {
      try {
        this.provider = new JsonRpcProvider(url, undefined, { staticNetwork: true });
      } catch {
        // Provider optional in isolated test mode
      }
    }
  }

  /**
   * Process a single event safely with atomic idempotency and projection projection updates.
   * If the (chainId, transactionHash, logIndex) has already been processed, skips replay.
   */
  public async processEvent(params: ProcessEventParams): Promise<boolean> {
    const {
      chainId,
      contractAddress,
      transactionHash,
      blockNumber,
      logIndex,
      blockTimestamp,
      eventName,
      payload,
    } = params;

    // 1. Deduplication check
    const existing = await this.db.indexedEvent.findUnique({
      where: {
        chainId_transactionHash_logIndex: {
          chainId,
          transactionHash,
          logIndex,
        },
      },
    });

    if (existing) {
      console.log(`[Indexer] Skipping duplicate event: ${eventName} (${transactionHash}:${logIndex})`);
      return false; // Already indexed
    }

    // 2. Persist to immutable IndexedEvent table
    await this.db.indexedEvent.create({
      data: {
        chainId,
        contractAddress: contractAddress.toLowerCase(),
        transactionHash,
        blockNumber,
        logIndex,
        eventName,
        payload,
        blockTimestamp,
        processed: true,
      },
    });

    // 3. Project state into non-authoritative read tables and trigger anomalies
    await this.projectEvent(eventName, payload, {
      blockNumber,
      transactionHash,
      blockTimestamp,
      reportedAreaHectares: params.reportedAreaHectares,
    });

    return true;
  }

  /**
   * Process a raw ethers Log
   */
  public async processLog(log: Log, blockTimestamp: Date = new Date()): Promise<boolean> {
    const parsed = parseContractLog(log);
    if (!parsed) {
      return false;
    }

    return this.processEvent({
      chainId: CONFIG.CHAIN_ID,
      contractAddress: log.address,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      blockTimestamp,
      eventName: parsed.eventName,
      payload: parsed.args,
    });
  }

  /**
   * Route event projections to appropriate schema tables
   */
  private async projectEvent(
    eventName: string,
    payload: Record<string, any>,
    meta: {
      blockNumber: number;
      transactionHash: string;
      blockTimestamp: Date;
      reportedAreaHectares?: Prisma.Decimal | number | null;
    }
  ): Promise<void> {
    switch (eventName) {
      // --- IssuerRegistry Events ---
      case "IssuerRegistered": {
        const { sourceID, issuerAddress, name, accreditingBody, accreditationExpiry } = payload;
        await this.db.issuerIndex.upsert({
          where: { sourceID },
          update: {
            issuerAddress: issuerAddress || null,
            name,
            accreditingBody,
            accreditationExpiry: new Date(Number(accreditationExpiry) * 1000),
            latestBlock: meta.blockNumber,
          },
          create: {
            sourceID,
            issuerAddress: issuerAddress || null,
            name,
            accreditingBody,
            accreditationExpiry: new Date(Number(accreditationExpiry) * 1000),
            latestBlock: meta.blockNumber,
          },
        });
        break;
      }

      case "IssuerRevoked": {
        const { sourceID, reason } = payload;
        await this.db.issuerIndex.updateMany({
          where: { sourceID },
          data: {
            isRevoked: true,
            revocationReason: reason,
            latestBlock: meta.blockNumber,
          },
        });
        break;
      }

      case "IssuerRecordClaimed": {
        const { sourceID, newOwner } = payload;
        await this.db.issuerIndex.updateMany({
          where: { sourceID },
          data: {
            issuerAddress: newOwner,
            verifiedOwner: newOwner,
            latestBlock: meta.blockNumber,
          },
        });
        break;
      }

      // --- CertificateRegistry Events ---
      case "CertificateIssued": {
        const {
          certificateID,
          issuer,
          holder,
          standardID,
          certifiedQuantityGrams,
          validFrom,
          validUntil,
        } = payload;

        await this.db.certificateIndex.upsert({
          where: { certificateID },
          update: {
            issuer,
            holder,
            standardID,
            certifiedQuantityGrams: BigInt(certifiedQuantityGrams),
            remainingQuantityGrams: BigInt(certifiedQuantityGrams),
            validFrom: new Date(Number(validFrom) * 1000),
            validUntil: new Date(Number(validUntil) * 1000),
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
          create: {
            certificateID,
            issuer,
            holder,
            standardID,
            certifiedQuantityGrams: BigInt(certifiedQuantityGrams),
            remainingQuantityGrams: BigInt(certifiedQuantityGrams),
            validFrom: new Date(Number(validFrom) * 1000),
            validUntil: new Date(Number(validUntil) * 1000),
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
        });
        break;
      }

      case "CertificateRevoked": {
        const { certificateID, reason, revokedBy } = payload;
        await this.db.certificateIndex.updateMany({
          where: { certificateID },
          data: {
            isRevoked: true,
            revocationReason: reason,
            revokedBy,
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
        });
        break;
      }

      case "CertifiedQuantityConsumed": {
        const { certificateID, remainingQuantityGrams } = payload;
        await this.db.certificateIndex.updateMany({
          where: { certificateID },
          data: {
            remainingQuantityGrams: BigInt(remainingQuantityGrams),
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
        });
        break;
      }

      case "MassBalanceAlert": {
        const { certificateID, caller, requestedQuantityGrams, remainingQuantityGrams, reason } =
          payload;
        await this.anomalyEngine.evaluateMassBalanceOverflow({
          certificateID,
          caller,
          requestedQuantityGrams: BigInt(requestedQuantityGrams),
          remainingQuantityGrams: BigInt(remainingQuantityGrams),
          reason: reason || "Capacity Exceeded",
          blockNumber: meta.blockNumber,
          txHash: meta.transactionHash,
        });
        break;
      }

      // --- ConsignmentRegistry Events ---
      case "RootConsignmentCreated": {
        const { lotID, certificateID, holder, quantityGrams } = payload;
        const qGrams = BigInt(quantityGrams);

        await this.db.lotIndex.upsert({
          where: { lotID },
          update: {
            certificateID,
            quantityGrams: qGrams,
            currentOwner: holder,
            status: "ACTIVE",
            reportedAreaHectares: meta.reportedAreaHectares ? new Prisma.Decimal(meta.reportedAreaHectares.toString()) : null,
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
          create: {
            lotID,
            certificateID,
            quantityGrams: qGrams,
            currentOwner: holder,
            status: "ACTIVE",
            reportedAreaHectares: meta.reportedAreaHectares ? new Prisma.Decimal(meta.reportedAreaHectares.toString()) : null,
            createdAtBlock: meta.blockNumber,
            createdAtTx: meta.transactionHash,
            createdAtTimestamp: meta.blockTimestamp,
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
        });

        // Trigger Rule 2: Yield Implausibility
        await this.anomalyEngine.evaluateYieldImplausibility({
          lotID,
          certificateID,
          quantityGrams: qGrams,
          reportedAreaHectares: meta.reportedAreaHectares,
          blockNumber: meta.blockNumber,
          txHash: meta.transactionHash,
        });

        // Trigger Rule 3: Stale Reference Check
        await this.anomalyEngine.evaluateStaleCertificateReference({
          lotID,
          certificateID,
          blockNumber: meta.blockNumber,
          txHash: meta.transactionHash,
        });
        break;
      }

      case "LotSplit": {
        const { parentLotID, childLotIDs, childQuantitiesGrams, owner } = payload;

        // Parent marked CONSUMED
        await this.db.lotIndex.updateMany({
          where: { lotID: parentLotID },
          data: {
            status: "CONSUMED",
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
        });

        // Find parent lot to get certificateID
        const parentLot = await this.db.lotIndex.findUnique({
          where: { lotID: parentLotID },
        });
        const certID = parentLot ? parentLot.certificateID : "UNKNOWN";

        // Create child lots and lineage edges
        for (let i = 0; i < childLotIDs.length; i++) {
          const childID = childLotIDs[i];
          const childQty = BigInt(childQuantitiesGrams[i]);

          await this.db.lotIndex.upsert({
            where: { lotID: childID },
            update: {
              certificateID: certID,
              quantityGrams: childQty,
              currentOwner: owner,
              status: "ACTIVE",
              latestBlock: meta.blockNumber,
              latestTxHash: meta.transactionHash,
            },
            create: {
              lotID: childID,
              certificateID: certID,
              quantityGrams: childQty,
              currentOwner: owner,
              status: "ACTIVE",
              createdAtBlock: meta.blockNumber,
              createdAtTx: meta.transactionHash,
              createdAtTimestamp: meta.blockTimestamp,
              latestBlock: meta.blockNumber,
              latestTxHash: meta.transactionHash,
            },
          });

          await this.db.lotLineage.upsert({
            where: {
              parentLotID_childLotID: {
                parentLotID,
                childLotID: childID,
              },
            },
            update: {},
            create: {
              parentLotID,
              childLotID: childID,
              operationType: "SPLIT",
              createdAtBlock: meta.blockNumber,
              createdAtTx: meta.transactionHash,
            },
          });
        }
        break;
      }

      case "LotsMerged": {
        const { parentLotIDs, newLotID, newQuantityGrams, owner } = payload;

        // Mark all parents CONSUMED
        await this.db.lotIndex.updateMany({
          where: { lotID: { in: parentLotIDs } },
          data: {
            status: "CONSUMED",
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
        });

        // Determine certificateID from the first parent
        const firstParent = await this.db.lotIndex.findUnique({
          where: { lotID: parentLotIDs[0] },
        });
        const certID = firstParent ? firstParent.certificateID : "UNKNOWN";

        // Create merged lot
        await this.db.lotIndex.upsert({
          where: { lotID: newLotID },
          update: {
            certificateID: certID,
            quantityGrams: BigInt(newQuantityGrams),
            currentOwner: owner,
            status: "ACTIVE",
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
          create: {
            lotID: newLotID,
            certificateID: certID,
            quantityGrams: BigInt(newQuantityGrams),
            currentOwner: owner,
            status: "ACTIVE",
            createdAtBlock: meta.blockNumber,
            createdAtTx: meta.transactionHash,
            createdAtTimestamp: meta.blockTimestamp,
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
        });

        // Create lineage edges for all parents
        for (const pID of parentLotIDs) {
          await this.db.lotLineage.upsert({
            where: {
              parentLotID_childLotID: {
                parentLotID: pID,
                childLotID: newLotID,
              },
            },
            update: {},
            create: {
              parentLotID: pID,
              childLotID: newLotID,
              operationType: "MERGE",
              createdAtBlock: meta.blockNumber,
              createdAtTx: meta.transactionHash,
            },
          });
        }
        break;
      }

      case "LotProcessed": {
        const { parentLotID, newLotID, outputQuantityGrams, processDetails, owner } = payload;

        // Mark input lot CONSUMED
        await this.db.lotIndex.updateMany({
          where: { lotID: parentLotID },
          data: {
            status: "CONSUMED",
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
        });

        // Get certificateID from parent
        const parent = await this.db.lotIndex.findUnique({
          where: { lotID: parentLotID },
        });
        const certID = parent ? parent.certificateID : "UNKNOWN";

        // Create output lot
        await this.db.lotIndex.upsert({
          where: { lotID: newLotID },
          update: {
            certificateID: certID,
            quantityGrams: BigInt(outputQuantityGrams),
            currentOwner: owner,
            status: "ACTIVE",
            processDetails,
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
          create: {
            lotID: newLotID,
            certificateID: certID,
            quantityGrams: BigInt(outputQuantityGrams),
            currentOwner: owner,
            status: "ACTIVE",
            processDetails,
            createdAtBlock: meta.blockNumber,
            createdAtTx: meta.transactionHash,
            createdAtTimestamp: meta.blockTimestamp,
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
        });

        // Lineage edge
        await this.db.lotLineage.upsert({
          where: {
            parentLotID_childLotID: {
              parentLotID,
              childLotID: newLotID,
            },
          },
          update: {},
          create: {
            parentLotID,
            childLotID: newLotID,
            operationType: "PROCESS",
            createdAtBlock: meta.blockNumber,
            createdAtTx: meta.transactionHash,
          },
        });
        break;
      }

      case "LotTransferred": {
        const { lotID, newOwner } = payload;
        await this.db.lotIndex.updateMany({
          where: { lotID },
          data: {
            currentOwner: newOwner,
            latestBlock: meta.blockNumber,
            latestTxHash: meta.transactionHash,
          },
        });
        break;
      }

      default:
        console.log(`[Indexer] Unhandled event: ${eventName}`);
    }
  }

  /**
   * Sync indexed block range from blockchain RPC
   */
  public async syncBlockRange(contractAddress: string, fromBlock: number, toBlock: number): Promise<number> {
    if (!this.provider) {
      throw new Error("Provider not configured for on-chain block sync");
    }

    const logs = await this.provider.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
    });

    let processedCount = 0;
    for (const log of logs) {
      const block = await this.provider.getBlock(log.blockNumber);
      const timestamp = block ? new Date(block.timestamp * 1000) : new Date();
      const processed = await this.processLog(log, timestamp);
      if (processed) processedCount++;
    }

    // Update synced state
    await this.db.indexerState.upsert({
      where: { contractAddress: contractAddress.toLowerCase() },
      update: { lastBlockSynced: toBlock },
      create: { contractAddress: contractAddress.toLowerCase(), lastBlockSynced: toBlock },
    });

    return processedCount;
  }
}

export default IndexerService;
