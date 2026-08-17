CREATE TYPE "public"."exam_area" AS ENUM('linguagens', 'humanas', 'natureza', 'matematica');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('pendente', 'aprovada', 'rejeitada');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('aluno', 'admin');--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"exam_day" integer NOT NULL,
	"question_number" integer NOT NULL,
	"area" "exam_area" NOT NULL,
	"statement" text NOT NULL,
	"alternatives" jsonb NOT NULL,
	"correct_answer" text NOT NULL,
	"image_url" text,
	"topic_id" text NOT NULL,
	"status" "question_status" DEFAULT 'pendente' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "questions_year_day_number_unique" UNIQUE("year","exam_day","question_number")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" text PRIMARY KEY NOT NULL,
	"area" "exam_area" NOT NULL,
	"subject" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" "user_role" DEFAULT 'aluno' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "questions_topic_idx" ON "questions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "questions_status_idx" ON "questions" USING btree ("status");