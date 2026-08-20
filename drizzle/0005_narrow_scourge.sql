CREATE TABLE "redacoes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tema_id" text NOT NULL,
	"text" text NOT NULL,
	"scores" jsonb NOT NULL,
	"nota_total" integer NOT NULL,
	"feedback" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temas" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "redacoes" ADD CONSTRAINT "redacoes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redacoes" ADD CONSTRAINT "redacoes_tema_id_temas_id_fk" FOREIGN KEY ("tema_id") REFERENCES "public"."temas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "redacoes_userId_idx" ON "redacoes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "redacoes_temaId_idx" ON "redacoes" USING btree ("tema_id");