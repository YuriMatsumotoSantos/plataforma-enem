export const INGEST_YEAR = 2025;

// Formato atual do ENEM: 90 questões por dia (45 de cada área)
// Pode precisar de ajuste se o formato mudar num ano futuro
export const EXPECTED_QUESTIONS_PER_DAY = 90;

export const PDF_URLS = {
  day1Exam: "https://download.inep.gov.br/enem/provas_e_gabaritos/2025_PV_impresso_D1_CD1.pdf",
  day1Gabarito: "https://download.inep.gov.br/enem/provas_e_gabaritos/2025_GB_impresso_D1_CD1.pdf",
  day2Exam: "https://download.inep.gov.br/enem/provas_e_gabaritos/2025_PV_impresso_D2_CD7.pdf",
  day2Gabarito: "https://download.inep.gov.br/enem/provas_e_gabaritos/2025_GB_impresso_D2_CD7.pdf",
} as const;

export const DOWNLOAD_DIR = "scripts/ingest/downloads";
