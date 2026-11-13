import dotenv from "dotenv";

dotenv.config({ quiet: true });

import * as qlik from "@qlik/api";
import { createApp, findMissingEnvVars, normalizeTenantUri } from "./src/app.js";

// Validate required environment variables
const missingEnvVars = findMissingEnvVars(process.env);
if (missingEnvVars.length > 0) {
  console.error("Missing required environment variables:", missingEnvVars.join(", "));
  console.error("Please check your .env file and ensure all required variables are set.");
  process.exit(1);
}

const rawTenantUri = process.env.TENANT_URI.trim();
if (normalizeTenantUri(rawTenantUri) !== rawTenantUri) {
  console.log("Using normalized TENANT_URI:", normalizeTenantUri(rawTenantUri));
}

// Routes, sessions, CSRF and the Qlik calls live in src/app.js. They are kept separate
// from this file so tests can build the app with a stubbed @qlik/api and a test env,
// without exiting on missing env vars, listening on a port, or calling Qlik Cloud.
// This file only does the one-time startup work: load and validate .env, then listen.
const app = createApp({ qlik });
const PORT = process.env.PORT || 3000;

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
