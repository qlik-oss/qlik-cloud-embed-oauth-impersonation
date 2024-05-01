//Function to retrieve the M2M impersonation token from the backend server
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
  const err = new Error("Unexpected serverside authentication error");
  err.status = response.status;
  err.detail;
  throw err;
}


//Function to retrieve the list of sheets of the app
async function getSheets() {
    const response = await fetch("/appsheets", {
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


//Function to retrieve an hypercube from the backend server
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


//Function to retrieve the config parameters from the backend
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
  const err = new Error("Unexpected serverside authentication error");
  err.status = response.status;
  err.detail;
  throw err;
}
  