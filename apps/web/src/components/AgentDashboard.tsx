import { useAgent } from "agents/react";
import { useState } from "react";
import { Bot, Activity, TrendingUp, ShieldCheck, Loader2, Check, X, RefreshCw } from "lucide-react";

// Agent state types (matching server-side)
interface MonitorState {
  lastCheckAt: string | null;
  activeAlerts: Array<{ cardId: string; cardName: string; type: string; magnitude: number; detectedAt: string }>;
  checksRun: number;
  anomaliesDetected: number;
}

interface IntelligenceState {
  reports: Array<{ id: string; date: string; summary: string; marketSentiment: string; generatedAt: string }>;
  lastGeneratedAt: string | null;
  totalReports: number;
}

interface TrackerState {
  lastScanAt: string | null;
  priceGaps: Array<{ cardId: string; cardName: string; gapPct: number; direction: string; platform: string }>;
  scansCompleted: number;
}

interface Recommendation {
  id: string;
  cardName: string;
  action: string;
  currentPrice: number;
  recommendedPrice: number;
  expectedMargin: number;
  confidence: string;
  reasoning: string;
  status: string;
}

interface RecommendationState {
  pending: Recommendation[];
  history: Recommendation[];
  lastGeneratedAt: string | null;
  stats: { totalGenerated: number; totalApproved: number; totalRejected: number; totalExpired: number };
}

export function AgentDashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">Agent Control Center</h1>
      <p className="text-sm text-text-secondary">Real-time agent state via WebSocket — no polling</p>

      <div className="grid gap-6 lg:grid-cols-2">
        <PriceMonitorPanel />
        <MarketIntelPanel />
        <CompetitorPanel />
        <RecommendationsPanel />
      </div>
    </div>
  );
}

