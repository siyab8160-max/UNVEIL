import dotenv from "dotenv";
dotenv.config();

export interface YieldBenchmarkMetadata {
  readonly benchmarkType: "ANALYTICAL_SCREENING_BENCHMARK";
  readonly commodity: string;
  readonly thresholdKgPerHa: number;
  readonly thresholdGramsPerHa: string;
  readonly unit: string;
  readonly primarySources: readonly string[];
  readonly publications: readonly string[];
  readonly publicationYears: string;
  readonly geographyAndAssumptions: string;
  readonly thresholdDerivation: string;
  readonly regulatoryDisclaimer: string;
}

export const YIELD_BENCHMARK_CONFIG: YieldBenchmarkMetadata = {
  benchmarkType: "ANALYTICAL_SCREENING_BENCHMARK",
  commodity: "Certified Organic Arabica Green Coffee (Coffea arabica)",
  thresholdKgPerHa: 2500,
  thresholdGramsPerHa: "2500000", // 2,500 kg = 2,500,000 g
  unit: "kg green coffee / hectare (kg/ha)",
  primarySources: [
    "USDA Foreign Agricultural Service (FAS) Global Agricultural Information Network (GAIN)",
    "International Coffee Organization (ICO) Historical Production Statistics"
  ],
  publications: [
    "USDA FAS GAIN Coffee Annual (Colombia & Central America, 2022-2024)",
    "ICO Historical Agronomic Statistics on Arabica Yields by Production System"
  ],
  publicationYears: "2022-2024",
  geographyAndAssumptions:
    "Shade-grown agroforestry smallholders in Central America and Andean Colombia. Organic shade canopy production without synthetic nitrogen fertilizers or chemical biocides typically yields 500-1,200 kg/ha. Well-managed organic plots peak around 1,500-2,000 kg/ha.",
  thresholdDerivation:
    "Analytical screening benchmark set at 2,500 kg/ha (125% of optimal organic ceiling). Yields above this figure indicate high probability of conventional bean commingling or farm area under-reporting.",
  regulatoryDisclaimer:
    "This threshold is strictly an analytical screening benchmark for risk scoring and auditor review. It is NOT a regulatory maximum codified in USDA Organic 7 CFR Part 205, nor a universal biological law. Farms exceeding this screening benchmark are flagged for audit, not automatically penalized or revoked on-chain."
};

export const CONFIG = {
  DATABASE_URL: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/certledger?schema=public",
  PORT: parseInt(process.env.PORT || "4000", 10),
  RPC_URL: process.env.RPC_URL || "http://127.0.0.1:8545",
  CHAIN_ID: parseInt(process.env.CHAIN_ID || "11155111", 10),
  DEPLOYMENT_START_BLOCK: parseInt(process.env.DEPLOYMENT_START_BLOCK || "11684480", 10),
  
  // Contracts
  ISSUER_REGISTRY_ADDRESS: process.env.ISSUER_REGISTRY_ADDRESS || "0x7c787f9AbDE336c8A377f8fF08527B4e3B918dFA",
  CERTIFICATE_REGISTRY_ADDRESS: process.env.CERTIFICATE_REGISTRY_ADDRESS || "0x021A1289Aa4589A1a4B83C8b878a91aDD0F0C83b",
  CONSIGNMENT_REGISTRY_ADDRESS: process.env.CONSIGNMENT_REGISTRY_ADDRESS || "0xC1fF045DCB2731AaFee1d398509b022Ed1F51688",

  // Escalation thresholds
  CASE_ESCALATION_RISK_THRESHOLD: parseInt(process.env.CASE_ESCALATION_RISK_THRESHOLD || "80", 10),
  CASE_ESCALATION_REPORT_THRESHOLD: parseInt(process.env.CASE_ESCALATION_REPORT_THRESHOLD || "3", 10),

  // Yield Benchmark
  YIELD_BENCHMARK: YIELD_BENCHMARK_CONFIG
};
