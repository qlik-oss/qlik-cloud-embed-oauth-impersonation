import dotenv from "dotenv";

// Load environment variables from .env.dev file
dotenv.config({ path: '.env.dev' });

import express from "express";
import session from "express-session";
import path from "path";
import {
  auth as qlikAuth,
  users as qlikUsers,
  qix as openAppSession,
} from "@qlik/api";
import { fileURLToPath } from "url";
import { getFrontendConfig, getBackendConfig } from "./config/config.js";
import csrf from "csurf"; // Add CSRF protection
import cookieParser from "cookie-parser"; // Required for CSRF

// Load config
const { appSettings, configBackend, configFrontend } = await getBackendConfig();
const { myParamsConfig } = await getFrontendConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.static("src"));
const PORT = appSettings.port || 3000;

// Set default auth config
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
      sameSite: 'strict' // Protect against CSRF
    }
  })
);

// Use express built-in parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Setup CSRF protection (use session rather than cookie)
const csrfProtection = csrf({ cookie: false });

// Create a reusable function for Qlik app sessions
async function getQlikAppSession(userId) {
  return openAppSession.openAppSession({
    appId: myParamsConfig.appId,
    hostConfig: {
      ...configFrontend,
      userId,
      scope: "user_default",
    },
    withoutData: false,
  });
}

// Get Qlik user (via qlik/api)
async function getQlikUser(userEmail) {
  try {
    const { data: user } = await qlikUsers.getUsers(
      {
        filter: `email eq "${userEmail}"`,
      },
      {
        hostConfig: {
          ...configBackend,
          scope: "user_default",
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
      hostConfig: {
        ...configFrontend,
        userId: req.session.userId,
        scope: "user_default",
      },
    });
    console.log("Retrieved access token for:", req.session.userId);
    res.send(accessToken);
  } catch (err) {
    console.error("Token error:", err);
    res.status(401).send("Authentication error");
  }
});

app.post("/config", [requireAuth, csrfProtection], async (req, res) => {
  try {
    const params = await getFrontendConfig(req.session.userId);
    res.json(params.myParamsConfig);
  } catch (err) {
    console.error("Config error:", err);
    res.status(500).send("Unable to retrieve configuration");
  }
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
    res.status(500).send("Unable to retrieve sheet definitions");
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
    res.status(500).send("Unable to retrieve hypercube");
  }
});

// Login route - needs ratelimit protection if production
app.get("/login", csrfProtection, (req, res) => {
  // Add CSRF token to login page
  res.sendFile(path.join(__dirname, "/src/login.html"));
});

// CSRF route
app.get("/csrf-token", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Root route
app.get("/", csrfProtection, async (req, res) => {
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
            scope: "admin_classic user_default",
          },
        }
      );
      
      req.session.userId = newUser.data.id;
      console.log("Created user:", newUser.data.id);
    } else {
      req.session.userId = currentUser.data[0].id;
      console.log("Found existing user:", currentUser.data[0].id);
    }
    
    const csrfToken = req.csrfToken();
    req.session.csrfToken = csrfToken;
    res.sendFile(path.join(__dirname, "/src/home.html"));
  } catch (error) {
    console.error("Error setting up user:", error);
    res.status(500).send("Error accessing user account");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
