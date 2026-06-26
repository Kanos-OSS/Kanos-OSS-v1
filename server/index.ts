import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { createServer } from "http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { storage } from "./storage";
import type { User } from "@shared/schema";

const app = express();
app.set("trust proxy", 1);
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    passport: { user: number };
  }
}

declare global {
  namespace Express {
    interface User {
      id: number;
      googleId: string;
      email: string;
      name: string | null;
      picture: string | null;
      createdAt: Date;
    }
  }
}

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "50mb" }));

// Use a Postgres-backed session store when a database is configured;
// otherwise fall back to express-session's in-memory store (DB-free mode).
const PgStore = connectPgSimple(session);
const sessionStore = process.env.DATABASE_URL
  ? new PgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
    })
  : undefined;
app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || "kanos-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV !== "development",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user: Express.User, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: number, done) => {
  try {
    const user = await storage.getUser(id);
    done(null, user || undefined);
  } catch (err) {
    done(err);
  }
});

if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
  // Set OAUTH_CALLBACK_URL to your deployed origin's callback, e.g.
  // https://your-domain.com/api/auth/google/callback
  const port = process.env.PORT || "15000";
  const callbackURL =
    process.env.OAUTH_CALLBACK_URL ||
    `http://localhost:${port}/api/auth/google/callback`;

  console.log(`[AUTH] Google OAuth callbackURL: ${callbackURL} (NODE_ENV=${process.env.NODE_ENV})`);

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        callbackURL,
        proxy: true,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value || "";
          const name = profile.displayName || null;
          const picture = profile.photos?.[0]?.value || null;
          const user = await storage.findOrCreateUser(profile.id, email, name, picture);
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      }
    )
  );
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} ${message} [${source}]`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const body = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${body.length > 200 ? body.slice(0, 200) + "…" : body}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  if (process.env.DATABASE_URL) {
    const { seedDatabase } = await import("./seed");
    await seedDatabase().catch((e) => console.error("Seed failed:", e));
  }

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "kanos-oss" });
  });

  // Root: service info + API map. Returns a small HTML page in browsers,
  // JSON for API clients.
  app.get("/", (req, res) => {
    const info = {
      name: "Kanos OSS",
      description:
        "Open-source AI pricing-analysis engine. Give it a product URL, name, or business description and it returns a structured pricing recommendation.",
      docs: "https://github.com/Kanos-OSS/kanos-oss#readme",
      endpoints: {
        "POST /api/agent/analyze":
          "Run a pricing analysis (API key auth: 'Authorization: Bearer <key>'). Body: { productInput, businessType?, businessLocation?, currentPrice? }",
        "GET /health": "Health check",
      },
      auth: "Send an API key as a Bearer token. Set a static API_KEY in the environment, or (with a database) mint one via `npm run create-api-key`.",
    };

    if ((req.headers.accept || "").includes("text/html")) {
      res.type("html").send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kanos OSS</title>
<style>
  body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#111;line-height:1.55}
  code{background:#f4f4f5;padding:2px 6px;border-radius:5px;font-size:.9em}
  pre{background:#0f172a;color:#e2e8f0;padding:16px;border-radius:10px;overflow:auto}
  h1{margin-bottom:4px}.sub{color:#666;margin-top:0}
  .pill{display:inline-block;background:#16a34a;color:#fff;font-size:12px;padding:2px 10px;border-radius:999px;vertical-align:middle}
  a{color:#2563eb}
</style></head>
<body>
  <h1>Kanos OSS <span class="pill">running</span></h1>
  <p class="sub">${info.description}</p>
  <h3>Quick start</h3>
  <pre>curl -X POST ${req.protocol}://${req.headers.host}/api/agent/analyze \\
  -H "Authorization: Bearer &lt;your-api-key&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{"productInput":"https://example-shop.com/products/widget","currentPrice":29.99}'</pre>
  <p>Create a key with <code>npm run create-api-key</code>. Full docs: <a href="${info.docs}">${info.docs}</a></p>
</body></html>`);
    } else {
      res.json(info);
    }
  });

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  const port = parseInt(process.env.PORT || "15000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
