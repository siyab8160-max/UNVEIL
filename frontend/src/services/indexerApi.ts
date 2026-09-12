import { INDEXER_API_BASE_URL } from "./config";

export interface StandardData {
  standardID: string;
  standardName: string;
  commodity: string;
  accreditingAuthority: string;
  authoritativeSource: string;
  authoritativeSourceUrl: string;
  regulatoryCitation: string;
  coveredDimensions: string[];
  excludedDimensions: string[];
  coveredCitations: Record<string, string>;
  excludedRationales: Record<string, string>;
}

export interface ProvenanceNode {
  parentLotID?: string;
  childLotID?: string;
  operationType: string;
  quantityGrams: string;
  status: string;
}

export interface ProvenanceLineage {
  ancestors: ProvenanceNode[];
  descendants: ProvenanceNode[];
}

export interface OpenCaseInfo {
  caseID: string;
  anomalyType: string;
  status: string;
  assignedRole: string;
  openedAt: string;
}

export interface SupplementaryDataResult {
  isAvailable: boolean;
  standard: StandardData | null;
  lineage: ProvenanceLineage | null;
  openCase: OpenCaseInfo | null;
  error: string | null;
}

// Deterministic source-backed fallback standard (7 CFR Part 205)
export const FALLBACK_USDA_STANDARD: StandardData = {
  standardID: "USDA-NOP-ORGANIC",
  standardName: "USDA National Organic Program (7 CFR Part 205)",
  commodity: "Coffee (Green and Roasted Beans)",
  accreditingAuthority: "United States Department of Agriculture (USDA) Agricultural Marketing Service (AMS)",
  authoritativeSource: "USDA Organic INTEGRITY Database",
  authoritativeSourceUrl: "https://organic.ams.usda.gov/Integrity/",
  regulatoryCitation: "Title 7, Code of Federal Regulations, Part 205 (7 CFR Part 205)",
  coveredDimensions: [
    "farming_practices",
    "synthetic_substance_prohibition",
    "soil_fertility_and_nutrient_management",
    "pest_weed_and_disease_management",
    "processing_and_handling_separation",
    "non_gmo_excluded_methods",
    "supply_chain_traceability"
  ],
  excludedDimensions: [
    "fair_wages_and_labor_conditions",
    "living_wage_and_fair_pricing",
    "carbon_neutrality_and_ghg_emissions",
    "shipping_and_transport_emissions",
    "biodegradable_packaging"
  ],
  coveredCitations: {
    farming_practices: "7 CFR §205.200, §205.201",
    synthetic_substance_prohibition: "7 CFR §205.105, §205.601",
    soil_fertility_and_nutrient_management: "7 CFR §205.203",
    pest_weed_and_disease_management: "7 CFR §205.206",
    processing_and_handling_separation: "7 CFR §205.270, §205.272",
    non_gmo_excluded_methods: "7 CFR §205.105(a), §205.2",
    supply_chain_traceability: "7 CFR §205.103, 88 FR 3548"
  },
  excludedRationales: {
    fair_wages_and_labor_conditions: "OFPA statute (7 U.S.C. 6501) limits NOP authority to organic production/handling; no labor/wage mandate.",
    living_wage_and_fair_pricing: "7 CFR Part 205 contains no price floors or social premiums.",
    carbon_neutrality_and_ghg_emissions: "No greenhouse gas metrics or carbon neutrality requirements exist under NOP.",
    shipping_and_transport_emissions: "Post-harvest transport logistics emissions outside NOP regulatory scope.",
    biodegradable_packaging: "7 CFR §205.272 restricts packaging contamination but permits conventional food-grade plastics/foil."
  }
};

/**
 * Fetch supplementary data from Phase 3 Backend:
 * Standards breakdown, historical provenance graph, and active investigation case.
 *
 * CRITICAL RULE: Backend availability MUST NOT block blockchain verification.
 * If backend fails, return isAvailable = false without throwing errors.
 */
