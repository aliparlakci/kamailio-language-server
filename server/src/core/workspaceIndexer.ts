import * as fs from 'fs';
import * as path from 'path';
import { Connection, FileChangeType } from 'vscode-languageserver';
import { DocumentManager } from './documentManager';

const STAT_MODPARAM_RE = /modparam\s*\(\s*"statistics"\s*,\s*"variable"\s*,\s*"([^"]+)"\s*\)/g;

export interface StatDeclaration {
  name: string;
  uri: string;
  line: number;
}

export class WorkspaceIndexer {
  private knownFiles: Set<string> = new Set();
  private declaredStats: Map<string, StatDeclaration> = new Map();

  constructor(
    private connection: Connection,
    private documentManager: DocumentManager,
    private workspaceRoots: string[]
  ) {}

  async scanWorkspace(): Promise<void> {
    // Scan config files first so declared stats are available during .py analysis
    for (const root of this.workspaceRoots) {
      this.collectCfgStats(root);
    }
    if (this.declaredStats.size > 0) {
      this.connection.console.log(
        `[workspace-indexer] Found ${this.declaredStats.size} declared statistics`
      );
    }

    const pyFiles: string[] = [];
    for (const root of this.workspaceRoots) {
      this.collectPyFiles(root, pyFiles);
    }

    this.connection.console.log(
      `[workspace-indexer] Found ${pyFiles.length} .py files in workspace`
    );

    // Process in batches to avoid blocking the event loop
    const batchSize = 10;
    for (let i = 0; i < pyFiles.length; i += batchSize) {
      const batch = pyFiles.slice(i, i + batchSize);
      for (const filePath of batch) {
        const uri = 'file://' + filePath;
        this.knownFiles.add(uri);
        if (!this.documentManager.isEditorOpen(uri)) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            this.documentManager.loadFromDisk(uri, content);
          } catch {
            // File may have been deleted between discovery and read
          }
        }
      }
      // Yield to event loop between batches
      if (i + batchSize < pyFiles.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    this.connection.console.log(
      `[workspace-indexer] Indexed ${this.knownFiles.size} files`
    );
  }

  markEditorOpen(uri: string): void {
    // DocumentManager.openDocument already handles the editorOpen flag
  }

  markEditorClosed(uri: string): void {
    // Re-read from disk to restore background index
    const filePath = uri.replace('file://', '');
    if (this.knownFiles.has(uri)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        this.documentManager.loadFromDisk(uri, content);
      } catch {
        // File may have been deleted
      }
    }
  }

  onFileChange(uri: string, changeType: FileChangeType): void {
    const filePath = uri.replace('file://', '');

    if (changeType === FileChangeType.Deleted) {
      this.knownFiles.delete(uri);
      this.documentManager.removeDocument(uri);
      return;
    }

    // Created or Changed
    if (!uri.endsWith('.py')) return;
    this.knownFiles.add(uri);

    if (!this.documentManager.isEditorOpen(uri)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        this.documentManager.loadFromDisk(uri, content);
      } catch {
        // File may have been deleted between notification and read
      }
    }
  }

  getKnownFiles(): Set<string> {
    return this.knownFiles;
  }

  getWorkspaceRoots(): string[] {
    return this.workspaceRoots;
  }

  getDeclaredStats(): Map<string, StatDeclaration> {
    return this.declaredStats;
  }

  private collectCfgStats(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          this.collectCfgStats(fullPath);
        } else if (entry.name.endsWith('.cfg')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const uri = 'file://' + fullPath;
            const lines = content.split('\n');
            for (let lineNo = 0; lineNo < lines.length; lineNo++) {
              STAT_MODPARAM_RE.lastIndex = 0;
              const match = STAT_MODPARAM_RE.exec(lines[lineNo]);
              if (match) {
                this.declaredStats.set(match[1], { name: match[1], uri, line: lineNo });
              }
            }
          } catch {
            // Can't read file
          }
        }
      }
    } catch {
      // Permission errors
    }
  }

  private collectPyFiles(dir: string, results: string[]): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip common non-source directories
          if (entry.name === 'node_modules' || entry.name === '.git' ||
              entry.name === '__pycache__' || entry.name === '.venv' ||
              entry.name === 'venv' || entry.name === '.tox') {
            continue;
          }
          this.collectPyFiles(fullPath, results);
        } else if (entry.name.endsWith('.py')) {
          results.push(fullPath);
        }
      }
    } catch {
      // Permission errors or other FS issues
    }
  }
}
