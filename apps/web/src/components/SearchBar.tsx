import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { api, type Card } from "../lib/api";

interface SearchBarProps {
  onSelect: (card: Card) => void;
}

export function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleSearch = async (q: string) => {
    setQuery(q);
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api.searchCards(q);
      setResults(data.cards);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Search games, consoles & more"
          className="w-full rounded-md border-0 bg-white py-2 pl-9 pr-10 text-sm text-text-primary shadow-sm placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-text-muted" />}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-bg-card shadow-lg">
          {results.map((card) => (
            <button
              key={card.id}
              onClick={() => {
                onSelect(card);
                setOpen(false);
                setQuery(card.name);
              }}
              className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-bg-hover"
            >
              {card.image_url ? (
                <img src={card.image_url} alt="" className="h-10 w-8 rounded object-cover" />
              ) : (
                <div className="flex h-10 w-8 items-center justify-center rounded bg-bg-secondary text-xs text-text-muted">
                  ?
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{card.name}</p>
                <p className="text-xs text-text-muted">
                  {card.set_name} ({card.set_year})
                </p>
              </div>
              <span className="shrink-0 rounded bg-bg-secondary px-2 py-0.5 text-xs font-medium text-text-secondary">
                {card.category.replace(/_/g, " ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
