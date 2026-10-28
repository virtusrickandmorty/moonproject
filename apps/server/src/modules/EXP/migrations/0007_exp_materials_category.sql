-- Materials and supplies paid on the spot (the owner's request, 28 Oct 2026): thread, needles, fabric or ink bought
-- for cash had no category of their own, so they went under Office supplies or Miscellaneous (operating expenses).
-- They are cost of sales: the category posts to 5101 Purchases – materials and supplies, as a supplier bill's materials
-- line does (periodic inventory: the count adjusts the stock at period end). Goods, for the purchases register and
-- the 2550Q; no usual EWT (goods_1 is for top withholding agents only).
INSERT INTO exp_categories (account_id, default_ewt_class, sort_order, purchase_class)
  SELECT id, NULL, sort_order, 'goods' FROM accounts WHERE code = '5101'
    AND id NOT IN (SELECT account_id FROM exp_categories);
