CREATE TYPE "public"."event_type" AS ENUM('ChapterAdded', 'FactExtracted', 'StateChanged', 'FlagRaised', 'FlagResolved', 'ChapterReplaced');--> statement-breakpoint
CREATE TYPE "public"."fact_type" AS ENUM('attribute', 'relationship', 'event', 'knowledge');--> statement-breakpoint
CREATE TYPE "public"."flag_status" AS ENUM('open', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."source_format" AS ENUM('paste', 'docx', 'md');--> statement-breakpoint
CREATE TYPE "public"."subject_kind" AS ENUM('character', 'place', 'object', 'group');--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text,
	"text" text NOT NULL,
	"source_format" "source_format" NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"chapter_id" uuid,
	"sequence" integer NOT NULL,
	"type" "event_type" NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"book_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"chapter_number" integer NOT NULL,
	"type" "fact_type" NOT NULL,
	"subject" text NOT NULL,
	"subject_kind" "subject_kind" NOT NULL,
	"attribute" text NOT NULL,
	"value" text NOT NULL,
	"quote" text NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"raised_by_event_id" uuid NOT NULL,
	"new_fact_id" uuid NOT NULL,
	"earlier_fact_id" uuid NOT NULL,
	"explanation" text NOT NULL,
	"status" "flag_status" DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_raised_by_event_id_events_id_fk" FOREIGN KEY ("raised_by_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_new_fact_id_facts_event_id_fk" FOREIGN KEY ("new_fact_id") REFERENCES "public"."facts"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_earlier_fact_id_facts_event_id_fk" FOREIGN KEY ("earlier_fact_id") REFERENCES "public"."facts"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "books_user_idx" ON "books" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_current_number_idx" ON "chapters" USING btree ("book_id","number") WHERE "chapters"."superseded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "events_book_sequence_idx" ON "events" USING btree ("book_id","sequence");--> statement-breakpoint
CREATE INDEX "facts_book_subject_attribute_idx" ON "facts" USING btree ("book_id","subject","attribute");--> statement-breakpoint
CREATE INDEX "flags_book_status_idx" ON "flags" USING btree ("book_id","status");