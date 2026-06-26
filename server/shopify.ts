import type { ShopifyProduct, ShopifyVariant } from "@shared/schema";
import crypto from "crypto";

const SHOPIFY_SCOPES = "read_products,write_products";

export function getShopifyApiKey(): string | undefined {
  return process.env.SHOPIFY_API_KEY;
}

export function getShopifyApiSecret(): string | undefined {
  return process.env.SHOPIFY_API_SECRET;
}

export function isOAuthConfigured(): boolean {
  return !!(getShopifyApiKey() && getShopifyApiSecret());
}

export function buildOAuthUrl(shopDomain: string, redirectUri: string, state: string): string {
  const apiKey = getShopifyApiKey();
  return `https://${shopDomain}/admin/oauth/authorize?client_id=${apiKey}&scope=${SHOPIFY_SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
}

export function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

export async function exchangeCodeForToken(
  shopDomain: string,
  code: string
): Promise<{ success: boolean; accessToken?: string; error?: string }> {
  try {
    const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: getShopifyApiKey(),
        client_secret: getShopifyApiSecret(),
        code,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Token exchange failed (${res.status}): ${text.slice(0, 200)}` };
    }

    const data: any = await res.json();
    return { success: true, accessToken: data.access_token };
  } catch (err: any) {
    return { success: false, error: err.message || "Token exchange failed" };
  }
}

export async function testShopifyConnection(shopDomain: string, accessToken: string): Promise<{ success: boolean; shopName?: string; error?: string }> {
  try {
    const res = await fetch(`https://${shopDomain}/admin/api/2024-01/shop.json`, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) return { success: false, error: "Invalid access token. Check your Shopify Admin API token." };
      if (res.status === 404) return { success: false, error: "Store not found. Check your store name." };
      return { success: false, error: `Shopify responded with ${res.status}: ${text.slice(0, 200)}` };
    }
    const data: any = await res.json();
    return { success: true, shopName: data.shop?.name || shopDomain };
  } catch (err: any) {
    return { success: false, error: err.message || "Could not connect to Shopify" };
  }
}

export async function listShopifyProducts(shopDomain: string, accessToken: string, search?: string): Promise<ShopifyProduct[]> {
  let url = `https://${shopDomain}/admin/api/2024-01/products.json?limit=20&fields=id,title,handle,image,variants`;
  if (search) url += `&title=${encodeURIComponent(search)}`;

  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);

  const data: any = await res.json();
  return (data.products || []).map((p: any) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    image: p.image?.src || undefined,
    variants: (p.variants || []).map((v: any) => ({
      id: v.id,
      title: v.title,
      price: v.price,
      sku: v.sku || undefined,
    })),
  }));
}

export async function updateShopifyVariantPrice(
  shopDomain: string,
  accessToken: string,
  variantId: number,
  newPrice: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`https://${shopDomain}/admin/api/2024-01/variants/${variantId}.json`, {
      method: "PUT",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        variant: {
          id: variantId,
          price: newPrice,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Failed to update price: ${text.slice(0, 200)}` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Could not update price" };
  }
}
