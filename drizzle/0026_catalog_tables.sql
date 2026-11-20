CREATE TABLE "attribute_value" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"attribute_id" uuid NOT NULL,
	"value" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_attribute_value__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_attribute_value__value_len" CHECK (char_length("attribute_value"."value") BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"parent_id" uuid,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_category__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_category__version" CHECK ("category"."version" > 0),
	CONSTRAINT "ck_category__name_len" CHECK (char_length("category"."name") BETWEEN 1 AND 80),
	CONSTRAINT "ck_category__not_self_parent" CHECK ("category"."parent_id" IS DISTINCT FROM "category"."id")
);
--> statement-breakpoint
CREATE TABLE "item_outlet_availability" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"outlet_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku_id" uuid,
	"status" text NOT NULL,
	"changed_at" timestamptz DEFAULT now() NOT NULL,
	"changed_by" uuid,
	CONSTRAINT "uq_item_outlet_availability__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_item_outlet_avail__version" CHECK ("item_outlet_availability"."version" > 0),
	CONSTRAINT "ck_item_outlet_avail__status" CHECK ("item_outlet_availability"."status" IN ('AVAILABLE', 'UNAVAILABLE'))
);
--> statement-breakpoint
CREATE TABLE "price_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"sku_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"outlet_id" uuid,
	"price" bigint NOT NULL,
	"currency" char(3) DEFAULT 'IDR' NOT NULL,
	CONSTRAINT "uq_price_entry__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_price_entry__version" CHECK ("price_entry"."version" > 0),
	CONSTRAINT "ck_price_entry__price_nonneg" CHECK ("price_entry"."price" >= 0),
	CONSTRAINT "ck_price_entry__currency" CHECK ("price_entry"."currency" = 'IDR')
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"category_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"product_type" text DEFAULT 'RETAIL' NOT NULL,
	"has_variants" boolean DEFAULT false NOT NULL,
	"base_uom_id" uuid NOT NULL,
	"track_stock" boolean DEFAULT true NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_open_price" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_product__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_product__version" CHECK ("product"."version" > 0),
	CONSTRAINT "ck_product__code" CHECK ("product"."code" ~ '^[A-Za-z0-9\-_.]{1,30}$'),
	CONSTRAINT "ck_product__name_len" CHECK (char_length("product"."name") BETWEEN 1 AND 160),
	CONSTRAINT "ck_product__type" CHECK ("product"."product_type" IN ('RETAIL', 'MENU_FNB'))
);
--> statement-breakpoint
CREATE TABLE "product_attribute" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_product_attribute__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_product_attribute__name_len" CHECK (char_length("product_attribute"."name") BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE TABLE "sku" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"product_id" uuid NOT NULL,
	"sku_code" text NOT NULL,
	"variant_label" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "uq_sku__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_sku__id_product" UNIQUE("id","product_id"),
	CONSTRAINT "ck_sku__version" CHECK ("sku"."version" > 0),
	CONSTRAINT "ck_sku__code" CHECK ("sku"."sku_code" ~ '^[A-Za-z0-9\-_.]{1,40}$'),
	CONSTRAINT "ck_sku__variant_label_len" CHECK (char_length("sku"."variant_label") <= 80)
);
--> statement-breakpoint
CREATE TABLE "sku_attribute_value" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"sku_id" uuid NOT NULL,
	"attribute_value_id" uuid NOT NULL,
	CONSTRAINT "uq_sku_attribute_value__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_sku_attribute_value__sku_val" UNIQUE("sku_id","attribute_value_id")
);
--> statement-breakpoint
CREATE TABLE "sku_uom" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"sku_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"conversion_factor" numeric(18, 4) NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"barcode" text,
	CONSTRAINT "uq_sku_uom__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_sku_uom__sku_uom" UNIQUE("sku_id","uom_id"),
	CONSTRAINT "ck_sku_uom__version" CHECK ("sku_uom"."version" > 0),
	CONSTRAINT "ck_sku_uom__factor_pos" CHECK ("sku_uom"."conversion_factor" > 0),
	CONSTRAINT "ck_sku_uom__base_factor_one" CHECK (NOT "sku_uom"."is_base" OR "sku_uom"."conversion_factor" = 1),
	CONSTRAINT "ck_sku_uom__barcode_len" CHECK (char_length("sku_uom"."barcode") BETWEEN 1 AND 64)
);
--> statement-breakpoint
CREATE TABLE "uom" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"allow_fraction" boolean DEFAULT false NOT NULL,
	CONSTRAINT "uq_uom__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "ck_uom__version" CHECK ("uom"."version" > 0),
	CONSTRAINT "ck_uom__code" CHECK ("uom"."code" ~ '^[a-z0-9]{1,12}$')
);
--> statement-breakpoint
CREATE TABLE "feature_flag" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamptz,
	"flag_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"params" jsonb,
	"note" text,
	CONSTRAINT "uq_feature_flag__tenant_id_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_feature_flag__tenant_key" UNIQUE("tenant_id","flag_key"),
	CONSTRAINT "ck_feature_flag__version" CHECK ("feature_flag"."version" > 0),
	CONSTRAINT "ck_feature_flag__key" CHECK ("feature_flag"."flag_key" ~ '^[a-z][a-z0-9_.]{2,63}$'),
	CONSTRAINT "ck_feature_flag__params_obj" CHECK (jsonb_typeof("feature_flag"."params") = 'object'),
	CONSTRAINT "ck_feature_flag__note_len" CHECK (char_length("feature_flag"."note") <= 200)
);
--> statement-breakpoint
ALTER TABLE "attribute_value" ADD CONSTRAINT "fk_attribute_value__attribute" FOREIGN KEY ("tenant_id","attribute_id") REFERENCES "public"."product_attribute"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_outlet_availability" ADD CONSTRAINT "fk_item_outlet_avail__product" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."product"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_entry" ADD CONSTRAINT "fk_price_entry__sku_uom" FOREIGN KEY ("sku_id","uom_id") REFERENCES "public"."sku_uom"("sku_id","uom_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_entry" ADD CONSTRAINT "fk_price_entry__sku" FOREIGN KEY ("tenant_id","sku_id") REFERENCES "public"."sku"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_entry" ADD CONSTRAINT "fk_price_entry__uom" FOREIGN KEY ("tenant_id","uom_id") REFERENCES "public"."uom"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "fk_product__category" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."category"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "fk_product__base_uom" FOREIGN KEY ("tenant_id","base_uom_id") REFERENCES "public"."uom"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attribute" ADD CONSTRAINT "fk_product_attribute__product" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."product"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku" ADD CONSTRAINT "fk_sku__product" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."product"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_attribute_value" ADD CONSTRAINT "fk_sku_attr_val__sku" FOREIGN KEY ("tenant_id","sku_id") REFERENCES "public"."sku"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_attribute_value" ADD CONSTRAINT "fk_sku_attr_val__attr_value" FOREIGN KEY ("tenant_id","attribute_value_id") REFERENCES "public"."attribute_value"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_uom" ADD CONSTRAINT "fk_sku_uom__sku" FOREIGN KEY ("tenant_id","sku_id") REFERENCES "public"."sku"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sku_uom" ADD CONSTRAINT "fk_sku_uom__uom" FOREIGN KEY ("tenant_id","uom_id") REFERENCES "public"."uom"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag" ADD CONSTRAINT "fk_feature_flag__tenant" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_category__feed" ON "category" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_item_outlet_availability__feed" ON "item_outlet_availability" USING btree ("tenant_id","outlet_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_price_entry__feed_outlet" ON "price_entry" USING btree ("tenant_id","outlet_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_price_entry__feed_default" ON "price_entry" USING btree ("tenant_id","version","id") WHERE "price_entry"."outlet_id" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_product__feed" ON "product" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_product__tenant_code" ON "product" USING btree ("tenant_id","code") WHERE "product"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_sku__feed" ON "sku" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_sku__product" ON "sku" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sku__tenant_code" ON "sku" USING btree ("tenant_id","sku_code") WHERE "sku"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sku__product_default" ON "sku" USING btree ("product_id") WHERE "sku"."is_default" AND "sku"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_sku_uom__feed" ON "sku_uom" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sku_uom__tenant_barcode" ON "sku_uom" USING btree ("tenant_id","barcode") WHERE "sku_uom"."barcode" IS NOT NULL AND "sku_uom"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sku_uom__sku_base" ON "sku_uom" USING btree ("sku_id") WHERE "sku_uom"."is_base" AND "sku_uom"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_uom__feed" ON "uom" USING btree ("tenant_id","version","id");--> statement-breakpoint
CREATE INDEX "ix_feature_flag__feed" ON "feature_flag" USING btree ("tenant_id","version","id");