import { expect, test, type Page } from '@playwright/test';
import { OWNER, signIn } from './shop';

/** Made-up rows, as the old sheet's tabs download: customers, sizes (four typed with no customer) and employees. */
const CELLS = 'Shoulder,Chest,Upper Waist,Collar,Bust Point,Figure Point,Bust Distance,Arm Hole,Sleeve Hole,Sleeve Height,Upper Length,Lower Waist,Hips,Crotch,Thigh,Calf,Ankle,Lower Length';
const cells = (shoulder: string, chest: string) => [shoulder, chest, ...Array<string>(16).fill('')].join(',');
const customersCsv = 'Customer ID,Name\nIMP-1,Bulk Academy\nIMP-2,Juanito Bulkexample\nIMP-3,Marita Bulksample\nIMP-4,MARITA  bulksample.';
const sizesCsv = [`Size ID,Customer ID,Customer Name,${CELLS}`,
  `IMS-1,MANUAL,JUANITO bulkexample,${cells('14.0', '34.0')}`, `IMS-2,MANUAL,Pedrito Bulkwearer,${cells('15.5', '35.0')}`,
  `IMS-3,MANUAL,Lito Bulkwearer,${cells('16.0', '37.5')}`, `IMS-4,MANUAL,Marita Bulksample,${cells('13.0', '30.0')}`].join('\n');
const employeesCsv = ['Employee ID,Name,Salary Category,Status,Date Employed', 'IME-1,Bulk Cutter,Daily,Active,2026-02-11', 'IME-2,Bulk Sewer,Piece Rate (Pakyawan),Active,2026-02-11',
  'IME-3,Bulk Clerk,Monthly,Active,2026-03-01', 'IME-4,Bulk Director,,Active,2025-01-15'].join('\n');

async function upload(page: Page, kind: string, name: string, csv: string) {
  await page.goto('/mig');
  await page.getByRole('radio', { name: kind }).check();
  await page.getByLabel('CSV file').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Load a copy' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}
async function dryRunAndCommit(page: Page) {
  await page.getByRole('button', { name: 'Check the import' }).click();
  await expect(page.getByText('Every row of the file is counted once.')).toBeVisible();
  await page.getByRole('button', { name: 'Import these approved rows' }).click();
  await page.getByRole('dialog', { name: 'Import these approved rows?' }).getByRole('button', { name: 'Import these approved rows' }).click();
  // Signing in just now counts as a fresh password; later in the run the server asks for it again.
  const ask = page.getByRole('dialog', { name: 'Confirm with your password' });
  await expect(ask.or(page.getByText('Groups', { exact: true }))).toBeVisible();
  if (await ask.isVisible()) {
    await ask.getByLabel('Password').fill(OWNER.password);
    await ask.getByRole('button', { name: 'Continue' }).click();
  }
}
const made = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]');

