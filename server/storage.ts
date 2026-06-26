import { type Analysis, type InsertAnalysis, analyses, type ShopifySettings, type InsertShopifySettings, shopifySettings, type ScheduledAnalysis, type InsertScheduledAnalysis, scheduledAnalyses, type User, users, type ApiKey, apiKeys, chatSessions, chatMessages, type ChatSession, type ChatMessage } from "@shared/schema";
import { db } from "./db";
import { eq, desc, lte, and, asc } from "drizzle-orm";
import crypto from "crypto";

export interface IStorage {
  findOrCreateUser(googleId: string, email: string, name: string | null, picture: string | null): Promise<User>;
  getUser(id: number): Promise<User | undefined>;
  createAnalysis(data: InsertAnalysis): Promise<Analysis>;
  getAnalysis(id: number): Promise<Analysis | undefined>;
  getAllAnalyses(userId?: number): Promise<Analysis[]>;
  updateAnalysis(id: number, data: Partial<InsertAnalysis>): Promise<Analysis | undefined>;
  deleteAnalysis(id: number): Promise<void>;
  getShopifySettings(): Promise<ShopifySettings | undefined>;
  saveShopifySettings(data: InsertShopifySettings): Promise<ShopifySettings>;
  deleteShopifySettings(): Promise<void>;
  createSchedule(data: InsertScheduledAnalysis): Promise<ScheduledAnalysis>;
  getSchedule(id: number): Promise<ScheduledAnalysis | undefined>;
  getAllSchedules(userId?: number): Promise<ScheduledAnalysis[]>;
  updateSchedule(id: number, data: Partial<InsertScheduledAnalysis>): Promise<ScheduledAnalysis | undefined>;
  deleteSchedule(id: number): Promise<void>;
  getDueSchedules(): Promise<ScheduledAnalysis[]>;
  createApiKey(userId: number, name: string): Promise<ApiKey>;
  getApiKeyByKey(key: string): Promise<ApiKey | undefined>;
  getApiKeysByUser(userId: number): Promise<ApiKey[]>;
  deleteApiKey(id: number, userId: number): Promise<void>;
  touchApiKey(id: number): Promise<void>;
  getOrCreateChatSession(userId: number, analysisId: number): Promise<ChatSession>;
  updateChatSessionTitle(sessionId: number, title: string): Promise<void>;
  getChatMessages(sessionId: number): Promise<ChatMessage[]>;
  addChatMessage(sessionId: number, role: "user" | "assistant", content: string): Promise<ChatMessage>;
  clearChatMessages(sessionId: number): Promise<void>;
  getUserChatSessions(userId: number): Promise<ChatSession[]>;
}

