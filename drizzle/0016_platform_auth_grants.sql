GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_user", "platform_session", "platform_account", "platform_verification" TO solva_app;
--> statement-breakpoint
CREATE FUNCTION list_tenants_for_platform() RETURNS TABLE (id uuid, name text, slug text, status text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT t.id, t.name, t.slug, t.status, t.created_at
  FROM tenant t
  ORDER BY t.created_at DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION list_tenants_for_platform() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION list_tenants_for_platform() TO solva_app;
