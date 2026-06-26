import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.COMPUTE_COMMUNITY_API_KEY || "missing-key",
  baseURL: process.env.COMPUTE_COMMUNITY_BASE_URL || "https://computecommunity.com/sundai-server/v1",
});

export const replicAI = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "missing-key",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export const minimaxAI = new OpenAI({
  apiKey: process.env.MINIMAX_KEY || "missing-key",
  baseURL: "https://openrouter.ai/api/v1",
});

export const AI_MODEL = "minimax/minimax-m2.5";
