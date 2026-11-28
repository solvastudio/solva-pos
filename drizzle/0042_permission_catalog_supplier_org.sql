INSERT INTO "permission" ("code", "module", "description") VALUES
  ('catalog.view', 'catalog', 'permission.catalog.view'),
  ('catalog.import', 'catalog', 'permission.catalog.import'),
  ('supplier.manage', 'inventory', 'permission.supplier.manage'),
  ('org.manage', 'identity', 'permission.org.manage')
ON CONFLICT ("code") DO NOTHING;