export class DatabaseStorage implements IStorage {
  async findOrCreateUser(googleId: string, email: string, name: string | null, picture: string | null): Promise<User> {
    const [existing] = await db.select().from(users).where(eq(users.googleId, googleId));
    if (existing) {
      const [updated] = await db.update(users).set({ email, name, picture }).where(eq(users.id, existing.id)).returning();
      return updated;
    }
    const [user] = await db.insert(users).values({ googleId, email, name, picture }).returning();
    return user;
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async createAnalysis(data: InsertAnalysis): Promise<Analysis> {
    const [analysis] = await db.insert(analyses).values(data as typeof analyses.$inferInsert).returning();
    return analysis;
  }

  async getAnalysis(id: number): Promise<Analysis | undefined> {
    const [analysis] = await db.select().from(analyses).where(eq(analyses.id, id));
    return analysis;
  }

  async getAllAnalyses(userId?: number): Promise<Analysis[]> {
    if (userId) {
      return db.select().from(analyses).where(eq(analyses.userId, userId)).orderBy(desc(analyses.createdAt));
    }
    return db.select().from(analyses).orderBy(desc(analyses.createdAt));
  }

  async updateAnalysis(id: number, data: Partial<InsertAnalysis>): Promise<Analysis | undefined> {
    const [analysis] = await db.update(analyses).set(data as Partial<typeof analyses.$inferInsert>).where(eq(analyses.id, id)).returning();
    return analysis;
  }

  async deleteAnalysis(id: number): Promise<void> {
    await db.delete(analyses).where(eq(analyses.id, id));
  }

  async getShopifySettings(): Promise<ShopifySettings | undefined> {
    const [settings] = await db.select().from(shopifySettings).orderBy(desc(shopifySettings.createdAt)).limit(1);
    return settings;
  }

  async saveShopifySettings(data: InsertShopifySettings): Promise<ShopifySettings> {
    await db.delete(shopifySettings);
    const [settings] = await db.insert(shopifySettings).values(data).returning();
    return settings;
  }

  async deleteShopifySettings(): Promise<void> {
    await db.delete(shopifySettings);
  }

  async createSchedule(data: InsertScheduledAnalysis): Promise<ScheduledAnalysis> {
    const [schedule] = await db.insert(scheduledAnalyses).values(data as typeof scheduledAnalyses.$inferInsert).returning();
    return schedule;
  }

  async getSchedule(id: number): Promise<ScheduledAnalysis | undefined> {
    const [schedule] = await db.select().from(scheduledAnalyses).where(eq(scheduledAnalyses.id, id));
    return schedule;
  }

  async getAllSchedules(userId?: number): Promise<ScheduledAnalysis[]> {
    if (userId) {
      return db.select().from(scheduledAnalyses).where(eq(scheduledAnalyses.userId, userId)).orderBy(desc(scheduledAnalyses.createdAt));
    }
    return db.select().from(scheduledAnalyses).orderBy(desc(scheduledAnalyses.createdAt));
  }

  async updateSchedule(id: number, data: Partial<InsertScheduledAnalysis>): Promise<ScheduledAnalysis | undefined> {
    const [schedule] = await db.update(scheduledAnalyses).set(data as Partial<typeof scheduledAnalyses.$inferInsert>).where(eq(scheduledAnalyses.id, id)).returning();
    return schedule;
  }

  async deleteSchedule(id: number): Promise<void> {
    await db.delete(scheduledAnalyses).where(eq(scheduledAnalyses.id, id));
  }

  async getDueSchedules(): Promise<ScheduledAnalysis[]> {
    return db.select().from(scheduledAnalyses).where(
      and(
        eq(scheduledAnalyses.enabled, 1),
        lte(scheduledAnalyses.nextRunAt, new Date())
      )
    );
  }

  async createApiKey(userId: number, name: string): Promise<ApiKey> {
    const key = `kanos_${crypto.randomBytes(24).toString("hex")}`;
    const [apiKey] = await db.insert(apiKeys).values({ userId, name, key }).returning();
    return apiKey;
  }

  async getApiKeyByKey(key: string): Promise<ApiKey | undefined> {
    const [apiKey] = await db.select().from(apiKeys).where(eq(apiKeys.key, key));
    return apiKey;
  }

  async getApiKeysByUser(userId: number): Promise<ApiKey[]> {
    return db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(desc(apiKeys.createdAt));
  }

  async deleteApiKey(id: number, userId: number): Promise<void> {
    await db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));
  }

  async touchApiKey(id: number): Promise<void> {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
  }

  async getOrCreateChatSession(userId: number, analysisId: number): Promise<ChatSession> {
    await db.insert(chatSessions)
      .values({ userId, analysisId })
      .onConflictDoNothing();
    const [session] = await db.select().from(chatSessions)
      .where(and(eq(chatSessions.userId, userId), eq(chatSessions.analysisId, analysisId)));
    return session;
  }

  async updateChatSessionTitle(sessionId: number, title: string): Promise<void> {
    await db.update(chatSessions).set({ title }).where(eq(chatSessions.id, sessionId));
  }

  async getChatMessages(sessionId: number): Promise<ChatMessage[]> {
    return db.select().from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdAt))
      .limit(100);
  }

  async addChatMessage(sessionId: number, role: "user" | "assistant", content: string): Promise<ChatMessage> {
    const [message] = await db.insert(chatMessages).values({ sessionId, role, content }).returning();
    return message;
  }

  async clearChatMessages(sessionId: number): Promise<void> {
    await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId));
    await db.update(chatSessions).set({ title: null }).where(eq(chatSessions.id, sessionId));
  }

  async getUserChatSessions(userId: number): Promise<ChatSession[]> {
    return db.select().from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(chatSessions.createdAt));
  }
}

