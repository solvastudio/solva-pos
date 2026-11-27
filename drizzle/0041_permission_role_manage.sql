INSERT INTO "permission" ("code", "module", "description") VALUES
  ('role.manage', 'identity', 'permission.role.manage')
ON CONFLICT ("code") DO NOTHING;
