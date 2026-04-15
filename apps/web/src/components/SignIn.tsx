import { useState } from "react";
import { BarChart3, Lock, ArrowRight } from "lucide-react";

interface SignInProps {
  onAuthenticated: () => void;
}

const ACCESS_CODE = "GMESTART2026";

export function SignIn({ onAuthenticated }: SignInProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(false);

    // Small delay for UX feel
    setTimeout(() => {
      if (code.trim().toUpperCase() === ACCESS_CODE) {
        localStorage.setItem("gamecards_authenticated", "true");
        localStorage.setItem("gamecards_api_key", "gamecards-demo-key-2026");
        onAuthenticated();
      } else {
        setError(true);
        setLoading(false);
      }
    }, 400);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-nav p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent/20">
              <BarChart3 className="h-7 w-7 text-accent" />
            </div>
          </div>
          <h1 className="text-2xl font-extrabold text-text-inverse">
            Game<span className="text-accent">Cards</span>
          </h1>
          <p className="mt-1 text-sm text-text-inverse/50">
            Dynamic Pricing Engine
          </p>
        </div>

        {/* Sign in card */}
        <div className="rounded-xl bg-bg-card p-6 shadow-lg">
          <div className="mb-5 flex items-center gap-2">
            <Lock className="h-4 w-4 text-text-muted" />
            <h2 className="text-sm font-semibold text-text-primary">Enter Access Code</h2>
          </div>

          <form onSubmit={handleSubmit}>
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setError(false);
              }}
              placeholder="ACCESS CODE"
              autoFocus
              className={`w-full rounded-lg border px-4 py-3 text-center text-lg font-mono font-bold tracking-widest text-text-primary placeholder:text-text-muted/40 focus-visible:outline-2 focus-visible:outline-accent ${
                error ? "border-sell bg-sell/5" : "border-border bg-bg-primary"
              }`}
            />

            {error && (
              <p className="mt-2 text-center text-sm text-sell">
                Invalid access code. Please try again.
              </p>
            )}

            <button
              type="submit"
              disabled={loading || code.length === 0}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-3 text-sm font-bold text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50 min-h-[48px]"
            >
              {loading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-inverse border-t-transparent" />
              ) : (
                <>
                  Access Dashboard
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-text-inverse/30">
          GameStop AI/ML Engineering &middot; Confidential
        </p>
      </div>
    </div>
  );
}
