ALTER TABLE "pairing_code"
  ADD CONSTRAINT "fk_pairing_code__used_by_device"
  FOREIGN KEY ("tenant_id", "used_by_device_id")
  REFERENCES "device" ("tenant_id", "id") ON DELETE NO ACTION;
--> statement-breakpoint
SELECT solva_enable_tenant_rls('pairing_code');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('device');
--> statement-breakpoint
SELECT solva_enable_tenant_rls('device_sync_status');
--> statement-breakpoint
SELECT solva_grant_app('pairing_code', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
SELECT solva_grant_app('device', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT solva_grant_app('device_sync_status', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
CREATE POLICY device_definer_read ON device FOR SELECT TO solva_owner USING (true);
--> statement-breakpoint
CREATE POLICY register_definer_read ON cash_master FOR SELECT TO solva_owner USING (true);
--> statement-breakpoint
CREATE POLICY outlet_definer_read ON outlet FOR SELECT TO solva_owner USING (true);
--> statement-breakpoint
CREATE FUNCTION resolve_device_by_credential(p_hash bytea)
RETURNS TABLE (
  device_id uuid,
  tenant_id uuid,
  register_id uuid,
  outlet_id uuid,
  register_type text,
  register_status text,
  revoked_at timestamptz,
  credential_expires_at timestamptz,
  tenant_status text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT d.id, d.tenant_id, d.register_id, r.outlet_id, r.register_type, r.status,
         d.revoked_at, d.credential_expires_at, t.status
  FROM device d
  JOIN cash_master r ON r.tenant_id = d.tenant_id AND r.id = d.register_id
  JOIN tenant t ON t.id = d.tenant_id
  WHERE d.credential_hash = p_hash
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_device_by_credential(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_device_by_credential(bytea) TO solva_app;
