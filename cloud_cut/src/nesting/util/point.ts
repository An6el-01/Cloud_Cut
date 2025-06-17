export class Point {
    x: number;
    y: number;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    squaredDistanceTo(p: Point): number {
        const dx = this.x - p.x;
        const dy = this.y - p.y;
        return dx * dx + dy * dy;
    }

    distanceTo(p: Point): number {
        return Math.sqrt(this.squaredDistanceTo(p));
    }

    withinDistance(p: Point, distance: number): boolean {
        return this.squaredDistanceTo(p) < distance * distance;
    }

    plus(p: Point): Point {
        return new Point(this.x + p.x, this.y + p.y);
    }

    minus(p: Point): Point {
        return new Point(this.x - p.x, this.y - p.y);
    }

    times(scalar: number): Point {
        return new Point(this.x * scalar, this.y * scalar);
    }

    divide(scalar: number): Point {
        return new Point(this.x / scalar, this.y / scalar);
    }
} 