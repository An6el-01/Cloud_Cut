/**
 * Handles the placement of parts
 */

const { getOuterNfp, getInnerNfp } = require('../background');
const { GeometryUtil } = require('./geometryUtilLib');

const { GeometryUtil: OldGeometryUtil } = require("./geometryutil");

function getOrCreateNfp(A, B, config, nfpCache, type = 'outer'){

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
            return normalizeNfpFormat(cachedNfp, type);
        }
    }
    // Calculate NFP
    let nfp;
    if (type === 'outer') {
        nfp = getOuterNfp(A.polygons[0], B.polygons[0], false, nfpCache);
    } else {
        nfp = getInnerNfp(A.polygons[0], B.polygons[0], config, nfpCache);
    }

    // Normalize the NFP format before caching
    const normalizedNfp = normalizeNfpFormat(nfp, type);

    // Cache the normalized result using the correct interface
    if (nfpCache && nfpCache.insert) {
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

    return normalizedNfp;
}

function toClipperCoordinates(polygon){
    var clone = [];
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
    
    // Debug: Log the bin polygon being used
    console.log('[PLACEMENT WORKER] Using bin polygon:', this.binPolygon.polygons[0]);
    
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

        // a and b are arrays of polygons (arrays of points)
        const clipper = new ClipperLib.Clipper();
        const solution = new ClipperLib.Paths();
        // Convert to Clipper coordinates and scale up
        function toClipper(poly) {
            
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

    // Helper: Check if a placement point is within the specified bounds
    function isPlacementPointValid(point, part, binPolygon) {
        // Define the bounds (10-990 for X, 10-1990 for Y)
        const minX = 10;
        const maxX = 990;
        const minY = 10;
        const maxY = 1990;
        
        // Check if the placement point itself is within bounds
        if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) {
            return false;
        }
        
        // Check if the entire part (when placed at this point) would be within bounds
        if (!part.polygons || !part.polygons[0]) {
            return false;
        }
        
        const rotation = part.rotation || 0;
        
        // For rotated parts, we need to calculate the actual placement coordinates
        // that represent the bottom-left of the rotated part
        let actualPlacementX = point.x;
        let actualPlacementY = point.y;
        
        if (rotation !== 0) {
            const angle = rotation * Math.PI / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            
            // Rotate the part polygon to find its bounds
            const rotatedPolygon = part.polygons[0].map(pt => ({
                x: pt.x * cos - pt.y * sin,
                y: pt.x * sin + pt.y * cos
            }));
            
            // Find the bottom-left of the rotated polygon
            let minX_rot = Infinity, minY_rot = Infinity;
            for (const pt of rotatedPolygon) {
                minX_rot = Math.min(minX_rot, pt.x);
                minY_rot = Math.min(minY_rot, pt.y);
            }
            
            // Calculate the actual placement coordinates (bottom-left of rotated part)
            actualPlacementX = point.x - minX_rot;
            actualPlacementY = point.y - minY_rot;
        }
        
        // Transform each point of the part to its final position
        const angle = rotation * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        for (const pt of part.polygons[0]) {
            const transformedX = pt.x * cos - pt.y * sin + actualPlacementX;
            const transformedY = pt.x * sin + pt.y * cos + actualPlacementY;
            
            if (transformedX < minX || transformedX > maxX || transformedY < minY || transformedY > maxY) {
                return false;
            }
        }
        
        return true;
    }

    // Convert pickBottomLeftPoint to a method of PlacementWorker
    // Accepts: polygons (valid region polygons), partPolygon (the part's polygon, already rotated), part (the part object), returns a valid placement point
    this.pickBottomLeftPoint = function(polygons, partPolygon, part) {
        if (!polygons || polygons.length === 0) {
            console.warn('[PLACE DEBUG] No polygons provided to pickBottomLeftPoint');
            return null;
        }

        if (!partPolygon || partPolygon.length === 0) {
            console.warn('[PLACE DEBUG] No part polygon provided to pickBottomLeftPoint');
            return null;
        }
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
            
            // Debug logging for fallback coordinates
            if (pt.x === 900 && pt.y === 10) {
                console.log(`[DEBUG] Checking fallback point (900,10) for part with bounds: minX=${minX.toFixed(2)}, minY=${minY.toFixed(2)}`);
                console.log(`[DEBUG] Translation vector: dx=${dx.toFixed(2)}, dy=${dy.toFixed(2)}`);
            }
            
            // Check all translated points
            for (const p of partPolygon) {
                const tx = p.x + dx;
                const ty = p.y + dy;
                if (!pointInPolygon({ x: tx, y: ty }, binPolygon)) {
                    if (pt.x === 900 && pt.y === 10) {
                        console.log(`[DEBUG] Point (${tx.toFixed(2)}, ${ty.toFixed(2)}) is outside bin polygon`);
                    }
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
                return best;
            }
        }
        // If no valid point found, fallback to previous logic (try to find any point in bin, or rotation-specific fallback)
        if (binPolygon) {
            for (const pt of allPoints) {
                if (pointInPolygon(pt, binPolygon)) {
                    if (isPartFullyInsideBin(pt, binPolygon)) {
                        return pt;
                    }
                }
            }
            
            // Use (10,10) as fallback point for all rotations (only 0 degrees now)
            let fallbackPoint;
            
            // Use (10,10) as fallback point for all rotations (only 0 degrees now)
            fallbackPoint = { x: 10, y: 10 };
                console.warn(`[PLACE DEBUG] Forcibly using (10,10) as placement point for ${rotation}° rotated part (part fully inside bin)`);
            
            if (isPartFullyInsideBin(fallbackPoint, binPolygon)) {
                return fallbackPoint;
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
            console.log(`[PLACEMENT WORKER] Rotating part ${paths[i].id} by ${paths[i].rotation}°`);
            var r = {
                ...paths[i],
                polygons: [rotatePolygon(paths[i].polygons[0], paths[i].rotation)],
                rotation: paths[i].rotation // Ensure rotation property is preserved
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

            // 1. Get NFP between bin and part
            const binNfp = getOrCreateNfp(
                this.binPolygon,
                part,
                config,
                this.nfpCache,
                'outer'
            );

            // --- DEBUG: Log NFP results ---
            console.log(`[NFP DEBUG] Part ${part.id} (rotation: ${part.rotation}°):`);
            console.log(`  Bin polygon:`, this.binPolygon.polygons[0]);
            console.log(`  Part polygon bounds:`, this.calculatePartBounds(part));
            console.log(`  Part polygon first point:`, part.polygons[0][0]);
            console.log(`  Part polygon last point:`, part.polygons[0][part.polygons[0].length - 1]);
            console.log(`  Bin NFP result:`, binNfp);

            if (!binNfp || binNfp.length === 0) {
                // Could not place this part
                unplaced.shift();
                continue;
            }

            // Validate binNfp format
            if (!Array.isArray(binNfp)) {
                unplaced.shift();
                continue;
            }

            // --- DEBUG: Log NFP coordinates ---
            if (binNfp.length > 0) {
                console.log(`  NFP has ${binNfp.length} regions`);
                for (let i = 0; i < Math.min(binNfp.length, 3); i++) {
                    const region = binNfp[i];
                    if (Array.isArray(region) && region.length > 0) {
                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                        for (const pt of region) {
                            minX = Math.min(minX, pt.x);
                            minY = Math.min(minY, pt.y);
                            maxX = Math.max(maxX, pt.x);
                            maxY = Math.max(maxY, pt.y);
                        }
                        console.log(`  NFP region ${i} bounds: (${minX.toFixed(2)}, ${minY.toFixed(2)}) to (${maxX.toFixed(2)}, ${maxY.toFixed(2)})`);
                    }
                }
            }

            // 2. For each already placed part, get NFP and intersect
            let validRegion = binNfp;
            for (let j = 0; j < placed.length; j++) {
                var placedPart = placed[j];

                var partNfp = getOrCreateNfp(
                    placedPart,
                    part,
                    this.config,
                    this.nfpCache,
                    'inner'
                );
                if (!partNfp || partNfp.length === 0) {
                    validRegion = [];
                    break;
                }

                // Validate partNfp format
                if (!Array.isArray(partNfp)) {
                    validRegion = [];
                    break;
                }
                try {
                    validRegion = intersectPolygons(validRegion, partNfp, scale);
                } catch (error) {
                    console.error(`[INTERSECT ERROR] Failed to intersect polygons:`, error);
                    console.error(`[INTERSECT ERROR] validRegion:`, validRegion);
                    console.error(`[INTERSECT ERROR] partNfp:`, partNfp);
                    validRegion = [];
                    break;
                }

                if (!validRegion || validRegion.length === 0) {
                    break;
                }
            }
            // 3. Pick a point from the valid region
            if (validRegion && validRegion.length > 0) {
                // --- Ensure validRegion is always an array of arrays of points ---
                // If validRegion is a flat array of points (i.e., first element has x/y), wrap it
                if (Array.isArray(validRegion) && validRegion.length > 0 && validRegion[0] && validRegion[0].x !== undefined) {
                    validRegion = [validRegion];
                }

                // Use pickBottomLeftPoint to select the best placement point
                let placementPoint = this.pickBottomLeftPoint(validRegion, part.polygons[0], part);
                
                // If pickBottomLeftPoint fails, use a simple fallback strategy
                if (!placementPoint) {
                    console.warn(`[PLACE DEBUG] pickBottomLeftPoint failed, using simple fallback for part ${part.id}`);
                    
                    // Use (10,10) as fallback point for all rotations (only 0 degrees now)
                        placementPoint = { x: 10, y: 10 };
                    console.log(`[PLACE DEBUG] Using simple fallback (10,10) for part ${part.id}`);
                }

                console.log(`[PLACE DEBUG] Selected placement point (${placementPoint.x.toFixed(2)}, ${placementPoint.y.toFixed(2)}) for part ${part.id}`);

                // Check for overlap with all already placed parts
                let overlaps = false;
                for (const placedPart of placed) {
                    const placedAngle = (placedPart.rotation || 0) * Math.PI / 180;
                    const placedCos = Math.cos(placedAngle);
                    const placedSin = Math.sin(placedAngle);
                    const transformedPlaced = placedPart.polygons[0].map(pt => ({
                        x: pt.x * placedCos - pt.y * placedSin + placedPart.x,
                        y: pt.x * placedSin + pt.y * placedCos + placedPart.y
                    }));

                    // Transform the new part's polygon to its intended position for overlap detection
                    const angle = (part.rotation || 0) * Math.PI / 180;
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);
                    const transformedNew = part.polygons[0].map(pt => ({
                        x: pt.x * cos - pt.y * sin + placementPoint.x,
                        y: pt.x * sin + pt.y * cos + placementPoint.y
                    }));

                    const intersection = intersectPolygons([transformedNew], [transformedPlaced], scale);
                    if (intersection && intersection.length > 0 && intersection[0].length > 0) {
                        overlaps = true;
                        break;
                    }
                }

                if (!overlaps){
                    // For 0-degree rotations, use the placement point directly
                        part.x = placementPoint.x;
                        part.y = placementPoint.y;
                    
                placed.push(part);
                    placements.push({ 
                        x: part.x, 
                        y: part.y, 
                        id: part.id, 
                        rotation: part.rotation,
                        polygons: part.polygons, // Include the polygons for validation
                        source: part.source // Include source information
                    });
                unplaced.shift();
                } else {
                    console.warn(`[PLACE DEBUG] Placement point overlaps with existing parts for ${part.id}`);
                    unplaced.shift();
            }
            } else {
                console.warn(`[PLACE DEBUG] No valid region found for part ${part.id}`);
            unplaced.shift();
            }
        }
        // Fitness: penalize for unplaced parts
        fitness += 2 * unplaced.length;
        
        // If no parts were placed, return failure
        if (placements.length === 0) {
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
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        for (const pt of polygon) {
            minX = Math.min(minX, pt.x);
            minY = Math.min(minY, pt.y);
            maxX = Math.max(maxX, pt.x);
            maxY = Math.max(maxY, pt.y);
        }

        return { minX, minY, maxX, maxY };
    };

    // Add calculatePartBounds method for debug logging
    this.calculatePartBounds = function(part) {
        if (!part.polygons || !part.polygons[0]) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }
        
        const polygon = part.polygons[0];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

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
    const placed = [];
    const placements = [];
    const unplaced = [...this.paths];
    
    // Sheet dimensions
    const maxX = 990;
    const startX = 10;
    const startY = 10;
    
    // Track rotation for each order
    const orderRotations = new Map();
    
    // 1. Sort parts by height descending
    const partsWithBounds = unplaced.map(part => {
            const bounds = this.calculateBounds(part.polygons[0]);
        return {
            part,
            bounds,
            width: bounds.maxX - bounds.minX,
            height: bounds.maxY - bounds.minY
        };
    });
    partsWithBounds.sort((a, b) => b.height - a.height);
    
    let currentX = startX;
    let currentY = startY;
    let rowAnchor = null;
    let rowIndex = 0;
    
    let i = 0;
    while (i < partsWithBounds.length) {
        let { part, bounds, width, height } = partsWithBounds[i];
        let placedThisPart = false;
        
        // Get order ID for this part
        const orderId = part.source?.orderId || part.source?.order_id || 'unknown';
        
        // Check if this order already has a set rotation
        const orderRotation = orderRotations.get(orderId);
        const isFirstPartOfOrder = orderRotation === undefined;
        
        // Determine rotations to try based on whether order has parts placed
        let tryRotations = isFirstPartOfOrder ? [0, 90] : [orderRotation];
        
        let canFitInCurrentRow = false;
        let bestFitRotation = null;
        let bestFitData = null;
        
                // First, check if the part can fit in current row with any rotation
        for (const rotation of tryRotations) {
            let testWidth, testHeight;

        if (rotation === 0) {
                testWidth = width;
                testHeight = height;
            } else if (rotation === 90) {
                testWidth = height;
                testHeight = width;
            }
            
            // Check bounds based on rotation
            let fitsInBounds = false;
            if (rotation === 90) {
                // For 90° rotation: check if x <= 990
                fitsInBounds = currentX <= 990;
            } else if (rotation === 0) {
                // For 0° rotation: check if x + width <= 990
                fitsInBounds = (currentX + width) <= 990;
            }
            
            // Check if it fits in current row
            if (fitsInBounds && currentX + testWidth <= maxX) {
                canFitInCurrentRow = true;
                bestFitRotation = rotation;
                bestFitData = { testWidth, testHeight };
                break; // Use first fitting rotation
            }
        }
        
        if (canFitInCurrentRow) {
            // Place the part with the best fitting rotation
            const rotation = bestFitRotation;
            const { testWidth, testHeight } = bestFitData;
            
            let testPolygon;
            if (rotation === 0) {
                testPolygon = part.polygons[0].map(pt => ({
                x: pt.x - bounds.minX + currentX,
                y: pt.y - bounds.minY + currentY
            }));
            } else if (rotation === 90) {
                testPolygon = rotatePolygon(part.polygons[0].map(pt => ({ x: pt.x - bounds.minX, y: pt.y - bounds.minY })), 90).map(pt => ({
                    x: pt.x + currentX,
                    y: pt.y + currentY
                }));
            }
            
            part.rotation = rotation;
            part.x = rotation === 90 ? currentX + height : currentX;
            part.y = currentY;
            part.polygons[0] = testPolygon;

            placed.push(part);
            placements.push({
                x: part.x,
                y: part.y,
                id: part.id,
                rotation: rotation,
            polygons: [testPolygon],
            source: { ...part.source, originalWidth: width, originalHeight: height }
        });

            currentX += testWidth + 5;
            placedThisPart = true;
            
            if (isFirstPartOfOrder) {
                orderRotations.set(orderId, rotation);
            }
            
            // Remove this part from the array and continue with next part
            partsWithBounds.splice(i, 1);
        } else {
            // Part doesn't fit in current row
            // Try to find other parts from different orders that might fit
            let foundAlternativePart = false;
            
            for (let j = i + 1; j < partsWithBounds.length; j++) {
                const altPart = partsWithBounds[j];
                const altOrderId = altPart.part.source?.orderId || altPart.part.source?.order_id || 'unknown';
                const altOrderRotation = orderRotations.get(altOrderId);
                const altIsFirstPartOfOrder = altOrderRotation === undefined;
                
                // Determine rotations to try for alternative part
                const altTryRotations = altIsFirstPartOfOrder ? [0, 90] : [altOrderRotation];
                
                // Check if alternative part can fit in current row
                for (const altRotation of altTryRotations) {
                    let altTestWidth;
                    
                    if (altRotation === 0) {
                        altTestWidth = altPart.width;
                    } else if (altRotation === 90) {
                        altTestWidth = altPart.height;
                    }
                    
                    // Check bounds based on rotation
                    let altFitsInBounds = false;
                    if (altRotation === 90) {
                        // For 90° rotation: check if x <= 990
                        altFitsInBounds = currentX <= 990;
                    } else if (altRotation === 0) {
                        // For 0° rotation: check if x + width <= 990
                        altFitsInBounds = (currentX + altPart.width) <= 990;
                    }
                    
                    if (altFitsInBounds && currentX + altTestWidth <= maxX) {
                        // This alternative part fits! Place it and continue
                        const altTestHeight = altRotation === 0 ? altPart.height : altPart.width;
                        
                        let altTestPolygon;
                        if (altRotation === 0) {
                            altTestPolygon = altPart.part.polygons[0].map(pt => ({
                                x: pt.x - altPart.bounds.minX + currentX,
                                y: pt.y - altPart.bounds.minY + currentY
                            }));
                        } else if (altRotation === 90) {
                            altTestPolygon = rotatePolygon(altPart.part.polygons[0].map(pt => ({ 
                                x: pt.x - altPart.bounds.minX, 
                                y: pt.y - altPart.bounds.minY 
                            })), 90).map(pt => ({
                                x: pt.x + currentX,
                                y: pt.y + currentY
                            }));
                        }
                        
                        altPart.part.rotation = altRotation;
                        altPart.part.x = altRotation === 90 ? currentX + altPart.height : currentX;
                        altPart.part.y = currentY;
                        altPart.part.polygons[0] = altTestPolygon;
                        
                        placed.push(altPart.part);
                        placements.push({
                            x: altPart.part.x,
                            y: altPart.part.y,
                            id: altPart.part.id,
                            rotation: altRotation,
                            polygons: [altTestPolygon],
                            source: { ...altPart.part.source, originalWidth: altPart.width, originalHeight: altPart.height }
                        });
                        
                        currentX += altTestWidth + 5;
                        
                        if (altIsFirstPartOfOrder) {
                            orderRotations.set(altOrderId, altRotation);
                        }
                        
                        // Remove the alternative part from the array
                        partsWithBounds.splice(j, 1);
                        foundAlternativePart = true;
                        break;
                    }
                }
                
                if (foundAlternativePart) {
                    break;
                }
            }
            
            // If we found and placed an alternative part, continue with current index
            // Otherwise, move to next part
            if (!foundAlternativePart) {
                i++;
            }
        }
    }
    
    // Handle any remaining parts that couldn't be placed in current rows
    // Start new rows as needed
    while (partsWithBounds.length > 0) {
        console.log(`[NEW ROW DEBUG] Starting new row placement process. Remaining parts: ${partsWithBounds.length}`);
        
        // --- NEXT ROW LOGIC ---
        // Find the group of placed parts with the highest y coordinate (current row)
        let maxY = -Infinity;
        for (const p of placed) {
            maxY = Math.max(maxY, p.y);
        }
        
        console.log(`[NEW ROW DEBUG] Found maxY (current row): ${maxY}`);
        
        // Get all parts at this maxY (the current row)
        const currentRowParts = placed.filter(p => p.y === maxY);
        console.log(`[NEW ROW DEBUG] Current row parts count: ${currentRowParts.length}`);
        currentRowParts.forEach((part, index) => {
            console.log(`[NEW ROW DEBUG] Current row part ${index}: ${part.id} at (${part.x}, ${part.y}) rotation: ${part.rotation}°`);
        });
        
        // For each, get the row height (0°: height, 90°: width) using original bounds
        let minRowDim = Infinity;
        let anchor = null;
        console.log(`[NEW ROW DEBUG] Calculating anchor based on row dimensions...`);
        
        for (const p of currentRowParts) {
            // Find the original bounds for this part to get the correct row dimension
            let rowDim;
            if (p.rotation === 0) {
                // For 0° rotation, row dimension is the original height
                rowDim = p.source?.originalHeight || (p.polygons[0].reduce((h, pt) => Math.max(h, pt.y), -Infinity) - p.polygons[0].reduce((h, pt) => Math.min(h, pt.y), Infinity));
            } else {
                // For 90° rotation, row dimension is the original width  
                rowDim = p.source?.originalWidth || (p.polygons[0].reduce((w, pt) => Math.max(w, pt.x), -Infinity) - p.polygons[0].reduce((w, pt) => Math.min(w, pt.x), Infinity));
            }
            
            console.log(`[NEW ROW DEBUG] Part ${p.id}: rotation=${p.rotation}°, rowDim=${rowDim}, x=${p.x}`);
            
            // Detailed anchor selection logic with debugging
            console.log(`[NEW ROW DEBUG] Comparing: rowDim=${rowDim} vs minRowDim=${minRowDim}`);
            console.log(`[NEW ROW DEBUG] Current anchor: ${anchor?.id || 'none'}`);
            
            const isSmallerRowDim = rowDim < minRowDim;
            const isSameRowDim = rowDim === minRowDim;
            const isCloserToX0 = !anchor || p.x < anchor.x;
            
            console.log(`[NEW ROW DEBUG] isSmallerRowDim: ${isSmallerRowDim}`);
            console.log(`[NEW ROW DEBUG] isSameRowDim: ${isSameRowDim}, isCloserToX0: ${isCloserToX0}`);
            
            if (isSmallerRowDim || (isSameRowDim && isCloserToX0)) {
                const reason = isSmallerRowDim ? 'smaller rowDim' : 'same rowDim but closer to x=0';
                console.log(`[NEW ROW DEBUG] ✓ NEW ANCHOR: ${p.id} (${reason})`);
                minRowDim = rowDim;
                anchor = p;
            } else {
                console.log(`[NEW ROW DEBUG] ✗ REJECTED: ${p.id}`);
            }
        }
        
        console.log(`[NEW ROW DEBUG] Selected anchor: ${anchor?.id} at (${anchor?.x}, ${anchor?.y}) with rotation ${anchor?.rotation}° and rowDim ${minRowDim}`);
        
        // Set currentX and currentY based on anchor rotation and new part rotation
        if (!anchor) {
            console.log(`[NEW ROW DEBUG] No anchor found, using fallback position`);
            currentX = startX;
            currentY = currentY + 100; // fallback if no anchor
        } else {
            // Will be set based on anchor and new part rotations below
            currentX = anchor.x;
            currentY = anchor.y;
            console.log(`[NEW ROW DEBUG] Initial coordinates from anchor: (${currentX}, ${currentY})`);
        }
        
        // Try to place the first remaining part in the new row
        const { part, bounds, width, height } = partsWithBounds[0];
        const orderId = part.source?.orderId || part.source?.order_id || 'unknown';
        const orderRotation = orderRotations.get(orderId);
        const isFirstPartOfOrder = orderRotation === undefined;
        
        console.log(`[NEW ROW DEBUG] Part to place: ${part.id} from order ${orderId}`);
        console.log(`[NEW ROW DEBUG] Part dimensions: width=${width}, height=${height}`);
        console.log(`[NEW ROW DEBUG] Order rotation: ${orderRotation}, isFirstPartOfOrder: ${isFirstPartOfOrder}`);
        
        // Determine best rotation for this part
        let bestRotation = 0;
        let bestWidth = width;
        let bestHeight = height;
        
        if (isFirstPartOfOrder) {
            // Try both rotations and pick the best fit
            if (height < width) {
                // If 90° rotation makes it narrower, prefer that
                bestRotation = 90;
                bestWidth = height;
                bestHeight = width;
            }
            console.log(`[NEW ROW DEBUG] First part of order, selected rotation: ${bestRotation}° (width=${bestWidth}, height=${bestHeight})`);
        } else {
            // Use the order's established rotation
            bestRotation = orderRotation;
            if (bestRotation === 90) {
                bestWidth = height;
                bestHeight = width;
            }
            console.log(`[NEW ROW DEBUG] Using established order rotation: ${bestRotation}° (width=${bestWidth}, height=${bestHeight})`);
        }
        
        // Calculate placement coordinates based on anchor and new part rotations
        if (anchor) {
            const anchorOriginalWidth = anchor.source?.originalWidth || 0;
            const anchorOriginalHeight = anchor.source?.originalHeight || 0;
            
            console.log(`[NEW ROW DEBUG] Anchor original dimensions: width=${anchorOriginalWidth}, height=${anchorOriginalHeight}`);
            console.log(`[NEW ROW DEBUG] Calculating new coordinates based on anchor rotation=${anchor.rotation}° and new part rotation=${bestRotation}°`);
            
            if (anchor.rotation === 0) {
                // Anchor has rotation 0
                if (bestRotation === 0) {
                    // New part rotation = 0: x = anchor.x, y = 10 + anchor.height
                    currentX = anchor.x;
                    currentY = 10 + anchorOriginalHeight;
                    console.log(`[NEW ROW DEBUG] Case: Anchor 0°, Part 0° → x=${currentX}, y=${currentY}`);
                } else if (bestRotation === 90) {
                    // New part rotation = 90: x = anchor.x + newPart.height, y = 10 + anchor.height
                    currentX = anchor.x + height;
                    currentY = 10 + anchorOriginalHeight;
                    console.log(`[NEW ROW DEBUG] Case: Anchor 0°, Part 90° → x=${currentX} (${anchor.x} + ${height}), y=${currentY}`);
                }
            } else if (anchor.rotation === 90) {
                // Anchor has rotation 90
                if (bestRotation === 0) {
                    // New part rotation = 0: x = anchor.x - anchor.height, y = 10 + anchor.width
                    currentX = anchor.x - anchorOriginalHeight;
                    currentY = 10 + anchorOriginalWidth;
                    console.log(`[NEW ROW DEBUG] Case: Anchor 90°, Part 0° → x=${currentX} (${anchor.x} - ${anchorOriginalHeight}), y=${currentY}`);
                } else if (bestRotation === 90) {
                    // New part rotation = 90: x = anchor.x, y = 10 + anchor.width
                    currentX = anchor.x;
                    currentY = 10 + anchorOriginalWidth;
                    console.log(`[NEW ROW DEBUG] Case: Anchor 90°, Part 90° → x=${currentX}, y=${currentY}`);
                }
            }
        }
        
        // Check if part fits within bounds before placing
        let canPlaceInNewRow = false;
        if (bestRotation === 90) {
            // For 90° rotation: check if x <= 990
            canPlaceInNewRow = currentX <= 990;
            console.log(`[NEW ROW DEBUG] Bounds check for 90° rotation: currentX (${currentX}) <= 990 = ${canPlaceInNewRow}`);
        } else if (bestRotation === 0) {
            // For 0° rotation: check if x + width <= 990
            canPlaceInNewRow = (currentX + width) <= 990;
            console.log(`[NEW ROW DEBUG] Bounds check for 0° rotation: currentX + width (${currentX} + ${width} = ${currentX + width}) <= 990 = ${canPlaceInNewRow}`);
        }
        
        // If part doesn't fit, skip placement (will be handled in next iteration)
        if (!canPlaceInNewRow) {
            console.log(`[NEW ROW DEBUG] Part ${part.id} doesn't fit in new row, exiting placement loop`);
            break; // Exit the new row placement loop
        }
        
        // Place the part in the new row
        let testPolygon;
        if (bestRotation === 0) {
            testPolygon = part.polygons[0].map(pt => ({
                x: pt.x - bounds.minX + currentX,
                y: pt.y - bounds.minY + currentY
            }));
            part.x = currentX;
        } else if (bestRotation === 90) {
            testPolygon = rotatePolygon(part.polygons[0].map(pt => ({ 
                x: pt.x - bounds.minX, 
                y: pt.y - bounds.minY 
            })), 90).map(pt => ({
                x: pt.x + currentX,
                y: pt.y + currentY
            }));
            part.x = currentX + height;
        }
        
                part.rotation = bestRotation;
            part.y = currentY;
        part.polygons[0] = testPolygon;

        console.log(`[NEW ROW DEBUG] Final part placement: ${part.id} at (${part.x}, ${part.y}) with rotation ${part.rotation}°`);

            placed.push(part);
            placements.push({
                x: part.x,
                y: part.y,
                id: part.id,
            rotation: bestRotation,
            polygons: [testPolygon],
            source: { ...part.source, originalWidth: width, originalHeight: height }
        });

        currentX += bestWidth + 5;
        console.log(`[NEW ROW DEBUG] Updated currentX for next part: ${currentX} (added ${bestWidth} + 5)`);
        
        if (isFirstPartOfOrder) {
            orderRotations.set(orderId, bestRotation);
            console.log(`[NEW ROW DEBUG] Set order ${orderId} rotation to ${bestRotation}°`);
        }
        
        // Remove the placed part
        partsWithBounds.shift();
        console.log(`[NEW ROW DEBUG] Removed placed part, remaining parts: ${partsWithBounds.length}`);
        console.log(`[NEW ROW DEBUG] ================================`);
        
        // Continue placing parts in this new row
        let newRowIndex = 0;
        while (newRowIndex < partsWithBounds.length) {
            const { part: nextPart, bounds: nextBounds, width: nextWidth, height: nextHeight } = partsWithBounds[newRowIndex];
            const nextOrderId = nextPart.source?.orderId || nextPart.source?.order_id || 'unknown';
            const nextOrderRotation = orderRotations.get(nextOrderId);
            const nextIsFirstPartOfOrder = nextOrderRotation === undefined;
            
            let canFitInNewRow = false;
            let newRowBestRotation = null;
            let newRowBestWidth = null;
            
            // Determine rotations to try
            const newRowTryRotations = nextIsFirstPartOfOrder ? [0, 90] : [nextOrderRotation];
            
            for (const rotation of newRowTryRotations) {
                const testWidth = rotation === 0 ? nextWidth : nextHeight;
                
                // Check bounds based on rotation
                let fitsInBounds = false;
                if (rotation === 90) {
                    // For 90° rotation: check if x <= 990
                    fitsInBounds = currentX <= 990;
                } else if (rotation === 0) {
                    // For 0° rotation: check if x + width <= 990
                    fitsInBounds = (currentX + nextWidth) <= 990;
                }
                
                if (fitsInBounds && currentX + testWidth <= maxX) {
                    canFitInNewRow = true;
                    newRowBestRotation = rotation;
                    newRowBestWidth = testWidth;
                    break;
                }
            }
            
            if (canFitInNewRow) {
                // Place this part in the new row
                const testHeight = newRowBestRotation === 0 ? nextHeight : nextWidth;
                
                let nextTestPolygon;
                if (newRowBestRotation === 0) {
                    nextTestPolygon = nextPart.polygons[0].map(pt => ({
                        x: pt.x - nextBounds.minX + currentX,
                        y: pt.y - nextBounds.minY + currentY
                    }));
                    nextPart.x = currentX;
                } else if (newRowBestRotation === 90) {
                    nextTestPolygon = rotatePolygon(nextPart.polygons[0].map(pt => ({ 
                        x: pt.x - nextBounds.minX, 
                        y: pt.y - nextBounds.minY 
                    })), 90).map(pt => ({
                        x: pt.x + currentX,
                        y: pt.y + currentY
                    }));
                    nextPart.x = currentX + nextHeight;
                }
                
                nextPart.rotation = newRowBestRotation;
                nextPart.y = currentY;
                nextPart.polygons[0] = nextTestPolygon;
                
                placed.push(nextPart);
                placements.push({
                    x: nextPart.x,
                    y: nextPart.y,
                    id: nextPart.id,
                    rotation: newRowBestRotation,
                    polygons: [nextTestPolygon],
                    source: { ...nextPart.source, originalWidth: nextWidth, originalHeight: nextHeight }
                });
                
                currentX += newRowBestWidth + 5;
                
                if (nextIsFirstPartOfOrder) {
                    orderRotations.set(nextOrderId, newRowBestRotation);
                }
                
                // Remove the placed part
                partsWithBounds.splice(newRowIndex, 1);
            } else {
                // This part doesn't fit, try next part
                newRowIndex++;
            }
        }
    }
    // Fitness: penalize for unplaced parts
    const fitness = (partsWithBounds.length - placed.length) * 1000;
    return {
        success: placed.length > 0,
        placements: placements,
        placementsCount: placements.length,
        fitness: fitness,
        unplaced: partsWithBounds.length - placed.length
    };
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