/**
 * In-memory implementation used when DATABASE_URL is not set. Everything works
 * (analyses, schedules, chat, API keys) but state is ephemeral and lost on
 * restart. Intended for the stateless/headless use case where you only need the
 * pricing API. Set DATABASE_URL to switch to persistent Postgres storage.
 */
export class InMemoryStorage implements IStorage {
  private usersMap = new Map<number, User>();
  private analysesMap = new Map<number, Analysis>();
  private schedulesMap = new Map<number, ScheduledAnalysis>();
  private apiKeysMap = new Map<number, ApiKey>();
  private chatSessionsMap = new Map<number, ChatSession>();
  private chatMessagesMap = new Map<number, ChatMessage>();
  private shopify: ShopifySettings | undefined;
  private seq = { user: 0, analysis: 0, schedule: 0, apiKey: 0, session: 0, message: 0 };

  async findOrCreateUser(googleId: string, email: string, name: string | null, picture: string | null): Promise<User> {
    for (const u of this.usersMap.values()) {
      if (u.googleId === googleId) {
        u.email = email;
        u.name = name;
        u.picture = picture;
        return u;
      }
    }
    const user: User = { id: ++this.seq.user, googleId, email, name, picture, createdAt: new Date() };
    this.usersMap.set(user.id, user);
    return user;
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.usersMap.get(id);
  }

  async createAnalysis(data: InsertAnalysis): Promise<Analysis> {
    const analysis = {
      id: ++this.seq.analysis,
      userId: null,
      productName: null,
      productCategory: null,
      businessType: null,
      businessLocation: null,
      status: "pending",
      currentPrice: null,
      optimalPrice: null,
      marketAverage: null,
      revenueImpact: null,
      profitImpact: null,
      marketPosition: null,
      summary: null,
      keyInsight: null,
      recommendedAction: null,
      competitors: null,
      localCompetitors: null,
      demandSignals: null,
      priceSimulation: null,
      customerPersona: null,
      webResearchSummary: null,
      internalDataSummary: null,
      hasInternalData: 0,
      ...(data as any),
      createdAt: new Date(),
    } as Analysis;
    this.analysesMap.set(analysis.id, analysis);
    return analysis;
  }

  async getAnalysis(id: number): Promise<Analysis | undefined> {
    return this.analysesMap.get(id);
  }

  async getAllAnalyses(userId?: number): Promise<Analysis[]> {
    let arr = [...this.analysesMap.values()];
    if (userId) arr = arr.filter((a) => a.userId === userId);
    return arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async updateAnalysis(id: number, data: Partial<InsertAnalysis>): Promise<Analysis | undefined> {
    const existing = this.analysesMap.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...(data as any) } as Analysis;
    this.analysesMap.set(id, updated);
    return updated;
  }

  async deleteAnalysis(id: number): Promise<void> {
    this.analysesMap.delete(id);
  }

  async getShopifySettings(): Promise<ShopifySettings | undefined> {
    return this.shopify;
  }

  async saveShopifySettings(data: InsertShopifySettings): Promise<ShopifySettings> {
    this.shopify = {
      id: 1,
      storeName: data.storeName,
      accessToken: data.accessToken,
      shopDomain: data.shopDomain,
      createdAt: new Date(),
    };
    return this.shopify;
  }

  async deleteShopifySettings(): Promise<void> {
    this.shopify = undefined;
  }

