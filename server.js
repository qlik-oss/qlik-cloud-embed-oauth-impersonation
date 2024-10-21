import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import path from "path";
import {
  auth as qlikAuth,
  users as qlikUsers,
  qix as openAppSession,
} from "@qlik/api";
import { fileURLToPath } from "url";
import { getFrontendConfig, getBackendConfig } from "./config/config.js";

// Load config
const { appSettings, configBackend, configFrontend }  = await getBackendConfig();
const { myParamsConfig }  = await getFrontendConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
var app = express();
app.use(express.static("src"));
const PORT = appSettings.port || 3000;

qlikAuth.setDefaultHostConfig(configFrontend);



// Configure session middleware using environment variable for session secret
app.use(
  session({
    secret: appSettings.secret,
    resave: false,
    saveUninitialized: true,
  })
);

// Configure body parser middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Get Qlik user (via qlik/api: https://github.com/qlik-oss/qlik-api-ts/blob/main/users.js)
async function getQlikUser(userEmail) {
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
}

// Set up a route to serve the login form
app.get("/login", (req, res) => {
  res.sendFile(__dirname + "/src/login.html");
});

// Handle form submission of login.html
app.post("/login", (req, res) => {
  const { email } = req.body;
  if (email) {
    // Save email to session
    req.session.email = email;
    console.log("Logging in user:", email);
    res.redirect("/");
  } else {
    res.send("Please provide an email.");
  }
});

// Get access token (M2M impersonation) for use in front-end by qlik-embed using qlik/api
app.post("/access-token", async (req, res) => {
  const userId = req.session.userId;
  if (userId != undefined && userId.length > 0) {
    try {
      const accessToken = await qlikAuth.getAccessToken({
        hostConfig: {
          ...configFrontend,
          userId,
          scope: "user_default",
        },
      });
      console.log("Retrieved access token for: ", userId);
      res.send(accessToken);
    } catch (err) {
      console.log(err);
      res.status(401).send("No access");
    }
  }
});

// Get sheet list using qlik/api
app.get("/app-sheets", async (req, res) => {
  const userId = req.session.userId;
  if (typeof userId !== "undefined" && userId !== null) {
    try {
      const appSession = openAppSession.openAppSession({
        appId: myParamsConfig.appId,
        hostConfig: {
          ...configFrontend,
          userId,
          scope: "user_default",
        },
        withoutData: false,
      });
      // get the "qix document (qlik app)"
      const app = await appSession.getDoc();

      // app is now fully typed including sense-client mixins
      const sheetList = await app.getSheetList();

      res.send(sheetList);
    } catch (err) {
      console.log(err);
      res.status(401).send("Unable to retrieve sheet definitions.");
    }
  } else {
    res.redirect("/login");
  }
});

// Get Parameters: userId not needed for the example, but needed in case you want to retrieve per tenant basis parameters
app.post("/config", async (req, res) => {
  const userId = req.session.userId;
  const params = await getFrontendConfig(userId);
  res.status(200).send(params.myParamsConfig);
});

// Set up a route for the Home page
app.get("/", async (req, res) => {
 
  const email = req.session.email;

  (async () => {
    if (email) {
      //check to see if a matching user email exists on the tenant
      const currentUser = await getQlikUser(email);

      // If user doesn't exist, create it (optional)
      if (currentUser.data.length !== 1) {
        // We have no user, so create one prefixed with 'oauth_gen_' to avoid collision risk with real users
        const currentUser = await qlikUsers.createUser(
          {
            name: "oauth_gen_" + req.session.email,
            email: "oauth_gen_" + req.session.email,
            subject: "oauth_gen_" + req.session.email,
            status: "active",
          },
          {
            hostConfig: {
              ...configBackend,
              scope: "admin_classic user_default",
            },
          }
        );
        console.log("Created user: ", currentUser);
        req.session.userId = currentUser.data.id;
      } else {
        // We have a user, continue
        req.session.userId = currentUser.data[0].id;
      }
      console.log("Current user ID:", req.session.userId);
      res.sendFile(__dirname + "/src/home.html");
    } else {
      res.redirect("/login");
    }
  })();
});

// Set up a route for a log out
app.get("/logout", async (req, res) => {
  req.session.userId = null;
  res.redirect("/login");
});

// Get hypercube data (hardcoded values for the provided example app)
app.get("/hypercube", async (req, res) => {
  const userId = req.session.userId;
  if (typeof userId !== "undefined" && userId !== null) {
    try {
      const appSession = openAppSession.openAppSession({
        appId: myParamsConfig.appId,
        hostConfig: {
          ...configFrontend,
          userId,
          scope: "user_default",
        },
        withoutData: false,
      });
      // get the "qix document (qlik app)"
      const app = await appSession.getDoc();

      //Hypercube properties
      const properties = {
        qInfo: {
          qType: "my-straight-hypercube",
        },
        qHyperCubeDef: {
          qDimensions: [
            {
              qDef: { qFieldDefs: ["Product Type"] },
            },
          ],
          qMeasures: [
            {
              qDef: { qDef: "=Sum([Sales Amount])" },
            },
          ],
          qInitialDataFetch: [
            {
              qHeight: 10,
              qWidth: 2,
            },
          ],
        },
      };
      //Extract hypercube data
      const model = await app.createSessionObject(properties);
      let layout = await model.getLayout();
      let data = layout.qHyperCube.qDataPages[0].qMatrix;

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

      //Put data in each single array for simplicity
      var productTypes = [];
      var salesAmount = [];

      for (let y in data) {
        productTypes.push(data[y][0].qText);
        salesAmount.push(data[y][1].qText);
      }

      var hypercubeDict = {};
      hypercubeDict["ProducTypes"] = productTypes;
      hypercubeDict["SalesAmount"] = salesAmount;

      res.send(hypercubeDict);
    } catch (err) {
      console.log(err);
      res.status(401).send("Unable to retrieve hypercube.");
    }
  } else {
    res.redirect("/login");
  }
});


// Start the server
app.listen(PORT, () => {
  console.log(
    `Server is listening on port ${PORT}! Go to http://localhost:${PORT}`
  );
});
