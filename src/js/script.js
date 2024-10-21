// Retrieves a M2M impersonation token from the backend
async function getAccessToken() {
  const response = await fetch("/access-token", {
    method: "POST",
    credentials: "include",
    mode: "same-origin",
    redirect: "follow",
  });
  if (response.status === 200) {
    return response.text();
  }
  const err = new Error("Unexpected server-side authentication error");
  err.status = response.status;
  err.detail;
  throw err;
}


// Retrieve the list of sheets in the Qlik Sense app from the backend
async function getSheets() {
    const response = await fetch("/app-sheets", {
      method: "GET",
      credentials: "include",
      mode: "same-origin",
      redirect: "follow",
    });
    if (response.status === 200) {
      return response.json();
    }
    const err = new Error("Unexpected error");
    err.status = response.status;
    err.detail;
    throw err;
}


// Retrieve a data set (hypercube) from the backend
async function getHypercube() {
  const response = await fetch("/hypercube", {
    method: "GET",
    credentials: "include",
    mode: "same-origin",
    redirect: "follow",
  });
  if (response.status === 200) {
    return response.json();
  }
  const err = new Error("Unexpected error");
  err.status = response.status;
  err.detail;
  throw err;
}


// Retrieve application connectivity parameters from the backend
async function getConfigParameter() {
  const headers = new Headers();
  headers.append("Accept", "application/json");
  headers.append("Content-Type", "application/json");
  const response = await fetch("/config", {
    headers: headers,
    method: "POST",
    credentials: "include",
    mode: "same-origin",
    redirect: "follow"
  });
  if (response.status === 200) {
    return response.text();
  }
  const err = new Error("Unexpected server-side authentication error");
  err.status = response.status;
  err.detail;
  throw err;
}
  