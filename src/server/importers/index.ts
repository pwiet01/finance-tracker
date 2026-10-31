import { dkb } from './dkb';
import type { Importer } from './types';

/** All supported bank formats. Register new importers here. */
export const importers: Importer[] = [dkb];

export function detectImporter(text: string): Importer | undefined {
  return importers.find((i) => i.detect(text));
}

export type { Importer, ParsedFile, ParsedRow } from './types';
