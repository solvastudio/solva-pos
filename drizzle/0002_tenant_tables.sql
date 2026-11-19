CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"default_locale" text DEFAULT 'id-ID' NOT NULL,
	"currency" char(3) DEFAULT 'IDR' NOT NULL,
	"auth_org_id" text,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "uq_tenant__slug" UNIQUE("slug"),
	CONSTRAINT "uq_tenant__auth_org_id" UNIQUE("auth_org_id"),
	CONSTRAINT "ck_tenant__name_len" CHECK (char_length("tenant"."name") BETWEEN 1 AND 40),
	CONSTRAINT "ck_tenant__slug" CHECK ("tenant"."slug" ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
	CONSTRAINT "ck_tenant__status" CHECK ("tenant"."status" IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
	CONSTRAINT "ck_tenant__default_locale" CHECK ("tenant"."default_locale" IN ('id-ID', 'en-US')),
	CONSTRAINT "ck_tenant__currency" CHECK ("tenant"."currency" = 'IDR'),
	CONSTRAINT "ck_tenant__version" CHECK ("tenant"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "tenant_sync" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"tombstone_floor_version" bigint DEFAULT 0 NOT NULL,
	"floor_updated_at" timestamptz,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "ck_tenant_sync__version" CHECK ("tenant_sync"."version" >= 0),
	CONSTRAINT "ck_tenant_sync__floor" CHECK ("tenant_sync"."tombstone_floor_version" >= 0 AND "tenant_sync"."tombstone_floor_version" <= "tenant_sync"."version")
);