  async createSchedule(data: InsertScheduledAnalysis): Promise<ScheduledAnalysis> {
    const schedule = {
      id: ++this.seq.schedule,
      userId: null,
      enabled: 1,
      lastRunAt: null,
      lastAnalysisId: null,
      ...(data as any),
      createdAt: new Date(),
    } as ScheduledAnalysis;
    this.schedulesMap.set(schedule.id, schedule);
    return schedule;
  }

  async getSchedule(id: number): Promise<ScheduledAnalysis | undefined> {
    return this.schedulesMap.get(id);
  }

  async getAllSchedules(userId?: number): Promise<ScheduledAnalysis[]> {
    let arr = [...this.schedulesMap.values()];
    if (userId) arr = arr.filter((s) => s.userId === userId);
    return arr.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async updateSchedule(id: number, data: Partial<InsertScheduledAnalysis>): Promise<ScheduledAnalysis | undefined> {
    const existing = this.schedulesMap.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...(data as any) } as ScheduledAnalysis;
    this.schedulesMap.set(id, updated);
    return updated;
  }

  async deleteSchedule(id: number): Promise<void> {
    this.schedulesMap.delete(id);
  }

  async getDueSchedules(): Promise<ScheduledAnalysis[]> {
    const now = Date.now();
    return [...this.schedulesMap.values()].filter(
      (s) => s.enabled === 1 && s.nextRunAt.getTime() <= now,
    );
  }

  async createApiKey(userId: number, name: string): Promise<ApiKey> {
    const key = `kanos_${crypto.randomBytes(24).toString("hex")}`;
    const apiKey: ApiKey = { id: ++this.seq.apiKey, userId, name, key, lastUsedAt: null, createdAt: new Date() };
    this.apiKeysMap.set(apiKey.id, apiKey);
    return apiKey;
  }

  async getApiKeyByKey(key: string): Promise<ApiKey | undefined> {
    for (const k of this.apiKeysMap.values()) if (k.key === key) return k;
    return undefined;
  }

  async getApiKeysByUser(userId: number): Promise<ApiKey[]> {
    return [...this.apiKeysMap.values()]
      .filter((k) => k.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async deleteApiKey(id: number, userId: number): Promise<void> {
    const k = this.apiKeysMap.get(id);
    if (k && k.userId === userId) this.apiKeysMap.delete(id);
  }

  async touchApiKey(id: number): Promise<void> {
    const k = this.apiKeysMap.get(id);
    if (k) k.lastUsedAt = new Date();
  }

  async getOrCreateChatSession(userId: number, analysisId: number): Promise<ChatSession> {
    for (const s of this.chatSessionsMap.values()) {
      if (s.userId === userId && s.analysisId === analysisId) return s;
    }
    const session: ChatSession = { id: ++this.seq.session, userId, analysisId, title: null, createdAt: new Date() };
    this.chatSessionsMap.set(session.id, session);
    return session;
  }

  async updateChatSessionTitle(sessionId: number, title: string): Promise<void> {
    const s = this.chatSessionsMap.get(sessionId);
    if (s) s.title = title;
  }

  async getChatMessages(sessionId: number): Promise<ChatMessage[]> {
    return [...this.chatMessagesMap.values()]
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, 100);
  }

  async addChatMessage(sessionId: number, role: "user" | "assistant", content: string): Promise<ChatMessage> {
    const message: ChatMessage = { id: ++this.seq.message, sessionId, role, content, createdAt: new Date() };
    this.chatMessagesMap.set(message.id, message);
    return message;
  }

  async clearChatMessages(sessionId: number): Promise<void> {
    for (const [id, m] of this.chatMessagesMap) if (m.sessionId === sessionId) this.chatMessagesMap.delete(id);
    const s = this.chatSessionsMap.get(sessionId);
    if (s) s.title = null;
  }

  async getUserChatSessions(userId: number): Promise<ChatSession[]> {
    return [...this.chatSessionsMap.values()]
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

export const usingDatabase = !!process.env.DATABASE_URL;

export const storage: IStorage = usingDatabase
  ? new DatabaseStorage()
  : new InMemoryStorage();
