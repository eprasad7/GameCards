import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "stable";
  trendValue?: string;
  variant?: "default" | "buy" | "sell" | "hold";
}

export function StatCard({ label, value, subtitle, trend, trendValue, variant = "default" }: StatCardProps) {
  const borderColor = {
    default: "border-border",
    buy: "border-buy/40",
    sell: "border-sell/40",
    hold: "border-hold/40",
  }[variant];

  const trendIcon = {
    up: <TrendingUp className="h-4 w-4 text-buy" />,
    down: <TrendingDown className="h-4 w-4 text-sell" />,
    stable: <Minus className="h-4 w-4 text-text-muted" />,
  };

  return (
    <div className={`rounded-lg border bg-bg-card p-4 shadow-sm ${borderColor}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-text-primary">{value}</p>
      <div className="mt-1 flex items-center gap-1.5">
        {trend && trendIcon[trend]}
        {trendValue && (
          <span className={`text-sm font-medium ${trend === "up" ? "text-buy" : trend === "down" ? "text-sell" : "text-text-muted"}`}>
            {trendValue}
          </span>
        )}
        {subtitle && <span className="text-xs text-text-muted">{subtitle}</span>}
      </div>
    </div>
  );
}
