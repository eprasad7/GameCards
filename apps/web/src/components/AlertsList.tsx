import { AlertTriangle, TrendingUp, TrendingDown, Zap, Eye, X } from "lucide-react";
import type { Alert } from "../lib/api";

interface AlertsListProps {
  alerts: Alert[];
  onResolve: (id: number) => void;
}

const alertIcons: Record<string, React.ReactNode> = {
  price_spike: <TrendingUp className="h-4 w-4 text-buy" />,
  price_crash: <TrendingDown className="h-4 w-4 text-sell" />,
  viral_social: <Zap className="h-4 w-4 text-warning" />,
  anomaly_detected: <AlertTriangle className="h-4 w-4 text-danger" />,
  new_high: <TrendingUp className="h-4 w-4 text-accent" />,
  new_low: <TrendingDown className="h-4 w-4 text-danger" />,
};

export function AlertsList({ alerts, onResolve }: AlertsListProps) {
  if (alerts.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-bg-card shadow-sm">
        <p className="text-text-muted">No active alerts</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-card shadow-sm">
      {alerts.map((alert, i) => (
        <div
          key={alert.id}
          className={`flex items-start gap-3 p-4 transition-colors hover:bg-bg-hover ${
            i < alerts.length - 1 ? "border-b border-border" : ""
          }`}
        >
          <div className="mt-0.5 shrink-0">
            {alertIcons[alert.alert_type] || <Eye className="h-4 w-4 text-text-muted" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-text-primary truncate">{alert.card_name}</span>
              <span className="shrink-0 rounded-sm bg-bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-text-muted">
                {alert.alert_type.replace(/_/g, " ")}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-text-secondary">{alert.message}</p>
            <p className="mt-0.5 text-xs text-text-muted">
              {new Date(alert.created_at).toLocaleString()}
            </p>
          </div>
          <button
            onClick={() => onResolve(alert.id)}
            className="shrink-0 rounded-md p-2.5 text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Resolve alert"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
