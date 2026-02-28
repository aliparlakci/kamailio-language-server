import * as path from 'path';
import Parser from 'web-tree-sitter';

export async function initTreeSitter(): Promise<Parser> {
  await Parser.init();
  const parser = new Parser();

  // Try multiple paths to find the WASM file
  const candidates = [
    path.join(__dirname, '..', '..', 'wasm', 'tree-sitter-python.wasm'),
    path.join(__dirname, '..', 'wasm', 'tree-sitter-python.wasm'),
    path.join(__dirname, '..', '..', 'node_modules', 'tree-sitter-python', 'tree-sitter-python.wasm'),
  ];

  let language: Parser.Language | null = null;
  for (const wasmPath of candidates) {
    try {
      language = await Parser.Language.load(wasmPath);
      break;
    } catch {
      // Try next candidate
    }
  }

  if (!language) {
    throw new Error(
      'Could not load tree-sitter-python.wasm. Searched: ' + candidates.join(', ')
    );
  }

  parser.setLanguage(language);
  return parser;
}
