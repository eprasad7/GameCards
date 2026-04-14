import type { SentimentResponse } from "../lib/api";

interface SentimentGaugeProps {
  sentiment: SentimentResponse;
}

export function SentimentGauge({ sentiment }: SentimentGaugeProps) {
  const pct = Math.round((sentiment.score + 1) * 50);

  const trendColors: Record<string, string> = {
    spiking: "text-buy font-bold",
    rising: "text-buy",
    stable: "text-text-muted",
    falling: "text-sell",
    crashing: "text-sell font-bold",
  };

  const sentimentLabel =
    sentiment.score > 0.5 ? "Very Bullish" :
    sentiment.score > 0.2 ? "Bullish" :
    sentiment.score > -0.2 ? "Neutral" :
    sentiment.score > -0.5 ? "Bearish" :
    "Very Bearish";

  return (
    <div className="rounded-lg border border-border bg-bg-card p-4 shadow-sm">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Social Sentiment</h3>

      <div className="mb-4">
        <div className="flex justify-between text-[11px] font-medium text-text-muted">
          <span>Bearish</span>
          <span>Bullish</span>
        </div>
        <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-bg-secondary">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg, var(--color-sell), var(--color-hold), var(--color-buy))",
            }}
          />
        </div>
        <p className="mt-1.5 text-center text-sm font-bold text-text-primary">{sentimentLabel}</p>
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-center">
        <div>
          <p className="text-xl font-bold text-text-primary">{sentiment.score.toFixed(2)}</p>
          <p className="text-[11px] text-text-muted">Score</p>
        </div>
        <div>
          <p className="text-xl font-bold text-text-primary">{sentiment.mentions_7d}</p>
          <p className="text-[11px] text-text-muted">Mentions (7d)</p>
        </div>
        <div>
          <p className={`text-xl font-bold capitalize ${trendColors[sentiment.trend] || "text-text-primary"}`}>
            {sentiment.trend}
          </p>
          <p className="text-[11px] text-text-muted">Trend</p>
        </div>
      </div>
    </div>
  );
}
