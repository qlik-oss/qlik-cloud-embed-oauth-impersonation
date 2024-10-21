/*
 * Config file: This file no longer requires manual updates to values,
 * as they are now managed through environment variables.
 */
import { config } from "dotenv";
import path from "path";

// Load environment variables from .env file
const nodeEnv = process.env.NODE_ENV || "";
config({
  path: path.resolve(process.cwd(), `.env${nodeEnv ? "." + nodeEnv : ""}`),
});

const getBackendConfig = async function (email) {
  /*
    This function should:
    - Accept a user or customer identifier (such as email)
    - Look up the correct Qlik Cloud tenant for that customer
    - Retrieve the corresponding OAuth client details for the backend activity (review guiding
      principles for OAuth M2M impersonation: https://qlik.dev/authenticate/oauth/guiding-principles-oauth-impersonation/)
  
    For purposes of making this demo as simple as possible, the values are hardcoded
    in this project via a .env file. Do not do this in production.

    */

  // Build app settings
  const appSettings = {
    secret: process.env.SESSION_SECRET,
    port: process.env.PORT
  };

  // Build qlik/api backend config
  const configBackend = {
    authType: "oauth2",
    host: process.env.TENANT_URI,
    clientId: process.env.OAUTH_BACKEND_CLIENT_ID,
    clientSecret: process.env.OAUTH_BACKEND_CLIENT_SECRET,
    noCache: true,
  };

  // Build qlik/api frontend config
  const configFrontend = {
    authType: "oauth2",
    host: process.env.TENANT_URI,
    clientId: process.env.OAUTH_FRONTEND_CLIENT_ID,
    clientSecret: process.env.OAUTH_FRONTEND_CLIENT_SECRET,
    noCache: true,
  };

  return { configBackend, configFrontend, appSettings };
};

const getFrontendConfig = async function (email) {
  /*
    This function should:
    - Accept a user or customer identifier (such as email)
    - Look up the correct Qlik Cloud tenant for that customer
    - Retrieve the corresponding impersonation OAuth client for the qlik-embed tag (review guiding
      principles for OAuth M2M impersonation: https://qlik.dev/authenticate/oauth/guiding-principles-oauth-impersonation/)
  
    For purposes of making this demo as simple as possible, the values are hardcoded
    in this project via a .env file. Do not do this in production.

    */

  // This is a cut-down config without the client secret for use in the qlik-embed HEAD tag.
  const myParamsConfig = {
    tenantUri: process.env.TENANT_URI,
    oAuthFrontEndClientId: process.env.OAUTH_FRONTEND_CLIENT_ID,
    appId: process.env.APP_ID,
    sheetId: process.env.SHEET_ID,
    objectId: process.env.OBJECT_ID,
    fieldId: process.env.FIELD_ID
  };

  return { myParamsConfig };
};

export { getFrontendConfig, getBackendConfig };
