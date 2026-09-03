// Wrapper mínimo em volta do console. Existe só pra dar ao projeto um
// único ponto de onde trocar por um logger de verdade (Sentry, Pino etc)
// mais tarde, sem precisar caçar cada `console.*` espalhado pelo código —
// não é log estruturado, é só a costura. Este é o único arquivo do
// projeto isento de quality/no-direct-console (ver eslint.config.mjs).
export const logger = {
  error: (...args: unknown[]) => console.error(...args),
  warn: (...args: unknown[]) => console.warn(...args),
};
