import { pdf } from "pdf-to-img";
import { createClient } from "@supabase/supabase-js";

export async function renderPageImage(
  pdfPath: string,
  pageNumber: number
): Promise<Buffer> {
  const document = await pdf(pdfPath, { scale: 2 });

  if (pageNumber < 1 || pageNumber > document.length) {
    throw new Error(
      `Página ${pageNumber} não encontrada em ${pdfPath} (documento tem ${document.length} páginas)`
    );
  }

  return document.getPage(pageNumber);
}

function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não definidas (verifique .env.local)"
    );
  }
  return createClient(url, serviceRoleKey);
}

export async function uploadQuestionImage(
  buffer: Buffer,
  key: string
): Promise<string> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.storage
    .from("question-images")
    .upload(key, buffer, { contentType: "image/png", upsert: true });

  if (error) {
    throw new Error(`Falha ao subir imagem ${key}: ${error.message}`);
  }

  const { data } = supabase.storage.from("question-images").getPublicUrl(key);
  return data.publicUrl;
}
