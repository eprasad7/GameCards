import { useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { SaleRecord } from "../lib/api";

const TIME_RANGES = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "1Y", days: 365 },
] as const;

interface PriceChartProps {
  sales: SaleRecord[];
  fairValue?: number;
  buyThreshold?: number;
  sellThreshold?: number;
  onRangeChange?: (days: number) => void;
}

export function PriceChart({ sales, fairValue, buyThreshold, sellThreshold, onRangeChange }: PriceChartProps) {
  const [selectedRange, setSelectedRange] = useState(90);

  const handleRangeChange = (days: number) => {
    setSelectedRange(days);
    onRangeChange?.(days);
  };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - selectedRange);

  const filteredSales = sales.filter((s) => new Date(s.sale_date) >= cutoff);

  const data = [...filteredSales]
    .sort((a, b) => new Date(a.sale_date).getTime() - new Date(b.sale_date).getTime())
    .map((s) => ({
      date: new Date(s.sale_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      price: s.price_usd,
      source: s.source,
    }));

  // Compute daily volume for the bar chart
  const volumeByDate = new Map<string, number>();
  for (const s of filteredSales) {
    const d = new Date(s.sale_date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    volumeByDate.set(d, (volumeByDate.get(d) || 0) + 1);
  }
  const volumeData = Array.from(volumeByDate.entries()).map(([date, count]) => ({ date, volume: count }));

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-bg-card shadow-sm">
        <p className="text-text-muted">No price history available</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Price History</h3>
        <div className="flex gap-1 rounded-md bg-bg-secondary p-0.5">
          {TIME_RANGES.map((range) => (
            <button
              key={range.days}
              onClick={() => handleRangeChange(range.days)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedRange === range.days
                  ? "bg-bg-card text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {/* Price area chart */}
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.15} />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
            axisLine={{ stroke: "var(--color-border)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${v}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              color: "var(--color-text-primary)",
              fontSize: 13,
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
            formatter={(value: number) => [`$${value.toFixed(2)}`, "Price"]}
          />
          {fairValue && (
            <ReferenceLine y={fairValue} stroke="var(--color-info)" strokeDasharray="4 4"
              label={{ value: "Fair Value", fill: "var(--color-info)", fontSize: 11 }} />
          )}
          {buyThreshold && (
            <ReferenceLine y={buyThreshold} stroke="var(--color-buy)" strokeDasharray="4 4"
              label={{ value: "Buy", fill: "var(--color-buy)", fontSize: 11 }} />
          )}
          {sellThreshold && (
            <ReferenceLine y={sellThreshold} stroke="var(--color-sell)" strokeDasharray="4 4"
              label={{ value: "Sell", fill: "var(--color-sell)", fontSize: 11 }} />
          )}
          <Area type="monotone" dataKey="price" stroke="var(--color-accent)" strokeWidth={2} fill="url(#priceGradient)" />
        </AreaChart>
      </ResponsiveContainer>

      {/* Volume bar chart */}
      {volumeData.length > 1 && (
        <ResponsiveContainer width="100%" height={60}>
          <BarChart data={volumeData} margin={{ top: 0, right: 5, bottom: 0, left: 5 }}>
            <XAxis dataKey="date" hide />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.375rem",
                color: "var(--color-text-primary)",
                fontSize: 12,
              }}
              formatter={(value: number) => [`${value} sale${value !== 1 ? "s" : ""}`, "Volume"]}
            />
            <Bar dataKey="volume" fill="var(--color-accent)" opacity={0.3} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
