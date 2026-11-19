CREATE FUNCTION tenant_member_emails() RETURNS TABLE (app_user_id uuid, email text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT au.id, u.email
  FROM app_user au
  JOIN "user" u ON u.id = au.auth_user_id
  WHERE au.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND au.deleted_at IS NULL
    AND au.membership_status = 'ACTIVE'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_member_emails() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenant_member_emails() TO solva_app;
