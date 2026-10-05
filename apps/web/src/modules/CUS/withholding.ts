export type WithholdingProfile = 'none' | 'twa_goods' | 'twa_services' | 'government' | 'platform';

export const withholdingLabels: Record<WithholdingProfile, string> = {
  none: 'None',
  twa_goods: 'TWA goods (1%)',
  twa_services: 'TWA services (2%)',
  government: 'Government (1% CWT + 5% VAT withheld)',
  platform: 'Platform (0.5%)',
};
