// Test setup and configuration
import { test } from '@playwright/test';

// Global test configuration
test.beforeAll(async () => {
  console.log('Starting Qlik Cloud Embed OAuth Impersonation Tests');
  console.log('Test Configuration:');
  console.log('   - Base URL: http://localhost:3000');
  console.log('   - Browsers: Chrome (Chromium) and Safari (WebKit)');
  console.log('   - Timeout: 30 seconds per test');
  console.log('   - Environment: Using existing .env file');
  console.log('');
});

test.afterAll(async () => {
  console.log('');
  console.log('SUCCESS: All tests completed!');
  console.log('Check the test results above for any failures or issues.');
});

// Helper function to wait for server to be ready
async function waitForServer(baseURL, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${baseURL}/login`);
      if (response.ok) {
        console.log('SUCCESS: Server is ready and responding');
        return true;
      }
    } catch (error) {
      // Server not ready yet, continue waiting
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('ERROR: Server did not become ready within the timeout period');
}

export { waitForServer };
