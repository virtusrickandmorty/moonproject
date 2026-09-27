/** Doc types with their own form or view parts; the generic screens handle every other type (PLAN H2). */
import type { ComponentType } from 'react';
import type { DocTypeInfo, Me } from '../api.ts';
import type { FormMode } from '../generic/DocForm.tsx';
import type { ViewParts } from '../generic/DocView.tsx';
import { CollectionForm } from './COL/CollectionForm.tsx';
import { RefundForm } from './COL/RefundForm.tsx';
import { QuickSaleForm } from './QS/QuickSaleForm.tsx';
import { quickSaleView } from './QS/QuickSaleView.tsx';
import { EntryForm } from './PRD/EntryForm.tsx';
import { ProductionBoard } from './PRD/Board.tsx';
import { PieceRates } from './RATE/Rates.tsx';

/** Screens that are not a document list, form or view, by path (their menu items are in shell/menu.ts SCREENS). */
export const PAGES: Record<string, ComponentType<{ me: Me; docTypes: DocTypeInfo[] }>> = { '/prd/board': ProductionBoard, '/prd/rates': PieceRates };

export const FORMS: Record<string, ComponentType<{ type: DocTypeInfo; mode: FormMode }>> = {
  'col.collection': CollectionForm,
  'col.refund': RefundForm,
  'qs.sale': QuickSaleForm,
  'prd.entry': EntryForm,
};

export const VIEWS: Record<string, ViewParts> = { 'qs.sale': quickSaleView };
