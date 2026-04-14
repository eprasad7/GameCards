import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env } from "./types";
import { priceRoutes } from "./routes/prices";
import { historyRoutes } from "./routes/history";
import { sentimentRoutes } from "./routes/sentiment";
import { evaluateRoutes } from "./routes/evaluate";
import { alertRoutes } from "./routes/alerts";
import { marketRoutes } from "./routes/market";
import { cardRoutes } from "./routes/cards";
import { handleScheduled } from "./services/scheduler";
import { handleIngestionQueue, handleSentimentQueue } from "./services/queue-consumer";

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Health check
app.get("/", (c) =>
  c.json({
    service: "GameCards Dynamic Pricing Engine",
    version: "1.0.0",
    status: "healthy",
  })
);

// API routes
const api = app.basePath("/v1");
api.route("/cards", cardRoutes);
api.route("/price", priceRoutes);
api.route("/history", historyRoutes);
api.route("/sentiment", sentimentRoutes);
api.route("/evaluate", evaluateRoutes);
api.route("/alerts", alertRoutes);
api.route("/market", marketRoutes);

export default {
  fetch: app.fetch,

  // Cron Triggers — scheduled data ingestion
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(event, env));
  },

  // Queue consumers — async processing
  async queue(batch: MessageBatch, env: Env) {
    const queueName = batch.queue;
    if (queueName === "gamecards-ingestion") {
      await handleIngestionQueue(batch, env);
    } else if (queueName === "gamecards-sentiment") {
      await handleSentimentQueue(batch, env);
    } else {
      console.error(`Unknown queue: ${queueName}. Acking ${batch.messages.length} messages to prevent retry loop.`);
      batch.ackAll();
    }
  },
};
