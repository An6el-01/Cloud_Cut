/**
 * Handles the placement of parts
 */

const { getOuterNfp, getInnerNfp } = require('../background');
const { GeometryUtil } = require('./geometryUtilLib');

const { GeometryUtil: OldGeometryUtil } = require("./geometryutil");

function getOrCreateNfp(A, B, config, nfpCache, type = 'outer'){
    console.log(`[NFP DEBUG] getOrCreateNfp called with:`, {
        A_id: A.id,
        B_id: B.id,
        A_rotation: A.rotation,
        B_rotation: B.rotation,
        type: type,
        A_polygons_length: A.polygons?.[0]?.length,
        B_polygons_length: B.polygons?.[0]?.length
    });

    // Validate input parts
    if (!A || !B || !A.polygons || !B.polygons || !A.polygons[0] || !B.polygons[0]) {
        console.error(`[NFP ERROR] Invalid parts provided:`, { A, B });
        return null;
    }

    // Ensure parts have required properties for caching
    if (!A.id || !B.id) {
        console.warn(`[NFP WARNING] Parts missing id property:`, { A_id: A.id, B_id: B.id });
        // Create temporary IDs if missing
        A.id = A.id || `temp_${Math.random().toString(36).substr(2, 9)}`;
        B.id = B.id || `temp_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Ensure parts have source properties for caching
    if (!A.source) {
        A.source = A.id;
    }
    if (!B.source) {
        B.source = B.id;
    }

    console.log(`[NFP DEBUG] Parts are valid, checking cache...`);

    // Check cache first using the correct interface
    const cacheKey = {
        A: A.id,
        B: B.id,
        Arotation: A.rotation,
        Brotation: B.rotation
    };
    
    if (nfpCache && nfpCache.find) {
        const cachedNfp = nfpCache.find(cacheKey, type === 'inner');
        if (cachedNfp) {
            console.log(`[NFP DEBUG] Found NFP in cache for ${A.id} vs ${B.id}`);
            return normalizeNfpFormat(cachedNfp, type);
        }
    }

    console.log(`[NFP DEBUG] NFP not in cache, calculating...`);

    // Calculate NFP
    let nfp;
    if (type === 'outer') {
        nfp = getOuterNfp(A.polygons[0], B.polygons[0], false, nfpCache);
    } else {
        nfp = getInnerNfp(A.polygons[0], B.polygons[0], config, nfpCache);
    }

    console.log(`[NFP DEBUG] Calculated NFP result:`, {
        nfp_length: nfp?.length,
        nfp_type: typeof nfp,
        is_null: nfp === null,
        is_undefined: nfp === undefined
    });

    // Normalize the NFP format before caching
    const normalizedNfp = normalizeNfpFormat(nfp, type);

    // Cache the normalized result using the correct interface
    if (nfpCache && nfpCache.insert) {
        console.log(`[NFP DEBUG] Stored NFP in cache`);
        nfpCache.insert({
            ...cacheKey,
            nfp: normalizedNfp
        }, type === 'inner');
    }

    return normalizedNfp;
}

// Helper function to normalize NFP format
function normalizeNfpFormat(nfp, type) {
    if (!nfp || nfp.length === 0) {
        return [];
    }

    console.log(`[NFP NORMALIZE] Normalizing NFP:`, {
        nfp_type: typeof nfp,
        nfp_length: nfp?.length,
        nfp_sample: nfp?.[0],
        type: type
    });

    // Handle different input formats
    let normalizedNfp;

    if (Array.isArray(nfp)) {
        if (nfp.length === 0) {
            return [];
        }

        // Check if nfp is a flat array of points
        if (nfp[0] && typeof nfp[0] === 'object' && nfp[0].x !== undefined) {
            // Flat array of points - wrap in another array
            normalizedNfp = [nfp];
        } else if (Array.isArray(nfp[0])) {
            // Already array of arrays - use as is
            normalizedNfp = nfp;
        } else {
            // Unknown format - try to handle gracefully
            console.warn(`[NFP NORMALIZE] Unknown array format:`, nfp);
            normalizedNfp = [nfp];
        }
    } else if (nfp && typeof nfp === 'object' && nfp.children) {
        // Object with children property
        normalizedNfp = Array.isArray(nfp.children) ? nfp.children : [nfp.children];
    } else {
        // Unknown format - wrap in array
        console.warn(`[NFP NORMALIZE] Unknown object format:`, nfp);
        normalizedNfp = [nfp];
    }

    // Validate the normalized result
    if (!Array.isArray(normalizedNfp)) {
        console.error(`[NFP NORMALIZE] Failed to normalize NFP:`, nfp);
        return [];
    }

    // Ensure each element is an array of points
    for (let i = 0; i < normalizedNfp.length; i++) {
        if (!Array.isArray(normalizedNfp[i])) {
            console.warn(`[NFP NORMALIZE] Element ${i} is not an array:`, normalizedNfp[i]);
            normalizedNfp[i] = [normalizedNfp[i]];
        }
    }

    console.log(`[NFP NORMALIZE] Final normalized NFP:`, {
        length: normalizedNfp.length,
        sample_element_length: normalizedNfp[0]?.length,
        sample_point: normalizedNfp[0]?.[0]
    });

    return normalizedNfp;
}

function toClipperCoordinates(polygon){
    console.log(`[CLIPPER DEBUG] toClipperCoordinates called with polygon length:`, polygon?.length);
    var clone = [];
    for (var i = 0; i < polygon.length; i++){
        clone.push({
            X: polygon[i].x,
            Y: polygon[i].y,
        });
    }
    console.log(`[CLIPPER DEBUG] Converted to Clipper coordinates:`, {
        clone_length: clone.length,
        first_point: clone[0],
        last_point: clone[clone.length - 1]
    });
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
    console.log('[PLACEMENT WORKER DEBUG] Constructor called with:', {
        binPolygon_type: typeof binPolygon,
        binPolygon_length: binPolygon?.length,
        binPolygon_isArray: Array.isArray(binPolygon),
        paths_length: paths?.length,
        config_type: typeof config,
        config_keys: config ? Object.keys(config) : 'undefined',
        nfpCache_type: typeof nfpCache
    });
    
    // Validate bin polygon
    if (!binPolygon || !Array.isArray(binPolygon) || binPolygon.length < 3) {
        throw new Error('Invalid bin polygon: must be an array of at least 3 points');
    }

    // Fix: Only wrap binPolygon if it is a flat array of points, not already an array of arrays
    this.binPolygon = {
        id: -1,
        polygons: Array.isArray(binPolygon[0]) ? binPolygon : [binPolygon],
        rotation: 0
    };
    
    this.paths = paths;
    this.ids = ids;
    this.rotations = rotations;
    this.config = config;
    this.nfpCache = nfpCache || {};
    this.polygonOffset = polygonOffset;

    // Create a fallback cache if nfpCache is not available
    if (!this.nfpCache) {
        console.warn('[PLACEMENT WORKER] No NFP cache provided, creating fallback cache');
        this.nfpCache = {
            db: {},
            find: function(key, inner) {
                const cacheKey = `${key.A}-${key.B}-${key.Arotation}-${key.Brotation}-${inner ? 'inner' : 'outer'}`;
                return this.db[cacheKey] || null;
            },
            insert: function(doc, inner) {
                if (!doc.nfp) return;
                const cacheKey = `${doc.A}-${doc.B}-${doc.Arotation}-${doc.Brotation}-${inner ? 'inner' : 'outer'}`;
                this.db[cacheKey] = doc.nfp;
            }
        };
    }

    // Helper: Intersect two sets of polygons using ClipperLib
    function intersectPolygons(a, b, scale) {
        console.log(`[INTERSECT DEBUG] intersectPolygons called with:`, {
            a_type: typeof a,
            a_length: a?.length,
            a_isArray: Array.isArray(a),
            a_sample: a?.[0],
            a_sample_type: typeof a?.[0],
            a_sample_isArray: Array.isArray(a?.[0]),
            b_type: typeof b,
            b_length: b?.length,
            b_isArray: Array.isArray(b),
            b_sample: b?.[0],
            b_sample_type: typeof b?.[0],
            b_sample_isArray: Array.isArray(b?.[0]),
            scale: scale
        });

        // a and b are arrays of polygons (arrays of points)
        const clipper = new ClipperLib.Clipper();
        const solution = new ClipperLib.Paths();
        // Convert to Clipper coordinates and scale up
        function toClipper(poly) {
            console.log(`[INTERSECT DEBUG] toClipper called with:`, {
                poly_type: typeof poly,
                poly_length: poly?.length,
                poly_isArray: Array.isArray(poly),
                poly_sample: poly?.[0],
                poly_sample_type: typeof poly?.[0]
            });
            
            if (!Array.isArray(poly)) {
                console.error(`[INTERSECT ERROR] poly is not an array:`, poly);
                throw new Error(`poly.map is not a function - poly is ${typeof poly}`);
            }
            
            return poly.map(pt => ({ X: Math.round(pt.x * scale), Y: Math.round(pt.y * scale) }));
        }
        
        // Ensure a and b are arrays of arrays (polygons)
        if (!Array.isArray(a) || !Array.isArray(b)) {
            console.error(`[INTERSECT ERROR] a or b is not an array:`, { a, b });
            throw new Error(`Expected arrays but got ${typeof a} and ${typeof b}`);
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

    // Helper: Check if a point is inside a polygon using ray casting algorithm
    function pointInPolygon(point, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            if (((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
                (point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
                inside = !inside;
            }
        }
        return inside;
    }

    // Convert pickBottomLeftPoint to a method of PlacementWorker
    // Accepts: polygons (valid region polygons), partPolygon (the part's polygon, already rotated), returns a valid placement point
    this.pickBottomLeftPoint = function(polygons, partPolygon) {
        if (!polygons || polygons.length === 0) {
            console.warn('[PLACE DEBUG] No polygons provided to pickBottomLeftPoint');
            return null;
        }

        if (!partPolygon || partPolygon.length === 0) {
            console.warn('[PLACE DEBUG] No part polygon provided to pickBottomLeftPoint');
            return null;
        }

        console.log(`[PLACE DEBUG] pickBottomLeftPoint called with ${polygons.length} polygons`);

        // Collect all points from all polygons
        let allPoints = [];
        polygons.forEach(polygon => {
            if (polygon && Array.isArray(polygon)) {
                allPoints.push(...polygon);
            }
        });

        if (allPoints.length === 0) {
            console.warn('[PLACE DEBUG] No points found in polygons');
            return null;
        }

        // Helper: Check if the translated partPolygon (placed with its bottom-left at pt) is fully inside the binPolygon
        const isPartFullyInsideBin = (pt, binPolygon) => {
            // Find the bottom-left of the partPolygon
            let minX = Infinity, minY = Infinity;
            for (const p of partPolygon) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
            }
            // Compute translation vector
            const dx = pt.x - minX;
            const dy = pt.y - minY;
            // Check all translated points
            for (const p of partPolygon) {
                const tx = p.x + dx;
                const ty = p.y + dy;
                if (!pointInPolygon({ x: tx, y: ty }, binPolygon)) {
                    return false;
                }
            }
            return true;
        };

        // Find the bottom-left point that keeps the part fully inside the binPolygon
        let best = null;
        let minX = Infinity;
        let minY = Infinity;
        const binPolygon = this.binPolygon && this.binPolygon.polygons && this.binPolygon.polygons[0] ? this.binPolygon.polygons[0] : null;
        for (const pt of allPoints) {
            if (!binPolygon || isPartFullyInsideBin(pt, binPolygon)) {
                if (pt.y < minY || (pt.y === minY && pt.x < minX)) {
                    minX = pt.x;
                    minY = pt.y;
                    best = pt;
                }
            }
        }
        if (best) {
            if (binPolygon && !isPartFullyInsideBin(best, binPolygon)) {
                console.warn(`[PLACE DEBUG] Picked point (${best.x}, ${best.y}) is not fully inside bin polygon, skipping`);
            } else {
                console.log(`[PLACE DEBUG] Picked valid point (${best.x}, ${best.y}) with part fully inside bin polygon`);
                return best;
            }
        }
        // If no valid point found, fallback to previous logic (try to find any point in bin, or (0,0))
        if (binPolygon) {
            for (const pt of allPoints) {
                if (pointInPolygon(pt, binPolygon)) {
                    if (isPartFullyInsideBin(pt, binPolygon)) {
                        console.log(`[PLACE DEBUG] Found alternative point (${pt.x}, ${pt.y}) with part fully inside bin polygon`);
                        return pt;
                    }
                }
            }
            // Try (0,0)
            const origin = { x: 0, y: 0 };
            if (isPartFullyInsideBin(origin, binPolygon)) {
                console.warn(`[PLACE DEBUG] Forcibly using (0,0) as placement point (part fully inside bin)`);
                return origin;
            }
        }
        console.warn(`[PLACE DEBUG] No valid placement point found that keeps part fully inside bin polygon, returning null`);
        return null;
    };

    function precomputeBinNfps(parts, binPolygon, rotations, config, nfpCache) {

        for (const part of parts){
            for (const rot of rotations){
                const rotatedPoly = rotatePolygon(part.polygons[0], rot);
                const partRot = {
                    ...part,
                    polygons: [rotatedPoly],
                    rotation: rot
                };
                getOrCreateNfp(
                    {
                        id: -1,
                        polygons: binPolygon.polygons,
                        rotation: 0,
                    },
                    partRot,
                    config,
                    nfpCache,
                    'outer'
                );
            }
        }
    }

    function precomputePartNfps(parts, rotations, config, nfpCache) {

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
    }

    const uniquePartsMap = new Map();
    for (const p of paths){
        if(!uniquePartsMap.has(p.sourceShapeId)){
            uniquePartsMap.set(p.sourceShapeId, p);
        }
    }
    const uniqueParts = Array.from(uniquePartsMap.values());

    precomputeBinNfps(uniqueParts, this.binPolygon, rotations, this.config, this.nfpCache);
    precomputePartNfps(uniqueParts, rotations, this.config, this.nfpCache);

    // return a placement for the paths/rotations worker
    // happens inside a webworker
    this.placePaths = function() {
        // Use the paths that were passed to the constructor
        let paths = this.paths || [];

        // Apply rotations to paths
        paths = paths.map((path, index) => ({
            ...path,
            rotation: this.rotations[index] || 0
        }));

        // Unwrap binPolygon if it's an object with a polygons property
        let binPoly = this.binPolygon;
        if (binPoly && binPoly.polygons && Array.isArray(binPoly.polygons[0])) {
            binPoly = binPoly.polygons[0];
        }

        if (!binPoly || binPoly.length === 0) {
            console.error('[PLACE ERROR] Invalid or empty binPolygon:', this.binPolygon);
            return { success: false, placements: [] };
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
            var r = {
                ...paths[i],
                polygons: [rotatePolygon(paths[i].polygons[0], paths[i].rotation)]
            };
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
            
            console.log(`[PLACE DEBUG] Attempting to place part ${part.id} (rotation: ${part.rotation})`);

            // 1. Get NFP between bin and part
            var binNfp = getOrCreateNfp(
                {
                    id: -1,
                    polygons: this.binPolygon.polygons,
                    rotation: 0,
                },
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

            console.log(`[PLACE DEBUG] Got bin NFP with ${binNfp.length} regions`);

            // Validate binNfp format
            if (!Array.isArray(binNfp)) {
                console.error(`[NFP ERROR] binNfp is not an array:`, binNfp);
                unplaced.shift();
                continue;
            }

            // 2. For each already placed part, get NFP and intersect
            let validRegion = binNfp;
            for (let j = 0; j < placed.length; j++) {
                var placedPart = placed[j];

                console.log(`[PLACE DEBUG] Checking against placed part ${placedPart.id}`);

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

                // Validate partNfp format
                if (!Array.isArray(partNfp)) {
                    console.error(`[NFP ERROR] partNfp is not an array:`, partNfp);
                    validRegion = [];
                    break;
                }

                console.log(`[PLACE DEBUG] About to call intersectPolygons with:`, {
                    validRegion_length: validRegion.length,
                    validRegion_sample: validRegion[0],
                    partNfp_length: partNfp.length,
                    partNfp_sample: partNfp[0]
                });

                try {
                    validRegion = intersectPolygons(validRegion, partNfp, scale);
                    console.log(`[PLACE DEBUG] Intersection result: ${validRegion?.length || 0} regions`);
                } catch (error) {
                    console.error(`[INTERSECT ERROR] Failed to intersect polygons:`, error);
                    console.error(`[INTERSECT ERROR] validRegion:`, validRegion);
                    console.error(`[INTERSECT ERROR] partNfp:`, partNfp);
                    validRegion = [];
                    break;
                }

                if (!validRegion || validRegion.length === 0) {
                    console.warn(`[NFP FAIL] No valid region after intersection for part ${part.id}`);
                    break;
                }
            }
            // 3. Pick a point from the valid region
            if (validRegion && validRegion.length > 0) {
                console.log(`[PLACE DEBUG] Found valid region with ${validRegion.length} polygons`);
                
                // --- Ensure validRegion is always an array of arrays of points ---
                // If validRegion is a flat array of points (i.e., first element has x/y), wrap it
                if (Array.isArray(validRegion) && validRegion.length > 0 && validRegion[0] && validRegion[0].x !== undefined) {
                    validRegion = [validRegion];
                }

                const placementPoint = this.pickBottomLeftPoint(validRegion, part.polygons[0]);
                if (placementPoint) {
                    console.log(`[PLACE DEBUG] Placed part ${part.id} at (${placementPoint.x}, ${placementPoint.y})`);
                    part.x = placementPoint.x;
                    part.y = placementPoint.y;
                    placed.push(part);
                    placements.push({ x: part.x, y: part.y, id: part.id, rotation: part.rotation });
                    unplaced.shift();
                    continue;
                } else {
                    console.warn(`[PLACE DEBUG] No placement point found for part ${part.id}`);
                }
            }
            // If we get here, could not place part
            console.warn(`[NFP PLACE FAIL] Could not place part ${part.id}`);
            unplaced.shift();
        }
        // Fitness: penalize for unplaced parts
        fitness += 2 * unplaced.length;
        
        // If no parts were placed, return failure
        if (placements.length === 0) {
            console.warn('[PLACE FAIL] No parts could be placed');
            return {
                success: false,
                placements: [],
                fitness: Number.MAX_VALUE,
                error: 'No parts could be placed'
            };
        }
        
        // Optionally, add more fitness logic here
        if (placements && placements.length > 0) {
            allplacements.push(placements);
        }
        
        // Return the full placed part objects with correct x/y/rotation
        return {
            success: true,
            placements: placed.map(part => ({
                ...part,
                x: part.x,
                y: part.y,
                rotation: part.rotation,
                id: part.id,
                polygons: part.polygons,
                source: part.source,
                children: part.children || [],
            })),
            fitness: fitness,
            paths: unplaced,
            area: binarea,
        };
    };

    // Add calculateBounds method to the internal placePaths function
    this.calculateBounds = function(polygon) {
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
}

PlacementWorker.prototype.place = function() {
    return this.placePaths();
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