ALTER TABLE tenant_sync ADD CONSTRAINT fk_tenant_sync__tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id);
--> statement-breakpoint
SELECT solva_enable_tenant_rls('tenant', 'id');
--> statement-breakpoint
CREATE POLICY tenant_definer_read ON tenant FOR SELECT TO solva_owner USING (true);
--> statement-breakpoint
SELECT solva_enable_tenant_rls('tenant_sync');
--> statement-breakpoint
SELECT solva_grant_app('tenant', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('tenant_sync', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
CREATE FUNCTION tenant_forbid_slug_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'tenant.slug is permanent';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER tenant_slug_permanent
  BEFORE UPDATE OF slug ON tenant
  FOR EACH ROW EXECUTE FUNCTION tenant_forbid_slug_change();
--> statement-breakpoint
-- CONFIRMATION NOTE (PERLU KONFIRMASI): `name` added per PRD V-38; SCHEMA §4.1.1(7) specifies `(id, status)`.
CREATE FUNCTION resolve_tenant_by_slug(p_slug text) RETURNS TABLE (id uuid, status text, name text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS
$$ SELECT t.id, t.status, t.name FROM tenant t WHERE t.slug = lower(p_slug) LIMIT 1 $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_tenant_by_slug(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_tenant_by_slug(text) TO solva_app;
--> statement-breakpoint
CREATE FUNCTION list_active_tenants() RETURNS TABLE (id uuid)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS
$$ SELECT t.id FROM tenant t WHERE t.status = 'ACTIVE' $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION list_active_tenants() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION list_active_tenants() TO solva_app;
