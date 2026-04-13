import dotenv from "dotenv";

dotenv.config({quiet: true });

// Validate required environment variables
const requiredEnvVars = [
  'SESSION_SECRET',
  'TENANT_URI',
  'OAUTH_BACKEND_CLIENT_ID',
  'OAUTH_BACKEND_CLIENT_SECRET',
  'OAUTH_FRONTEND_CLIENT_ID',
  'OAUTH_FRONTEND_CLIENT_SECRET',
  'APP_ID'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  console.error('Please check your .env file and ensure all required variables are set.');
  process.exit(1);
}

/** Qlik APIs accept either `tenant.region.qlikcloud.com` or `https://tenant.region.qlikcloud.com`. */
function normalizeTenantUri(uri) {
  const trimmed = (uri || "").trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

const rawTenantUri = (process.env.TENANT_URI || "").trim();
const TENANT_URI = normalizeTenantUri(rawTenantUri);
if (TENANT_URI !== rawTenantUri) {
  console.log("Using normalized TENANT_URI:", TENANT_URI);
}

import express from "express";
import session from "express-session";
import path from "path";
import {
  auth as qlikAuth,
  users as qlikUsers,
  qix as openAppSession,
} from "@qlik/api";
import { fileURLToPath } from "url";
import { csrfSync } from "csrf-sync";
import rateLimit from "express-rate-limit";

// Application settings (USER_PREFIX defaults match login.html copy for new learners)
const appSettings = {
  secret: process.env.SESSION_SECRET,
  port: process.env.PORT,
  userPrefix: process.env.USER_PREFIX ?? "oauth_gen_",
  hypercubeDimension: process.env.HYPERCUBE_DIMENSION,
  hypercubeMeasure: process.env.HYPERCUBE_MEASURE,
};

// Qlik backend config for server-to-server user lookup and creation
const configBackend = {
  authType: "oauth2",
  host: TENANT_URI,
  clientId: process.env.OAUTH_BACKEND_CLIENT_ID,
  clientSecret: process.env.OAUTH_BACKEND_CLIENT_SECRET,
  noCache: true,
};

// Qlik frontend config for minting impersonated end-user access tokens
const configFrontend = {
  authType: "oauth2",
  host: TENANT_URI,
  clientId: process.env.OAUTH_FRONTEND_CLIENT_ID,
  clientSecret: process.env.OAUTH_FRONTEND_CLIENT_SECRET,
  noCache: true,
};

// Backend-only scopes for user management API calls
const BACKEND_USER_LOOKUP_SCOPE = "user_default";
const BACKEND_USER_CREATE_SCOPE = "admin_classic user_default";

// Frontend scope granted to impersonated user tokens
const FRONTEND_USER_APP_SCOPES = "user_default";

// Build a host config scoped to a specific impersonated user
function getFrontendHostConfig(userId) {
  return {
    ...configFrontend,
    userId,
    scope: FRONTEND_USER_APP_SCOPES,
  };
}

// Configuration parameters sent to the browser for qlik-embed setup
const frontendParams = {
  tenantUri: TENANT_URI,
  oAuthFrontEndClientId: process.env.OAUTH_FRONTEND_CLIENT_ID,
  appId: process.env.APP_ID,
  sheetId: process.env.SHEET_ID,
  objectId: process.env.OBJECT_ID,
  fieldId: process.env.FIELD_ID,
  assistantId: process.env.ASSISTANT_ID,
  agenticAssistantId: process.env.AGENTIC_ASSISTANT_ID,
  hypercubeDimension: process.env.HYPERCUBE_DIMENSION,
  hypercubeMeasure: process.env.HYPERCUBE_MEASURE,
  masterDimension: process.env.MASTER_DIMENSION,
  masterMeasure: process.env.MASTER_MEASURE
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = appSettings.port || 3000;

// Rate limiter for file-serving routes (login page, home page)
const fileRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
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
app.use("/css", express.static(path.join(__dirname, "src/css")));
app.use("/js", express.static(path.join(__dirname, "src/js")));
app.use("/img", express.static(path.join(__dirname, "src/img")));

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
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
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many token requests, please try again later.",
  handler: (req, res, _next, options) => {
    console.warn(`[Rate Limit] Token mint blocked ${req.ip} — ${options.max} per minute`);
    res.status(options.statusCode).send(options.message);
  },
});

app.set('trust proxy', 1);

qlikAuth.setDefaultHostConfig(configFrontend);

