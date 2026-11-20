GRANT SELECT ON "app_release" TO solva_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA drizzle TO solva_app;
--> statement-breakpoint
GRANT SELECT ON drizzle.__drizzle_migrations TO solva_app;
