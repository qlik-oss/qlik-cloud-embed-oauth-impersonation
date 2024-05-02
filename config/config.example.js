/*
 * Config file: rename this to `config.js`, and update the values in `myConfig`.
 * Do not version control this file, and consider using .env files if you require
 * a more common integration pattern.
 */

// This is the hard-coded config for the M2M steps in impersonation, exposed below by getParameters().
const myConfig = {
  tenantHostname: "your-tenant.us.qlikcloud.com", // format: "your-tenant.us.qlikcloud.com" (no protocol or trailing slashes)
  oAuthClientId: "5058cc83b4b6fae428e2c90e77123",
  oAuthClientSecret:
    "15932095c804414fd7a3b882fa2bf874bf126f19ae39d83deb123",
  appId: "b0702f9b-46a3-46ff-8c8e-3a5f83a9b898",
};

// Create a cut-down config without the client secret for use in the qlik-embed HEAD tag
const myParamsConfig = {
  tenantHostname: myConfig.tenantHostname,
  oAuthClientId: myConfig.oAuthClientId,
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
