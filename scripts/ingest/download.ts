import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export async function downloadPdf(url: string, destPath: string): Promise<string> {
  if (existsSync(destPath)) {
    return destPath;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar ${url}: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(destPath), { recursive: true });
  await writeFile(destPath, buffer);
  return destPath;
}
