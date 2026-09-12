import React from "react";

interface MassBalanceBarProps {
  certifiedGrams: bigint | number;
  remainingGrams: bigint | number;
  lotID?: string;
  certificateID?: string;
}

export const MassBalanceBar: React.FC<MassBalanceBarProps> = ({
  certifiedGrams,
  remainingGrams,
  lotID,
  certificateID,
}) => {
  const certG = typeof certifiedGrams === "bigint" ? certifiedGrams : BigInt(certifiedGrams || 0);
  const remG = typeof remainingGrams === "bigint" ? remainingGrams : BigInt(remainingGrams || 0);
  const allocG = certG >= remG ? certG - remG : 0n;

  const certKg = Number(certG) / 1000;
  const allocKg = Number(allocG) / 1000;
  const remKg = Number(remG) / 1000;

  const allocPct = certKg > 0 ? Math.min(100, Math.max(0, (allocKg / certKg) * 100)) : 0;
  const remPct = Math.max(0, 100 - allocPct);

  const formatKg = (val: number) =>
    val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " kg";

  return (
    <div className="mass-balance-bar-component" aria-label="Mass Balance Quantitative Balance">
      <div className="mb-header">
        <span className="mb-title">PHYSICAL VOLUME BALANCE ARCHITECTURE</span>
        <span className="mb-delta-badge">
          Certified: {formatKg(certKg)} | Claimed: {formatKg(allocKg)} | Delta: +{formatKg(remKg)} Available
        </span>
      </div>

      {/* Quantitative Tier Cards */}
      <div className="mb-tier-cards">
        <div className="mb-tier-card">
          <span className="mb-tier-label">1. Certified Ceiling</span>
          <div className="mb-tier-value">{formatKg(certKg)}</div>
          <div className="mb-tier-sub">
            {lotID ? `Lot ${lotID}` : certificateID ? `Under ${certificateID}` : "Accredited Harvest Quota"}
          </div>
        </div>

        <div className="mb-tier-card mb-tier-card-allocated">
          <span className="mb-tier-label label-allocated">2. Allocated Downstream</span>
          <div className="mb-tier-value value-allocated">
            {formatKg(allocKg)}
            <span className="mb-pct">({allocPct.toFixed(1)}%)</span>
          </div>
          <div className="mb-tier-sub">Consigned to downstream batches</div>
        </div>

        <div className="mb-tier-card mb-tier-card-reserve">
          <span className="mb-tier-label label-reserve">3. Unallocated Reserve</span>
          <div className="mb-tier-value value-reserve">
            {formatKg(remKg)}
            <span className="mb-pct">({remPct.toFixed(1)}%)</span>
          </div>
          <div className="mb-tier-sub">Available for valid supply issuance</div>
        </div>
      </div>

      {/* Proportional Breakdown Bar */}
      <div className="mb-bar-container">
        <div className="mb-bar-track">
          <div
            className="mb-bar-segment segment-allocated"
            style={{ width: `${allocPct}%` }}
            title={`Allocated: ${formatKg(allocKg)} (${allocPct.toFixed(1)}%)`}
          />
          <div
            className="mb-bar-segment segment-reserve"
            style={{ width: `${remPct}%` }}
            title={`Reserve: ${formatKg(remKg)} (${remPct.toFixed(1)}%)`}
          />
        </div>

        <div className="mb-legend">
          <div className="mb-legend-item">
            <span className="legend-dot dot-allocated" />
            <span className="legend-name">Allocated to Consignments:</span>
            <span className="legend-val">{formatKg(allocKg)} ({allocPct.toFixed(1)}%)</span>
          </div>
          <div className="mb-legend-item">
            <span className="legend-dot dot-reserve" />
            <span className="legend-name">Remaining Quota:</span>
            <span className="legend-val text-green">{formatKg(remKg)} ({remPct.toFixed(1)}%)</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MassBalanceBar;
