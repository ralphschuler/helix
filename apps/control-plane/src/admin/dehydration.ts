import type { DehydratedState } from '@tanstack/react-query';

const unsafeJsonCharacters: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

export function serializeDehydratedState(state: DehydratedState): string {
  return JSON.stringify(state).replace(
    /[<>&\u2028\u2029]/gu,
    (character) => unsafeJsonCharacters[character] ?? character,
  );
}
