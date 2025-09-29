# Playwright Tests for Qlik Cloud Embed OAuth Impersonation

This directory contains Playwright tests for the Qlik Cloud embed application with OAuth impersonation.

## Test Files

- `qlik-app.spec.js` - Comprehensive test suite covering all application functionality
- `login-and-tiles.spec.js` - Focused tests for login flow and tile verification
- `test-setup.js` - Test configuration and setup utilities

## Test Coverage

The tests verify the following functionality:

### Core User Journey
1. **Navigation to Login Page** - Verifies the app loads correctly
2. **Login Form Display** - Checks all form elements are present
3. **CSRF Token Loading** - Ensures security tokens are properly loaded
4. **User Login** - Tests the complete login flow
5. **Home Page Display** - Verifies successful redirect after login
6. **Tile Verification** - Confirms all embeddable UI tiles are displayed
7. **Navigation Testing** - Tests clicking on different tiles and sections

### Browser Support
- **Chrome (Chromium)** - Full functionality testing
- **Safari (WebKit)** - Cross-browser compatibility testing

### Authentication Flow
- Session management
- CSRF protection
- Logout functionality
- Protected route access

## Prerequisites

1. **Server Running**: The Qlik Cloud embed application must be running locally on port 3000
2. **Environment Variables**: Ensure your `.env` file is properly configured with all required Qlik Cloud credentials
3. **Dependencies**: Playwright must be installed (`npm install`)

## Running the Tests

### Run All Tests
```bash
npx playwright test
```

### Run Specific Test File
```bash
# Run the focused login and tiles tests
npx playwright test tests/login-and-tiles.spec.js

# Run the comprehensive test suite
npx playwright test tests/qlik-app.spec.js
```

### Run Tests for Specific Browser
```bash
# Run only Chrome tests
npx playwright test --project=chromium

# Run only WebKit tests
npx playwright test --project=webkit
```

### Run Tests with UI Mode (Interactive)
```bash
npx playwright test --ui
```

### Run Tests in Headed Mode (See Browser)
```bash
npx playwright test --headed
```

### Run Tests with Debug Mode
```bash
npx playwright test --debug
```

## Test Configuration

The tests are configured to:
- Use a 30-second timeout for each test
- Run against `http://localhost:3000`
- Test both Chrome and WebKit browsers
- Generate detailed console output for debugging
- Handle authentication and CSRF tokens automatically

## Expected Test Results

When running successfully, you should see:
- All login flow tests passing
- All tile verification tests passing
- Navigation tests working correctly
- Authentication flow functioning properly
- Both Chrome and WebKit browsers working

## Troubleshooting

### Common Issues

1. **Server Not Running**
   - Ensure the application is running on port 3000
   - Check that all environment variables are set in `.env`

2. **Authentication Failures**
   - Verify Qlik Cloud credentials in `.env` file
   - Check that the tenant URI is correct
   - Ensure OAuth client IDs and secrets are valid

3. **Timeout Errors**
   - The application may be slow to load
   - Check network connectivity to Qlik Cloud
   - Verify the Qlik Sense app is accessible

4. **Browser Issues**
   - Ensure Playwright browsers are installed: `npx playwright install`
   - Check that the browsers can access localhost:3000

### Debug Mode

For detailed debugging, run tests with:
```bash
npx playwright test --debug --headed
```

This will:
- Open the browser visibly
- Pause execution at each step
- Allow you to inspect the page state
- Show detailed error messages

## Test Reports

After running tests, you can view detailed reports:
```bash
npx playwright show-report
```

This opens an HTML report with:
- Test results and timing
- Screenshots of failures
- Video recordings of test runs
- Detailed error messages