export async function fetchSupplementaryData(
  lotID: string,
  certificateID?: string
): Promise<SupplementaryDataResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const investigationUrl = `${INDEXER_API_BASE_URL}/api/investigations/status?lotID=${encodeURIComponent(lotID)}${
      certificateID ? `&certificateID=${encodeURIComponent(certificateID)}` : ""
    }`;

    const [standardsRes, lotRes, investigationRes] = await Promise.allSettled([
      fetch(`${INDEXER_API_BASE_URL}/api/standards`, { signal: controller.signal }),
      fetch(`${INDEXER_API_BASE_URL}/api/lots/${encodeURIComponent(lotID)}`, { signal: controller.signal }),
      fetch(investigationUrl, { signal: controller.signal }),
    ]);

    clearTimeout(timeoutId);

    // 1. Process Standard Data
    let standard: StandardData = FALLBACK_USDA_STANDARD;
    if (standardsRes.status === "fulfilled" && standardsRes.value.ok) {
      const data = await standardsRes.value.json();
      if (data.standards && data.standards.length > 0) {
        standard = data.standards[0];
      }
    }

    // 2. Process Provenance Lineage
    let lineage: ProvenanceLineage | null = null;
    if (lotRes.status === "fulfilled" && lotRes.value.ok) {
      const lotData = await lotRes.value.json();
      if (lotData.data && lotData.data.lineage) {
        lineage = lotData.data.lineage;
      }
    }

    // 3. Process Sanitized Investigation Indicator (No raw risk scores, rule IDs, or reviewer identities exposed)
    let openCase: OpenCaseInfo | null = null;
    if (investigationRes.status === "fulfilled" && investigationRes.value.ok) {
      const invData = await investigationRes.value.json();
      if (invData.isUnderInvestigation && invData.case) {
        openCase = {
          caseID: invData.case.caseID,
          anomalyType: "INVESTIGATION_ACTIVE",
          status: invData.case.status,
          assignedRole: "AUDITOR",
          openedAt: invData.case.openedAt,
        };
      }
    }

    const backendConnected =
      (standardsRes.status === "fulfilled" && standardsRes.value.ok) ||
      (lotRes.status === "fulfilled" && lotRes.value.ok) ||
      (investigationRes.status === "fulfilled" && investigationRes.value.ok);

    return {
      isAvailable: backendConnected,
      standard,
      lineage,
      openCase,
      error: backendConnected ? null : "Supplementary indexer details currently unavailable.",
    };
  } catch (err: any) {
    // Graceful offline fallback: supplementary data unavailable, but blockchain status stands!
    return {
      isAvailable: false,
      standard: FALLBACK_USDA_STANDARD,
      lineage: null,
      openCase: null,
      error: "Supplementary indexer details currently unavailable.",
    };
  }
}

export interface ConsumerReportPayload {
  lotID?: string;
  certificateID?: string;
  issueType: "PRODUCT_MISLABELING" | "TAMPERED_SEAL" | "SUSPECTED_NON_ORGANIC" | "VOLUME_DISCREPANCY";
  reporterReference: string;
  evidence?: Record<string, any>;
}

export interface ConsumerReportResponse {
  success: boolean;
  reportID?: string;
  dedupeKey?: string;
  submittedAt?: string;
  error?: string;
}

/**
 * Submit consumer report to Phase 3 API: POST /api/reports
 * Exposes no internal risk score or case details to consumer.
 */
