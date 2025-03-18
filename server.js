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

// Load config
const { appSettings, configBackend, configFrontend } = await getBackendConfig();
const { myParamsConfig } = await getFrontendConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.static("src"));
const PORT = appSettings.port || 3000;

// Set default auth config
qlikAuth.setDefaultHostConfig(configFrontend);

// Configure session middleware 
app.use(
  session({
    secret: appSettings.secret,
    resave: false,
    saveUninitialized: true,
    maxAge: 3600000
  })
);

// Use express built-in parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

// API routes
app.post("/access-token", requireAuth, async (req, res) => {
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

app.post("/config", requireAuth, async (req, res) => {
  try {
    const params = await getFrontendConfig(req.session.userId);
    res.json(params.myParamsConfig);
  } catch (err) {
    console.error("Config error:", err);
    res.status(500).send("Unable to retrieve configuration");
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
          { qDef: { qFieldDefs: ["Product Type"] } },
        ],
        qMeasures: [
          { qDef: { qDef: "=Sum([Sales Amount])" } },
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
    const productTypes = data.map(row => row[0].qText);
    const salesAmount = data.map(row => row[1].qText);

    res.json({
      ProductTypes: productTypes,
      SalesAmount: salesAmount
    });
  } catch (err) {
    console.error("Hypercube error:", err);
    res.status(500).send("Unable to retrieve hypercube");
  }
});

// Page routes
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "/src/login.html"));
});

app.post("/login", async (req, res) => {
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

app.get("/", async (req, res) => {
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
    
    res.sendFile(path.join(__dirname, "/src/home.html"));
  } catch (error) {
    console.error("Error setting up user:", error);
    res.status(500).send("Error accessing user account");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
