-- What an expense category buys, goods or services, for the purchases register, the 2550Q worksheet and the SLP
-- (research vat-cwt-ewt §3.8 and §3.9). Staff meals, fuel and office supplies are goods; every other category is a
-- service. The accountant confirms the split before the first 2550Q (TAX-1).
ALTER TABLE exp_categories ADD COLUMN purchase_class TEXT NOT NULL DEFAULT 'services' CHECK (purchase_class IN ('goods', 'services'));
UPDATE exp_categories SET purchase_class = 'goods'
  WHERE account_id IN (SELECT id FROM accounts WHERE code IN ('6104', '6141', '6160'));