// Express session with secure cookie and 1-hour TTL
app.use(
  session({
    secret: appSettings.secret,
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 3600000,
      sameSite: 'lax'
    }
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const { csrfSynchronisedProtection: csrfProtection } = csrfSync({
  getTokenFromRequest: (req) => {
    const headerToken =
      req.headers["csrf-token"] ||
      req.headers["x-csrf-token"] ||
      req.headers["xsrf-token"] ||
      req.headers["x-xsrf-token"];
    const ct = (req.headers["content-type"] || "").toLowerCase();
    if (ct.includes("application/json")) {
      return headerToken;
    }
    const bodyToken = typeof req.body?._csrf === "string" ? req.body._csrf : undefined;
    return bodyToken || headerToken;
  },
});

// Open a QIX app session (since 2.6.0 doesn't need identity).
function getQlikAppSession(userId) {
  if (process.env.NODE_ENV !== "production") {
    console.log("Getting QIX app session for userId", getFrontendHostConfig(userId).userId);
  }
  return openAppSession.openAppSession({
    appId: frontendParams.appId,
    hostConfig: getFrontendHostConfig(userId),
    //identity: userId,
    withoutData: false,
  });
}

// Execute a callback against a Qlik app doc with 3-stage session recovery:
// 1. Try the cached session  2. Resume on failure  3. Open a fresh identity session
async function withQlikDoc(userId, callback) {
  const appSession = getQlikAppSession(userId);

  function isSessionError(err) {
    return err.code === -11 || err.code === -32602 ||
      /session suspended|socket closed/i.test(err.message);
  }

  try {
    const doc = await appSession.getDoc();
    return await callback(doc);
  } catch (err) {
    if (!isSessionError(err)) throw err;
    console.warn(`[QIX] Session error (code ${err.code}) — resuming...`);
  }

  // First retry: resume the existing session
  try {
    await appSession.resume();
    console.log('[QIX] Session resumed');
    const doc = await appSession.getDoc();
    return await callback(doc);
  } catch (err) {
    if (!isSessionError(err)) throw err;
    console.warn('[QIX] Resumed session still has stale handles — opening fresh session');
  }

  // Second retry: fresh session with unique identity to bypass cache
  try { await appSession.close(); } catch { /* already dead */ }
  const freshSession = openAppSession.openAppSession({
    appId: frontendParams.appId,
    hostConfig: getFrontendHostConfig(userId),
    identity: `recover-${Date.now()}`,
    withoutData: false,
  });
  const doc = await freshSession.getDoc();
  console.log('[QIX] Fresh session established');
  return await callback(doc);
}

// OData filter string safety (email must not break the quoted literal)
function escapeODataString(value) {
  return String(value).replace(/"/g, "");
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

// Mint and return an impersonated Qlik access token for the current user
app.post("/access-token", [tokenRateLimiter, requireAuth, csrfProtection], async (req, res) => {
  try {
    const accessToken = await qlikAuth.getAccessToken({
      hostConfig: getFrontendHostConfig(req.session.userId),
    });
    console.log("Retrieved access token for:", req.session.userId);
    res.send(accessToken);
  } catch (err) {
    console.error("Token error:", err);
    res.status(401).json({ error: "authentication_error", message: "Unable to mint access token" });
  }
});

app.post("/config", [requireAuth, csrfProtection], (req, res) => {
  res.json({ ...frontendParams, userEmail: req.session.email });
});

// Return the list of sheets in the Qlik app
app.get("/app-sheets", requireAuth, async (req, res) => {
  try {
    const sheetList = await withQlikDoc(req.session.userId, async (app) => {
      return app.getSheetList();
    });
    res.json(sheetList);
  } catch (err) {
    console.error("Sheet error:", err);
    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode).json({
      error: "Unable to retrieve sheet definitions",
      code: err.code,
      message: err.message,
      enigmaError: err.enigmaError || false,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    });
  }
});

app.get("/hypercube", requireAuth, async (req, res) => {
  try {
    const result = await withQlikDoc(req.session.userId, async (app) => {
      // Hypercube properties
      const properties = {
        qInfo: {
          qType: "my-straight-hypercube",
        },
        qHyperCubeDef: {
          qDimensions: [
            { qDef: { qFieldDefs: [appSettings.hypercubeDimension] } },
          ],
          qMeasures: [
            { qDef: { qDef: appSettings.hypercubeMeasure } },
          ],
          qInitialDataFetch: [
            { qHeight: 10, qWidth: 2 },
          ],
        },
      };

      // Extract hypercube data
      const model = await app.createSessionObject(properties);
      try {
        const layout = await model.getLayout();
        let data = layout.qHyperCube.qDataPages[0].qMatrix;

        // Get additional pages if needed
        const columns = layout.qHyperCube.qSize.qcx;
        const totalHeight = layout.qHyperCube.qSize.qcy;
        const pageHeight = 5;
        const numberOfPages = Math.ceil(totalHeight / pageHeight);

        for (let i = 1; i < numberOfPages; i++) {
          const page = {
            qTop: pageHeight * i,
            qLeft: 0,
            qWidth: columns,
            qHeight: pageHeight,
          };
          const row = await model.getHyperCubeData("/qHyperCubeDef", [page]);
          data.push(...row[0].qMatrix);
        }

        // Transform data for front-end consumption
        return {
          returnedDimension: data.map(row => row[0].qText),
          returnedMeasure: data.map(row => row[1].qText),
        };
      } finally {
        try {
          await app.destroySessionObject(model.id);
        } catch (destroyErr) {
          console.warn("[hypercube] destroySessionObject failed:", destroyErr);
        }
      }
    });

    res.json(result);
  } catch (err) {
    console.error("Hypercube error:", err);
    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode).json({
      error: "Unable to retrieve hypercube data",
      code: err.code,
      message: err.message,
      enigmaError: err.enigmaError || false,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    });
  }
});

// Return the authenticated Qlik user as seen from the current app session
app.get("/user-attributes", requireAuth, async (req, res) => {
  try {
    const result = await withQlikDoc(req.session.userId, async (app) => {
      const evaluated = await app.evaluateEx("=OSUser()");
      const qlikUserId = String(evaluated.qText ?? "");

      return {
        sessionUserId: req.session.userId,
        qlikUserId,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("User attributes error:", err);
    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode).json({
      error: "Unable to retrieve user attributes",
      code: err.code,
      message: err.message,
      enigmaError: err.enigmaError || false,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    });
  }
});

// Serve the login page with a CSRF token
app.get("/login", fileRateLimiter, csrfProtection, (req, res) => {
  console.log(`[File Request] ${req.method} ${req.originalUrl} from ${req.ip}`);
  res.sendFile(path.join(__dirname, "/src/login.html"));
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
    
    return res.sendFile(path.join(__dirname, "/src/home.html"));
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

// Start Express and listen on the configured port
try {
  const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Please free the port or set a different PORT environment variable.`
      );
    } else {
      console.error(`Server error:`, err);
    }
    process.exit(1);
  });
} catch (err) {
  console.error(`Failed to start server:`, err);
  process.exit(1);
}
