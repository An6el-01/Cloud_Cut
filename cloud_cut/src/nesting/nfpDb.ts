import { Point } from './util/point';

type Nfp = Point[] & { children?: Point[][] };

export interface NfpDoc {
    A: string;
    B: string;
    Arotation: number | string;
    Brotation: number | string;
    Aflipped?: boolean;
    Bflipped?: boolean;
    nfp: Nfp | Nfp[];
}

export class NfpCache {
    private db: Record<string, Nfp | Nfp[]> = {};

    private clone(nfp: Nfp): Nfp {
        if (!Array.isArray(nfp)) {
            return nfp;
        }
        const newnfp = nfp.map(p => new Point(p.x, p.y)) as Nfp;
        if (nfp.children && nfp.children.length > 0) {
            newnfp.children = nfp.children.map(child => 
                child.map(p => new Point(p.x, p.y))
            );
        }
        return newnfp;
    }

    private cloneNfp(nfp: Nfp | Nfp[], inner?: boolean): Nfp | Nfp[] {
        if (!nfp) {
            return [] as Nfp;
        }
        if (Array.isArray(nfp) && !('children' in nfp)) {
            return nfp.map(n => this.clone(n as Nfp));
        }
        return this.clone(nfp as Nfp);
    }

    private makeKey(doc: NfpDoc, _inner?: boolean): string {
        return `${doc.A}-${doc.B}-${doc.Arotation}-${doc.Brotation}`;
    }

    has(obj: NfpDoc): boolean {
        const key = this.makeKey(obj);
        return this.db[key] !== undefined;
    }

    find(obj: NfpDoc, inner?: boolean): Nfp | Nfp[] | null {
        const key = this.makeKey(obj);
        const nfp = this.db[key];
        if (!nfp) {
            return null;
        }
        return this.cloneNfp(nfp, inner);
    }

    insert(obj: NfpDoc, inner?: boolean): void {
        if (!obj.nfp) {
            return;
        }
        const key = this.makeKey(obj);
        this.db[key] = this.cloneNfp(obj.nfp, inner);
    }

    getCache(): Record<string, Nfp | Nfp[]> {
        return this.db;
    }

    getStats(): number {
        return Object.keys(this.db).length;
    }
}