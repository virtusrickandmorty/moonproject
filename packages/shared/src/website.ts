/**
 * The website and the ERP on their own addresses (the owner's request, Nov 2026): www.virtusgarments.com is the public
 * website only, erp.virtusgarments.com is the ERP (with the floor app). The website's door answers the pages below, the
 * built files and the public API (no sign-in); anything else is sent to the ERP's address.
 */
export const WEBSITE_URL = 'https://www.virtusgarments.com';
export const ERP_URL = 'https://erp.virtusgarments.com';

/** The website's own pages. */
export const SITE_PATHS = ['/', '/shop', '/services', '/about', '/support', '/checkout', '/orders', '/track', '/terms'];
/** A customer's order page: /order/WEB-000123 (opened with its secret link). */
export const ORDER_PAGE = /^\/order\/([A-Z]+-\d{1,9})$/;
/** A customer's own page from a link the shop sent: an order link (/l/), a design to approve (/p/), a rating (/r/). */
export const CUSTOMER_LINK = /^\/[lpr]\/[\w-]{20,64}$/;

/** Whether the website's door answers this page (the path without its query). */
export const isWebsitePage = (path: string) => SITE_PATHS.includes(path) || ORDER_PAGE.test(path) || CUSTOMER_LINK.test(path);
