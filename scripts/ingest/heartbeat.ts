// Log periódico enquanto uma chamada demorada (a extração via Gemini,
// hoje síncrona e sem progresso por questão — manda o PDF inteiro numa
// chamada só) está em andamento, só pra deixar visível que o processo
// não travou. Não muda nada do resultado, é puramente cosmético.
export async function withHeartbeat<T>(label: string, promise: Promise<T>): Promise<T> {
  const startedAt = Date.now();
  const interval = setInterval(() => {
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(`  ...ainda aguardando ${label} (${elapsedSeconds}s)`);
  }, 5000);

  try {
    return await promise;
  } finally {
    clearInterval(interval);
  }
}
