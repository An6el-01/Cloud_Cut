/**
 * Handles the placement of parts
 */

const { getOuterNfp, getInnerNfp } = require('../background');
const { GeometryUtil } = require('./geometryUtilLib');

const { GeometryUtil: OldGeometryUtil } = require("./geometryutil");

function getOrCreateNfp(A, B, config, nfpCache, type = 'outer'){
    const key = { A: A.id, B: B.id, Arotation: A.rotation, Brotation: B.rotation };

    if (!A || !A.polygons || !A.polygons[0] || A.polygons[0].length === 0 ||
        !B || !B.polygons || !B.polygons[0] || B.polygons[0].length === 0) {
        console.error('[NFP ERROR] Invalid part(s) passed to getOrCreateNfp:', {A, B});
        return [];
    }

    let nfp = nfpCache.find(key, type === 'inner' );
    if (nfp) {
        console.log(`[NFP CACHE HIT] ${type.toUpperCase()} NFP for A:${A.id} (rot:${A.rotation}) B:${B.id} (rot:${B.rotation})`);
    } else {
        console.log(`[NFP GENERATE] ${type.toUpperCase()} NFP for A:${A.id} (rot:${A.rotation}) B:${B.id} (rot:${B.rotation})`);
        nfp = type === 'outer'
            ? getOuterNfp(A.polygons[0], B.polygons[0], false, nfpCache)
            : getInnerNfp(A.polygons[0], B.polygons[0], config, nfpCache);
        nfpCache.insert({ ...key, nfp }, type === 'inner');
    }
    return nfp;
}

function toClipperCoordinates(polygon){
    var clone = {};
    for (var i = 0; i < polygon.length; i++){
        clone.push({
            X: polygon[i].x,
            Y: polygon[i].y,
        });
    }
    return clone;
}

function toNestCoordinates(polygon, scale){
    var clone = [];
    for (var i = 0; i < polygon.length; i++){
        clone.push({
            x: polygon[i].X / scale,
            y: polygon[i].Y / scale,
        });
    }
    return clone;
}

function rotatePolygon(polygon, degrees){
    var rotated = [];
    var angle = (degrees * Math.PI) / 180;
    for (var i = 0; i < polygon.length; i++){
        var x = polygon[i].x;
        var y = polygon[i].y;
        var x1 = x * Math.cos(angle) - y * Math.sin(angle);
        var y1 = x * Math.sin(angle) + y * Math.cos(angle);

        rotated.push({ x: x1, y: y1 });
    }

    if (polygon.children && polygon.children.length > 0){
        rotated.children = [];
        for (var j = 0; j < polygon.children.length; j++){
            rotated.children.push(rotatePolygon(polygon.children[j], degrees));
        }
    }

    return rotated;
}

