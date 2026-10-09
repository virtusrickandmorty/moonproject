import { expect, test, type Page } from '@playwright/test';
import { serverDate, signIn } from './shop';

/** YYYY-MM-DD plus some days, as calendar arithmetic (the dates are the server's Manila dates). */
const plusDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dayOfWeek = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 1 = Monday

/** The Monday of a week that has surely ended: the week before last, so that its Saturday is well past. */
const monday = (today: string) => {
  const back = plusDays(today, -7);
  return plusDays(back, -((dayOfWeek(back) + 6) % 7));
};

/** Marks one day of the attendance grid, moving to the half-month it is in first. */
async function mark(page: Page, employee: string, date: string) {
  const cell = page.getByLabel(`${employee} ${date}`, { exact: true });
  const range = page.getByText(/^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/);
  while (!(await cell.isVisible())) {
    const [from] = (await range.innerText()).split(' to ');
    await page.getByRole('button', { name: date < from! ? '← Earlier' : 'Later →' }).click();
    await expect(range).not.toHaveText(`${from} to ${(await range.innerText()).split(' to ')[1]}`);
  }
  // A holiday takes the holiday marks instead of P.
  const marks = await cell.locator('option').allTextContents();
  await cell.selectOption({ label: marks.includes('P') ? 'P' : 'H' });
  await page.getByRole('button', { name: /^Save \d+ change/ }).click();
  await expect(page.getByText(/^Saved \d+ days?\.$/)).toBeVisible();
}

test('payroll: an employee, a week of attendance, the run, its release and the payslip', async ({ page }) => {
  await signIn(page);
  const today = await serverDate(page);
  const start = monday(today);

  // The employee, hired long before that week, on daily pay in the weekly group.
  await page.getByRole('link', { name: 'Employees', exact: true }).click();
  await page.getByRole('button', { name: '+ New employee' }).click();
  await page.getByLabel('Full name').fill('Erin Tailor');
  await page.getByLabel('Hire date').fill(plusDays(start, -60));
  await page.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByRole('heading', { name: /^Erin Tailor/ })).toBeVisible();
  await page.getByLabel('From *').fill(plusDays(start, -60));
  await page.getByLabel('Pay type *').selectOption({ label: 'Daily' });
  await page.getByLabel('Pay group *').selectOption({ label: 'Weekly (piece rate)' });
  await page.getByLabel('Daily rate *').fill('700');
  await page.getByLabel(/^Why/).fill('First pay of a new tailor');
  await page.getByRole('button', { name: 'Save pay', exact: true }).click();
  await expect(page.getByText(/^Daily, Weekly \(piece rate\), 6-day week, since /)).toBeVisible();

  // Where the payslip is emailed, and the tick that she agreed: kept on the employee record (no mail server here, so nothing is sent).
  await page.getByLabel('Email address').fill('erin@example.test');
  await page.getByLabel(/agrees to get payslips by email/).check();
  await page.getByRole('button', { name: 'Save payslip email' }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

  // Attendance for Monday to Saturday.
  await page.getByRole('link', { name: 'Attendance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible();
  for (let d = 0; d < 6; d++) await mark(page, 'Erin Tailor', plusDays(start, d));

  // The payroll run for that week.
  await page.getByRole('link', { name: 'Payroll Runs' }).click();
  await page.getByRole('button', { name: '+ New Payroll Run' }).click();
  await page.getByLabel('Pay group').selectOption({ label: 'Weekly (piece rate)' });
  await page.getByLabel('Date from').fill(start); // takes the week starting that day
  const row = page.getByRole('region', { name: 'Erin Tailor', exact: true });
  await expect(row).toContainText('₱');
  const gross = await row.getByText('Gross', { exact: false }).first().locator('b').innerText();
  const net = await row.getByText('Net pay', { exact: false }).first().locator('b').innerText();
  expect(gross).toMatch(/^₱[\d,]+\.\d\d$/);
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('dialog', { name: 'Record this Payroll Run?' }).getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/^Recorded as PAY-\d+\.$/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Erin Tailor', exact: true })).toContainText(net);

  // Its release: the net pay, paid from the cash box.
  await page.getByRole('link', { name: 'Release net pay' }).click();
  await expect(page.getByLabel(/Erin Tailor/)).toBeChecked();
  await page.getByRole('radio', { name: /^Cash on hand/ }).click();
  await page.getByLabel('Amount').fill(net.replace('₱', ''));
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('dialog', { name: 'Record this Payroll Release?' }).getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/^Recorded as POUT-\d+\.$/)).toBeVisible();

  // The payslip opens, with the same figures.
  await page.getByRole('link', { name: 'Payroll Runs' }).click();
  await page.getByRole('link', { name: /^PAY-/ }).click();
  await page.getByRole('link', { name: 'Payslips' }).click();
  await expect(page.getByRole('heading', { name: 'PAYSLIP', exact: true })).toBeVisible();
  await expect(page.getByText('Erin Tailor', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Gross pay').locator('..')).toContainText(gross);
  await expect(page.getByText('Net pay').locator('..')).toContainText(net);
});
