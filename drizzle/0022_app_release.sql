CREATE TABLE "app_release" (
	"app_version" text PRIMARY KEY NOT NULL,
	"schema_version" integer NOT NULL,
	"released_at" timestamptz DEFAULT now() NOT NULL,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"min_supported_schema_version" integer NOT NULL,
	"min_supported_app_version" text,
	"accept_previous_until" timestamptz,
	"notes" text,
	CONSTRAINT "ck_app_release__app_version" CHECK (char_length(app_version) <= 30 AND app_version ~ '^v\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$'),
	CONSTRAINT "ck_app_release__schema_version" CHECK ("app_release"."schema_version" > 0),
	CONSTRAINT "ck_app_release__min_schema" CHECK ("app_release"."min_supported_schema_version" > 0 AND "app_release"."min_supported_schema_version" <= "app_release"."schema_version"),
	CONSTRAINT "ck_app_release__min_app" CHECK (min_supported_app_version IS NULL OR (char_length(min_supported_app_version) <= 30 AND min_supported_app_version ~ '^v\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$'))
);
--> statement-breakpoint
CREATE INDEX "ix_app_release__released_at" ON "app_release" USING btree ("released_at" DESC);