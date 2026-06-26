import "dotenv/config";
import { storage } from "../server/storage";

/**
 * Mint an API key without the web frontend / Google OAuth.
 *
 *   npm run create-api-key -- "my-key-name"
 *
 * Prints a key you can pass to POST /api/agent/analyze as a Bearer token.
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Copy .env.example to .env, fill it in, " +
        "run `npm run db:push`, then try again.",
    );
    process.exit(1);
  }

  const name = (process.argv[2] || "cli-key").trim();

  // Create (or reuse) a local, non-OAuth user to own the key.
  const user = await storage.findOrCreateUser(
    `local:${name}`,
    `${name}@local`,
    name,
    null,
  );
  const apiKey = await storage.createApiKey(user.id, name);

  console.log("\nAPI key created (named \"" + name + "\"):\n");
  console.log("  " + apiKey.key);
  console.log("\nTry it:\n");
  console.log(
    "  curl -X POST http://localhost:15000/api/agent/analyze \\\n" +
      "    -H 'Authorization: Bearer " + apiKey.key + "' \\\n" +
      "    -H 'Content-Type: application/json' \\\n" +
      "    -d '{\"productInput\":\"Premium ceramic coffee mug\",\"currentPrice\":18.99}'\n",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to create API key:", err);
  process.exit(1);
});
