import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { openai, minimaxAI, replicAI, AI_MODEL } from "./openai";
import type { CompetitorData, CustomerPersona, DemandSignal, LocalCompetitor, PriceSimulationPoint } from "@shared/schema";
import multer from "multer";
import { testShopifyConnection, listShopifyProducts, updateShopifyVariantPrice, isOAuthConfigured, buildOAuthUrl, generateNonce, exchangeCodeForToken } from "./shopify";
import { z } from "zod";
import { registerRunAnalysis, startScheduler, computeNextRun } from "./scheduler";
import { deepResearch, fetchProductPage, extractPageData } from "./web-research";
import { buildSystemPrompt, generateSessionTitle } from "./chat";
import passport from "passport";

const shopifyConnectSchema = z.object({
  storeName: z.string().min(1, "Store name is required"),
  accessToken: z.string().min(1, "Access token is required"),
});

const shopifyUpdatePriceSchema = z.object({
  variantId: z.number({ coerce: true }).positive("Invalid variant ID"),
  price: z.number({ coerce: true }).positive("Price must be positive"),
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: "Not authenticated" });
}

async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const key = match ? match[1].trim() : (req.headers["x-api-key"] as string || "").trim();
  if (!key) return res.status(401).json({ error: { message: "Missing API key. Provide it as 'Authorization: Bearer <key>'." } });
  const apiKey = await storage.getApiKeyByKey(key);
  if (!apiKey) return res.status(401).json({ error: { message: "Invalid API key." } });
  storage.touchApiKey(apiKey.id).catch(() => {});
  (req as any).apiUserId = apiKey.userId;
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

  app.get("/api/auth/google/callback", (req, res, next) => {
    passport.authenticate("google", (err: any, user: any) => {
      if (err) {
        console.error("Google OAuth error:", err);
        return res.redirect("/");
      }
      if (!user) {
        console.error("Google OAuth: no user returned");
        return res.redirect("/");
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          console.error("Session login error:", loginErr);
          return res.redirect("/");
        }
        return res.redirect("/");
      });
    })(req, res, next);
  });

  app.get("/api/auth/me", (req, res) => {
    if (req.isAuthenticated()) {
      res.json(req.user);
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Logout failed" });
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/analyses", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const analyses = await storage.getAllAnalyses(userId);
      res.json(analyses);
    } catch (error) {
      console.error("Error fetching analyses:", error);
      res.status(500).json({ message: "Failed to fetch analyses" });
    }
  });

  app.get("/api/analyses/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const analysis = await storage.getAnalysis(id);
      if (!analysis) return res.status(404).json({ message: "Analysis not found" });
      res.json(analysis);
    } catch (error) {
      console.error("Error fetching analysis:", error);
      res.status(500).json({ message: "Failed to fetch analysis" });
    }
  });

  app.delete("/api/analyses/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      await storage.deleteAnalysis(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting analysis:", error);
      res.status(500).json({ message: "Failed to delete analysis" });
    }
  });

  app.post("/api/analyses", requireAuth, upload.array("files", 10), async (req, res) => {
    try {
      const { productInput, businessType, businessLocation, currentPrice, isNewProduct } = req.body;
      if (!productInput || !productInput.trim()) {
        return res.status(400).json({ message: "Product URL or name is required" });
      }

      const files = req.files as Express.Multer.File[] | undefined;
      const hasFiles = files && files.length > 0;

      const newProduct = isNewProduct === "true";
      const parsedPrice = currentPrice !== undefined && currentPrice !== "" ? parseFloat(currentPrice) : null;
      const validPrice = parsedPrice !== null && Number.isFinite(parsedPrice) && parsedPrice >= 0;

      if (!newProduct && !validPrice) {
        return res.status(400).json({ message: "Please provide your current price or mark this as a new product." });
      }

      const userPrice = newProduct ? null : (validPrice ? parsedPrice : null);

      const analysis = await storage.createAnalysis({
        productInput: productInput.trim(),
        businessType: businessType || "online",
        businessLocation: businessLocation?.trim() || null,
        status: "analyzing",
        hasInternalData: hasFiles ? 1 : 0,
        currentPrice: userPrice,
        userId: req.user!.id,
      });

      res.json(analysis);

      runAnalysis(analysis.id, productInput.trim(), files || [], {
        businessType: businessType || "online",
        businessLocation: businessLocation?.trim() || null,
        userCurrentPrice: userPrice,
        isNewProduct: newProduct,
      }).catch(err => {
        console.error("Analysis failed:", err);
        storage.updateAnalysis(analysis.id, { status: "failed" });
      });
    } catch (error) {
      console.error("Error creating analysis:", error);
      res.status(500).json({ message: "Failed to create analysis" });
    }
  });

  app.post("/api/analyses/:id/retry", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const analysis = await storage.getAnalysis(id);
      if (!analysis) return res.status(404).json({ message: "Analysis not found" });
      if (analysis.status !== "failed") return res.status(400).json({ message: "Only failed analyses can be retried" });

      await storage.updateAnalysis(id, { status: "analyzing" });
      const updated = await storage.getAnalysis(id);
      res.json(updated);

      const storedPrice = analysis.currentPrice != null ? Number(analysis.currentPrice) : null;
      runAnalysis(id, analysis.productInput, [], {
        businessType: (analysis.businessType as "online" | "in_person") || "online",
        businessLocation: analysis.businessLocation || null,
        userCurrentPrice: storedPrice,
        isNewProduct: storedPrice === null,
      }).catch(err => {
        console.error("Retry analysis failed:", err);
        storage.updateAnalysis(id, { status: "failed" });
      });
    } catch (error) {
      console.error("Error retrying analysis:", error);
      res.status(500).json({ message: "Failed to retry analysis" });
    }
  });

  app.get("/api/analyses/:id/stream", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id as string);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const check = async () => {
      const analysis = await storage.getAnalysis(id);
      if (!analysis) {
        res.write(`data: ${JSON.stringify({ type: "error", message: "Not found" })}\n\n`);
        res.end();
        return;
      }

      res.write(`data: ${JSON.stringify({ type: "update", data: analysis })}\n\n`);

      if (analysis.status === "completed" || analysis.status === "failed") {
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();
        return;
      }

      setTimeout(check, 1500);
    };

    check();

    req.on("close", () => {});
  });

  app.get("/api/shopify/status", requireAuth, async (_req, res) => {
    try {
      const settings = await storage.getShopifySettings();
      if (!settings) return res.json({ connected: false, oauthAvailable: isOAuthConfigured() });
      res.json({ connected: true, storeName: settings.storeName, shopDomain: settings.shopDomain, oauthAvailable: isOAuthConfigured() });
    } catch (error) {
      console.error("Error checking Shopify status:", error);
      res.status(500).json({ message: "Failed to check Shopify status" });
    }
  });

  const oauthNonces = new Map<string, { shop: string; expires: number }>();

  app.get("/api/shopify/auth", requireAuth, (req, res) => {
    if (!isOAuthConfigured()) {
      return res.status(400).json({ message: "Shopify OAuth is not configured. Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET." });
    }

    const shop = (req.query.shop as string || "").trim().replace(/\.myshopify\.com$/, "").replace(/^https?:\/\//, "");
    if (!shop) return res.status(400).json({ message: "Store name is required" });

    const shopDomain = `${shop}.myshopify.com`;
    const nonce = generateNonce();
    oauthNonces.set(nonce, { shop: shopDomain, expires: Date.now() + 10 * 60 * 1000 });

    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const redirectUri = `${protocol}://${host}/api/shopify/callback`;

    const authUrl = buildOAuthUrl(shopDomain, redirectUri, nonce);
    res.json({ authUrl });
  });

  app.get("/api/shopify/callback", requireAuth, async (req, res) => {
    try {
      const { code, shop, state } = req.query as { code?: string; shop?: string; state?: string };

      if (!code || !shop || !state) {
        return res.redirect("/?shopify_error=missing_params");
      }

      const nonceData = oauthNonces.get(state);
      if (!nonceData || nonceData.expires < Date.now()) {
        oauthNonces.delete(state || "");
        return res.redirect("/?shopify_error=invalid_state");
      }
      oauthNonces.delete(state);

      const shopDomain = typeof shop === "string" ? shop : "";
      const result = await exchangeCodeForToken(shopDomain, code);
      if (!result.success || !result.accessToken) {
        console.error("Shopify token exchange failed:", result.error);
        return res.redirect("/?shopify_error=token_failed");
      }

      const test = await testShopifyConnection(shopDomain, result.accessToken);
      const storeName = test.shopName || shopDomain.replace(".myshopify.com", "");

      await storage.saveShopifySettings({
        storeName,
        accessToken: result.accessToken,
        shopDomain,
      });

      res.send(`<!DOCTYPE html><html><head><title>Connected!</title></head><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb"><div style="text-align:center"><h2 style="color:#16a34a">Shopify Connected!</h2><p style="color:#6b7280">You can close this tab now.</p><script>setTimeout(()=>window.close(),1500)</script></div></body></html>`);
    } catch (error) {
      console.error("Shopify OAuth callback error:", error);
      res.send(`<!DOCTYPE html><html><head><title>Error</title></head><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb"><div style="text-align:center"><h2 style="color:#dc2626">Connection Failed</h2><p style="color:#6b7280">Please close this tab and try again.</p></div></body></html>`);
    }
  });

  app.post("/api/shopify/connect", requireAuth, async (req, res) => {
    try {
      const parsed = shopifyConnectSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { storeName, accessToken } = parsed.data;

      const cleanName = storeName.trim().replace(/\.myshopify\.com$/, "").replace(/^https?:\/\//, "");
      const shopDomain = `${cleanName}.myshopify.com`;

      const test = await testShopifyConnection(shopDomain, accessToken.trim());
      if (!test.success) {
        return res.status(400).json({ message: test.error });
      }

      const settings = await storage.saveShopifySettings({
        storeName: test.shopName || cleanName,
        accessToken: accessToken.trim(),
        shopDomain,
      });

      res.json({ connected: true, storeName: settings.storeName, shopDomain: settings.shopDomain });
    } catch (error) {
      console.error("Error connecting Shopify:", error);
      res.status(500).json({ message: "Failed to connect to Shopify" });
    }
  });

  app.delete("/api/shopify/disconnect", requireAuth, async (_req, res) => {
    try {
      await storage.deleteShopifySettings();
      res.json({ connected: false });
    } catch (error) {
      console.error("Error disconnecting Shopify:", error);
      res.status(500).json({ message: "Failed to disconnect Shopify" });
    }
  });

  app.get("/api/shopify/products", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopifySettings();
      if (!settings) return res.status(400).json({ message: "Shopify not connected" });

      const search = req.query.search as string | undefined;
      const products = await listShopifyProducts(settings.shopDomain, settings.accessToken, search);
      res.json(products);
    } catch (error) {
      console.error("Error fetching Shopify products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.post("/api/shopify/update-price", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getShopifySettings();
      if (!settings) return res.status(400).json({ message: "Shopify not connected" });

      const parsed = shopifyUpdatePriceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { variantId, price } = parsed.data;

      const result = await updateShopifyVariantPrice(
        settings.shopDomain,
        settings.accessToken,
        variantId,
        price.toFixed(2)
      );

      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating Shopify price:", error);
      res.status(500).json({ message: "Failed to update price on Shopify" });
    }
  });

  const scheduleSchema = z.object({
    productInput: z.string().min(1),
    frequency: z.enum(["daily", "weekly", "monthly"]),
  });

  app.get("/api/schedules", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const schedules = await storage.getAllSchedules(userId);
      res.json(schedules);
    } catch (error) {
      console.error("Error fetching schedules:", error);
      res.status(500).json({ message: "Failed to fetch schedules" });
    }
  });

  app.post("/api/schedules", requireAuth, async (req, res) => {
    try {
      const parsed = scheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { productInput, frequency } = parsed.data;
      const nextRunAt = computeNextRun(frequency);
      const schedule = await storage.createSchedule({
        productInput,
        frequency,
        enabled: 1,
        nextRunAt,
        userId: req.user!.id,
      });
      res.json(schedule);
    } catch (error) {
      console.error("Error creating schedule:", error);
      res.status(500).json({ message: "Failed to create schedule" });
    }
  });

  const schedulePatchSchema = z.object({
    enabled: z.boolean(),
  });

  app.patch("/api/schedules/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const parsed = schedulePatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input: enabled must be a boolean" });
      }
      const schedule = await storage.updateSchedule(id, {
        enabled: parsed.data.enabled ? 1 : 0,
      });
      if (!schedule) return res.status(404).json({ message: "Schedule not found" });
      res.json(schedule);
    } catch (error) {
      console.error("Error updating schedule:", error);
      res.status(500).json({ message: "Failed to update schedule" });
    }
  });

  app.delete("/api/schedules/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      await storage.deleteSchedule(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting schedule:", error);
      res.status(500).json({ message: "Failed to delete schedule" });
    }
  });

  app.get("/api/api-keys", requireAuth, async (req, res) => {
    try {
      const keys = await storage.getApiKeysByUser(req.user!.id);
      res.json(keys.map(k => ({ ...k, key: `${k.key.slice(0, 12)}...${k.key.slice(-4)}` })));
    } catch (error) {
      console.error("Error fetching API keys:", error);
      res.status(500).json({ message: "Failed to fetch API keys" });
    }
  });

  app.post("/api/api-keys", requireAuth, async (req, res) => {
    try {
      const name = (req.body?.name || "").toString().trim() || "Untitled key";
      const apiKey = await storage.createApiKey(req.user!.id, name);
      res.json(apiKey);
    } catch (error) {
      console.error("Error creating API key:", error);
      res.status(500).json({ message: "Failed to create API key" });
    }
  });

  app.delete("/api/api-keys/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteApiKey(parseInt(req.params.id as string), req.user!.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting API key:", error);
      res.status(500).json({ message: "Failed to delete API key" });
    }
  });

  app.post("/api/agent/analyze", requireApiKey, async (req, res) => {
    try {
      const userId = (req as any).apiUserId as number;
      const productInput = (req.body?.productInput || req.body?.product || req.body?.query || "").toString().trim();
      if (!productInput) {
        return res.status(400).json({ error: { message: "productInput is required" } });
      }

      const businessType = (req.body?.businessType === "in_person" ? "in_person" : "online") as "online" | "in_person";
      const businessLocation = req.body?.businessLocation ? String(req.body.businessLocation).trim() : null;
      const rawPrice = req.body?.currentPrice;
      const parsedPrice = rawPrice !== undefined && rawPrice !== null && rawPrice !== "" ? parseFloat(String(rawPrice)) : null;
      const validPrice = parsedPrice !== null && Number.isFinite(parsedPrice) && parsedPrice >= 0;
      const isNewProduct = !validPrice;

      const analysis = await storage.createAnalysis({
        productInput,
        businessType,
        businessLocation,
        status: "analyzing",
        hasInternalData: 0,
        currentPrice: validPrice ? parsedPrice : null,
        userId,
      });

      await runAnalysis(analysis.id, productInput, [], {
        businessType,
        businessLocation,
        userCurrentPrice: validPrice ? parsedPrice : null,
        isNewProduct,
      });

      const result = await storage.getAnalysis(analysis.id);
      if (!result || result.status === "failed") {
        return res.status(500).json({ error: { message: "Analysis failed to complete" } });
      }

      res.json({
        result: {
          id: result.id,
          productName: result.productName,
          productCategory: result.productCategory,
          currentPrice: result.currentPrice,
          optimalPrice: result.optimalPrice,
          marketAverage: result.marketAverage,
          marketPosition: result.marketPosition,
          revenueImpact: result.revenueImpact,
          profitImpact: result.profitImpact,
          summary: result.summary,
          keyInsight: result.keyInsight,
          recommendedAction: result.recommendedAction,
          competitors: result.competitors,
          localCompetitors: result.localCompetitors,
          demandSignals: result.demandSignals,
          customerPersona: result.customerPersona,
        },
      });
    } catch (error) {
      console.error("Agent analyze error:", error);
      res.status(500).json({ error: { message: error instanceof Error ? error.message : "Internal error" } });
    }
  });

  app.get("/api/analyses/:id/chat", requireAuth, async (req, res) => {
    try {
      const analysisId = parseInt(req.params.id as string);
      if (isNaN(analysisId)) return res.status(400).json({ message: "Invalid analysis ID" });

      const analysis = await storage.getAnalysis(analysisId);
      if (!analysis) return res.status(404).json({ message: "Analysis not found" });
      if (analysis.userId !== req.user!.id) return res.status(403).json({ message: "Forbidden" });

      const session = await storage.getOrCreateChatSession(req.user!.id, analysisId);
      const messages = await storage.getChatMessages(session.id);
      res.json({ session, messages });
    } catch (error) {
      console.error("Chat load error:", error);
      res.status(500).json({ message: "Failed to load chat" });
    }
  });

  app.get("/api/chat/sessions", requireAuth, async (req, res) => {
    try {
      const sessions = await storage.getUserChatSessions(req.user!.id);
      res.json({ sessions });
    } catch (error) {
      console.error("Chat sessions load error:", error);
      res.status(500).json({ message: "Failed to load sessions" });
    }
  });

  app.delete("/api/analyses/:id/chat", requireAuth, async (req, res) => {
    try {
      const analysisId = parseInt(req.params.id as string);
      if (isNaN(analysisId)) return res.status(400).json({ message: "Invalid analysis ID" });

      const analysis = await storage.getAnalysis(analysisId);
      if (!analysis) return res.status(404).json({ message: "Analysis not found" });
      if (analysis.userId !== req.user!.id) return res.status(403).json({ message: "Forbidden" });

      const session = await storage.getOrCreateChatSession(req.user!.id, analysisId);
      await storage.clearChatMessages(session.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("Chat clear error:", error);
      res.status(500).json({ message: "Failed to clear chat" });
    }
  });

  app.post("/api/analyses/:id/chat", requireAuth, async (req, res) => {
    try {
      const analysisId = parseInt(req.params.id as string);
      if (isNaN(analysisId)) return res.status(400).json({ message: "Invalid analysis ID" });

      const analysis = await storage.getAnalysis(analysisId);
      if (!analysis) return res.status(404).json({ message: "Analysis not found" });
      if (analysis.userId !== req.user!.id) return res.status(403).json({ message: "Forbidden" });
      if (analysis.status !== "completed") return res.status(400).json({ message: "Analysis not yet complete" });

      const message = (req.body?.message || "").toString().trim();
      if (!message) return res.status(400).json({ message: "Message is required" });

      const session = await storage.getOrCreateChatSession(req.user!.id, analysisId);
      const isFirstMessage = !session.title;

      await storage.addChatMessage(session.id, "user", message);

      const history = await storage.getChatMessages(session.id);
      const systemPrompt = buildSystemPrompt(analysis);

      const response = await minimaxAI.chat.completions.create({
        model: AI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...history.slice(-20).map((m) => ({ role: m.role, content: m.content })),
        ],
      });

      const reply = response.choices[0]?.message?.content?.trim() || "Sorry, I couldn't generate a response.";
      await storage.addChatMessage(session.id, "assistant", reply);

      if (isFirstMessage) {
        generateSessionTitle(session.id, analysis.productName || analysis.productInput, message).catch(() => {});
      }

      res.json({ reply });
    } catch (error) {
      console.error("Chat error:", error);
      res.status(500).json({ message: "Chat request failed" });
    }
  });

  registerRunAnalysis(runAnalysis);
  startScheduler();

  return httpServer;
}

