export type Alternative = { letter: string; text: string };

export type ExtractedQuestion = {
  questionNumber: number;
  statement: string;
  alternatives: Alternative[];
  hasImage: boolean;
  pageNumber: number;
  area: "linguagens" | "humanas" | "natureza" | "matematica";
  subject: string;
  topic: string;
};

export type GabaritoEntry = {
  questionNumber: number;
  correctAnswer: string;
};
