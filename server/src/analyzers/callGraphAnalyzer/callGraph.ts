import { FunctionDef } from './functionExtractor';

export interface FunctionNode {
  def: FunctionDef;
  callees: Set<string>;
  callers: Set<string>;
  directPvReads: Set<string>;
  directPvWrites: Set<string>;
}

export class CallGraph {
  private functions: Map<string, FunctionNode> = new Map();
  private byName: Map<string, Set<string>> = new Map();

  static qualifiedKey(uri: string, name: string): string {
    return `${uri}#${name}`;
  }

  addFunction(def: FunctionDef): void {
    const key = CallGraph.qualifiedKey(def.uri, def.name);
    this.functions.set(key, {
      def,
      callees: new Set(),
      callers: new Set(),
      directPvReads: new Set(),
      directPvWrites: new Set(),
    });

    let nameSet = this.byName.get(def.name);
    if (!nameSet) {
      nameSet = new Set();
      this.byName.set(def.name, nameSet);
    }
    nameSet.add(key);
  }

  removeFile(uri: string): void {
    const keysToRemove: string[] = [];
    for (const [key, node] of this.functions) {
      if (node.def.uri === uri) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      const node = this.functions.get(key)!;

      // Remove this function from its callers' callee lists
      for (const callerKey of node.callers) {
        const caller = this.functions.get(callerKey);
        if (caller) caller.callees.delete(key);
      }

      // Remove this function from its callees' caller lists
      for (const calleeKey of node.callees) {
        const callee = this.functions.get(calleeKey);
        if (callee) callee.callers.delete(key);
      }

      // Remove from byName index
      const nameSet = this.byName.get(node.def.name);
      if (nameSet) {
        nameSet.delete(key);
        if (nameSet.size === 0) this.byName.delete(node.def.name);
      }

      this.functions.delete(key);
    }
  }

  addEdge(callerKey: string, calleeKey: string): void {
    const caller = this.functions.get(callerKey);
    const callee = this.functions.get(calleeKey);
    if (caller) caller.callees.add(calleeKey);
    if (callee) callee.callers.add(callerKey);
  }

  setDirectPvAccess(funcKey: string, reads: Set<string>, writes: Set<string>): void {
    const node = this.functions.get(funcKey);
    if (!node) return;
    node.directPvReads = reads;
    node.directPvWrites = writes;
  }

  getTransitivePvWrites(funcKey: string): Set<string> {
    const result = new Set<string>();
    const visited = new Set<string>();
    const queue = [funcKey];

    while (queue.length > 0) {
      const current = queue.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const node = this.functions.get(current);
      if (!node) continue;

      for (const w of node.directPvWrites) result.add(w);
      for (const callee of node.callees) queue.push(callee);
    }

    return result;
  }

  getTransitivePvReads(funcKey: string): Set<string> {
    const result = new Set<string>();
    const visited = new Set<string>();
    const queue = [funcKey];

    while (queue.length > 0) {
      const current = queue.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const node = this.functions.get(current);
      if (!node) continue;

      for (const r of node.directPvReads) result.add(r);
      for (const callee of node.callees) queue.push(callee);
    }

    return result;
  }

  getFunctionsByName(name: string): FunctionNode[] {
    const keys = this.byName.get(name);
    if (!keys) return [];
    return Array.from(keys)
      .map((k) => this.functions.get(k))
      .filter((n): n is FunctionNode => n !== undefined);
  }

  getFunction(key: string): FunctionNode | undefined {
    return this.functions.get(key);
  }

  getFunctionsInFile(uri: string): FunctionNode[] {
    const results: FunctionNode[] = [];
    for (const node of this.functions.values()) {
      if (node.def.uri === uri) results.push(node);
    }
    return results;
  }

  /** Check if any function in the entire graph transitively writes this PV key */
  hasTransitiveWrite(pvKey: string): boolean {
    for (const node of this.functions.values()) {
      if (node.directPvWrites.has(pvKey)) return true;
    }
    return false;
  }
}
