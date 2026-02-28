import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import * as fs from 'fs';
import * as path from 'path';

import { AnalyzerRegistry } from './core/analyzerRegistry';
import { DocumentManager } from './core/documentManager';
import { initTreeSitter } from './core/treeSitterInit';
import { WorkspaceIndexer } from './core/workspaceIndexer';
import { PvAnalyzer } from './analyzers/pvAnalyzer/index';
import { CallGraphAnalyzer } from './analyzers/callGraphAnalyzer/index';

const connection = createConnection(ProposedFeatures.all);

let documentManager: DocumentManager;
let registry: AnalyzerRegistry;
let workspaceIndexer: WorkspaceIndexer;

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

// Send PV decoration data to client for client-side highlighting.
// This bypasses semantic tokens which get overridden by Pylance.
function sendDecorations(uri: string): void {
  const state = documentManager.getDocumentState(uri);
  if (!state) return;

  const tokens = registry.getSemanticTokens({
    uri: state.uri,
    tree: state.tree,
    fullText: state.content,
  });

  const decorations = tokens.map((t) => ({
    range: {
      start: { line: t.line, character: t.char },
      end: { line: t.line, character: t.char + t.length },
    },
    kind: t.tokenType === 0 ? 'pvType' as const
        : t.tokenType === 2 ? 'pvBuiltin' as const
        : 'pvName' as const,
  }));

  connection.sendNotification('kamailio/pvDecorations', {
    uri: state.uri,
    decorations,
  });
}

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
  const parser = await initTreeSitter();
  registry = new AnalyzerRegistry();
  documentManager = new DocumentManager(parser, registry);

  const workspaceRoots = (params.workspaceFolders || [])
    .map((f) => f.uri.replace('file://', ''));

  // Merge extra Python paths from client settings
  const extraPaths: string[] = params.initializationOptions?.extraPaths || [];
  const resolvedExtraPaths = resolveExtraPaths(extraPaths);
  if (resolvedExtraPaths.length > 0) {
    connection.console.log(`[init] Extra paths: ${resolvedExtraPaths.join(', ')}`);
    workspaceRoots.push(...resolvedExtraPaths);
  }

  workspaceIndexer = new WorkspaceIndexer(connection, documentManager, workspaceRoots);

  const callGraphAnalyzer = new CallGraphAnalyzer(
    () => workspaceIndexer.getWorkspaceRoots(),
    () => workspaceIndexer.getKnownFiles(),
    () => workspaceIndexer.getDeclaredStats()
  );
  const pvAnalyzer = new PvAnalyzer();
  pvAnalyzer.setCallGraphAnalyzer(callGraphAnalyzer);

  // Register CallGraphAnalyzer BEFORE PvAnalyzer so call graph is
  // updated first when a document changes
  registry.register(callGraphAnalyzer);
  registry.register(pvAnalyzer);

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['$', '(', '"', "'"],
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

connection.onInitialized(async () => {
  await workspaceIndexer.scanWorkspace();
});

connection.onDidChangeWatchedFiles((params) => {
  for (const change of params.changes) {
    workspaceIndexer.onFileChange(change.uri, change.type);
  }
});

connection.onDidOpenTextDocument((params) => {
  documentManager.openDocument(
    params.textDocument.uri,
    params.textDocument.text,
    params.textDocument.version
  );
  scheduleDiagnostics(params.textDocument.uri, 0);
  sendDecorations(params.textDocument.uri);
});

connection.onDidChangeTextDocument((params) => {
  documentManager.changeDocument(params);
  scheduleDiagnostics(params.textDocument.uri);
  sendDecorations(params.textDocument.uri);
});

connection.onDidCloseTextDocument((params) => {
  documentManager.closeDocument(params.textDocument.uri);
  workspaceIndexer.markEditorClosed(params.textDocument.uri);
  connection.sendDiagnostics({ uri: params.textDocument.uri, diagnostics: [] });
});

connection.onCompletion((params) => {
  const state = documentManager.getDocumentState(params.textDocument.uri);
  if (!state) return [];
  const items = registry.getCompletions(
    { uri: state.uri, tree: state.tree, fullText: state.content },
    params.position
  );
  // isIncomplete forces VS Code to re-request on each keystroke,
  // ensuring textEdit ranges are always fresh (not stale from a prior request)
  return { items, isIncomplete: true };
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

/** Expand extra paths: include .pth file entries from site-packages dirs. */
function resolveExtraPaths(extraPaths: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const p of extraPaths) {
    const resolved = path.resolve(p);
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    if (!fs.existsSync(resolved)) continue;
    result.push(resolved);

    // If this looks like a site-packages dir, scan for .pth files
    try {
      const entries = fs.readdirSync(resolved);
      for (const entry of entries) {
        if (!entry.endsWith('.pth')) continue;
        const pthPath = path.join(resolved, entry);
        try {
          const content = fs.readFileSync(pthPath, 'utf-8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('import ')) continue;
            const pthResolved = path.resolve(trimmed);
            if (!seen.has(pthResolved) && fs.existsSync(pthResolved)) {
              seen.add(pthResolved);
              result.push(pthResolved);
            }
          }
        } catch {
          // Can't read .pth file
        }
      }
    } catch {
      // Not a directory or can't read
    }
  }

  return result;
}

connection.listen();
