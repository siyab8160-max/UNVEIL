import React, { useState, useMemo } from "react";
import type { CaseRecord } from "../../services/indexerApi";

interface CaseQueueProps {
  cases: CaseRecord[];
  selectedCaseId: string | null;
  onSelectCase: (caseRecord: CaseRecord) => void;
  isLoading?: boolean;
}

export const CaseQueue: React.FC<CaseQueueProps> = ({
  cases,
  selectedCaseId,
  onSelectCase,
  isLoading = false,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      const matchesFilter =
        filterStatus === "ALL" || c.status === filterStatus;
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        c.caseID.toLowerCase().includes(query) ||
        (c.lotID && c.lotID.toLowerCase().includes(query)) ||
        (c.certificateID && c.certificateID.toLowerCase().includes(query)) ||
        c.anomalyType.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [cases, filterStatus, searchQuery]);

  const stats = useMemo(() => {
    return {
      total: cases.length,
      open: cases.filter((c) => c.status === "OPEN").length,
      underReview: cases.filter((c) => c.status === "UNDER_REVIEW").length,
      highRisk: cases.filter((c) => c.riskScore >= 80).length,
      resolved: cases.filter((c) => c.status === "RESOLVED").length,
    };
  }, [cases]);

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "OPEN":
        return "badge-status-open";
      case "UNDER_REVIEW":
        return "badge-status-review";
      case "REVOCATION_PENDING":
        return "badge-status-pending";
      case "RESOLVED":
        return "badge-status-resolved";
      case "DISMISSED":
        return "badge-status-dismissed";
      case "ESCALATED":
        return "badge-status-escalated";
      default:
        return "badge-status-default";
    }
  };

  const getRiskBadgeClass = (score: number) => {
    if (score >= 80) return "badge-risk-critical";
    if (score >= 50) return "badge-risk-high";
    if (score > 0) return "badge-risk-medium";
    return "badge-risk-low";
  };

  return (
    <div className="case-queue-container">
      {/* Summary KPI Cards */}
      <div className="queue-kpi-grid">
        <div className="queue-kpi-card">
          <span className="kpi-label">Total Cases</span>
          <span className="kpi-value">{stats.total}</span>
        </div>
        <div className="queue-kpi-card kpi-warning">
          <span className="kpi-label">Open / Unassigned</span>
          <span className="kpi-value">{stats.open}</span>
        </div>
        <div className="queue-kpi-card kpi-info">
          <span className="kpi-label">Under Active Review</span>
          <span className="kpi-value">{stats.underReview}</span>
        </div>
        <div className="queue-kpi-card kpi-danger">
          <span className="kpi-label">Critical Risk (≥80)</span>
          <span className="kpi-value">{stats.highRisk}</span>
        </div>
        <div className="queue-kpi-card kpi-success">
          <span className="kpi-label">Resolved</span>
          <span className="kpi-value">{stats.resolved}</span>
        </div>
      </div>

      {/* Queue Filter Controls */}
      <div className="queue-filter-toolbar">
        <div className="status-filter-pills">
          {["ALL", "OPEN", "UNDER_REVIEW", "REVOCATION_PENDING", "RESOLVED", "DISMISSED"].map(
            (status) => (
              <button
                key={status}
                type="button"
                className={`pill-btn ${filterStatus === status ? "active" : ""}`}
                onClick={() => setFilterStatus(status)}
              >
                {status.replace("_", " ")}
              </button>
            )
          )}
        </div>
        <div className="queue-search-box">
          <input
            type="text"
            placeholder="Search by Case, Lot, or Cert ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="queue-search-input"
            aria-label="Filter case queue"
          />
        </div>
      </div>

      {/* Case Table */}
      {isLoading ? (
        <div className="queue-loading-state">
          <span className="spinner" />
          <p>Loading regulatory case queue from Phase 3 API...</p>
        </div>
      ) : filteredCases.length === 0 ? (
        <div className="queue-empty-state">
          <p>No cases match the selected filter criteria.</p>
        </div>
      ) : (
        <div className="queue-table-wrapper">
          <table className="queue-table" role="table">
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Target Lot / Cert</th>
                <th>Risk Score</th>
                <th>Anomaly Rule / Trigger</th>
                <th>Status</th>
                <th>Assigned Role</th>
                <th>Opened</th>
                <th>Reviewer</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredCases.map((c) => {
                const isSelected = c.caseID === selectedCaseId;
                return (
                  <tr
                    key={c.caseID}
                    className={`queue-row ${isSelected ? "selected-row" : ""}`}
                    onClick={() => onSelectCase(c)}
                  >
                    <td>
                      <code className="case-id-code">{c.caseID.slice(0, 8)}...</code>
                    </td>
                    <td>
                      <div className="lot-cert-cell">
                        {c.lotID && <span className="cell-lot-id">{c.lotID}</span>}
                        {c.certificateID && (
                          <span className="cell-cert-id">{c.certificateID}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`risk-pill ${getRiskBadgeClass(c.riskScore)}`}>
                        {c.riskScore}/100
                      </span>
                    </td>
                    <td>
                      <span className="rule-type-tag">{c.anomalyType}</span>
                    </td>
                    <td>
                      <span className={`status-pill ${getStatusBadgeClass(c.status)}`}>
                        {c.status.replace("_", " ")}
                      </span>
                    </td>
                    <td>
                      <span className="role-tag">{c.assignedRole}</span>
                    </td>
                    <td>
                      <span className="timestamp-text">
                        {new Date(c.openedAt).toLocaleDateString()}
                      </span>
                    </td>
                    <td>
                      <span className="reviewer-text">
                        {c.reviewer || "—"}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-select-case"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectCase(c);
                        }}
                      >
                        {isSelected ? "Active" : "Review"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CaseQueue;
