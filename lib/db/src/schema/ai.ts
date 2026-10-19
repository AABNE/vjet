import { pgTable, integer, serial, text, timestamp, boolean, doublePrecision } from "drizzle-orm/pg-core";

// Per-agent AI model configuration. One row per agent key; agents without a row
// fall back to coded safe defaults.
export const aiConfigTable = pgTable("ai_config", {
  agentKey: text("agent_key").primaryKey(),
  provider: text("provider").notNull().default("openrouter"),
  modelId: text("model_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  temperature: doublePrecision("temperature").notNull().default(0.4),
  maxTokens: integer("max_tokens").notNull().default(500),
  timeoutMs: integer("timeout_ms").notNull().default(20000),
  maxRetries: integer("max_retries").notNull().default(1),
  fallbackModelId: text("fallback_model_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AiConfig = typeof aiConfigTable.$inferSelect;

// Lightweight call metrics for latency / error-rate / token estimates.
export const aiUsageTable = pgTable("ai_usage", {
  id: serial("id").primaryKey(),
  agentKey: text("agent_key").notNull(),
  model: text("model").notNull(),
  ok: boolean("ok").notNull().default(true),
  latencyMs: integer("latency_ms"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type AiUsage = typeof aiUsageTable.$inferSelect;
