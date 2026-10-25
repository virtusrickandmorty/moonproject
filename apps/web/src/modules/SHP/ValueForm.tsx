/**
 * Shop stock value form (the owner's request, 25 Oct 2026): at a month end the accountant values the website shop's own
 * pieces on hand at cost, on the TPL stock value's form with the shop's words and sheet.
 */
import { api, type DocTypeInfo, type Me } from '../../api.ts';
import { Link } from '../../router.tsx';
import type { FormMode } from '../../generic/DocForm.tsx';
import { StockValueForm, type StockWords } from '../TPL/ValueForm.tsx';

const SHOP_WORDS: StockWords = {
  sheet: (date) => api.shpValueSheet(date),
  intro: <>The website shop's own pieces are still yours until sold, so at a month end they go on the books at cost.
    The quantities come from the shop's stock on that day: pieces in, counts, pieces made, less the pieces sold.</>,
  whose: "The shop's stock",
  costHint: <>Materials plus labor for one piece. The <Link to="/rpt/job-margin" className="text-indigo-700 underline">Job margin</Link> report shows the shop's labor per piece.</>,
  loading: "Loading the shop's stock…",
  none: 'No shop pieces',
};

export function ShopValueForm(props: { type: DocTypeInfo; mode: FormMode; me: Me }) {
  return <StockValueForm {...props} words={SHOP_WORDS} />;
}