interface AnalysisOptions {
  businessType?: "online" | "in_person";
  businessLocation?: string | null;
  userCurrentPrice?: number | null;
  isNewProduct?: boolean;
}

async function runAnalysis(analysisId: number, productInput: string, files: Express.Multer.File[], options: AnalysisOptions = {}) {
  const { businessType = "online", businessLocation = null, userCurrentPrice = null, isNewProduct = false } = options;
  let internalDataContext = "";
  let webResearchContext = "";
  let localResearchContext = "";
  
  if (files.length > 0) {
    await storage.updateAnalysis(analysisId, { status: "extracting_data" });
    internalDataContext = await extractInternalData(files);
    await storage.updateAnalysis(analysisId, { internalDataSummary: internalDataContext });
  }

  await storage.updateAnalysis(analysisId, { status: "researching_market" });

  try {
    const research = await deepResearch(productInput, businessType as "online" | "in_person", businessLocation);
    webResearchContext = research.webSummary;
    localResearchContext = research.localSummary;
    if (webResearchContext) {
      await storage.updateAnalysis(analysisId, { webResearchSummary: webResearchContext });
    }
    if (localResearchContext) {
      await storage.updateAnalysis(analysisId, { status: "researching_local" });
    }
  } catch (err) {
    console.error("[Analysis] Research failed, continuing with AI knowledge:", err);
  }

  await storage.updateAnalysis(analysisId, { status: "analyzing_market" });

  const isInPerson = businessType === "in_person";
  const locationContext = isInPerson && businessLocation
    ? `\nBusiness Location: ${businessLocation}\nThis is a LOCAL/IN-PERSON business. Focus on local market dynamics, foot traffic, neighborhood demographics, and nearby competitors.`
    : "";

  const localCompetitorInstruction = isInPerson
    ? `
  "localCompetitors": [
    {"name": "Nearby Business Name", "address": "123 Main St, City", "distance": "0.3 miles", "priceRange": "$15-$25", "rating": "4.5/5", "reviewCount": "328 reviews", "type": "Direct competitor"},
    ... (3-8 nearby competitors with real addresses, distances, Google/Yelp ratings, and review counts)
  ],`
    : "";

  const localCompetitorNote = isInPerson
    ? `\nFor the localCompetitors array: find REAL nearby businesses that compete with this product/service in ${businessLocation}. Include their actual addresses, approximate distances, price ranges, and ratings. Think about what a customer walking around that area would see as alternatives.`
    : "";

  const userPriceContext = userCurrentPrice !== null && userCurrentPrice !== undefined
    ? `\nOwner's Current Price: $${userCurrentPrice.toFixed(2)} (PROVIDED BY THE OWNER — treat this as FACT, not an estimate. Use this exact number as the baseline for all comparisons, revenue/profit impact calculations, and price simulation.)`
    : isNewProduct
    ? `\nThis is a NEW PRODUCT with no current price yet. The owner is launching this for the first time and needs a launch price recommendation. Do NOT fabricate a "currentPrice" — set it to null. Focus your recommendation on what the FIRST price should be, with emphasis on market entry strategy.`
    : "";

  const competitorPrompt = `You are a senior pricing strategist with the depth of a McKinsey pricing consultant and the pragmatism of a Main Street business advisor. Your job: give the owner of this business the most ACCURATE, REALISTIC, and ACTIONABLE pricing recommendation possible.

Product/Business: ${productInput}
Business Type: ${isInPerson ? "In-Person / Local Business" : "Online / E-commerce"}${locationContext}${userPriceContext}

${webResearchContext ? `\n=== LIVE WEB RESEARCH DATA (PRIMARY SOURCE) ===\n${webResearchContext}\n=== END WEB RESEARCH ===` : ""}
${localResearchContext ? `\n=== LOCAL COMPETITOR RESEARCH ===\n${localResearchContext}\n=== END LOCAL RESEARCH ===` : ""}
${internalDataContext ? `\n=== OWNER'S INTERNAL BUSINESS DATA ===\n${internalDataContext}\n=== END INTERNAL DATA ===` : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — CONTEXT RESOLUTION (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before pricing, determine EXACTLY what is being sold, by whom, in what channel, and to whom.
A vague input like "steak" has wildly different correct prices:
  • Steakhouse entrée (restaurant)  → $28–$65
  • Raw prime ribeye at a butcher   → $18–$40/lb
  • Frozen steak subscription box   → $12–$22/lb
  • Food truck steak sandwich       → $13–$18
  • Grocery store retail pack       → $8–$18/lb
Resolve the most likely interpretation based on the business type, location context, and wording.
State your interpretation clearly inside the "productName" and "productCategory" fields.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — PRICING FRAMEWORK SELECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Choose the RIGHT framework for this product/business. Apply it rigorously:

A. VALUE-BASED PRICING (best for premium, unique, or experience goods)
   → Price = what the customer believes it's worth, not what it costs
   → Signals: strong brand, differentiated quality, loyal repeat buyers
   → Typical markup: 60–200% above cost

B. COMPETITIVE PRICING (best for commoditized products)
   → Price = at, slightly below, or slightly above direct competitors
   → Use actual competitor prices from research as your anchor
   → Typical variance from market avg: ±5–20%

C. COST-PLUS PRICING (best for services, bespoke, or custom work)
   → Price = estimated cost × markup factor
   → Food/beverage: target 28–35% food cost ratio (price = cost ÷ 0.30)
   → Retail goods: 40–60% gross margin (price = cost ÷ 0.55)
   → Services: 50–70% margin after labor

D. PSYCHOLOGICAL PRICING (apply to ANY framework for conversion lift)
   → Use charm prices: $X.99, $X.95, $X.49 (not $X.00 unless luxury)
   → Anchor high: show a "was" price or premium tier first
   → Bundle: suggest "2 for $X" or add-on upsells in the action steps

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — REALITY-CHECK BEFORE OUTPUT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before finalizing any price, verify ALL of the following:
✓ Is the optimalPrice within the known real-world range for this product category and channel?
✓ Would a real customer pay this without laughing or feeling ripped off?
✓ Are the competitor prices actually what real businesses charge? (not fabricated)
✓ Does the priceSimulation peak profit land AT or NEAR the optimalPrice? (if not, recalculate)
✓ Is the currentPrice a real estimate for what this type of business currently charges — not a placeholder?
✓ Are revenue/profit impact percentages computed correctly vs the currentPrice baseline?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4 — PRODUCE THE JSON OUTPUT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY a valid JSON object — no commentary, no markdown, no code fences:
{
  "productName": "Specific product/business name — include channel context (e.g. 'NY Strip Steak (Steakhouse Entrée)' or 'NY Strip Steak (Butcher Retail, per lb)')",
  "productCategory": "Specific category including channel — e.g. 'Fine Dining / Steakhouse' not just 'Food'",
  "currentPrice": ${userCurrentPrice ? `${userCurrentPrice} (USE THE OWNER'S PROVIDED PRICE — do NOT change it)` : isNewProduct ? `null (new product — no current price exists yet)` : `typical current price for this type of business as a number (MUST be realistic — a steakhouse entrée is $30–$55, not $15; a raw steak /lb is $12–$35, not $50)`},
  "pricingStrategy": "Value-Based" | "Competitive" | "Cost-Plus" | "Psychological" | "Competitive + Psychological",
  "pricingRationale": "2-3 sentences explaining WHY this specific price. Reference the framework used, specific competitors, and what makes this price defensible.",
  "competitors": [
    {"name": "Real Business or Brand Name", "price": 29.99, "discount": "10% off or null", "availability": "In Stock or Varies", "rating": "4.5/5", "reviewCount": "1,240 reviews"${isInPerson ? ', "address": "Full street address", "distance": "0.4 miles"' : ""}},
    ... (4-7 competitors — real businesses at realistic prices with REAL ratings/review counts from Google, Yelp, Amazon, etc. For restaurants/services: use menu prices + Yelp/Google ratings. For retail: use actual retail prices + Amazon/product review counts.)
  ],${localCompetitorInstruction}
  "customerPersona": {
    "who": "2 specific sentences about who buys this — age, lifestyle, motivation. Be vivid.${isInPerson ? " Mention how they find this business (walk-by, Google Maps, referral)." : ""}",
    "ageRange": "XX–YY years old",
    "whyTheyBuy": "The core emotional and functional reason",
    "whatTheyCareMost": "The #1 decision factor (quality/price/convenience/brand/trust)",
    "typicalBudget": "Realistic budget range — e.g. '$30–$50 per dinner out' or '$20–$35 for a scented candle'",
    "whereTheyShop": "${isInPerson ? "Other local spots they frequent — name real neighborhood businesses or chains" : "Top 3 online channels where they discover and buy products like this"}",
    "priceSensitivity": "low" | "medium" | "high"
  },
  "demandSignals": {
    "trend": "Concrete 2-3 sentences. Cite real data: e.g. 'Google Trends shows +22% YoY for this query' or 'Yelp reviews for this category grew 18% in this zip code.' Be specific.",
    "trendDirection": "up" | "down" | "stable",
    "trendPercentage": realistic number (e.g. 8 for 8% growth),
    "seasonality": "Month-by-month or quarter-by-quarter pattern. Name actual peak seasons and why.${isInPerson ? " Include local events, tourist seasons, school calendar." : ""}",
    "searchVolume": "Realistic estimate with units — e.g. '~40,000 searches/month for [keyword]' or 'high — category leader in Google Shopping'",
    "priceVolatility": "How often and by how much do prices move? Give a concrete range if possible."
  },
  "marketAverage": weighted average of competitor prices as a number (calculate from the competitors array),
  "priceSimulation": [
    ... 10 price points spanning ±40% around the currentPrice.
    Each: {"price": X.XX, "expectedDemand": Y (units/month), "expectedRevenue": Z, "expectedProfit": W}
    IMPORTANT: demand must slope downward as price increases (price elasticity), and profit MUST peak close to optimalPrice.
    Use realistic units — a local restaurant might do 200–800 covers/month; an Etsy seller 20–200 units/month.
  ],
  "optimalPrice": the price point where expectedProfit is highest in the simulation, expressed with psychological pricing (use .99/.95/.49 unless premium positioning warrants a round number),
  "marketPosition": "Budget" | "Mid-range" | "Slightly Premium" | "Premium" | "Luxury",
  "revenueImpact": "+X%" or "-X%" — calculate from (optimalPrice - currentPrice) / currentPrice × 100, adjusted for demand elasticity,
  "profitImpact": "+X%" or "-X%" — estimate margin improvement at optimalPrice vs currentPrice,
  "summary": "3 sentences: (1) What this business/product is and where it sits in the market. (2) Why the current price is wrong or right — with specific numbers. (3) What the optimal price achieves.",
  "keyInsight": "Begin with 'Strategy: [name]' (e.g., 'Strategy: Competitive + Psychological'). Then in 1 sentence explain WHY this price — reference actual competitors or cost structure. Then the single most counterintuitive or non-obvious insight about pricing this product backed by data.",
  "recommendedAction": "Numbered step-by-step plan. Each step must be concrete and immediately actionable. Include: (1) the exact price to set, (2) how to frame/present it to customers, (3) a psychological pricing tactic (charm price, anchor, bundle), (4) what to monitor, (5) when to re-evaluate.${isInPerson ? " Include local tactics: signage, Google My Business, neighborhood partnerships." : ""}"
}${localCompetitorNote}

FINAL REMINDER: If the product input is ambiguous (like 'steak' or 'coffee'), state your interpretation explicitly in productName. The optimalPrice MUST be realistic for the industry — verify it against the competitor prices in your own output before returning.`;

  try {
    const response = await minimaxAI.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: "user", content: competitorPrompt }],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No response from AI");

    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const result = JSON.parse(cleaned);

    await storage.updateAnalysis(analysisId, {
      status: "completed",
      productName: result.productName,
      productCategory: result.productCategory,
      currentPrice: isNewProduct ? null : (userCurrentPrice ?? result.currentPrice),
      optimalPrice: result.optimalPrice,
      marketAverage: result.marketAverage,
      revenueImpact: result.revenueImpact,
      profitImpact: result.profitImpact,
      marketPosition: result.marketPosition,
      summary: result.summary,
      keyInsight: result.keyInsight,
      recommendedAction: result.recommendedAction,
      competitors: result.competitors as CompetitorData[],
      localCompetitors: result.localCompetitors as LocalCompetitor[] || null,
      demandSignals: result.demandSignals as DemandSignal,
      priceSimulation: result.priceSimulation as PriceSimulationPoint[],
      customerPersona: result.customerPersona as CustomerPersona,
    });
  } catch (error) {
    console.error("AI analysis failed:", error);
    await storage.updateAnalysis(analysisId, { status: "failed" });
  }
}

async function extractInternalData(files: Express.Multer.File[]): Promise<string> {
  const summaries: string[] = [];
  
  for (const file of files) {
    const ext = file.originalname.split(".").pop()?.toLowerCase() || "";
    let fileContent = "";

    if (["csv", "txt"].includes(ext)) {
      fileContent = file.buffer.toString("utf-8").slice(0, 10000);
    } else if (["xlsx", "xls"].includes(ext)) {
      fileContent = `[Excel file: ${file.originalname}, ${(file.size / 1024).toFixed(1)}KB]`;
    } else if (["pdf", "doc", "docx"].includes(ext)) {
      fileContent = `[Document file: ${file.originalname}, ${(file.size / 1024).toFixed(1)}KB]`;
    } else if (["pptx", "ppt"].includes(ext)) {
      fileContent = `[Presentation file: ${file.originalname}, ${(file.size / 1024).toFixed(1)}KB]`;
    } else if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
      try {
        const base64 = file.buffer.toString("base64");
        const visionResponse = await replicAI.chat.completions.create({
          model: "gpt-5.2",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Extract any pricing, sales, cost, or business data from this image. Look for price tags, charts, tables, or any numerical business information. Provide a structured summary." },
              { type: "image_url", image_url: { url: `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${base64}` } },
            ],
          }],
        });
        fileContent = visionResponse.choices[0]?.message?.content || "Could not extract data from image";
      } catch {
        fileContent = `[Image file: ${file.originalname}]`;
      }
    } else {
      fileContent = file.buffer.toString("utf-8").slice(0, 5000);
    }

    if (fileContent) {
      summaries.push(`File: ${file.originalname}\n${fileContent}`);
    }
  }

  if (summaries.length === 0) return "";

  try {
    const extractResponse = await minimaxAI.chat.completions.create({
      model: AI_MODEL,
      messages: [{
        role: "user",
        content: `Extract and summarize all business-relevant data from these files. Focus on: pricing data, sales volumes, revenue, costs, margins, marketing positioning, target demographics, and any other business intelligence.\n\n${summaries.join("\n\n---\n\n")}`,
      }],
    });
    return extractResponse.choices[0]?.message?.content || summaries.join("\n");
  } catch {
    return summaries.join("\n");
  }
}
