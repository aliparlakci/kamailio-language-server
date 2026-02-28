import * as path from 'path';
import * as fs from 'fs';
import Parser from 'web-tree-sitter';

const WASM_CANDIDATES = [
  // From src/__tests__/ (vitest runs from source)
  path.join(__dirname, '..', '..', '..', 'wasm', 'tree-sitter-python.wasm'),
  // From out/__tests__/ (compiled JS)
  path.join(__dirname, '..', '..', 'wasm', 'tree-sitter-python.wasm'),
  // From node_modules directly
  path.join(__dirname, '..', '..', '..', 'node_modules', 'tree-sitter-python', 'tree-sitter-python.wasm'),
];

export async function createTestParser(): Promise<Parser> {
  await Parser.init();

  let language: Parser.Language | null = null;
  for (const candidate of WASM_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      language = await Parser.Language.load(candidate);
      break;
    }
  }

  if (!language) {
    throw new Error(
      'Could not find tree-sitter-python.wasm for tests. Run `npm run copy-wasm` first.\nSearched: ' +
      WASM_CANDIDATES.join('\n  ')
    );
  }

  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}