function PlacementWorker(binPolygon, paths, ids, rotations, config, nfpCache, polygonOffset) {

    this.binPolygon = binPolygon;
    this.paths = paths;
    this.ids = ids;
    this.rotations = rotations;
    this.config = config;
    this.nfpCache = nfpCache || {};
    this.polygonOffset = polygonOffset;
    console.log('[PlacementWorker] Constructor called');
    console.log('[PlacementWorker] binPolygon:', this.binPolygon);
    console.log('[PlacementWorker] typeof polygonOffset:', typeof this.polygonOffset);
    console.log('[PlacementWorker] polygonOffset:', this.polygonOffset);
    console.log("PlacementWorker initialized with binPolygon:", this.binPolygon);
    console.log("PlacementWorker initialized with paths:", this.paths);

    // Bind methods to this instance
    this.place = this.place.bind(this);
    this.placePaths = this.placePaths.bind(this);

    // Helper: Intersect two sets of polygons using ClipperLib
    function intersectPolygons(a, b, scale) {
        // a and b are arrays of polygons (arrays of points)
        const clipper = new ClipperLib.Clipper();
        const solution = new ClipperLib.Paths();
        // Convert to Clipper coordinates and scale up
        function toClipper(poly) {
            return poly.map(pt => ({ X: Math.round(pt.x * scale), Y: Math.round(pt.y * scale) }));
        }
        const aClip = a.map(toClipper);
        const bClip = b.map(toClipper);
        clipper.AddPaths(aClip, ClipperLib.PolyType.ptSubject, true);
        clipper.AddPaths(bClip, ClipperLib.PolyType.ptClip, true);
        clipper.Execute(
            ClipperLib.ClipType.ctIntersection,
            solution,
            ClipperLib.PolyFillType.pftNonZero,
            ClipperLib.PolyFillType.pftNonZero
        );
        // Convert back to normal coordinates
        return solution.map(poly => poly.map(pt => ({ x: pt.X / scale, y: pt.Y / scale })));
    }

    // Helper: Pick the bottom-left-most point from a set of polygons
    function pickBottomLeftPoint(polygons) {
        let minX = Infinity, minY = Infinity, best = null;
        polygons.forEach(poly => {
            poly.forEach(pt => {
                if (pt.y < minY || (pt.y === minY && pt.x < minX)) {
                    minX = pt.x;
                    minY = pt.y;
                    best = pt;
                }
            });
        });
        return best;
    }

    function precomputeBinNfps(parts, binPolygon, rotations, config, nfpCache) {
        console.log(`[NFP PRECOMPUTE] Starting bin-part NFP precomputation for ${parts.length} parts and ${rotations.length} rotations.`);
        for (const part of parts){
            for (const rot of rotations){
                const rotatedPoly = rotatePolygon(part.polygons[0], rot);
                const partRot = {
                    ...part,
                    polygons: [rotatedPoly],
                    rotation: rot
                };
                getOrCreateNfp(
                    { id: -1, polygons: [binPolygon], rotation:0 },
                    partRot,
                    config,
                    nfpCache,
                    'outer'
                );
            }
        }
        console.log(`[NFP PRECOMPUTE] Finished bin-part NFP precomputation.`);
    }

    function precomputePartNfps(parts, rotations, config, nfpCache) {
        console.log(`[NFP PRECOMPUTE] Starting part-part NFP precomputation for ${parts.length} parts and ${rotations.length} rotations.`);
        for (const partA of parts){
            for (const partB of parts){
                for (const rotA of rotations){
                    for (const rotB of rotations){
                        const rotatedPolyA = rotatePolygon(partA.polygons[0], rotA);
                        const partARot = {
                            ...partA,
                            polygons: [rotatedPolyA],
                            rotation: rotA
                        };
                        const rotatedPolyB = rotatePolygon(partB.polygons[0], rotB);
                        const partBRot = {
                            ...partB,
                            polygons: [rotatedPolyB],
                            rotation: rotB
                        };
                        getOrCreateNfp(
                            partARot,
                            partBRot,
                            config,
                            nfpCache,
                            'inner'
                        );
                    }
                }
            }
        }
        console.log(`[NFP PRECOMPUTE] Finished part-part NFP precomputation.`);
    }

    const uniquePartsMap = new Map();
    for (const p of paths){
        if(!uniquePartsMap.has(p.sourceShapeId)){
            uniquePartsMap.set(p.sourceShapeId, p);
        }
    }
    const uniqueParts = Array.from(uniquePartsMap.values());
    console.log('uniqueParts', uniqueParts);
    uniqueParts.forEach((p, i) => {
        console.log(`Part ${i}:`, p, 'polygons:', p.polygons);
    })

    precomputeBinNfps(uniqueParts, this.binPolygon, rotations, this.config, this.nfpCache);
    precomputePartNfps(uniqueParts, rotations, this.config, this.nfpCache);

    // return a placement for the paths/rotations worker
    // happens inside a webworker
    this.placePaths = function(paths) {
        console.log('[PlacementWorker.placePaths] called');
        console.log('[PlacementWorker.placePaths] this.polygonOffset:', this.polygonOffset);
        if (!this.binPolygon || !Array.isArray(this.binPolygon) || this.binPolygon.length === 0) {
            console.error('[PLACE ERROR] Invalid or empty binPolygon:', this.binPolygon);
            return null;
        }
        // Validate all part polygons before placement
        for (let i = 0; i < paths.length; i++) {
            if (!paths[i].polygons || !paths[i].polygons[0] || paths[i].polygons[0].length === 0) {
                console.warn(`[PLACE WARNING] Skipping invalid or empty polygon for part ${paths[i].id}`);
                continue;
            }
        }
        if(this.binPolygon && Array.isArray(this.binPolygon)) {
            if (typeof this.polygonOffset === 'function') {
                const padded = this.polygonOffset(this.binPolygon, {x: -10, y: -10});
            if (padded && padded.length > 0) {
                    this.binPolygon = padded;
                }
            }
        }
        var i;
        // rotate paths by given rotation
        var rotated = [];
        for (i = 0; i < paths.length; i++) {
            var r = rotatePolygon(paths[i], paths[i].rotation);
            r.rotation = paths[i].rotation;
            r.source = paths[i].source;
            r.id = paths[i].id;
            rotated.push(r);
        }
        paths = rotated;
        var allplacements = [];
        var fitness = 0;
        var binarea = Math.abs(GeometryUtil.polygonArea(this.binPolygon));
        var scale = this.config.clipperScale || 10000000;
        var unplaced = paths.slice();
            var placed = [];
            var placements = [];
        while (unplaced.length > 0) {
            var part = unplaced[0];
            // 1. Get NFP between bin and part
            console.log(`[NFP USAGE] Requesting BIN NFP for part ${part.id} (rot:${part.rotation})`);
            var binNfp = getOrCreateNfp(
                { id: -1, polygons: [this.binPolygon], rotation: 0 },
                part,
                this.config,
                this.nfpCache,
                'outer'
            );
            if (!binNfp || binNfp.length === 0) {
                // Could not place this part
                console.warn(`[NFP FAIL] No bin NFP found for part ${part.id} (rot:${part.rotation})`);
                unplaced.shift();
                    continue;
                }
            // 2. For each already placed part, get NFP and intersect
            let validRegion = binNfp;
            for (let j = 0; j < placed.length; j++) {
                var placedPart = placed[j];
                console.log(`[NFP USAGE] Requesting PART NFP for placed ${placedPart.id} (rot:${placedPart.rotation}) vs part ${part.id} (rot:${part.rotation})`);
                var partNfp = getOrCreateNfp(
                    placedPart,
                    part,
                    this.config,
                    this.nfpCache,
                    'inner'
                );
                if (!partNfp || partNfp.length === 0) {
                    console.warn(`[NFP FAIL] No part NFP found for placed ${placedPart.id} (rot:${placedPart.rotation}) vs part ${part.id} (rot:${part.rotation})`);
                    validRegion = [];
                    break;
                }
                validRegion = intersectPolygons(validRegion, partNfp, scale);
                if (!validRegion || validRegion.length === 0) {
                    console.warn(`[NFP FAIL] No valid region after intersection for part ${part.id}`);
                    break;
                }
            }
            // 3. Pick a point from the valid region
            if (validRegion && validRegion.length > 0) {
                const placementPoint = pickBottomLeftPoint(validRegion);
                if (placementPoint) {
                    console.log(`[NFP PLACE] Placing part ${part.id} at (${placementPoint.x}, ${placementPoint.y})`);
                    part.x = placementPoint.x;
                    part.y = placementPoint.y;
                    placed.push(part);
                    placements.push({ x: part.x, y: part.y, id: part.id, rotation: part.rotation });
                    unplaced.shift();
                    continue;
                }
            }
            // If we get here, could not place part
            console.warn(`[NFP PLACE FAIL] Could not place part ${part.id}`);
            unplaced.shift();
        }
        // Fitness: penalize for unplaced parts
        fitness += 2 * unplaced.length;
        // Optionally, add more fitness logic here
            if (placements && placements.length > 0) {
                allplacements.push(placements);
        }
        return {
            placements: allplacements,
            fitness: fitness,
            paths: unplaced,
            area: binarea,
        };
    };
}

