import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, jsonb, real } from "drizzle-orm/pg-core";

export { chatSessions, chatMessages, insertChatSessionSchema, insertChatMessageSchema } from "./models/chat";
export type { ChatSession, InsertChatSession, ChatMessage, InsertChatMessage } from "./models/chat";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  googleId: text("google_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  picture: text("picture"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const analyses = pgTable("analyses", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  productInput: text("product_input").notNull(),
  productName: text("product_name"),
  productCategory: text("product_category"),
  businessType: text("business_type").$type<"online" | "in_person">(),
  businessLocation: text("business_location"),
  status: text("status").notNull().default("pending"),
  currentPrice: real("current_price"),
  optimalPrice: real("optimal_price"),
  marketAverage: real("market_average"),
  revenueImpact: text("revenue_impact"),
  profitImpact: text("profit_impact"),
  marketPosition: text("market_position"),
  summary: text("summary"),
  keyInsight: text("key_insight"),
  recommendedAction: text("recommended_action"),
  competitors: jsonb("competitors").$type<CompetitorData[]>(),
  localCompetitors: jsonb("local_competitors").$type<LocalCompetitor[]>(),
  demandSignals: jsonb("demand_signals").$type<DemandSignal>(),
  priceSimulation: jsonb("price_simulation").$type<PriceSimulationPoint[]>(),
  customerPersona: jsonb("customer_persona").$type<CustomerPersona>(),
  webResearchSummary: text("web_research_summary"),
  internalDataSummary: text("internal_data_summary"),
  hasInternalData: integer("has_internal_data").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const scheduledAnalyses = pgTable("scheduled_analyses", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  productInput: text("product_input").notNull(),
  frequency: text("frequency").notNull().$type<"daily" | "weekly" | "monthly">(),
  enabled: integer("enabled").default(1).notNull(),
  nextRunAt: timestamp("next_run_at").notNull(),
  lastRunAt: timestamp("last_run_at"),
  lastAnalysisId: integer("last_analysis_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  key: text("key").notNull().unique(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const shopifySettings = pgTable("shopify_settings", {
  id: serial("id").primaryKey(),
  storeName: text("store_name").notNull(),
  accessToken: text("access_token").notNull(),
  shopDomain: text("shop_domain").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertAnalysisSchema = createInsertSchema(analyses).omit({
  id: true,
  createdAt: true,
});

export const insertShopifySettingsSchema = createInsertSchema(shopifySettings).omit({
  id: true,
  createdAt: true,
});

export const insertScheduledAnalysisSchema = createInsertSchema(scheduledAnalyses).omit({
  id: true,
  createdAt: true,
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
  key: true,
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type User = typeof users.$inferSelect;
export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type Analysis = typeof analyses.$inferSelect;
export type ShopifySettings = typeof shopifySettings.$inferSelect;
export type InsertShopifySettings = z.infer<typeof insertShopifySettingsSchema>;
export type ScheduledAnalysis = typeof scheduledAnalyses.$inferSelect;
export type InsertScheduledAnalysis = z.infer<typeof insertScheduledAnalysisSchema>;

export interface CompetitorData {
  name: string;
  price: number;
  discount?: string;
  availability?: string;
  url?: string;
  address?: string;
  distance?: string;
  rating?: string;
  reviewCount?: string;
}

export interface LocalCompetitor {
  name: string;
  address: string;
  distance?: string;
  priceRange?: string;
  rating?: string;
  reviewCount?: string;
  type?: string;
}

export interface DemandSignal {
  trend: string;
  trendDirection: "up" | "down" | "stable";
  trendPercentage: number;
  seasonality: string;
  searchVolume: string;
  priceVolatility: string;
}

export interface PriceSimulationPoint {
  price: number;
  expectedDemand: number;
  expectedRevenue: number;
  expectedProfit: number;
}

export interface CustomerPersona {
  who: string;
  ageRange: string;
  whyTheyBuy: string;
  whatTheyCareMost: string;
  typicalBudget: string;
  whereTheyShop: string;
  priceSensitivity: "low" | "medium" | "high";
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  image?: string;
  variants: ShopifyVariant[];
}

export interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
  sku?: string;
}