function PriceMonitorPanel() {
  const agent = useAgent<MonitorState>({ agent: "price-monitor-agent", name: "default" });
  const state = agent.state;

  return (
    <div className="rounded-lg border border-border bg-bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-bold text-text-primary">Price Monitor</h3>
        </div>
        <button
          onClick={() => agent.call("runMonitoringCheck")}
          className="flex items-center gap-1 rounded-md bg-bg-secondary px-2 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover min-h-[44px]"
        >
          <RefreshCw className="h-3 w-3" /> Check Now
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-xl font-bold text-text-primary">{state?.checksRun ?? 0}</p>
          <p className="text-[11px] text-text-muted">Checks</p>
        </div>
        <div>
          <p className="text-xl font-bold text-accent">{state?.activeAlerts?.length ?? 0}</p>
          <p className="text-[11px] text-text-muted">Active Alerts</p>
        </div>
        <div>
          <p className="text-xl font-bold text-text-primary">{state?.anomaliesDetected ?? 0}</p>
          <p className="text-[11px] text-text-muted">Total Anomalies</p>
        </div>
      </div>

      {state?.lastCheckAt && (
        <p className="mt-2 text-xs text-text-muted">Last check: {new Date(state.lastCheckAt).toLocaleString()}</p>
      )}

      {state?.activeAlerts && state.activeAlerts.length > 0 && (
        <div className="mt-3 space-y-1">
          {state.activeAlerts.slice(-3).map((a, i) => (
            <div key={i} className="flex items-center justify-between rounded bg-bg-secondary px-2 py-1 text-xs">
              <span className="truncate text-text-primary">{a.cardName}</span>
              <span className={a.type === "price_spike" || a.type === "viral" ? "text-buy" : "text-sell"}>
                {a.type === "viral" ? `${a.magnitude}x` : `${a.magnitude > 0 ? "+" : ""}${a.magnitude}%`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketIntelPanel() {
  const agent = useAgent<IntelligenceState>({ agent: "market-intelligence-agent", name: "default" });
  const state = agent.state;
  const latestReport = state?.reports?.[0];

  return (
    <div className="rounded-lg border border-border bg-bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-info" />
          <h3 className="text-sm font-bold text-text-primary">Market Intelligence</h3>
        </div>
        <button
          onClick={() => agent.call("generateDailyReport")}
          className="flex items-center gap-1 rounded-md bg-bg-secondary px-2 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover min-h-[44px]"
        >
          <RefreshCw className="h-3 w-3" /> Generate
        </button>
      </div>

      {latestReport ? (
        <>
          <div className="mb-2 flex items-center gap-2">
            <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              latestReport.marketSentiment === "bullish" ? "bg-buy/10 text-buy" :
              latestReport.marketSentiment === "bearish" ? "bg-sell/10 text-sell" : "bg-bg-secondary text-text-muted"
            }`}>
              {latestReport.marketSentiment}
            </span>
            <span className="text-xs text-text-muted">{latestReport.date}</span>
          </div>
          <p className="text-sm text-text-secondary line-clamp-4">{latestReport.summary}</p>
        </>
      ) : (
        <p className="text-sm text-text-muted">No reports generated yet</p>
      )}

      <p className="mt-2 text-xs text-text-muted">{state?.totalReports ?? 0} reports generated</p>
    </div>
  );
}

function CompetitorPanel() {
  const agent = useAgent<TrackerState>({ agent: "competitor-tracker-agent", name: "default" });
  const state = agent.state;

  return (
    <div className="rounded-lg border border-border bg-bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-bold text-text-primary">Competitor Tracker</h3>
        </div>
        <button
          onClick={() => agent.call("scanCompetitorPrices")}
          className="flex items-center gap-1 rounded-md bg-bg-secondary px-2 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover min-h-[44px]"
        >
          <RefreshCw className="h-3 w-3" /> Scan
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-center">
        <div>
          <p className="text-xl font-bold text-sell">{state?.priceGaps?.filter((g) => g.direction === "overpriced").length ?? 0}</p>
          <p className="text-[11px] text-text-muted">Overpriced</p>
        </div>
        <div>
          <p className="text-xl font-bold text-buy">{state?.priceGaps?.filter((g) => g.direction === "underpriced").length ?? 0}</p>
          <p className="text-[11px] text-text-muted">Underpriced</p>
        </div>
      </div>

      {state?.priceGaps && state.priceGaps.length > 0 && (
        <div className="mt-3 space-y-1">
          {state.priceGaps.slice(0, 3).map((g, i) => (
            <div key={i} className="flex items-center justify-between rounded bg-bg-secondary px-2 py-1 text-xs">
              <span className="truncate text-text-primary">{g.cardName}</span>
              <span className={g.direction === "overpriced" ? "text-sell" : "text-buy"}>
                {g.gapPct > 0 ? "+" : ""}{g.gapPct}%
              </span>
            </div>
          ))}
        </div>
      )}

      {state?.lastScanAt && (
        <p className="mt-2 text-xs text-text-muted">Last scan: {new Date(state.lastScanAt).toLocaleString()}</p>
      )}
    </div>
  );
}

function RecommendationsPanel() {
  const agent = useAgent<RecommendationState>({ agent: "pricing-recommendation-agent", name: "default" });
  const state = agent.state;
  const [approving, setApproving] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    setApproving(id);
    await agent.call("approveRecommendation", [id, "dashboard"]);
    setApproving(null);
  };

  const handleReject = async (id: string) => {
    setApproving(id);
    await agent.call("rejectRecommendation", [id, "dashboard"]);
    setApproving(null);
  };

  const actionColors: Record<string, string> = {
    BUY: "bg-buy/10 text-buy",
    SELL: "bg-sell/10 text-sell",
    REPRICE: "bg-hold/10 text-hold",
  };

  return (
    <div className="rounded-lg border border-border bg-bg-card p-4 shadow-sm lg:col-span-2">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-buy" />
          <h3 className="text-sm font-bold text-text-primary">Pricing Recommendations</h3>
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-text-inverse">
            {state?.pending?.length ?? 0} pending
          </span>
        </div>
        <button
          onClick={() => agent.call("generateRecommendations")}
          className="flex items-center gap-1 rounded-md bg-bg-secondary px-2 py-1 text-xs font-medium text-text-secondary hover:bg-bg-hover min-h-[44px]"
        >
          <RefreshCw className="h-3 w-3" /> Generate
        </button>
      </div>

      {/* Stats */}
      <div className="mb-3 grid grid-cols-4 gap-2 text-center">
        <div className="rounded bg-bg-secondary px-2 py-1">
          <p className="text-sm font-bold text-text-primary">{state?.stats?.totalGenerated ?? 0}</p>
          <p className="text-[10px] text-text-muted">Generated</p>
        </div>
        <div className="rounded bg-bg-secondary px-2 py-1">
          <p className="text-sm font-bold text-buy">{state?.stats?.totalApproved ?? 0}</p>
          <p className="text-[10px] text-text-muted">Approved</p>
        </div>
        <div className="rounded bg-bg-secondary px-2 py-1">
          <p className="text-sm font-bold text-sell">{state?.stats?.totalRejected ?? 0}</p>
          <p className="text-[10px] text-text-muted">Rejected</p>
        </div>
        <div className="rounded bg-bg-secondary px-2 py-1">
          <p className="text-sm font-bold text-text-muted">{state?.stats?.totalExpired ?? 0}</p>
          <p className="text-[10px] text-text-muted">Expired</p>
        </div>
      </div>

      {/* Pending list */}
      {state?.pending && state.pending.length > 0 ? (
        <div className="space-y-2">
          {state.pending.slice(0, 5).map((rec) => (
            <div key={rec.id} className="flex items-start gap-3 rounded-lg border border-border bg-bg-primary p-3">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${actionColors[rec.action] || ""}`}>
                {rec.action}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{rec.cardName}</p>
                <p className="text-xs text-text-secondary">{rec.reasoning}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Current: ${rec.currentPrice.toFixed(2)} → Recommended: ${rec.recommendedPrice.toFixed(2)} · {rec.expectedMargin}% margin · {rec.confidence}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => handleApprove(rec.id)}
                  disabled={approving === rec.id}
                  className="flex items-center justify-center rounded-md bg-buy/10 p-2 text-buy hover:bg-buy/20 min-h-[44px] min-w-[44px]"
                  aria-label="Approve"
                >
                  {approving === rec.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => handleReject(rec.id)}
                  disabled={approving === rec.id}
                  className="flex items-center justify-center rounded-md bg-sell/10 p-2 text-sell hover:bg-sell/20 min-h-[44px] min-w-[44px]"
                  aria-label="Reject"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-muted">No pending recommendations</p>
      )}
    </div>
  );
}
