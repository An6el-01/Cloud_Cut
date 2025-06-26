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
            
            // Use rotation-specific fallback coordinates
            const rotation = part && part.rotation ? part.rotation : 0;
            let fallbackPoint;
            
            if (rotation === 90) {
                // For 90-degree rotation, place near the right edge but with margin to ensure it fits
                // Bin bounds are (10,10) to (1010,2010), so use (900,10) to give margin
                fallbackPoint = { x: 990, y: 10 };
                console.warn(`[PLACE DEBUG] Forcibly using (900,10) as placement point for 90° rotated part (part fully inside bin)`);
            } else {
                fallbackPoint = { x: 10, y: 10 }; // Use (10,10) instead of (0,0) to stay within bin bounds
                console.warn(`[PLACE DEBUG] Forcibly using (10,10) as placement point for ${rotation}° rotated part (part fully inside bin)`);
            }
            
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
                    
                    // Use rotation-specific fallback coordinates
                    const rotation = part.rotation || 0;
                    if (rotation === 90) {
                        placementPoint = { x: 990, y: 10 };
                        console.log(`[PLACE DEBUG] Using simple fallback (990,10) for 90° rotated part ${part.id}`);
                } else {
                        placementPoint = { x: 10, y: 10 };
                        console.log(`[PLACE DEBUG] Using simple fallback (10,10) for ${rotation}° rotated part ${part.id}`);
                    }
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
                    //For rotated parts, we need to ensure the placement coordinates represent the bottom-left of the rotated part
                    if (part.rotation && part.rotation !== 0) {
                        // Calculate the bounds of the rotated part to find its bottom-left
                        const angle = part.rotation * Math.PI / 180;
                        const cos = Math.cos(angle);
                        const sin = Math.sin(angle);
                        
                        // Rotate the part polygon to find its bounds
                        const rotatedPolygon = part.polygons[0].map(pt => ({
                            x: pt.x * cos - pt.y * sin,
                            y: pt.x * sin + pt.y * cos
                        }));
                        
                        // Find the bottom-left of the rotated polygon
                        let minX = Infinity, minY = Infinity;
                        for (const pt of rotatedPolygon) {
                            minX = Math.min(minX, pt.x);
                            minY = Math.min(minY, pt.y);
                        }
                        
                        // The placement point from NFP represents where the part should be placed
                        // We need to adjust it so that the bottom-left of the rotated part is at the placement point
                        // If the rotated part's bottom-left is at (minX, minY), we need to shift by (-minX, -minY)
                        part.x = placementPoint.x - minX;
                        part.y = placementPoint.y - minY;
                        
                        console.log(`[PLACEMENT FIX] Part ${part.id} (rotation: ${part.rotation}°):`);
                        console.log(`  NFP placement point: (${placementPoint.x.toFixed(2)}, ${placementPoint.y.toFixed(2)})`);
                        console.log(`  Rotated polygon bottom-left: (${minX.toFixed(2)}, ${minY.toFixed(2)})`);
                        console.log(`  Final placement coordinates: (${part.x.toFixed(2)}, ${part.y.toFixed(2)})`);
                    } else {
                        // For non-rotated parts, use the placement point directly
                        part.x = placementPoint.x;
                        part.y = placementPoint.y;
                    }
                    
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
    
    // Track the current Y position for stacking parts
    let currentY = 10; // Start at the top with padding
    
    while (unplaced.length > 0) {
        const part = unplaced[0];
        
        // Calculate the height of the current part
        let partHeight = 0;
        if (part.polygons && part.polygons[0]) {
            const bounds = this.calculateBounds(part.polygons[0]);
            partHeight = bounds.maxY - bounds.minY;
        }
        
        // All parts are placed at 0 degrees - use simple left-side placement
        const placementPoint = { x: 10, y: currentY };
        console.log(`[PLACE DEBUG] Placing part ${part.id} at (10, ${currentY.toFixed(2)})`);
        
        // Apply the placement (no rotation calculations needed)
        part.x = placementPoint.x;
        part.y = placementPoint.y;
        part.rotation = 0; // All parts are 0 degrees
        
        // Add the part to placed list
        placed.push(part);
        placements.push({ 
                    x: part.x,
                    y: part.y,
            id: part.id, 
            rotation: 0, // All parts are 0 degrees
            polygons: part.polygons, // Include the polygons for validation
            source: part.source // Include source information
        });
        
        // Update currentY for the next part (add the height of this part plus some spacing)
        currentY += partHeight + 5; // Add 5 units of spacing between parts
        
        // Remove the part from unplaced list
        unplaced.shift();
        
        console.log(`[PLACE DEBUG] Successfully placed part ${part.id} at (${part.x.toFixed(2)}, ${part.y.toFixed(2)}), next Y position: ${currentY.toFixed(2)}`);
        }
        
        return {
        success: true,
        placements: placements,
        placementsCount: placements.length
    };
};

PlacementWorker.prototype.calculateBounds = function(polygon) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for (const pt of polygon) {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
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