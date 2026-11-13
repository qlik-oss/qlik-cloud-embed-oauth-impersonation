import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import csrf from "csurf";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";

export const REQUIRED_ENV_VARS = [
  "SESSION_SECRET",
  "TENANT_URI",
  "OAUTH_BACKEND_CLIENT_ID",
  "OAUTH_BACKEND_CLIENT_SECRET",
  "OAUTH_FRONTEND_CLIENT_ID",
  "OAUTH_FRONTEND_CLIENT_SECRET",
  "APP_ID",
];

/** Return the names of required environment variables that are missing or empty. */
export function findMissingEnvVars(env) {
  return REQUIRED_ENV_VARS.filter((name) => !env[name]);
}

/** Qlik APIs accept either `tenant.region.qlikcloud.com` or `https://tenant.region.qlikcloud.com`. */
export function normalizeTenantUri(uri) {
  const trimmed = (uri || "").trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// OData filter string safety (email must not break the quoted literal)
export function escapeODataString(value) {
  return String(value).replace(/"/g, "");
}

// Backend-only scopes for user management API calls
export const BACKEND_USER_LOOKUP_SCOPE = "user_default";
export const BACKEND_USER_CREATE_SCOPE = "admin_classic user_default";

// Frontend scope granted to impersonated user tokens
export const FRONTEND_USER_APP_SCOPES = "user_default";

// Rows fetched per hypercube page (initial fetch and every follow-up page)
export const HYPERCUBE_PAGE_HEIGHT = 10;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build the Express app.
 *
 * This returns the app without starting it, and takes the Qlik SDK and env as arguments
 * instead of importing them. That lets the tests in tests/unit/ create the app with
 * stubbed Qlik calls; server.js passes the real `@qlik/api` and `process.env`.
 *
 * @param {object} options
 * @param {object} options.qlik  The `@qlik/api` modules used by the app: `{ auth, users, qix }`.
 *                               Passed in so tests can supply stubs instead of calling Qlik Cloud.
 * @param {object} [options.env] Environment variables (defaults to `process.env`).
 * @param {object} [options.rateLimits] Optional overrides for limiter `max` values: `{ file, login, token }`.
 */
export function createApp({ qlik, env = process.env, rateLimits = {} }) {
  const { auth: qlikAuth, users: qlikUsers, qix: openAppSession } = qlik;
  const TENANT_URI = normalizeTenantUri(env.TENANT_URI);
  const isProduction = env.NODE_ENV === "production";

  // Application settings (USER_PREFIX defaults match login.html copy for new learners)
  const appSettings = {
    secret: env.SESSION_SECRET,
    userPrefix: env.USER_PREFIX ?? "oauth_gen_",
    hypercubeDimension: env.HYPERCUBE_DIMENSION,
    hypercubeMeasure: env.HYPERCUBE_MEASURE,
  };

  // Qlik backend config for server-to-server user lookup and creation
  const configBackend = {
    authType: "oauth2",
    host: TENANT_URI,
    clientId: env.OAUTH_BACKEND_CLIENT_ID,
    clientSecret: env.OAUTH_BACKEND_CLIENT_SECRET,
    noCache: true,
  };

  // Qlik frontend config for minting impersonated end-user access tokens
  const configFrontend = {
    authType: "oauth2",
    host: TENANT_URI,
    clientId: env.OAUTH_FRONTEND_CLIENT_ID,
    clientSecret: env.OAUTH_FRONTEND_CLIENT_SECRET,
    noCache: true,
  };

  // Build a host config scoped to a specific impersonated user
  function getFrontendHostConfig(userId) {
    return {
      ...configFrontend,
      userId,
      scope: FRONTEND_USER_APP_SCOPES,
    };
  }

  // Configuration parameters sent to the browser for qlik-embed setup (never include secrets here)
  const frontendParams = {
    tenantUri: TENANT_URI,
    oAuthFrontEndClientId: env.OAUTH_FRONTEND_CLIENT_ID,
    appId: env.APP_ID,
    sheetId: env.SHEET_ID,
    objectId: env.OBJECT_ID,
    fieldId: env.FIELD_ID,
    assistantId: env.ASSISTANT_ID,
    agenticAssistantId: env.AGENTIC_ASSISTANT_ID,
    hypercubeDimension: env.HYPERCUBE_DIMENSION,
    hypercubeMeasure: env.HYPERCUBE_MEASURE,
    masterDimension: env.MASTER_DIMENSION,
    masterMeasure: env.MASTER_MEASURE,
  };

  const app = express();

  // Rate limiter for file-serving routes (login page, home page)
  const fileRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: rateLimits.file ?? 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many requests, please try again later.",
    handler: (req, res, _next, options) => {
      console.warn(`[Rate Limit] Blocked ${req.method} ${req.originalUrl} from ${req.ip} — limit of ${options.max} requests per ${options.windowMs / 1000}s exceeded`);
      res.status(options.statusCode).send(options.message);
    },
  });

  // Only expose asset folders — home.html and login.html are served via routes so GET /
  // always runs user provisioning (see README "Troubleshooting").
  app.use("/css", express.static(path.join(__dirname, "css")));
  app.use("/js", express.static(path.join(__dirname, "js")));
  app.use("/img", express.static(path.join(__dirname, "img")));

  const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: rateLimits.login ?? 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many login attempts, please try again later.",
    handler: (req, res, _next, options) => {
      console.warn(`[Rate Limit] Login blocked ${req.ip} — ${options.max} per ${options.windowMs / 60000} min`);
      res.status(options.statusCode).send(options.message);
    },
  });

  const tokenRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: rateLimits.token ?? 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many token requests, please try again later.",
    handler: (req, res, _next, options) => {
      console.warn(`[Rate Limit] Token mint blocked ${req.ip} — ${options.max} per minute`);
      res.status(options.statusCode).send(options.message);
    },
  });

  app.set("trust proxy", 1);

  qlikAuth.setDefaultHostConfig(configFrontend);

  app.use(cookieParser());

  // Express session with secure cookie and 1-hour TTL
  app.use(
    session({
      secret: appSettings.secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: isProduction,
        httpOnly: true,
        maxAge: 3600000,
        sameSite: "lax",
      },
    })
  );

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  const csrfProtection = csrf({
    cookie: true,
  });

  // Open a QIX app session for a given user
  function getQlikAppSession(userId) {
    return openAppSession.openAppSession({
      appId: frontendParams.appId,
      hostConfig: getFrontendHostConfig(userId),
      withoutData: false,
    });
  }

  // Look up an active Qlik user by email
  async function getQlikUser(userEmail) {
    const safeEmail = escapeODataString(userEmail);
    try {
      const { data: user } = await qlikUsers.getUsers(
        {
          filter: `email eq "${safeEmail}" and status eq "active"`,
        },
        {
          hostConfig: {
            ...configBackend,
            scope: BACKEND_USER_LOOKUP_SCOPE,
          },
        }
      );
      return user;
    } catch (error) {
      console.error("Error getting user:", error);
      throw error;
    }
  }

  // JSON error body shared by the QIX routes (stack only outside production)
  function sendQixError(res, err, error) {
    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode).json({
      error,
      code: err.code,
      message: err.message,
      enigmaError: err.enigmaError || false,
      stack: isProduction ? undefined : err.stack,
    });
  }

  // Reject unauthenticated API requests with 401 so the client can redirect to login
  function requireAuth(req, res, next) {
    if (!req.session.userId) {
      return res.status(401).json({ error: "session_expired" });
    }
    next();
  }

  // Authenticate user by email and store in session (regenerate session id to limit fixation)
  app.post("/login", loginRateLimiter, csrfProtection, (req, res) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).send("Please provide an email");
    }

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error("Session regenerate error:", regenErr);
        return res.status(500).send("Login failed");
      }
      req.session.email = email;
      console.log("Logging in user:", email);
      res.redirect("/");
    });
  });

  // Mint and return an impersonated Qlik access token for the current user.
  // A mint failure is an upstream problem, not an expired session, so it returns 502
  // (the browser treats 401 as "session expired" and redirects to /login).
  app.post("/access-token", [tokenRateLimiter, requireAuth, csrfProtection], async (req, res) => {
    try {
      const accessToken = await qlikAuth.getAccessToken({
        hostConfig: getFrontendHostConfig(req.session.userId),
      });
      console.log("Retrieved access token for:", req.session.userId);
      res.send(accessToken);
    } catch (err) {
      console.error("Token error:", err);
      res.status(502).json({ error: "authentication_error", message: "Unable to mint access token" });
    }
  });

  app.post("/config", [requireAuth, csrfProtection], (req, res) => {
    res.json({ ...frontendParams, userEmail: req.session.email });
  });

  // Return the list of sheets in the Qlik app
  app.get("/app-sheets", requireAuth, async (req, res) => {
    try {
      const doc = await getQlikAppSession(req.session.userId).getDoc();
      const sheetList = await doc.getSheetList();
      res.json(sheetList);
    } catch (err) {
      console.error("Sheet error:", err);
      sendQixError(res, err, "Unable to retrieve sheet definitions");
    }
  });

  app.get("/hypercube", requireAuth, async (req, res) => {
    try {
      const doc = await getQlikAppSession(req.session.userId).getDoc();
      const properties = {
        qInfo: { qType: "my-straight-hypercube" },
        qHyperCubeDef: {
          qDimensions: [{ qDef: { qFieldDefs: [appSettings.hypercubeDimension] } }],
          qMeasures: [{ qDef: { qDef: appSettings.hypercubeMeasure } }],
          qInitialDataFetch: [{ qHeight: HYPERCUBE_PAGE_HEIGHT, qWidth: 2 }],
        },
      };

      const model = await doc.createSessionObject(properties);
      try {
        const layout = await model.getLayout();
        const data = [...(layout.qHyperCube.qDataPages[0]?.qMatrix ?? [])];

        const columns = layout.qHyperCube.qSize.qcx;
        const totalHeight = layout.qHyperCube.qSize.qcy;

        // Fetch the remaining rows, starting right after the rows we already have
        while (data.length < totalHeight) {
          const page = { qTop: data.length, qLeft: 0, qWidth: columns, qHeight: HYPERCUBE_PAGE_HEIGHT };
          const [nextPage] = await model.getHyperCubeData("/qHyperCubeDef", [page]);
          if (!nextPage?.qMatrix?.length) break; // defensive: never loop forever
          data.push(...nextPage.qMatrix);
        }

        res.json({
          returnedDimension: data.map(row => row[0].qText),
          returnedMeasure: data.map(row => row[1].qText),
        });
      } finally {
        try { await doc.destroySessionObject(model.id); } catch { /* ignore */ }
      }
    } catch (err) {
      console.error("Hypercube error:", err);
      sendQixError(res, err, "Unable to retrieve hypercube data");
    }
  });

  // Return the authenticated Qlik user as seen from the current app session
  app.get("/user-attributes", requireAuth, async (req, res) => {
    try {
      const doc = await getQlikAppSession(req.session.userId).getDoc();
      const evaluated = await doc.evaluateEx("=OSUser()");
      const qlikUserId = String(evaluated.qText ?? "");
      res.json({ sessionUserId: req.session.userId, qlikUserId });
    } catch (err) {
      console.error("User attributes error:", err);
      sendQixError(res, err, "Unable to retrieve user attributes");
    }
  });

  // Serve the login page with a CSRF token
  app.get("/login", fileRateLimiter, csrfProtection, (req, res) => {
    console.log(`[File Request] ${req.method} ${req.originalUrl} from ${req.ip}`);
    res.sendFile(path.join(__dirname, "login.html"));
  });

  // Return a fresh CSRF token for client-side form submissions
  app.get("/csrf-token", csrfProtection, (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
  });

  // Resolve the Qlik user (create if needed) and serve the home page
  app.get("/", fileRateLimiter, csrfProtection, async (req, res) => {
    console.log(`[File Request] ${req.method} ${req.originalUrl} from ${req.ip}`);
    const email = req.session.email;
    if (!email) {
      return res.redirect("/login");
    }

    try {
      const prefixedEmail = appSettings.userPrefix + email;
      const currentUser = await getQlikUser(prefixedEmail);
      const matches = currentUser.data;

      // Qlik Cloud enforces unique email per tenant (duplicates are migrated), so expect 0 or 1 match.
      if (matches.length === 1) {
        req.session.userId = matches[0].id;
        console.log("Found existing user:", matches[0].id);
      } else {
        const newUser = await qlikUsers.createUser(
          {
            name: prefixedEmail,
            email: prefixedEmail,
            subject: prefixedEmail,
            status: "active",
          },
          {
            hostConfig: {
              ...configBackend,
              scope: BACKEND_USER_CREATE_SCOPE,
            },
          }
        );

        req.session.userId = newUser.data.id;
        console.log("Created user:", newUser.data.id);
      }

      return res.sendFile(path.join(__dirname, "home.html"));
    } catch (error) {
      console.error("Error setting up user:", error);
      // Clear session on error
      req.session.email = null;
      req.session.userId = null;
      res.status(500).send("Error accessing user account");
    }
  });

  app.get("/logout", (req, res) => {
    req.session.destroy(() => {
      res.redirect("/login");
    });
  });

  return app;
}
