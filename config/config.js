/*
 * Config file: This file no longer requires manual updates to values,
 * as they are now managed through environment variables.
 */
import dotenv from 'dotenv';

// Load environment variables from .env file
const envFilePath = `env/${process.env.NODE_ENV}.env`;
dotenv.config({ path: envFilePath });

// This is the configuration for the M2M steps in impersonation, exposed below by getParameters().
const myConfig = {
  tenantUri: process.env.TENANT_URI,
  oAuthBackEndClientId: process.env.OAUTH_BACKEND_CLIENT_ID,
  oAuthBackEndClientSecret: process.env.OAUTH_BACKEND_CLIENT_SECRET,
  appId: process.env.APP_ID,
};

// This is a cut-down config without the client secret for use in the qlik-embed HEAD tag.
const myParamsConfig = {
  tenantUri: myConfig.tenantUri,
  oAuthFrontEndClientId: process.env.OAUTH_FRONTEND_CLIENT_ID,
  appId: myConfig.appId,
};

const getParameters = async function (email) {
  /*
    This function should:
    - Accept a user or customer identifier (such as email)
    - Look up the correct Qlik Cloud tenant for that customer
    - Retrieve the corresponding OAuth client details for the impersonation activity
    - Retrieve the corresponding OAuth client for the qlik-embed tag (review guiding
      principles for OAuth M2M impersonation: https://qlik.dev/authenticate/oauth/guiding-principles-oauth-impersonation/)
  
    For purposes of making this demo as simple as possible, the values are hardcoded
    in this project via myParamsConfig, and the same OAuth client is used for
    embedding and impersonation. Do not do this in production.

    */
  return myParamsConfig;
};

export { myConfig, getParameters };
