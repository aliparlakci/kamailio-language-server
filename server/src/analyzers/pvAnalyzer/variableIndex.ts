import { ParsedPv, pvIdentityKey } from './pvParser';
import { Point } from 'web-tree-sitter';

export interface PvOccurrence {
  pv: ParsedPv;
  method: string;
  isWrite: boolean;
  range: {
    startPosition: Point;
    endPosition: Point;
    startIndex: number;
    endIndex: number;
  };
}

export class VariableIndex {
  private byIdentity: Map<string, PvOccurrence[]> = new Map();
  private byPosition: PvOccurrence[] = [];

  add(occurrence: PvOccurrence): void {
    const key = pvIdentityKey(occurrence.pv);
    let list = this.byIdentity.get(key);
    if (!list) {
      list = [];
      this.byIdentity.set(key, list);
    }
    list.push(occurrence);
    this.byPosition.push(occurrence);
  }

  removeInRange(startIndex: number, endIndex: number): void {
    this.byPosition = this.byPosition.filter(
      (occ) => occ.range.endIndex <= startIndex || occ.range.startIndex >= endIndex
    );
    this.rebuildIdentityIndex();
  }

  clear(): void {
    this.byIdentity.clear();
    this.byPosition = [];
  }

  findAtOffset(offset: number): PvOccurrence | undefined {
    return this.byPosition.find(
      (occ) => offset >= occ.range.startIndex && offset < occ.range.endIndex
    );
  }

  getByIdentity(key: string): PvOccurrence[] {
    return this.byIdentity.get(key) || [];
  }

  getAllIdentities(): string[] {
    return Array.from(this.byIdentity.keys());
  }

  getAll(): PvOccurrence[] {
    return this.byPosition;
  }

  getFirstWrite(key: string): PvOccurrence | undefined {
    const list = this.byIdentity.get(key);
    if (!list) return undefined;
    return list.find((occ) => occ.isWrite);
  }

  getAllWrites(key: string): PvOccurrence[] {
    const list = this.byIdentity.get(key);
    if (!list) return [];
    return list.filter((occ) => occ.isWrite);
  }

  private rebuildIdentityIndex(): void {
    this.byIdentity.clear();
    for (const occ of this.byPosition) {
      const key = pvIdentityKey(occ.pv);
      let list = this.byIdentity.get(key);
      if (!list) {
        list = [];
        this.byIdentity.set(key, list);
      }
      list.push(occ);
    }
  }
}
