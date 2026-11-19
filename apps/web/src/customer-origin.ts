/**
 * Where a link the shop sends a customer opens (order links, proofs, ratings): the website's address, also when it is
 * copied on the ERP's own address (erp.virtusgarments.com, the owner's request, Nov 2026); the practice shop's address
 * in the practice shop, so its made-up links stay there; the website for any other (a PC on the shop's network).
 */
import { ERP_URL, WEBSITE_URL } from '@moonproject/shared';

export function customerOrigin(where: Pick<Location, 'hostname' | 'origin'> = location): string {
  if (where.hostname === new URL(ERP_URL).hostname) return WEBSITE_URL;
  return /(^|\.)virtusgarments\.com$/.test(where.hostname) ? where.origin : WEBSITE_URL;
}
