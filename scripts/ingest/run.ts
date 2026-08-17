import path from "node:path";
import { db } from "@/lib/db";
import { questions } from "@/db/schema";
import { INGEST_YEAR, PDF_URLS, DOWNLOAD_DIR } from "./config";
import { downloadPdf } from "./download";
import { extractQuestionsFromPdf } from "./extract-questions";
import { extractGabaritoFromPdf, mergeGabarito } from "./extract-gabarito";
import { questionAlreadyExists } from "./idempotency";
import { renderPageImage, uploadQuestionImage } from "./images";
import { findOrCreateTopic } from "./topics";

const DELAY_BETWEEN_CALLS_MS = 4500; // ~13 chamadas/min, abaixo do limite de 15 RPM

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processDay(examDay: 1 | 2) {
  const examUrl = examDay === 1 ? PDF_URLS.day1Exam : PDF_URLS.day2Exam;
  const gabaritoUrl = examDay === 1 ? PDF_URLS.day1Gabarito : PDF_URLS.day2Gabarito;

  const examPath = await downloadPdf(
    examUrl,
    path.join(DOWNLOAD_DIR, `${INGEST_YEAR}-d${examDay}-prova.pdf`)
  );
  const gabaritoPath = await downloadPdf(
    gabaritoUrl,
    path.join(DOWNLOAD_DIR, `${INGEST_YEAR}-d${examDay}-gabarito.pdf`)
  );

  console.log(`[dia ${examDay}] extraindo questões...`);
  const extracted = await extractQuestionsFromPdf(examPath, examDay);
  await sleep(DELAY_BETWEEN_CALLS_MS);

  console.log(`[dia ${examDay}] extraindo gabarito...`);
  const gabarito = await extractGabaritoFromPdf(gabaritoPath);
  await sleep(DELAY_BETWEEN_CALLS_MS);

  const withAnswers = mergeGabarito(extracted, gabarito);

  let imported = 0;
  let skipped = 0;

  for (const question of withAnswers) {
    const alreadyExists = await questionAlreadyExists(
      INGEST_YEAR,
      examDay,
      question.questionNumber
    );
    if (alreadyExists) {
      skipped += 1;
      continue;
    }

    const topicId = await findOrCreateTopic(question.area, question.subject, question.topic);

    let imageUrl: string | null = null;
    if (question.hasImage) {
      try {
        const pageBuffer = await renderPageImage(examPath, question.pageNumber);
        imageUrl = await uploadQuestionImage(
          pageBuffer,
          `${INGEST_YEAR}/d${examDay}-q${question.questionNumber}.png`
        );
      } catch (error) {
        console.warn(
          `[dia ${examDay}] questão ${question.questionNumber}: falha ao gerar imagem — seguindo sem imagem`,
          error
        );
      }
    }

    await db.insert(questions).values({
      id: crypto.randomUUID(),
      year: INGEST_YEAR,
      examDay,
      questionNumber: question.questionNumber,
      area: question.area,
      statement: question.statement,
      alternatives: question.alternatives,
      correctAnswer: question.correctAnswer,
      imageUrl,
      topicId,
      status: "pendente",
    });
    imported += 1;
  }

  console.log(`[dia ${examDay}] concluído: ${imported} importadas, ${skipped} já existiam`);
}

async function main() {
  await processDay(1);
  await processDay(2);
  console.log("Ingestão concluída. Revise em /admin/revisao.");
  // O cliente postgres-js não encerra os sockets sozinho no fim do script —
  // sem isso, o processo fica pendurado indefinidamente após "concluído".
  process.exit(0);
}

main().catch((error) => {
  console.error("Ingestão falhou:", error);
  process.exit(1);
});
