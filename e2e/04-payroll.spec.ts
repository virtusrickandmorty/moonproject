import { expect, test, type Page } from '@playwright/test';
import { serverDate, signIn } from './shop';

/** YYYY-MM-DD plus some days, as calendar arithmetic (the dates are the server's Manila dates). */
const plusDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dayOfWeek = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 1 = Monday

/**
 * The first day of a weekly pay period that has surely ended (the week before last): a Friday from Oct 2, 2026, when the
 * weekly payrolls became Friday to Thursday (setting pay.week_start), a Monday before that.
 */
const FRIDAY_WEEKS_FROM = '2026-10-02';
const weekStart = (today: string) => {
  const back = plusDays(today, -7);
  const friday = plusDays(back, -((dayOfWeek(back) + 2) % 7));
  return friday >= FRIDAY_WEEKS_FROM ? friday : plusDays(back, -((dayOfWeek(back) + 6) % 7));
};
/** The six working days of the week from its first day: every day but Sunday. */
const workdays = (start: string) => Array.from({ length: 7 }, (_, d) => plusDays(start, d)).filter((d) => dayOfWeek(d) !== 0);
const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/**
 * Marks one day of the attendance sheet present (worked, on a holiday), moving to the pay period it is in first. Each day
 * is a button named for the person and the day ("Change Erin Tailor, October 2, 2026: nothing typed").
 */
async function mark(page: Page, employee: string, date: string) {
  const cell = page.getByRole('button', { name: new RegExp(`^Change ${employee}, ${longDate(date)}:`) });
  for (let tries = 0; !(await cell.isVisible()) && tries < 6; tries++) {
    const shown = await page.getByRole('button', { name: new RegExp(`^Change ${employee}, `) }).first().getAttribute('aria-label');
    const shownDate = new Date(`${shown!.split(', ').slice(1, 3).join(', ').split(':')[0]} UTC`).toISOString().slice(0, 10);
    await page.getByRole('button', { name: date < shownDate ? 'Earlier half-month' : 'Later half-month' }).click();
    await page.waitForTimeout(300);
  }
  await cell.click();
  const status = page.getByRole('radiogroup', { name: 'Status' });
  const present = status.getByRole('radio', { name: 'Present', exact: true });
  await ((await present.count()) ? present : status.getByRole('radio', { name: /^Holiday, worked|^Worked/ }).first()).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: /^Save \d+ changes?$/ }).click();
  await expect(page.getByText(/^Saved \d+ days?\.$/)).toBeVisible();
}

test('payroll: an employee, a week of attendance, the run, its release and the payslip', async ({ page }) => {
  await signIn(page);
  const today = await serverDate(page);
  const start = weekStart(today);

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

  // Attendance for the six working days of that week.
  await page.getByRole('link', { name: 'Attendance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible();
  for (const day of workdays(start)) await mark(page, 'Erin Tailor', day);

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
