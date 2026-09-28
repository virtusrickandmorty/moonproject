-- EWT rates become a dated setting (PLAN D4.8, E12), so a BIR rate change is a new version from its effective date
-- and posted documents keep the rate they used. The first version holds the rates the code used until now.
INSERT INTO settings (key, effective_from, value_json, reason, created_at) VALUES
('tax.ewt_rates_bp', '2000-01-01', '{"rent_5":500,"contractor_2":200,"prof_ind_5":500,"prof_ind_10":1000,"prof_firm_10":1000,"prof_firm_15":1500,"goods_1":100,"services_2":200}', 'Default at install: EWT rates by class (PLAN D4.8)', '2026-09-28T00:00:00.000+08:00');
