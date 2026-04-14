import { useState } from "react";
import { api, type EvaluateResponse, type Card } from "../lib/api";
import { SearchBar } from "./SearchBar";
import { DollarSign, Loader2 } from "lucide-react";

interface EvaluateCardProps {
  onCardSelect?: (card: Card) => void;
}

export function EvaluateCard({ onCardSelect }: EvaluateCardProps) {
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [price, setPrice] = useState("");
  const [grade, setGrade] = useState("10");
  const [gradingCompany, setGradingCompany] = useState("PSA");
  const [result, setResult] = useState<EvaluateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleEvaluate = async () => {
    if (!selectedCard || !price) return;
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      setError("Please enter a positive price");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await api.evaluate(selectedCard.id, priceNum, grade, gradingCompany);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setLoading(false);
    }
  };

  const decisionStyles: Record<string, string> = {
    STRONG_BUY: "bg-buy/10 text-buy border-buy/30",
    REVIEW_BUY: "bg-hold/10 text-hold border-hold/30",
    FAIR_VALUE: "bg-info/10 text-info border-info/30",
    SELL_SIGNAL: "bg-sell/10 text-sell border-sell/30",
  };

  return (
    <div className="rounded-lg border border-border bg-bg-card p-6 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card search instead of raw ID input */}
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
            Card
          </label>
          {selectedCard ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg-primary px-3 py-2">
              <span className="flex-1 truncate text-sm font-medium text-text-primary">{selectedCard.name}</span>
              <button
                onClick={() => { setSelectedCard(null); setResult(null); }}
                className="shrink-0 text-xs text-accent hover:text-accent-hover"
              >
                Change
              </button>
            </div>
          ) : (
            <SearchBar onSelect={(card) => {
              setSelectedCard(card);
              onCardSelect?.(card);
            }} />
          )}
        </div>

        <div>
          <label htmlFor="eval-price" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
            Offered Price
          </label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              id="eval-price"
              type="number"
              min="0.01"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="250.00"
              className="w-full rounded-md border border-border bg-bg-primary py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-accent"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="eval-grade" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">Grade</label>
            <select
              id="eval-grade"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
            >
              {["RAW", "1", "2", "3", "4", "5", "6", "7", "8", "8.5", "9", "9.5", "10"].map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor="eval-company" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">Co.</label>
            <select
              id="eval-company"
              value={gradingCompany}
              onChange={(e) => setGradingCompany(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
            >
              {["PSA", "BGS", "CGC", "SGC", "RAW"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <button
        onClick={handleEvaluate}
        disabled={loading || !selectedCard || !price}
        className="mt-4 flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50 min-h-[44px]"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Evaluate Price
      </button>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {result && (
        <div className="mt-5 rounded-lg border border-border bg-bg-primary p-4">
          <div className={`mb-3 inline-flex rounded-md border px-4 py-2 text-lg font-extrabold ${decisionStyles[result.decision] || ""}`}>
            {result.decision.replace(/_/g, " ")}
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <span className="text-text-muted">Fair Value</span>
              <p className="text-lg font-bold text-text-primary">${result.fair_value.toFixed(2)}</p>
            </div>
            <div>
              <span className="text-text-muted">Net Margin</span>
              <p className={`text-lg font-bold ${result.margin > 0 ? "text-buy" : "text-sell"}`}>
                {result.margin > 0 ? "+" : ""}{result.margin.toFixed(1)}%
              </p>
            </div>
            <div>
              <span className="text-text-muted">Confidence</span>
              <p className="text-lg font-bold text-text-primary">{result.confidence}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-text-secondary">{result.reasoning}</p>
        </div>
      )}
    </div>
  );
}
