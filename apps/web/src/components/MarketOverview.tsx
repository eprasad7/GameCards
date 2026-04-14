import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { StatCard } from "./StatCard";
import { TrendingUp, TrendingDown } from "lucide-react";

export function MarketOverview() {
  const { data: market, isLoading } = useQuery({
    queryKey: ["market-index"],
    queryFn: api.getMarketIndex,
    refetchInterval: 60_000,
  });

  const { data: moversUp } = useQuery({
    queryKey: ["movers", "up"],
    queryFn: () => api.getMovers("up", 7),
    refetchInterval: 60_000,
  });

  const { data: moversDown } = useQuery({
    queryKey: ["movers", "down"],
    queryFn: () => api.getMovers("down", 7),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-bg-card" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Index Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pokemon Index"
          value={market?.pokemon_index?.toLocaleString() ?? "--"}
          trend={market?.trend_30d?.startsWith("+") ? "up" : market?.trend_30d?.startsWith("-") ? "down" : "stable"}
          trendValue={market?.trend_30d}
        />
        <StatCard
          label="Sports Index"
          value={market?.sports_index?.toLocaleString() ?? "--"}
          trend={market?.trend_30d?.startsWith("+") ? "up" : market?.trend_30d?.startsWith("-") ? "down" : "stable"}
          trendValue={market?.trend_30d}
        />
        <StatCard
          label="Market Volatility"
          value={market?.volatility ?? "--"}
          subtitle="30-day measure"
        />
        <StatCard
          label="Last Updated"
          value={market?.updated_at ? new Date(market.updated_at).toLocaleTimeString() : "--"}
          subtitle="Auto-refreshes"
        />
      </div>

      {/* Movers — wider two-column layout */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Gainers */}
        <div className="rounded-lg border border-border bg-bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <TrendingUp className="h-4 w-4 text-buy" />
            <h3 className="text-sm font-bold text-text-primary">Top Gainers (7d)</h3>
          </div>
          <div>
            {moversUp?.movers?.slice(0, 5).map((m, i) => (
              <div
                key={m.card_id}
                className={`flex items-center justify-between px-4 py-3 hover:bg-bg-hover ${
                  i < 4 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-bg-secondary text-xs font-bold text-text-muted">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{m.name}</p>
                    <p className="text-xs text-text-muted">{m.grading_company} {m.grade}</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-sm font-bold text-buy">+{m.change_pct.toFixed(1)}%</span>
                  <p className="text-xs text-text-muted">${m.recent_avg.toFixed(2)}</p>
                </div>
              </div>
            )) || (
              <div className="px-4 py-6 text-center text-sm text-text-muted">Loading...</div>
            )}
          </div>
        </div>

        {/* Losers */}
        <div className="rounded-lg border border-border bg-bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <TrendingDown className="h-4 w-4 text-sell" />
            <h3 className="text-sm font-bold text-text-primary">Top Decliners (7d)</h3>
          </div>
          <div>
            {moversDown?.movers?.slice(0, 5).map((m, i) => (
              <div
                key={m.card_id}
                className={`flex items-center justify-between px-4 py-3 hover:bg-bg-hover ${
                  i < 4 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-bg-secondary text-xs font-bold text-text-muted">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{m.name}</p>
                    <p className="text-xs text-text-muted">{m.grading_company} {m.grade}</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-sm font-bold text-sell">{m.change_pct.toFixed(1)}%</span>
                  <p className="text-xs text-text-muted">${m.recent_avg.toFixed(2)}</p>
                </div>
              </div>
            )) || (
              <div className="px-4 py-6 text-center text-sm text-text-muted">Loading...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
