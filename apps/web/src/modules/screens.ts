/** Doc types with their own form or view parts; the generic screens handle every other type (PLAN H2). */
import type { ComponentType } from 'react';
import type { DocTypeInfo } from '../api.ts';
import type { FormMode } from '../generic/DocForm.tsx';
import type { ViewParts } from '../generic/DocView.tsx';
import { CollectionForm } from './COL/CollectionForm.tsx';
import { DepositTransferForm } from './COL/DepositTransferForm.tsx';
import { RefundForm } from './COL/RefundForm.tsx';
import { jobOrderView } from './JO/JobOrderView.tsx';
import { QuickSaleForm } from './QS/QuickSaleForm.tsx';
import { quickSaleView } from './QS/QuickSaleView.tsx';

export const FORMS: Record<string, ComponentType<{ type: DocTypeInfo; mode: FormMode }>> = {
  'col.collection': CollectionForm,
  'col.refund': RefundForm,
  'col.deposit_transfer': DepositTransferForm,
  'qs.sale': QuickSaleForm,
};

export const VIEWS: Record<string, ViewParts> = { 'jo.job_order': jobOrderView, 'qs.sale': quickSaleView };
