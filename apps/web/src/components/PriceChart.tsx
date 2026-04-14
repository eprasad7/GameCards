import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { SaleRecord } from "../lib/api";

interface PriceChartProps {
  sales: SaleRecord[];
  fairValue?: number;
  buyThreshold?: number;
  sellThreshold?: number;
}

export function PriceChart({ sales, fairValue, buyThreshold, sellThreshold }: PriceChartProps) {
  const data = [...sales]
    .sort((a, b) => new Date(a.sale_date).getTime() - new Date(b.sale_date).getTime())
    .map((s) => ({
      date: new Date(s.sale_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      price: s.price_usd,
      source: s.source,
    }));

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-bg-card shadow-sm">
        <p className="text-text-muted">No price history available</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-bg-card p-4 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-text-muted">Price History</h3>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e53e3e" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#e53e3e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#888" }}
            axisLine={{ stroke: "#e2e2e2" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#888" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${v}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#fff",
              border: "1px solid #e2e2e2",
              borderRadius: "0.5rem",
              color: "#1a1a1a",
              fontSize: 13,
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
            formatter={(value: number) => [`$${value.toFixed(2)}`, "Price"]}
          />
          {fairValue && (
            <ReferenceLine
              y={fairValue}
              stroke="#3182ce"
              strokeDasharray="4 4"
              label={{ value: "Fair Value", fill: "#3182ce", fontSize: 11 }}
            />
          )}
          {buyThreshold && (
            <ReferenceLine
              y={buyThreshold}
              stroke="#2f855a"
              strokeDasharray="4 4"
              label={{ value: "Buy", fill: "#2f855a", fontSize: 11 }}
            />
          )}
          {sellThreshold && (
            <ReferenceLine
              y={sellThreshold}
              stroke="#e53e3e"
              strokeDasharray="4 4"
              label={{ value: "Sell", fill: "#e53e3e", fontSize: 11 }}
            />
          )}
          <Area
            type="monotone"
            dataKey="price"
            stroke="#e53e3e"
            strokeWidth={2}
            fill="url(#priceGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
