import { useQuery } from "@tanstack/react-query";
import { api, type Card } from "../lib/api";
import { PriceChart } from "./PriceChart";
import { SentimentGauge } from "./SentimentGauge";
import { StatCard } from "./StatCard";
import { ArrowLeft } from "lucide-react";

interface CardDetailProps {
  card: Card;
  onBack: () => void;
}

export function CardDetail({ card, onBack }: CardDetailProps) {
  const { data: price } = useQuery({
    queryKey: ["price", card.id],
    queryFn: () => api.getPrice(card.id, "10", "PSA"),
  });

  const { data: history } = useQuery({
    queryKey: ["history", card.id],
    queryFn: () => api.getHistory(card.id, 90),
  });

  const { data: sentiment } = useQuery({
    queryKey: ["sentiment", card.id],
    queryFn: () => api.getSentiment(card.id),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={onBack}
          className="mt-1 shrink-0 rounded-md p-2 text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-1 items-start gap-4">
          {card.image_url ? (
            <img src={card.image_url} alt={card.name} className="h-24 w-20 rounded-lg border border-border object-cover shadow-sm" />
          ) : (
            <div className="flex h-24 w-20 items-center justify-center rounded-lg border border-border bg-bg-secondary text-2xl text-text-muted shadow-sm">
              ?
            </div>
          )}
          <div>
            <h2 className="text-xl font-bold text-text-primary">{card.name}</h2>
            <p className="text-sm text-text-secondary">
              {card.set_name} ({card.set_year}) &middot; #{card.card_number}
            </p>
            <span className="mt-1 inline-block rounded bg-bg-secondary px-2 py-0.5 text-xs font-medium text-text-secondary">
              {card.category.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      </div>

      {/* Pricing at a glance — GameStop-style pricing row */}
      {price && (
        <div className="rounded-lg border border-border bg-bg-card p-5 shadow-sm">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Fair Value</p>
              <p className="mt-0.5 text-3xl font-extrabold text-text-primary">${price.price.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Price Range (90% CI)</p>
              <p className="mt-0.5 text-lg font-bold text-text-primary">
                ${price.lower.toFixed(0)} &ndash; ${price.upper.toFixed(0)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Sales (30d)</p>
              <p className="mt-0.5 text-lg font-bold text-text-primary">{price.sales_30d}</p>
              <p className="text-xs text-text-muted">
                {price.last_sale ? `Last: ${new Date(price.last_sale).toLocaleDateString()}` : "No recent sales"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Trend</p>
              <p className={`mt-0.5 text-lg font-bold capitalize ${
                price.trend === "rising" ? "text-buy" : price.trend === "falling" ? "text-sell" : "text-text-primary"
              }`}>
                {price.trend}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Confidence</p>
              <p className={`mt-0.5 text-lg font-bold ${
                price.confidence === "HIGH" ? "text-buy" : price.confidence === "LOW" ? "text-sell" : "text-hold"
              }`}>
                {price.confidence}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Charts and Sentiment — full-width layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PriceChart
            sales={history?.sales || []}
            fairValue={price?.price}
            buyThreshold={price?.lower}
            sellThreshold={price?.upper}
          />
        </div>
        <div>
          {sentiment && <SentimentGauge sentiment={sentiment} />}
        </div>
      </div>
    </div>
  );
}
