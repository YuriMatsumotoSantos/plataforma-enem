CREATE TABLE "topic_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"stability" real NOT NULL,
	"difficulty" real NOT NULL,
	"state" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp NOT NULL,
	"last_reviewed_at" timestamp NOT NULL,
	CONSTRAINT "topic_progress_user_topic_unique" UNIQUE("user_id","topic_id")
);
--> statement-breakpoint
ALTER TABLE "topic_progress" ADD CONSTRAINT "topic_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_progress" ADD CONSTRAINT "topic_progress_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topic_progress_user_idx" ON "topic_progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "topic_progress_due_idx" ON "topic_progress" USING btree ("due_at");