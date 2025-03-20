// Get CSRF token from the server
async function getCsrfToken() {
  try {
    const response = await fetch("/csrf-token");
    if (response.status === 200) {
      const data = await response.json();
      return data.csrfToken;
    }
    throw new Error("Could not retrieve CSRF token");
  } catch (err) {
    console.error("CSRF token error:", err);
    throw err;
  }
}

// Retrieves a M2M impersonation token from the backend
async function getAccessToken() {
  try {
    const csrfToken = await getCsrfToken();
    const response = await fetch("/access-token", {
      method: "POST",
      credentials: "include",
      mode: "same-origin",
      redirect: "follow",
      headers: {
        'CSRF-Token': csrfToken
      }
    });
    
    if (response.status === 200) {
      return response.text();
    }
    
    const err = new Error("Unexpected server-side authentication error");
    err.status = response.status;
    err.detail = await response.text().catch(() => "No details available");
    throw err;
  } catch (error) {
    console.error("Access token error:", error);
    throw error;
  }
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
  try {
    const csrfToken = await getCsrfToken();
    const headers = new Headers();
    headers.append("Accept", "application/json");
    headers.append("Content-Type", "application/json");
    headers.append("CSRF-Token", csrfToken);
    
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
    err.detail = await response.text().catch(() => "No details available");
    throw err;
  } catch (error) {
    console.error("Config parameter error:", error);
    throw error;
  }
}
