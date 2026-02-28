import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import {
  createProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter,
  InitializeRequest,
  InitializeParams,
  InitializedNotification,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  CompletionRequest,
  HoverRequest,
  DefinitionRequest,
  ReferencesRequest,
  SemanticTokensRequest,
  DidCloseTextDocumentNotification,
  ProtocolConnection,
  CompletionList,
  CompletionItem,
  Hover,
  Location,
  SemanticTokens,
  Diagnostic,
  PublishDiagnosticsNotification,
  TextDocumentSyncKind,
} from 'vscode-languageserver-protocol/node';

export class TestLspClient {
  private process: ChildProcess;
  private connection: ProtocolConnection;
  private diagnostics: Map<string, Diagnostic[]> = new Map();
  private docVersions: Map<string, number> = new Map();

  private workspaceFolders: Array<{ uri: string; name: string }>;
  private initOptions: Record<string, unknown> | undefined;

  private constructor(
    proc: ChildProcess,
    conn: ProtocolConnection,
    workspaceFolders: Array<{ uri: string; name: string }>,
    initOptions?: Record<string, unknown>
  ) {
    this.process = proc;
    this.connection = conn;
    this.workspaceFolders = workspaceFolders;
    this.initOptions = initOptions;

    // Collect diagnostics pushed by the server
    conn.onNotification(PublishDiagnosticsNotification.type, (params) => {
      this.diagnostics.set(params.uri, params.diagnostics);
    });
  }

  static async start(
    workspaceFolders?: Array<{ uri: string; name: string }>,
    initializationOptions?: Record<string, unknown>
  ): Promise<TestLspClient> {
    const serverPath = path.join(__dirname, '..', '..', '..', 'out', 'server.js');
    const proc = spawn('node', [serverPath, '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const conn = createProtocolConnection(
      new StreamMessageReader(proc.stdout!),
      new StreamMessageWriter(proc.stdin!)
    );

    conn.listen();

    const folders = workspaceFolders || [{ uri: 'file:///test-workspace', name: 'test' }];
    const client = new TestLspClient(proc, conn, folders, initializationOptions);
    await client.initialize();
    return client;
  }

  private async initialize(): Promise<void> {
    const params: InitializeParams = {
      processId: process.pid,
      rootUri: this.workspaceFolders[0]?.uri || 'file:///test-workspace',
      capabilities: {
        textDocument: {
          completion: {
            completionItem: {
              snippetSupport: true,
              insertReplaceSupport: true,
            },
          },
          semanticTokens: {
            requests: { full: true },
            tokenTypes: ['type', 'variable'],
            tokenModifiers: ['declaration', 'modification'],
            formats: ['relative'],
          },
        },
      },
      workspaceFolders: this.workspaceFolders,
      initializationOptions: this.initOptions,
    };

    await this.connection.sendRequest(InitializeRequest.type, params);
    await this.connection.sendNotification(InitializedNotification.type, {});
    // Give workspace indexer time to scan
    await this.sleep(200);
  }

  async openDocument(uri: string, text: string, languageId = 'python'): Promise<void> {
    this.docVersions.set(uri, 1);
    await this.connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId, version: 1, text },
    });
    // Give the server a moment to process
    await this.sleep(100);
  }

  async changeDocument(
    uri: string,
    changes: Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; text: string }>
  ): Promise<void> {
    const version = (this.docVersions.get(uri) || 1) + 1;
    this.docVersions.set(uri, version);
    await this.connection.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version },
      contentChanges: changes,
    });
    await this.sleep(100);
  }

  async getCompletions(uri: string, line: number, character: number): Promise<CompletionItem[]> {
    const result = await this.connection.sendRequest(CompletionRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
    if (!result) return [];
    if (Array.isArray(result)) return result;
    return (result as CompletionList).items;
  }

  async getHover(uri: string, line: number, character: number): Promise<Hover | null> {
    return await this.connection.sendRequest(HoverRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async getDefinitions(uri: string, line: number, character: number): Promise<Location[]> {
    const result = await this.connection.sendRequest(DefinitionRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
    if (!result) return [];
    return Array.isArray(result) ? result as Location[] : [result as Location];
  }

  async getReferences(uri: string, line: number, character: number): Promise<Location[]> {
    const result = await this.connection.sendRequest(ReferencesRequest.type, {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    });
    return result || [];
  }

  async getSemanticTokens(uri: string): Promise<SemanticTokens | null> {
    return await this.connection.sendRequest(SemanticTokensRequest.type, {
      textDocument: { uri },
    });
  }

  getDiagnostics(uri: string): Diagnostic[] {
    return this.diagnostics.get(uri) || [];
  }

  async waitForDiagnostics(uri: string, timeoutMs = 2000): Promise<Diagnostic[]> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const diags = this.diagnostics.get(uri);
      if (diags && diags.length > 0) return diags;
      await this.sleep(50);
    }
    return this.diagnostics.get(uri) || [];
  }

  async closeDocument(uri: string): Promise<void> {
    await this.connection.sendNotification(DidCloseTextDocumentNotification.type, {
      textDocument: { uri },
    });
  }

  async shutdown(): Promise<void> {
    try {
      this.connection.dispose();
    } catch {
      // ignore
    }
    this.process.kill();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
