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
// Colors are defined as contributed theme colors in package.json so they
// adapt to the active color theme (dark, light, high-contrast).
const pvTypeDecoration = vscode.window.createTextEditorDecorationType({
  color: new vscode.ThemeColor('kamailio.pvTypeColor'),
});

const pvNameDecoration = vscode.window.createTextEditorDecorationType({
  color: new vscode.ThemeColor('kamailio.pvNameColor'),
});

const pvBuiltinDecoration = vscode.window.createTextEditorDecorationType({
  color: new vscode.ThemeColor('kamailio.pvBuiltinColor'),
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

  // Auto-trigger completions when typing inside $class() in a string.
  // VS Code disables quick suggestions inside strings by default, so
  // without this, variable name completions only appear via Ctrl+Space.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== event.document) return;
      if (event.document.languageId !== 'python') return;
      if (event.contentChanges.length !== 1) return;
      if (event.contentChanges[0].text.length !== 1) return;

      const position = editor.selection.active;
      const before = editor.document.lineAt(position.line).text.substring(0, position.character);
      if (/\$\w+\([^)"']*$/.test(before) || /\$\w*$/.test(before)) {
        vscode.commands.executeCommand('editor.action.triggerSuggest');
      }
    }),
  );

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
