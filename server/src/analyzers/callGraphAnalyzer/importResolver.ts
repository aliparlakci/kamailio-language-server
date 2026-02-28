import { SyntaxNode, Tree } from 'web-tree-sitter';
import * as path from 'path';

export interface ImportBinding {
  localName: string;
  remoteName: string;
  resolvedUri: string | null;
  modulePath: string;
  isWildcard: boolean;
}

export class ImportResolver {
  extractImports(tree: Tree): ImportBinding[] {
    const imports: ImportBinding[] = [];
    const root = tree.rootNode;

    for (let i = 0; i < root.namedChildCount; i++) {
      const node = root.namedChild(i)!;
      if (node.type === 'import_statement') {
        this.extractImportStatement(node, imports);
      } else if (node.type === 'import_from_statement') {
        this.extractImportFromStatement(node, imports);
      }
    }

    return imports;
  }

  resolveModulePath(
    modulePath: string,
    fromUri: string,
    workspaceRoots: string[],
    knownFiles: Set<string>
  ): string | null {
    // Handle relative imports (leading dots)
    const dotMatch = modulePath.match(/^(\.+)(.*)/);
    if (dotMatch) {
      const dots = dotMatch[1].length;
      const rest = dotMatch[2];
      const fromPath = fromUri.replace('file://', '');
      let baseDir = path.dirname(fromPath);
      for (let i = 1; i < dots; i++) {
        baseDir = path.dirname(baseDir);
      }
      return this.tryResolve(rest, baseDir, knownFiles);
    }

    // Absolute imports — try from each workspace root
    for (const root of workspaceRoots) {
      const resolved = this.tryResolve(modulePath, root, knownFiles);
      if (resolved) return resolved;
    }

    return null;
  }

  resolveCallTarget(
    localName: string,
    fileUri: string,
    importsByFile: Map<string, ImportBinding[]>
  ): { uri: string; name: string } | null {
    const imports = importsByFile.get(fileUri);
    if (!imports) return null;

    for (const imp of imports) {
      if (imp.localName === localName && imp.resolvedUri) {
        return { uri: imp.resolvedUri, name: imp.remoteName };
      }
    }

    return null;
  }

  private tryResolve(
    modulePath: string,
    baseDir: string,
    knownFiles: Set<string>
  ): string | null {
    const parts = modulePath ? modulePath.split('.') : [];
    const relPath = parts.join('/');

    // Try module.py
    const filePath = path.join(baseDir, relPath + '.py');
    const fileUri = 'file://' + filePath;
    if (knownFiles.has(fileUri)) return fileUri;

    // Try module/__init__.py
    const initPath = path.join(baseDir, relPath, '__init__.py');
    const initUri = 'file://' + initPath;
    if (knownFiles.has(initUri)) return initUri;

    return null;
  }

  private extractImportStatement(node: SyntaxNode, imports: ImportBinding[]): void {
    // import helpers / import helpers.routing / import helpers as h
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)!;
      if (child.type === 'dotted_name') {
        const modulePath = child.text;
        const topLevel = modulePath.split('.')[0];
        imports.push({
          localName: topLevel,
          remoteName: topLevel,
          resolvedUri: null,
          modulePath,
          isWildcard: false,
        });
      } else if (child.type === 'aliased_import') {
        const name = child.childForFieldName('name');
        const alias = child.childForFieldName('alias');
        if (name) {
          const modulePath = name.text;
          imports.push({
            localName: alias ? alias.text : modulePath.split('.')[0],
            remoteName: modulePath.split('.')[0],
            resolvedUri: null,
            modulePath,
            isWildcard: false,
          });
        }
      }
    }
  }

  private extractImportFromStatement(node: SyntaxNode, imports: ImportBinding[]): void {
    // from helpers import func / from helpers import func as f / from helpers import *
    const moduleNode = node.childForFieldName('module_name');
    const modulePath = moduleNode ? moduleNode.text : '';

    // Collect node IDs to skip (module_name and its children)
    const skipIds = new Set<number>();
    if (moduleNode) {
      skipIds.add(moduleNode.id);
      for (let j = 0; j < moduleNode.namedChildCount; j++) {
        skipIds.add(moduleNode.namedChild(j)!.id);
      }
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)!;
      if (skipIds.has(child.id)) continue;

      if (child.type === 'dotted_name') {
        // Named import: from X import name
        imports.push({
          localName: child.text,
          remoteName: child.text,
          resolvedUri: null,
          modulePath,
          isWildcard: false,
        });
      } else if (child.type === 'aliased_import') {
        const name = child.childForFieldName('name');
        const alias = child.childForFieldName('alias');
        if (name) {
          imports.push({
            localName: alias ? alias.text : name.text,
            remoteName: name.text,
            resolvedUri: null,
            modulePath,
            isWildcard: false,
          });
        }
      } else if (child.type === 'wildcard_import') {
        imports.push({
          localName: '*',
          remoteName: '*',
          resolvedUri: null,
          modulePath,
          isWildcard: true,
        });
      }
    }
  }
}
