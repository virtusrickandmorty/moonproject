# 42. Employees, Attendance and Holidays

**What it is for:** Add employees to the system, set their pay rates, record daily attendance, and manage the list of holidays.

**Before you start:** You will need the employee's details, their hire date, and their pay rates. You also need to know the dates of any local holidays you want to add.

### Steps
#### Adding an employee
1. On the **People & Payroll** menu, click **Employees**.
2. Click **+ New employee**.
3. Type the **Full name**, **Hire date**, **Position**, and **Department**.
4. Choose the **Cost centre**.
5. The form says "Set the pay on the next page." Click **Add employee** to open the new employee's page and **Set the pay**.

#### Adding government numbers
1. On the employee's page, under the **Details** panel, look for the **Government deductions** heading. You will see ticks for **SSS**, **PhilHealth**, **Pag-IBIG**, and **Withholding tax**. These start switched on. If you switch one off, you must answer **Why is one switched off? (at least 10 characters)**.
2. Under the **Government numbers** heading (this might be hidden from some users), type their **SSS no.**, **PhilHealth PIN**, **Pag-IBIG MID**, and **TIN**.
3. Click **Save changes**.

#### Setting the pay
1. On the employee's page, look for the **Pay** panel and the **Set the pay** (or **Change the pay**) section.
2. Pick the **From** date, **Pay type**, **Pay group**, and **Work week**.
3. Type the **Daily rate** or **Monthly rate**.
4. Check the box if they are a **Minimum wage earner**.
5. Type **Why (at least 10 characters)** you are setting this pay.
6. Click **Save pay**.

#### Recording a resigned employee
1. On the employee's page, click **Record separation**.
2. In the **Separation of** box, type the **Last day worked** and a **Reason (at least 10 characters)**.
3. Click **Record separation**.

#### Recording attendance
1. On the **People & Payroll** menu, click **Attendance**.
2. Use the **← Earlier** or **Later →** buttons to find the right dates.
3. Pick a status mark for each day from the list (**P** Present, **½** Half day, **A** Absent, **R** Rest day, **L** Leave (SIL), **UL** Unpaid leave, **H** Holiday off, **HW** Holiday worked, or **RW** Rest day worked). The key is printed above the grid. For holidays, you can only pick the holiday marks.
4. For worked days (Present, Holiday worked, and Rest day worked), an **OT** box appears. Type the overtime in hours (like 1.5 or 1:30).
5. For night hours (worked between 10 PM and 6 AM), type them in the **Night** box (it appears for Present, Half day, Holiday worked and Rest day worked). For night hours that were also overtime, type them in the **Night OT** box (Present, Holiday worked and Rest day worked only). Type them in hours, like the OT.
6. You can click **Undo changes** if you make a mistake. When you are done, click **Save changes** (the button will show how many changes you made, for example **Save 3 changes**).

#### Adding a local holiday
1. On the **People & Payroll** menu, click **Holidays**.
2. Under the **Add a holiday** panel, type the **Date** and **Name**.
3. Pick the **Kind** (**Special non-working day** or **Regular holiday**).
4. Type the **Source (proclamation or ordinance)**.
5. Click **Add holiday**.
6. Under the **Regular holidays and special non-working days** panel, you can click **Switch off** to stop treating a day as a holiday. A "Switch off" box will open asking for a reason. Type the reason and click **Switch off** again.

### What the system does for you
It keeps track of employee information and their pay history. It calculates the correct payroll based on the attendance statuses, overtime hours, and the list of holidays. When you add a holiday, the system automatically marks it on the attendance grid. When you separate an employee, their record is kept, and the system still pays what is owed up to their last day.

### Common mistakes and how to fix them
- **Mistake:** You entered the wrong attendance status or overtime for a day.
- **Fix:** If the day is not locked, change the status or overtime on the Attendance screen and click **Save changes**. If the day is locked, you must cancel the payroll run that paid it first, then change the attendance.
- **Mistake:** You added a wrong holiday.
- **Fix:** You cannot delete a holiday, but you can click **Switch off** on the Holidays screen. Note that "Days already marked as a holiday must be changed first" before you can switch it off.
