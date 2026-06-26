import { db } from "./db";
import { analyses } from "@shared/schema";
import { sql } from "drizzle-orm";

export async function seedDatabase() {
  const existing = await db.select({ count: sql<number>`count(*)` }).from(analyses);
  if (existing[0].count > 0) return;

  await db.insert(analyses).values([
    {
      productInput: "Premium Ceramic Coffee Mug - Handcrafted 12oz",
      productName: "Premium Ceramic Coffee Mug",
      productCategory: "Kitchen & Dining / Drinkware",
      status: "completed",
      currentPrice: 18.99,
      optimalPrice: 22.50,
      marketAverage: 19.75,
      revenueImpact: "+12%",
      profitImpact: "+28%",
      marketPosition: "Mid-range",
      summary: "Your handcrafted ceramic mug is currently priced below market value for premium drinkware. The artisan quality and unique design justify a higher price point. Increasing to $22.50 would position you competitively while significantly boosting margins.",
      keyInsight: "Competitors with similar handcrafted positioning are selling at $20-$26. Your product's quality features support pricing in the upper half of this range without impacting demand.",
      recommendedAction: "1. Increase price to $22.50\n2. Emphasize handcrafted quality in product listing\n3. Monitor sales for 2 weeks\n4. Re-run analysis to validate",
      competitors: [
        { name: "Artisan Home Co.", price: 24.99, discount: "Free shipping", availability: "In Stock" },
        { name: "CeramicCraft Studio", price: 21.50, availability: "In Stock" },
        { name: "The Mug House", price: 19.99, discount: "Buy 2 get 10% off", availability: "In Stock" },
        { name: "SimpleWare", price: 16.49, availability: "Low Stock" },
        { name: "PotteryBarn Express", price: 23.95, availability: "In Stock" },
      ],
      demandSignals: {
        trend: "Specialty drinkware demand continues upward trajectory driven by home office culture and gift-giving seasons",
        trendDirection: "up",
        trendPercentage: 14,
        seasonality: "Peak demand in Q4 (holiday season) and moderate spike in May (Mother's Day). Summer months show slight dip.",
        searchVolume: "High - 'ceramic coffee mug' averages 74K monthly searches with steady growth",
        priceVolatility: "Low - prices in this category remain stable with minor promotional fluctuations",
      },
      priceSimulation: [
        { price: 14, expectedDemand: 145, expectedRevenue: 2030, expectedProfit: 435 },
        { price: 16, expectedDemand: 135, expectedRevenue: 2160, expectedProfit: 540 },
        { price: 18, expectedDemand: 122, expectedRevenue: 2196, expectedProfit: 610 },
        { price: 20, expectedDemand: 112, expectedRevenue: 2240, expectedProfit: 672 },
        { price: 22, expectedDemand: 104, expectedRevenue: 2288, expectedProfit: 732 },
        { price: 22.5, expectedDemand: 101, expectedRevenue: 2272.5, expectedProfit: 742 },
        { price: 24, expectedDemand: 92, expectedRevenue: 2208, expectedProfit: 700 },
        { price: 26, expectedDemand: 78, expectedRevenue: 2028, expectedProfit: 624 },
        { price: 28, expectedDemand: 62, expectedRevenue: 1736, expectedProfit: 496 },
        { price: 30, expectedDemand: 48, expectedRevenue: 1440, expectedProfit: 384 },
      ],
      hasInternalData: 0,
    },
    {
      productInput: "https://example-shop.com/products/wireless-earbuds-pro",
      productName: "Wireless Earbuds Pro",
      productCategory: "Electronics / Audio",
      status: "completed",
      currentPrice: 49.99,
      optimalPrice: 44.95,
      marketAverage: 42.50,
      revenueImpact: "+8%",
      profitImpact: "+5%",
      marketPosition: "Slightly Premium",
      summary: "Your wireless earbuds are priced above the competitive sweet spot. While your product has good features, the crowded mid-range market suggests a slight price reduction would capture significantly more volume. The net effect on profit is positive due to volume gains.",
      keyInsight: "The $40-$50 segment is highly competitive. Products priced at $44-$46 see the best balance of conversion rate and margin in this category.",
      recommendedAction: "1. Reduce price to $44.95\n2. Add a limited-time bundle offer with a charging case\n3. Monitor conversion rate and reviews\n4. Re-analyze in 3 weeks",
      competitors: [
        { name: "SoundCore Elite", price: 39.99, discount: "15% off", availability: "In Stock" },
        { name: "BeatBuds Audio", price: 44.99, availability: "In Stock" },
        { name: "TrueWire Audio", price: 42.50, availability: "In Stock" },
        { name: "ZenPods", price: 54.99, discount: "Free case included", availability: "In Stock" },
      ],
      demandSignals: {
        trend: "Wireless audio market growing steadily with shift toward affordable premium options",
        trendDirection: "up",
        trendPercentage: 22,
        seasonality: "Strong demand year-round with peaks during back-to-school and holiday seasons",
        searchVolume: "Very High - wireless earbuds consistently among top-searched electronics",
        priceVolatility: "Medium - frequent promotional cycles with ~15% average discounts",
      },
      priceSimulation: [
        { price: 30, expectedDemand: 280, expectedRevenue: 8400, expectedProfit: 1680 },
        { price: 35, expectedDemand: 245, expectedRevenue: 8575, expectedProfit: 2205 },
        { price: 40, expectedDemand: 210, expectedRevenue: 8400, expectedProfit: 2520 },
        { price: 45, expectedDemand: 178, expectedRevenue: 8010, expectedProfit: 2670 },
        { price: 50, expectedDemand: 142, expectedRevenue: 7100, expectedProfit: 2485 },
        { price: 55, expectedDemand: 108, expectedRevenue: 5940, expectedProfit: 2160 },
        { price: 60, expectedDemand: 78, expectedRevenue: 4680, expectedProfit: 1716 },
      ],
      hasInternalData: 0,
    },
  ]);
}