test('import: sizes typed with no customer and employees\' rates, in bulk, then the same files again', async ({ page }) => {
  await signIn(page);

  // The customers go in first, as they are.
  await upload(page, 'Customers', 'Customers.csv', customersCsv);
  await dryRunAndCommit(page);
  await expect(made(page, 'Customers')).toHaveText('4 imported');

  // Sizes: four rows with no customer. One name matches exactly one customer, one matches two, two match none.
  const sizes = async () => {
    await upload(page, 'Measurements', 'Customer Sizes.csv', sizesCsv);
    await expect(page.getByRole('heading', { name: 'Sizes typed without a customer (4)' })).toBeVisible();
  };
  await sizes();
  await expect(page.getByRole('button', { name: /^Use Juanito Bulkexample \(CUS-\d+\)$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Use Marita Bulksample/ })).toBeHidden();
  await page.getByRole('button', { name: /^Use Juanito Bulkexample/ }).click();
  await expect(page.getByRole('heading', { name: 'Sizes typed without a customer (3)' })).toBeVisible();
  await expect(page.getByText('1 row was assigned and accepted.')).toBeVisible();

  // Two group-order wearers, together, under one customer in a new group.
  await page.getByLabel('Tick row 3').check();
  await page.getByLabel('Tick row 4').check();
  await page.getByRole('radio', { name: /^Put them under one customer/ }).check();
  await page.getByLabel('Customer', { exact: true }).fill('Bulk Academy');
  await page.getByRole('button', { name: /^Bulk Academy CUS-/ }).click();
  await page.getByLabel('New group name').fill('Batch A');
  await page.getByRole('button', { name: 'Apply to the 2 ticked rows' }).click();
  await expect(page.getByText('2 rows were assigned and accepted.')).toBeVisible();

  // The last one is made its own customer, a person named as in the sheet.
  await page.getByLabel('Tick row 5').check();
  await page.getByRole('radio', { name: /^Make each its own customer/ }).check();
  await page.getByRole('button', { name: 'Apply to the 1 ticked rows' }).click();
  await expect(page.getByText(/^1 row was assigned and accepted\./)).toBeVisible();
  await expect(page.getByText('Accepted 4 + excluded 0 + merged 0 = 4 rows listed.')).toBeVisible();

  await page.getByRole('button', { name: 'Check the import' }).click();
  await expect(page.getByText('Every row of the file is counted once.')).toBeVisible();
  await expect(page.getByText('New customers (a person each), from sizes without a customer', { exact: true }).locator('xpath=following-sibling::dd[1]')).toHaveText('1');
  await expect(page.getByText('Wearers made from sizes without a customer', { exact: true }).locator('xpath=following-sibling::dd[1]')).toHaveText('4');
  await expect(page.getByText('Measurement cells add up to', { exact: true }).locator('xpath=following-sibling::dd[1]')).toHaveText('195.0');
  await dryRunAndCommit(page);
  await expect(made(page, 'Customers')).toHaveText('1 imported');
  await expect(made(page, 'Groups')).toHaveText('1 imported');
  await expect(made(page, 'Wearers')).toHaveText('4 imported');
  await expect(made(page, 'Measurements')).toHaveText('4 imported');

  // Employees: one table, every rate and pay type, saved together.
  await upload(page, 'Employees', 'Employees.csv', employeesCsv);
  await expect(page.getByRole('heading', { name: 'Employees who need a rate or a pay type (3)' })).toBeVisible();
  await page.getByLabel('Rate in pesos, row 2').fill('650.50');
  await page.getByLabel('Pay type, row 4').selectOption('monthly');
  await page.getByLabel('Rate in pesos, row 4').fill('twenty thousand');
  await page.getByRole('button', { name: 'Save all' }).click();
  await expect(page.getByText(/type a peso amount such as 650.50/)).toBeVisible(); // stopped before anything was sent
  await page.getByLabel('Rate in pesos, row 4').fill('20000');
  await page.getByLabel('Pay type, row 5').selectOption('piece');
  await expect(page.getByLabel('Rate in pesos, row 5')).toBeDisabled();
  await page.getByRole('button', { name: 'Save all' }).click();
  await expect(page.getByText('3 employees saved and accepted.')).toBeVisible();
  await expect(page.getByText('Every employee has a pay type and rate.')).toBeVisible();
  // The Pakyawan employee only waits for the owner to confirm; nothing to type.
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await dryRunAndCommit(page);
  await expect(made(page, 'Employees')).toHaveText('4 imported');

  // The same sizes again, with the same choices: nothing is made twice.
  await sizes();
  await page.getByRole('button', { name: /^Use Juanito Bulkexample/ }).click();
  await expect(page.getByText('1 row was assigned and accepted.')).toBeVisible();
  await page.getByLabel('Tick row 3').check();
  await page.getByLabel('Tick row 4').check();
  await page.getByRole('radio', { name: /^Put them under one customer/ }).check();
  await page.getByLabel('Customer', { exact: true }).fill('Bulk Academy');
  await page.getByRole('button', { name: /^Bulk Academy CUS-/ }).click();
  await page.getByRole('radio', { name: /^One of its groups/ }).check();
  await page.getByLabel('Group', { exact: true }).selectOption({ label: 'Batch A' });
  await page.getByRole('button', { name: 'Apply to the 2 ticked rows' }).click();
  await expect(page.getByText('2 rows were assigned and accepted.')).toBeVisible();
  await page.getByLabel('Tick row 5').check();
  await page.getByRole('radio', { name: /^Make each its own customer/ }).check();
  await page.getByRole('button', { name: 'Apply to the 1 ticked rows' }).click();
  await dryRunAndCommit(page);
  await expect(made(page, 'Customers')).toHaveText('0 imported');
  await expect(made(page, 'Groups')).toHaveText('0 imported');
  await expect(made(page, 'Wearers')).toHaveText('0 imported');
  await expect(made(page, 'Measurements')).toHaveText('0 imported, 4 already imported before');
});