PlacementWorker.prototype.place = function(placement) {
    return this.placePaths(placement);
};

PlacementWorker.prototype.placePaths = function(placement) {
    try {
        // Initialize placement results
        const placements = [];
        const PADDING = 10; // 10mm padding
        let currentX = PADDING; // Start with padding
        let currentY = PADDING; // Start with padding
        let maxY = PADDING; // Start with padding

        // Place each path
        for (let i = 0; i < placement.length; i++) {
            const part = placement[i];
            const rotation = this.rotations[i] || 0;

            // Get the first polygon from the part
            const polygon = part.polygons[0];
            if (!polygon) {
                console.error('No polygon found for part:', part);
                continue;
            }

            // Rotate the polygon if needed
            const rotatedPolygon = rotation !== 0 ? rotatePolygon(polygon, rotation) : polygon;

            // Calculate polygon bounds
            const bounds = this.calculateBounds(rotatedPolygon);
            const width = bounds.maxX - bounds.minX;
            const height = bounds.maxY - bounds.minY;

            // Check if we need to move to next row
            if (currentX + width > 1000 - PADDING) { // Account for padding on right side
                currentX = PADDING; // Reset to left padding
                currentY = maxY;
            }

            // Place the polygon
            placements.push({
                x: currentX + PADDING, // Add padding and don't subtract minX
                y: currentY - bounds.minY,
                rotation: rotation,
                id: part.id,
                source: part.source
            });

            // Update positions
            currentX += width + PADDING; // Add padding between parts
            maxY = Math.max(maxY, currentY + height);
        }

        return {
            success: true,
            placements: placements,
            area: (maxY + PADDING) * 1000, // Total area used including bottom padding
            compactness: 1 - ((maxY + PADDING) * 1000) / (1000 * 1000) // Compactness score
        };
    } catch (error) {
        console.error('Error in placePaths:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

PlacementWorker.prototype.calculateBounds = function(polygon) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const point of polygon) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }

    return { minX, minY, maxX, maxY };
};

//clipperjs uses alerts for warnings
function alert(message){
    console.log("alert: ", message);
}

module.exports = {
    PlacementWorker,
    toClipperCoordinates,
    toNestCoordinates,
    rotatePolygon
};