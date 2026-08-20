import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { temas } from "@/db/schema";

// Títulos oficiais de propostas de redação de provas passadas do ENEM
// (informação pública do INEP, mesma base legal já usada para ingerir as
// questões do banco de questões). Só o título - sem os textos motivadores
// completos, que não são reproduzidos aqui.
const SEED_TEMAS = [
  "Desafios para a valorização de comunidades e povos tradicionais no Brasil",
  "Desafios para o enfrentamento da invisibilidade do trabalho de cuidado realizado pela mulher no Brasil",
  "Invisibilidade e registro civil: garantia de acesso à cidadania no Brasil",
  "Democratização do acesso ao cinema no Brasil",
  "Manipulação do comportamento do usuário pelo controle de dados na internet",
];

async function seedTemas() {
  let inserted = 0;
  let skipped = 0;

  for (const title of SEED_TEMAS) {
    const [existing] = await db.select().from(temas).where(eq(temas.title, title));
    if (existing) {
      skipped++;
      continue;
    }
    await db.insert(temas).values({ id: crypto.randomUUID(), title });
    inserted++;
  }

  console.log(`Temas: ${inserted} inseridos, ${skipped} já existiam.`);
}

seedTemas()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Erro ao popular temas:", error);
    process.exit(1);
  });
