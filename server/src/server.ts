import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';

import { AnalyzerRegistry } from './core/analyzerRegistry';
import { DocumentManager } from './core/documentManager';
import { initTreeSitter } from './core/treeSitterInit';
import { PvAnalyzer } from './analyzers/pvAnalyzer/index';

const connection = createConnection(ProposedFeatures.all);

let documentManager: DocumentManager;
let registry: AnalyzerRegistry;

// Debounce diagnostics so intermediate keystrokes don't flood the UI
const diagnosticTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
function scheduleDiagnostics(uri: string, delayMs = 300): void {
  const existing = diagnosticTimers.get(uri);
  if (existing) clearTimeout(existing);
  diagnosticTimers.set(
    uri,
    setTimeout(() => {
      diagnosticTimers.delete(uri);
      const state = documentManager.getDocumentState(uri);
      if (state) {
        connection.sendDiagnostics({
          uri: state.uri,
          diagnostics: registry.getDiagnostics({
            uri: state.uri,
            tree: state.tree,
            fullText: state.content,
          }),
        });
      }
    }, delayMs)
  );
}

connection.onInitialize(async (_params: InitializeParams): Promise<InitializeResult> => {
  const parser = await initTreeSitter();
  registry = new AnalyzerRegistry();
  documentManager = new DocumentManager(parser, registry);

  registry.register(new PvAnalyzer());

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['$', '('],
      },
      semanticTokensProvider: {
        legend: {
          tokenTypes: ['kamailioPvType', 'kamailioPvName', 'kamailioPvBuiltin'],
          tokenModifiers: ['declaration', 'modification'],
        },
        full: true,
      },
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
    },
  };
});

connection.onDidOpenTextDocument((params) => {
  documentManager.openDocument(
    params.textDocument.uri,
    params.textDocument.text,
    params.textDocument.version
  );
  // Publish diagnostics immediately on file open
  scheduleDiagnostics(params.textDocument.uri, 0);
});

connection.onDidChangeTextDocument((params) => {
  documentManager.changeDocument(params);
  // Debounce diagnostics while the user is typing
  scheduleDiagnostics(params.textDocument.uri);
});

connection.onDidCloseTextDocument((params) => {
  documentManager.closeDocument(params.textDocument.uri);
  connection.sendDiagnostics({ uri: params.textDocument.uri, diagnostics: [] });
});

connection.onCompletion((params) => {
  const state = documentManager.getDocumentState(params.textDocument.uri);
  if (!state) return [];
  return registry.getCompletions(
    { uri: state.uri, tree: state.tree, fullText: state.content },
    params.position
  );
});

connection.onDefinition((params) => {
  const state = documentManager.getDocumentState(params.textDocument.uri);
  if (!state) return null;
  return registry.getDefinitions(
    { uri: state.uri, tree: state.tree, fullText: state.content },
    params.position
  );
});

connection.onReferences((params) => {
  const state = documentManager.getDocumentState(params.textDocument.uri);
  if (!state) return [];
  return registry.getReferences(
    { uri: state.uri, tree: state.tree, fullText: state.content },
    params.position
  );
});

connection.onHover((params) => {
  const state = documentManager.getDocumentState(params.textDocument.uri);
  if (!state) return null;
  return registry.getHover(
    { uri: state.uri, tree: state.tree, fullText: state.content },
    params.position
  );
});

connection.languages.semanticTokens.on((params) => {
  const state = documentManager.getDocumentState(params.textDocument.uri);
  if (!state) {
    connection.console.log('[semantic-tokens] No document state for: ' + params.textDocument.uri);
    return { data: [] };
  }
  const tokens = registry.getSemanticTokens({
    uri: state.uri,
    tree: state.tree,
    fullText: state.content,
  });

  connection.console.log(`[semantic-tokens] ${tokens.length} tokens for ${params.textDocument.uri}`);

  // Encode tokens using delta encoding as required by LSP
  const sorted = tokens.sort((a, b) =>
    a.line !== b.line ? a.line - b.line : a.char - b.char
  );

  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;

  for (const token of sorted) {
    const deltaLine = token.line - prevLine;
    const deltaChar = deltaLine === 0 ? token.char - prevChar : token.char;
    data.push(deltaLine, deltaChar, token.length, token.tokenType, token.tokenModifiers);
    prevLine = token.line;
    prevChar = token.char;
  }

  return { data };
});

connection.listen();
