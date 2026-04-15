import { useQuery } from "@tanstack/react-query";
import { api, type Card } from "../lib/api";
import { Loader2 } from "lucide-react";

interface CategoryBrowseProps {
  category: string;
  onCardSelect: (card: Card) => void;
}

export function CategoryBrowse({ category, onCardSelect }: CategoryBrowseProps) {
  // Search with category filter — use a broad query to get all cards
  const { data, isLoading } = useQuery({
    queryKey: ["browse", category],
    queryFn: () => api.searchCards("", category || undefined),
  });

  const cards = data?.cards || [];

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-bg-card">
        <p className="text-sm text-text-muted">No cards found{category ? ` in ${category.replace(/_/g, " ")}` : ""}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((card) => (
        <button
          key={card.id}
          onClick={() => onCardSelect(card)}
          className="flex items-start gap-3 rounded-lg border border-border bg-bg-card p-4 text-left shadow-sm transition-colors hover:border-accent/30 hover:bg-bg-hover min-h-[44px]"
        >
          {card.image_url ? (
            <img src={card.image_url} alt="" className="h-16 w-12 shrink-0 rounded object-cover" />
          ) : (
            <div className={`flex h-16 w-12 shrink-0 items-center justify-center rounded text-sm font-bold text-text-inverse ${
              card.category === "pokemon" ? "bg-amber-500" :
              card.category.startsWith("sports_") ? "bg-blue-600" :
              card.category.startsWith("tcg_") ? "bg-purple-600" : "bg-gray-500"
            }`}>
              {card.name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary truncate">{card.name}</p>
            <p className="text-xs text-text-muted">{card.set_name}</p>
            {card.set_year > 0 && <p className="text-xs text-text-muted">{card.set_year}</p>}
            <span className="mt-1 inline-block rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
              {card.category.replace(/_/g, " ")}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
