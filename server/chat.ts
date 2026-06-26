import fs from "fs";
import path from "path";
import type { Analysis } from "@shared/schema";
import { minimaxAI, AI_MODEL } from "./openai";
import { storage } from "./storage";

function loadPromptTemplate(): string {
  return fs.readFileSync(path.join(process.cwd(), "server/prompts/chat-system.txt"), "utf-8");
}

export function buildSystemPrompt(analysis: Analysis): string {
  const template = loadPromptTemplate();

  const competitors = (analysis.competitors || [])
    .map((c) => `- ${c.name}: $${c.price}${c.rating ? ` (${c.rating})` : ""}`)
    .join("\n") || "None listed";

  const localCompetitors = (analysis.localCompetitors || [])
    .map((c) => `- ${c.name}${c.distance ? ` (${c.distance})` : ""}: ${c.priceRange || ""}${c.rating ? ` — ${c.rating}` : ""}`)
    .join("\n");

  const persona = analysis.customerPersona;
  const demand = analysis.demandSignals;

  return template
    .replace("{{PRODUCT_NAME}}", analysis.productName || analysis.productInput)
    .replace("{{PRODUCT_CATEGORY}}", analysis.productCategory || "N/A")
    .replace("{{BUSINESS_TYPE}}", analysis.businessType || "online")
    .replace("{{BUSINESS_LOCATION}}", analysis.businessLocation || "N/A")
    .replace("{{CURRENT_PRICE}}", analysis.currentPrice != null ? `$${analysis.currentPrice}` : "Not set (new product)")
    .replace("{{OPTIMAL_PRICE}}", analysis.optimalPrice != null ? `$${analysis.optimalPrice}` : "N/A")
    .replace("{{MARKET_AVERAGE}}", analysis.marketAverage != null ? `$${analysis.marketAverage}` : "N/A")
    .replace("{{MARKET_POSITION}}", analysis.marketPosition || "N/A")
    .replace("{{REVENUE_IMPACT}}", analysis.revenueImpact || "N/A")
    .replace("{{PROFIT_IMPACT}}", analysis.profitImpact || "N/A")
    .replace("{{SUMMARY}}", analysis.summary || "N/A")
    .replace("{{KEY_INSIGHT}}", analysis.keyInsight || "N/A")
    .replace("{{RECOMMENDED_ACTION}}", analysis.recommendedAction || "N/A")
    .replace("{{COMPETITORS}}", competitors)
    .replace("{{LOCAL_COMPETITORS}}", localCompetitors ? `LOCAL COMPETITORS:\n${localCompetitors}\n\n` : "")
    .replace("{{CUSTOMER_PERSONA}}", persona
      ? `${persona.who} Age: ${persona.ageRange}. Budget: ${persona.typicalBudget}. Price sensitivity: ${persona.priceSensitivity}.`
      : "N/A")
    .replace("{{DEMAND_SIGNALS}}", demand
      ? `${demand.trend} Trend: ${demand.trendDirection} (${demand.trendPercentage}%). ${demand.seasonality}`
      : "N/A");
}

export async function generateSessionTitle(sessionId: number, productName: string, firstMessage: string): Promise<void> {
  try {
    const response = await minimaxAI.chat.completions.create({
      model: AI_MODEL,
      messages: [{
        role: "user",
        content: `Generate a short 5-7 word title for a pricing chat session. Product: "${productName}". User's opening question: "${firstMessage}". Reply with only the title — no quotes, no punctuation at the end.`,
      }],
    });
    const title = response.choices[0]?.message?.content?.trim();
    if (title) {
      await storage.updateChatSessionTitle(sessionId, title.slice(0, 80));
    }
  } catch (err) {
    console.error("[Chat] Title generation failed:", err);
  }
}
