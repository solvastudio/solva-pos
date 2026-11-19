CREATE FUNCTION solva_enable_tenant_rls(tbl regclass, tenant_col text DEFAULT 'tenant_id') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    $p$CREATE POLICY tenant_isolation ON %s
      USING (%I = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (%I = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$,
    tbl,
    tenant_col,
    tenant_col
  );
END $$;
--> statement-breakpoint
CREATE FUNCTION solva_enable_tenant_rls_append_only(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_select ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON %s', tbl);
  EXECUTE format(
    $p$CREATE POLICY tenant_select ON %s FOR SELECT USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$,
    tbl
  );
  EXECUTE format(
    $p$CREATE POLICY tenant_insert ON %s FOR INSERT WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$,
    tbl
  );
END $$;
--> statement-breakpoint
CREATE FUNCTION solva_grant_app(tbl regclass, privileges text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('GRANT %s ON %s TO solva_app', privileges, tbl);
END $$;
--> statement-breakpoint
CREATE FUNCTION solva_grant_report(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('GRANT SELECT ON %s TO solva_report', tbl);
END $$;
