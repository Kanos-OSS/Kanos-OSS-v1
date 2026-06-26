import { minimaxAI, AI_MODEL } from "./openai";

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") return false;
    if (host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (/^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function fetchProductPage(url: string): Promise<string> {
  if (!isAllowedUrl(url)) {
    console.log("[WebResearch] Blocked disallowed URL:", url);
    return "";
  }

  try {
    console.log("[WebResearch] Fetching page:", url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KanosBot/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return cleaned.slice(0, 12000);
  } catch (error) {
    console.error("[WebResearch] Failed to fetch:", url, error);
    return "";
  }
}

export async function extractPageData(pageContent: string, url: string): Promise<string> {
  if (!pageContent.trim()) return "";

  try {
    const response = await minimaxAI.chat.completions.create({
      model: AI_MODEL,
      messages: [{
        role: "user",
        content: `Extract all pricing, product, and business information from this web page content. Focus on:
- Product name and description
- Prices (current, sale, original)
- Product specifications and features
- Reviews or ratings if visible
- Any competitor mentions
- Business details (location, hours, etc.)

URL: ${url}
Page content:
${pageContent.slice(0, 10000)}

Return a structured summary of everything you found.`,
      }],
    });
    return response.choices[0]?.message?.content || "";
  } catch {
    return `[Fetched content from ${url}: ${pageContent.slice(0, 2000)}]`;
  }
}

export async function deepResearch(
  productInput: string,
  businessType: "online" | "in_person",
  businessLocation?: string | null
): Promise<{ webSummary: string; localSummary: string }> {
  const isUrl = productInput.startsWith("http://") || productInput.startsWith("https://");
  let pageData = "";
  let webSummary = "";
  let localSummary = "";

  if (isUrl) {
    const pageContent = await fetchProductPage(productInput);
    if (pageContent) {
      pageData = await extractPageData(pageContent, productInput);
    }
  }

  try {
    const webResearchPrompt = `You are an autonomous market research AI agent. Your task is to provide comprehensive, real-world market intelligence.

Product/Business: ${productInput}
${pageData ? `\n=== DATA FROM PRODUCT PAGE ===\n${pageData}\n=== END ===` : ""}

Using your training data and knowledge, provide detailed research:

1. **Product Identification**: What exactly is this product? Clean name, category, typical price range.
2. **Real Competitors**: Name 5-8 REAL companies/products that compete. Include actual brand names, actual price points you know about, their market positioning, customer rating (e.g. 4.5/5), and approximate review count (e.g. "2,340 reviews on Amazon").
3. **Market Data**: Market size estimates, growth trends, seasonal patterns.
4. **Price Intelligence**: What prices are competitors actually charging? What discounts are common? What's the typical markup in this industry?
5. **Consumer Behavior**: How do buyers research and purchase this type of product? What do reviews commonly praise or criticize? What complaints are most frequent?
${businessType === "in_person" && businessLocation ? `6. **Local Market Context for ${businessLocation}**: Cost of living, typical pricing for this type of business in that area, local economic conditions, foot traffic patterns, neighborhood demographics.` : ""}

Be specific. Use real brand names, real prices, real data points. Don't hedge or be vague — give concrete numbers and names.`;

    const response = await minimaxAI.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: "user", content: webResearchPrompt }],
    });

    webSummary = response.choices[0]?.message?.content || "";
  } catch (err) {
    console.error("[WebResearch] Deep research failed:", err);
  }

  if (businessType === "in_person" && businessLocation) {
    try {
      const localPrompt = `You are a local market intelligence AI. Research the competitive landscape for a specific business in a specific location.

Business Type: ${productInput}
Location: ${businessLocation}

Provide detailed local intelligence:

1. **Nearby Competitors**: Name REAL businesses of this type that exist in or near ${businessLocation}. Include:
   - Business name
   - Approximate address or neighborhood
   - Estimated price range
   - Google/Yelp rating (e.g. 4.3/5) and approximate review count (e.g. "328 reviews")
   - What reviewers commonly praise and complain about
   - How far from the center of ${businessLocation}
   
2. **Local Market Dynamics**:
   - What's the typical pricing for this type of business in ${businessLocation}?
   - Is this a high-rent area? What are typical costs?
   - What's the foot traffic like? Tourist area or residential?
   - Any seasonal patterns specific to this location?
   
3. **Local Consumer Profile**:
   - Who lives/works/visits this area?
   - What's the income level?
   - Price sensitivity of the local customer base?
   
4. **Local Competitive Advantages**:
   - What could make a business stand out in this specific location?
   - Are there underserved niches?
   - What do local reviews say about existing competitors?

Be specific and use real place names, real business names when you can, and realistic price estimates for the area.`;

      const localResponse = await minimaxAI.chat.completions.create({
        model: AI_MODEL,
        messages: [{ role: "user", content: localPrompt }],
      });

      localSummary = localResponse.choices[0]?.message?.content || "";
    } catch (err) {
      console.error("[WebResearch] Local research failed:", err);
    }
  }

  return { webSummary, localSummary };
}
