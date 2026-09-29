import { test } from '@playwright/test';

// Not done in the browser: the web app has no form for a Job Order or a Release Slip (each has lines, which the general form
// cannot fill in: "This document needs its own screen"), and the Invoice Record form asks for the release's internal id.
// Doing this flow through the API instead would not be an end-to-end test, so it waits for those screens (PLAN I1 item 6).
test.fixme('sales: a customer, a job order with a deposit, a collection, a release with an invoice record; balance due zero and nothing open in AR aging', async () => {});
