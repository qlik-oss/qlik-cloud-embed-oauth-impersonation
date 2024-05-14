
# Embed Qlik Sense using qlik-embed and emulated SSO (Single Sign On) via OAuth impersonation

> [!IMPORTANT]
> This project is not production ready, and is structured for learning and evaluation
> of the qlik-embed project with a simple OAuth impersonation configuration.
> Before beginning a production app you should first review the [guiding principles for OAuth impersonation](https://qlik.dev/authenticate/oauth/guiding-principles-oauth-impersonation/)
> and understand how to use [qlik-embed](https://qlik.dev/embed/qlik-embed/) and [qlik/api](https://qlik.dev/toolkits/qlik-api/). You should also use https rather than http
for your project.


## Introduction

The goal of this project is to show how easy it is to deploy analytics into your
solution with a seamless login experience for your users from your web app or portal when you don't have a backend identity provider for your users to authenticate to directly. This leverages Qlik's qlik-embed,
qlik/api, and OAuth machine-to-machine impersonation capabilities.

<img src="src/img/screenshot.png" width="600" alt="Screenshot of resulting embedded application"/>

It showcases several embedding techniques, such as:

- qlik-embed `classic/app`: full sheet embed supporting the native experience
- qlik-embed `analytics/sheet`: lightweight full sheet embed
- qlik-embed `classic/chart`: load legacy charts in a similar manner to `classic/app`
- qlik-embed `field`: lightweight way to render a list box containing dimension values
- qlik-embed `selections`: lightweight way to render a full Qlik Sense selections bar
- qlik-embed retrieval of hypercube data from an existing object
- qlik/api retrieval of hypercube data without an existing qlik-embed object

## Getting Started

1. **Install Node.js** if you haven't already (https://nodejs.org)
1. Download and unpack, or `git clone` this repository to your computer
1. Upload the [demo Qlik Sense application](./qlik_app/Consumer%20Sales.qvf) to your tenant. Open the app and copy the ID (it will be a GUID similar to `946d5af4-e089-42d3-9ba7-1d21adb68472`). This demo contains some hard coded values which will only work with this Qlik Sense app.
1. Move the app into a new space, of type `shared`. Edit the space configuration to provide `Can view` access to anyone in the tenant. In a production deployment, you would verify that the logged in user has access to the app.
1. Open **config/config.example.js** and configure the values in `myConfig` to match your Qlik Cloud deployment:
    1. `tenantHostname`: enter the hostname of the Qlik Cloud tenant against which the app will run, such as `z29kgagw312sl0g.eu.qlikcloud.com`.
    1. `oAuthClientId` and `oAuthClientSecret`: enter the credentials obtained when you registered a new OAuth client in your Qlik Cloud management console. If you need one, review [how to set up an OAuth m2m impersonation client](https://qlik.dev/authenticate/oauth/create-oauth-client-m2m-impersonation/). It should accept an origin of `http://localhost:3000` to work with this project. Keep these secrets
    safe as they provide wide access to your tenant. In a production deployment you
    should create a separate OAuth client with reduced scopes for any non-admin tasks.
    1. `appId`: enter the app GUID for the Qlik Sense app you uploaded above.
    1. Save the updated file as **config/config.js**.
1. Open up a terminal window in the folder containing the repository you extracted or cloned above.
1. Run `npm install` to install the project dependencies.
1. Run `npm start` to start the development server at http://localhost:3000
