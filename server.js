import dotenv from "dotenv";

// Load environment variables from .env file
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

import express from "express";
import session from "express-session";
import path from "path";
import {
  auth as qlikAuth,
  users as qlikUsers,
  qix as openAppSession,
} from "@qlik/api";
import { fileURLToPath } from "url";
import csrf from "csurf"; // Add CSRF protection
import cookieParser from "cookie-parser"; // Required for CSRF
import rateLimit from "express-rate-limit"; // Rate limiting for file system requests

// Application settings
const appSettings = {
  secret: process.env.SESSION_SECRET,
  port: process.env.PORT,
  userPrefix: process.env.USER_PREFIX,
  hypercubeDimension: process.env.HYPERCUBE_DIMENSION,
  hypercubeMeasure: process.env.HYPERCUBE_MEASURE,
};

// Qlik backend configuration (server-to-server client credentials).
// Used to mint management tokens for user lookup/creation in this backend only.
const configBackend = {
  authType: "oauth2",
  host: process.env.TENANT_URI,
  clientId: process.env.OAUTH_BACKEND_CLIENT_ID,
  clientSecret: process.env.OAUTH_BACKEND_CLIENT_SECRET,
  noCache: true,
};

// Qlik frontend configuration (server-side OAuth client for impersonated end-user tokens).
// Used to mint tokens that access app content as the impersonated user.
const configFrontend = {
  authType: "oauth2",
  host: process.env.TENANT_URI,
  clientId: process.env.OAUTH_FRONTEND_CLIENT_ID,
  clientSecret: process.env.OAUTH_FRONTEND_CLIENT_SECRET,
  noCache: true,
};

// Backend token scopes for user management operations (lookup, creation). These tokens are never sent to the frontend and only used in this server.js for user provisioning.
const BACKEND_USER_LOOKUP_SCOPE = "user_default"; // Read/list users
const BACKEND_USER_CREATE_SCOPE = "admin_classic user_default"; // Create users + basic user access

// Frontend token scopes for impersonated user app access. These tokens are sent to the frontend and used in the QIX session, so should be limited to only necessary permissions for app access.
const FRONTEND_USER_APP_SCOPES = "user_default";

// Shared hostConfig for all frontend-user token calls (QIX session + /access-token endpoint).
function getFrontendHostConfig(userId) {
  return {
    ...configFrontend,
    userId,
    scope: FRONTEND_USER_APP_SCOPES,
  };
}

// Frontend parameters (sanitized, safe to send to client)
const frontendParams = {
  tenantUri: process.env.TENANT_URI,
  oAuthFrontEndClientId: process.env.OAUTH_FRONTEND_CLIENT_ID,
  appId: process.env.APP_ID,
  sheetId: process.env.SHEET_ID,
  objectId: process.env.OBJECT_ID,
  fieldId: process.env.FIELD_ID,
  assistantId: process.env.ASSISTANT_ID,
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
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 1000, // limit each IP to 1000 file-serving requests per minute
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: "Too many requests, please try again later.",
  handler: (req, res, _next, options) => {
    console.warn(`[Rate Limit] Blocked ${req.method} ${req.originalUrl} from ${req.ip} — limit of ${options.max} requests per ${options.windowMs / 1000}s exceeded`);
    res.status(options.statusCode).send(options.message);
  },
});

// Serve static assets without rate limiting (CSS, JS, images don't need it)
app.use(express.static("src"));

// Trust proxy in production environments
app.set('trust proxy', 1);

// Set default frontend auth client (host/client credentials only).
// User context + scopes are supplied per request via getFrontendHostConfig(userId).
qlikAuth.setDefaultHostConfig(configFrontend);

// Configure cookie parser middleware (required for csrf)
app.use(cookieParser());

// Configure session middleware with secure settings
app.use(
  session({
    secret: appSettings.secret,
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true, // Prevent client-side JS from reading the cookie
      maxAge: 3600000, // 1 hour
      sameSite: 'lax' // Changed from 'strict' to 'lax' for better compatibility with redirects
    }
  })
);

// Use express built-in parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Setup CSRF protection with simple configuration
const csrfProtection = csrf({ 
  cookie: true 
});

// Create a reusable function for Qlik app sessions
async function getQlikAppSession(userId) {
  return openAppSession.openAppSession({
    appId: frontendParams.appId,
    hostConfig: getFrontendHostConfig(userId),
    withoutData: false,
  });
}

// Get Qlik user (via qlik/api)
async function getQlikUser(userEmail) {
  try {
    const { data: user } = await qlikUsers.getUsers(
      {
        filter: `email eq "${userEmail}" and status eq "active"`,
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

// Authentication middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect("/login");
  }
  next();
}

// Apply CSRF protection to routes that change state
app.post("/login", csrfProtection, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).send("Please provide an email");
  }
  
  try {
    req.session.email = email;
    console.log("Logging in user:", email);
    res.redirect("/");
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).send("Login failed");
  }
});

// API routes that need CSRF protection
app.post("/access-token", [requireAuth, csrfProtection], async (req, res) => {
  try {
    const accessToken = await qlikAuth.getAccessToken({
      hostConfig: getFrontendHostConfig(req.session.userId),
    });
    console.log("Retrieved access token for:", req.session.userId);
    res.send(accessToken);
  } catch (err) {
    console.error("Token error:", err);
    res.status(401).send("Authentication error");
  }
});

app.post("/config", [requireAuth, csrfProtection], (_req, res) => {
  res.json(frontendParams);
});

// Read-only API routes don't need CSRF protection
app.get("/app-sheets", requireAuth, async (req, res) => {
  try {
    const appSession = await getQlikAppSession(req.session.userId);
    const app = await appSession.getDoc();
    const sheetList = await app.getSheetList();
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
    const appSession = await getQlikAppSession(req.session.userId);
    const app = await appSession.getDoc();

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
    const returnedDimension = data.map(row => row[0].qText);
    const returnedMeasure = data.map(row => row[1].qText);

    res.json({
      returnedDimension: returnedDimension,
      returnedMeasure: returnedMeasure
    });
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

// Login route
app.get("/login", fileRateLimiter, csrfProtection, (req, res) => {
  console.log(`[File Request] ${req.method} ${req.originalUrl} from ${req.ip}`);
  res.sendFile(path.join(__dirname, "/src/login.html"));
});

// CSRF route
app.get("/csrf-token", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Root route
app.get("/", fileRateLimiter, csrfProtection, async (req, res) => {
  console.log(`[File Request] ${req.method} ${req.originalUrl} from ${req.ip}`);
  const email = req.session.email;
  if (!email) {
    return res.redirect("/login");
  }

  try {
    const prefixedEmail = appSettings.userPrefix + email;
    const currentUser = await getQlikUser(prefixedEmail);

    if (currentUser.data.length !== 1) {
      // Create user if not found
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
    } else {
      req.session.userId = currentUser.data[0].id;
      console.log("Found existing user:", currentUser.data[0].id);
    }
    
    return res.sendFile(path.join(__dirname, "/src/home.html"));
  } catch (error) {
    console.error("Error setting up user:", error);
    // Clear session data on error to prevent inconsistent state
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

// Start the server
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
