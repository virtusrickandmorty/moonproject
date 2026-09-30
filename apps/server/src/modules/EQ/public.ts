/** What other modules may read from EQ: the register of stockholders and officers (party ids on 2502/31xx, 1220/2501). */
export { person, type Person } from './people.ts';
/** The dividend lines behind the final tax withheld (TAX reads them for the 1601-FQ and 1604-F lists). */
export { dividendsWithheld, type DividendWithheld } from './dividends.ts';
