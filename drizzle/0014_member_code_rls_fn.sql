SELECT solva_enable_tenant_rls('member_code');
--> statement-breakpoint
SELECT solva_grant_app('member_code', 'SELECT, INSERT, UPDATE, DELETE');
--> statement-breakpoint
CREATE POLICY app_user_definer_read ON app_user FOR SELECT TO solva_owner USING (true);
--> statement-breakpoint
CREATE POLICY member_code_definer_read ON member_code FOR SELECT TO solva_owner USING (true);
--> statement-breakpoint
CREATE FUNCTION auth_account_membership_count(p_auth_user_id text) RETURNS integer
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT count(DISTINCT t)::int FROM (
    SELECT au.tenant_id AS t
    FROM app_user au
    WHERE au.auth_user_id = p_auth_user_id AND au.deleted_at IS NULL
    UNION
    SELECT mc.tenant_id
    FROM member_code mc
    JOIN "user" u ON mc.email = u.email::citext
    WHERE u.id = p_auth_user_id
      AND mc.kind = 'INVITE'
      AND mc.used_at IS NULL
      AND mc.revoked_at IS NULL
      AND mc.expires_at > now()
  ) x
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_account_membership_count(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_account_membership_count(text) TO solva_app;