export async function submitConsumerReport(
  payload: ConsumerReportPayload
): Promise<ConsumerReportResponse> {
  try {
    const res = await fetch(`${INDEXER_API_BASE_URL}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json();
      return { success: false, error: err.error || "Failed to submit report" };
    }

    const data = await res.json();
    return {
      success: true,
      reportID: data.report?.reportID,
      dedupeKey: data.report?.dedupeKey,
      submittedAt: data.report?.submittedAt,
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Network error submitting report" };
  }
}

// ---------------------------------------------------------------------------
// Phase 6 Regulator & Auditor Case Management API
// ---------------------------------------------------------------------------

export interface AnomalyFlagRecord {
  id: string;
  ruleID: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  riskScore: number;
  status: "FLAGGED" | "INSUFFICIENT_DATA" | "EVALUATED";
  lotID?: string | null;
  certificateID?: string | null;
  description: string;
  evidence: Record<string, any>;
  blockNumber: number;
  txHash: string;
  detectedAt: string;
  caseID?: string | null;
}

export interface CaseAuditLogRecord {
  id: string;
  caseID: string;
  actor: string;
  action: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  notes?: string | null;
  timestamp: string;
}

export interface CaseConsumerReportRecord {
  reportID: string;
  lotID?: string | null;
  certificateID?: string | null;
  issueType: string;
  submittedAt: string;
  reporterReference: string;
  dedupeKey: string;
  evidence?: Record<string, any> | null;
}

export interface CaseRecord {
  caseID: string;
  lotID?: string | null;
  certificateID?: string | null;
  anomalyType: string;
  riskScore: number;
  status: "OPEN" | "UNDER_REVIEW" | "REVOCATION_PENDING" | "RESOLVED" | "DISMISSED" | "ESCALATED";
  assignedRole: string;
  openedAt: string;
  reviewer?: string | null;
  resolution?: string | null;
  resolvedAt?: string | null;
  evidence: Record<string, any>;
  anomalies?: AnomalyFlagRecord[];
  reports?: CaseConsumerReportRecord[];
  auditLogs?: CaseAuditLogRecord[];
}

/**
 * Helper to obtain authorization header from parameter or session storage.
 */
function getAuthHeaders(token?: string): Record<string, string> {
  const activeToken =
    token ||
    (typeof window !== "undefined" ? sessionStorage.getItem("certledger_siwe_token") || undefined : undefined);
  return activeToken ? { Authorization: `Bearer ${activeToken}` } : {};
}

/**
 * Fetches all cases from Phase 3 API, optionally filtered by status.
 * Protected: Requires SIWE authentication token.
 */
export async function fetchCases(statusFilter?: string, token?: string): Promise<CaseRecord[]> {
  try {
    const url = statusFilter && statusFilter !== "ALL"
      ? `${INDEXER_API_BASE_URL}/api/cases?status=${encodeURIComponent(statusFilter)}`
      : `${INDEXER_API_BASE_URL}/api/cases`;
    
    const headers = getAuthHeaders(token);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    return data.cases || [];
  } catch (err) {
    console.error("fetchCases error:", err);
    return [];
  }
}

/**
 * Fetches an individual case by ID with full evidence, anomalies, reports, and audit logs.
 * Protected: Requires SIWE authentication token.
 */
export async function fetchCaseById(caseID: string, token?: string): Promise<CaseRecord | null> {
  try {
    const headers = getAuthHeaders(token);
    const res = await fetch(`${INDEXER_API_BASE_URL}/api/cases/${encodeURIComponent(caseID)}`, { headers });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`fetchCaseById error for ${caseID}:`, err);
    return null;
  }
}

/**
 * Transitions case status (e.g. OPEN -> UNDER_REVIEW, UNDER_REVIEW -> DISMISSED, UNDER_REVIEW -> REVOCATION_PENDING).
 * Strictly off-chain workflow mutation.
 */
export async function transitionCaseStatus(
  caseID: string,
  newStatus: string,
  actor: string,
  notes?: string,
  token?: string
): Promise<{ success: boolean; case?: CaseRecord; error?: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${INDEXER_API_BASE_URL}/api/cases/${encodeURIComponent(caseID)}/transition`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actor, newStatus, notes }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || `Transition to ${newStatus} failed` };
    }

    return { success: true, case: data.case };
  } catch (err: any) {
    return { success: false, error: err.message || "Network error during case transition" };
  }
}

/**
 * Resolves a case with official decision (e.g. REVOCATION_CONFIRMED, NO_VIOLATION_FOUND).
 */
export async function resolveCaseRecord(
  caseID: string,
  resolution: string,
  actor: string,
  notes?: string,
  token?: string
): Promise<{ success: boolean; case?: CaseRecord; error?: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${INDEXER_API_BASE_URL}/api/cases/${encodeURIComponent(caseID)}/resolve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actor, resolution, notes }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || "Case resolution failed" };
    }

    return { success: true, case: data.case };
  } catch (err: any) {
    return { success: false, error: err.message || "Network error during case resolution" };
  }
}

/**
 * Fetches raw anomaly flags (Regulator / Auditor only).
 */
export async function fetchRawAnomalies(
  filters?: {
    ruleID?: string;
    severity?: string;
    status?: string;
  },
  token?: string
): Promise<AnomalyFlagRecord[]> {
  try {
    const params = new URLSearchParams();
    if (filters?.ruleID) params.set("ruleID", filters.ruleID);
    if (filters?.severity) params.set("severity", filters.severity);
    if (filters?.status) params.set("status", filters.status);

    const qs = params.toString();
    const url = qs ? `${INDEXER_API_BASE_URL}/api/anomalies?${qs}` : `${INDEXER_API_BASE_URL}/api/anomalies`;

    const headers = getAuthHeaders(token);
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return data.anomalies || [];
  } catch {
    return [];
  }
}

