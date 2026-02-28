import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

// Decoration types for PV highlighting — these render on top of
// Pylance's string tokens and can't be overridden.
const pvTypeDecoration = vscode.window.createTextEditorDecorationType({
  color: '#4ec9b0',
});

const pvNameDecoration = vscode.window.createTextEditorDecorationType({
  color: '#9cdcfe',
});

const pvBuiltinDecoration = vscode.window.createTextEditorDecorationType({
  color: '#9cdcfe',
});

interface PvDecorationData {
  uri: string;
  decorations: Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    kind: 'pvType' | 'pvName' | 'pvBuiltin';
  }>;
}

export function activate(context: vscode.ExtensionContext) {
  const serverModule = context.asAbsolutePath(
    path.join('server', 'out', 'server.js')
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'python' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.py'),
    },
  };

  client = new LanguageClient(
    'kamailioKemiLanguageServer',
    'Kamailio Language Server',
    serverOptions,
    clientOptions
  );

  client.start().then(() => {
    // Listen for PV decoration notifications from the server
    client.onNotification('kamailio/pvDecorations', (data: PvDecorationData) => {
      applyDecorations(data);
    });
  });

  context.subscriptions.push(
    pvTypeDecoration,
    pvNameDecoration,
    pvBuiltinDecoration,
  );
}

function applyDecorations(data: PvDecorationData): void {
  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === data.uri
  );
  if (!editor) return;

  const typeRanges: vscode.Range[] = [];
  const nameRanges: vscode.Range[] = [];
  const builtinRanges: vscode.Range[] = [];

  for (const dec of data.decorations) {
    const range = new vscode.Range(
      new vscode.Position(dec.range.start.line, dec.range.start.character),
      new vscode.Position(dec.range.end.line, dec.range.end.character)
    );
    switch (dec.kind) {
      case 'pvType': typeRanges.push(range); break;
      case 'pvName': nameRanges.push(range); break;
      case 'pvBuiltin': builtinRanges.push(range); break;
    }
  }

  editor.setDecorations(pvTypeDecoration, typeRanges);
  editor.setDecorations(pvNameDecoration, nameRanges);
  editor.setDecorations(pvBuiltinDecoration, builtinRanges);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}
