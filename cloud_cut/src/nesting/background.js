'use strict';

const { NfpCache } = require('./nfpDb');
let ClipperLib;
if (typeof window !== 'undefined') {
  ClipperLib = require('./util/clipperLib');
}
const { GeometryUtil } = require('./util/geometryUtilLib');

function toClipperCoordinates(polygon){
    var clone = [];
    for (let i = 0; i < polygon.length; i++){
        clone.push({
            X: polygon[i].x,
            Y: polygon[i].y
        });
    }
    return clone;
};

function toNestCoordinates(polygon, scale){
    var clone = [];
    for (let i = 0; i < polygon.length; i++){
        clone.push({
            x: polygon[i].X / scale,
            y: polygon[i].Y / scale
        });
    }
    return clone;
}

//helper function to analyze sheet holes
function analyzeSheetHoles(sheets){
    const allHoles = [];
    let totalHoleArea = 0;

    //Analyze each sheet
    for (let i = 0; i < sheets.length; i++){
        const sheet = sheets[i];
        if (sheet.children && sheet.children.length > 0){
            for (let j = 0; j < sheet.children.length; j++){
                const hole = sheet.children[j];
                const holeArea = Math.abs(GeometryUtil.polygonArea(hole));
                const holeBounds = GeometryUtil.getPolygonBounds(hole);

                const holeInfo ={
                    sheetIndex: i,
                    holeIndex: j,
                    area: holeArea,
                    width: holeBounds.width,
                    height: holeBounds.height,
                    isWide: holeBounds.width > holeBounds.height
                };

                allHoles.push(holeInfo);
                totalHoleArea += holeArea;
            }
        }
    }

    // Calculate statistics about holes
    const averageHoleArea = allHoles.length > 0 ? totalHoleArea / allHoles.length : 0;

    return{
        holes: allHoles,
        totalHoleArea: totalHoleArea,
        averageHoleArea: averageHoleArea,
        count: allHoles.length
    };
}

function getFrame(polygon) {
    // Get the bounding box of the polygon
    const bounds = GeometryUtil.getPolygonBounds(polygon);
    
    // Create a rectangular frame around the polygon
    return [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height }
    ];
}

function getOuterNfp(A, B, inside, nfpCache) {
    console.log(`[OUTER NFP DEBUG] getOuterNfp called with:`, {
        A_length: A?.length,
        B_length: B?.length,
        inside: inside,
        A_has_children: !!(A?.children && A.children.length > 0),
        B_has_children: !!(B?.children && B.children.length > 0)
    });

    // try the file cache if the calculation will take a long time
    if (nfpCache) {
        var doc = nfpCache.find({ A: A.source, B: B.source, Arotation: A.rotation, Brotation: B.rotation });

        if(doc){
            console.log(`[OUTER NFP DEBUG] Found NFP in file cache`);
            return doc;
        }
    }

    // not found in cache
    if(inside || (A.children && A.children.length > 0)){
        console.log(`[OUTER NFP DEBUG] Using ClipperLib for inside/complex polygons`);
        if(!A.children){
            A.children = [];
        }
        if(!B.children){
            B.children = [];
        }

        // For inside or complex polygons, use ClipperLib directly
        var Ac = toClipperCoordinates(A);
        console.log(`[OUTER NFP DEBUG] A converted to Clipper coordinates:`, {
            Ac_length: Ac?.length,
            Ac_first_point: Ac?.[0],
            Ac_last_point: Ac?.[Ac?.length - 1]
        });
        
        ClipperLib.JS.ScaleUpPath(Ac, 10000000);
        var Bc = toClipperCoordinates(B);
        console.log(`[OUTER NFP DEBUG] B converted to Clipper coordinates:`, {
            Bc_length: Bc?.length,
            Bc_first_point: Bc?.[0],
            Bc_last_point: Bc?.[Bc?.length - 1]
        });
        
        ClipperLib.JS.ScaleUpPath(Bc, 10000000);
        for(let i = 0; i < Bc.length; i++){
            Bc[i].X *= -1;
            Bc[i].Y *= -1;
        }
        
        console.log(`[OUTER NFP DEBUG] Calling ClipperLib.Clipper.MinkowskiSum...`);
        var solution = ClipperLib.Clipper.MinkowskiSum(Ac, Bc, true);
        console.log(`[OUTER NFP DEBUG] MinkowskiSum result:`, {
            solution_length: solution?.length,
            solution_type: typeof solution
        });

        var clipperNfp;
        var largestArea = null;
        for(let i = 0; i < solution.length; i++){
            var n = toNestCoordinates(solution[i], 10000000);
            var sarea = -GeometryUtil.polygonArea(n);
            if (largestArea === null || largestArea < sarea){
                clipperNfp = n;
                largestArea = sarea;
            }
        }

        console.log(`[OUTER NFP DEBUG] Selected NFP from solution:`, {
            clipperNfp_length: clipperNfp?.length,
            largestArea: largestArea
        });

        if (!clipperNfp) {
            console.error(`[OUTER NFP DEBUG] No valid NFP found in solution`);
            return null;
        }

        for(let i = 0; i < clipperNfp.length; i++){
            clipperNfp[i].x += B[0].x;
            clipperNfp[i].y += B[0].y;
        }

        var nfp = [clipperNfp];
    }
    else{
        console.log(`[OUTER NFP DEBUG] Using ClipperLib for simple polygons`);
        var Ac = toClipperCoordinates(A);
        console.log(`[OUTER NFP DEBUG] A converted to Clipper coordinates:`, {
            Ac_length: Ac?.length,
            Ac_first_point: Ac?.[0]
        });
        
        ClipperLib.JS.ScaleUpPath(Ac, 10000000);
        var Bc = toClipperCoordinates(B);
        console.log(`[OUTER NFP DEBUG] B converted to Clipper coordinates:`, {
            Bc_length: Bc?.length,
            Bc_first_point: Bc?.[0]
        });
        
        ClipperLib.JS.ScaleUpPath(Bc, 10000000);
        for(let i = 0; i < Bc.length; i++){
            Bc[i].X *= -1;
            Bc[i].Y *= -1;
        }
        
        console.log(`[OUTER NFP DEBUG] Calling ClipperLib.Clipper.MinkowskiSum...`);
        var solution = ClipperLib.Clipper.MinkowskiSum(Ac, Bc, true);
        console.log(`[OUTER NFP DEBUG] MinkowskiSum result:`, {
            solution_length: solution?.length,
            solution_type: typeof solution
        });

        var clipperNfp;
        var largestArea = null;
        for(let i = 0; i < solution.length; i++){
            var n = toNestCoordinates(solution[i], 10000000);
            var sarea = -GeometryUtil.polygonArea(n);
            if (largestArea === null || largestArea < sarea){
                clipperNfp = n;
                largestArea = sarea;
            }
        }

        console.log(`[OUTER NFP DEBUG] Selected NFP from solution:`, {
            clipperNfp_length: clipperNfp?.length,
            largestArea: largestArea
        });

        if (!clipperNfp) {
            console.error(`[OUTER NFP DEBUG] No valid NFP found in solution`);
            return null;
        }

        for(let i = 0; i < clipperNfp.length; i++){
            clipperNfp[i].x += B[0].x;
            clipperNfp[i].y += B[0].y;
        }

        var nfp = [clipperNfp];
    }

    console.log(`[OUTER NFP DEBUG] Final NFP before processing:`, {
        nfp_length: nfp?.length,
        nfp_type: typeof nfp
    });

    if(!nfp || nfp.length == 0){
        console.error(`[OUTER NFP DEBUG] NFP is empty or null`);
        return null;
    }

    nfp = nfp.pop();

    console.log(`[OUTER NFP DEBUG] Final NFP after pop:`, {
        nfp_length: nfp?.length,
        nfp_type: typeof nfp
    });

    if (!nfp || nfp.length == 0){
        console.error(`[OUTER NFP DEBUG] Final NFP is empty or null`);
        return null;
    }

    if (!inside && typeof A.source !== 'undefined' && typeof B.source !== 'undefined' && nfpCache){
        var doc = {
            A: A.source,
            B: B.source,
            Arotation: A.rotation,
            Brotation: B.rotation,
            nfp: nfp
        };
        nfpCache.insert(doc);
        console.log(`[OUTER NFP DEBUG] Stored NFP in file cache`);
    }
    
    console.log(`[OUTER NFP DEBUG] Returning NFP with ${nfp.length} points`);
    return nfp;
}

function innerNfpToClipperCoordinates(nfp, config) {
    var clipperNfp = [];
    for (let i = 0; i < nfp.length; i++) {
        var path = toClipperCoordinates(nfp[i]);
        ClipperLib.JS.ScaleUpPath(path, config.clipperScale);
        clipperNfp.push(path);
    }
    return clipperNfp;
}

function getInnerNfp(A, B, config, nfpCache){

    if (typeof GeometryUtil !== 'undefined') {

  }
  
    if(typeof A.source !== 'undefined' && typeof B.source !== 'undefined' && nfpCache){
        var doc = nfpCache.find({ A: A.source, B: B.source, Arotation: 0, Brotation: B.rotation }, true);

        if(doc){
            return doc;
        }
    }

    // --- DEBUG: Check winding and closure ---
    function isClosed(polygon) {
        return polygon.length > 2 && (polygon[0].x === polygon[polygon.length-1].x && polygon[0].y === polygon[polygon.length-1].y);
    }
    function ensureCCW(polygon) {
        if (GeometryUtil.polygonArea(polygon) < 0) {
            return polygon.slice().reverse();
        }
        return polygon;
    }
    function closePolygon(polygon) {
        if (polygon.length > 2 && (polygon[0].x !== polygon[polygon.length-1].x || polygon[0].y !== polygon[polygon.length-1].y)) {
            return polygon.concat([polygon[0]]);
        }
        return polygon;
    }

    // --- Force winding and closure ---
    A = ensureCCW(closePolygon(A));
    B = ensureCCW(closePolygon(B));


    // --- DEBUG: Check for duplicate points ---
    function hasDuplicatePoints(polygon) {
        const seen = new Set();
        for (const pt of polygon) {
            const key = `${pt.x.toFixed(6)},${pt.y.toFixed(6)}`;
            if (seen.has(key)) return true;
            seen.add(key);
        }
        return false;
    }


    // --- DEBUG: Check for self-intersections ---
    function segmentsIntersect(a1, a2, b1, b2) {
        function ccw(p1, p2, p3) {
            return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
        }
        return (ccw(a1, b1, b2) !== ccw(a2, b1, b2)) && (ccw(a1, a2, b1) !== ccw(a1, a2, b2));
    }
    function hasSelfIntersection(polygon) {
        for (let i = 0; i < polygon.length; i++) {
            const a1 = polygon[i];
            const a2 = polygon[(i + 1) % polygon.length];
            for (let j = i + 1; j < polygon.length; j++) {
                const b1 = polygon[j];
                const b2 = polygon[(j + 1) % polygon.length];
                // Skip adjacent segments
                if (Math.abs(i - j) <= 1 || (i === 0 && j === polygon.length - 1) || (j === 0 && i === polygon.length - 1)) continue;
                if (segmentsIntersect(a1, a2, b1, b2)) return true;
            }
        }
        return false;
    }


    var frame = getFrame(A);

    var nfp = getOuterNfp(frame, B, true, nfpCache);

    console.log(`[INNER NFP DEBUG] getOuterNfp returned:`, {
        nfp_type: typeof nfp,
        nfp_length: nfp?.length,
        has_children: !!(nfp?.children),
        children_length: nfp?.children?.length
    });

    if(!nfp || nfp.length == 0){
        console.log(`[INNER NFP DEBUG] NFP is null or empty, returning null`);
        return null;
    }

    // Handle both flat array and object with children
    var nfpArray = Array.isArray(nfp) ? nfp : (nfp.children || [nfp]);

    console.log(`[INNER NFP DEBUG] Processed NFP array:`, {
        nfpArray_length: nfpArray.length,
        nfpArray_type: typeof nfpArray
    });

    var holes = [];
    if (A.children && A.children.length > 0){
        for(let i = 0; i < A.children.length; i++){
            var hnfp = getOuterNfp(A.children[i], B, false, nfpCache);
            if(hnfp) {
                holes.push(hnfp);
            }
        }
    }

    if(holes.length == 0){
        console.log(`[INNER NFP DEBUG] No holes, returning NFP array wrapped in array`);
        // Return as array of arrays (polygons) as expected by intersectPolygons
        // Ensure nfpArray is properly formatted as an array of arrays
        if (Array.isArray(nfpArray) && nfpArray.length > 0) {
            // If nfpArray is a flat array of points, wrap it in another array
            if (nfpArray[0] && typeof nfpArray[0] === 'object' && nfpArray[0].x !== undefined) {
                return [nfpArray];
            }
            // If nfpArray is already an array of arrays, return as is
            return nfpArray;
        }
        return [];
    }

    var clipperNfp = innerNfpToClipperCoordinates(nfpArray, config);
    var clipperHoles = innerNfpToClipperCoordinates(holes, config);

    var finalNfp = new ClipperLib.Paths();
    var clipper = new ClipperLib.Clipper();

    clipper.AddPaths(clipperHoles, ClipperLib.PolyType.ptClip, true);
    clipper.AddPaths(clipperNfp, ClipperLib.PolyType.ptSubject, true);

    if (!clipper.Execute(ClipperLib.ClipType.ctDifference, finalNfp, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)){
        console.log(`[INNER NFP DEBUG] Clipper operation failed, returning original NFP array`);
        return nfpArray;
    }

    if (finalNfp.length == 0){
        console.log(`[INNER NFP DEBUG] Final NFP is empty, returning null`);
        return null;
    }

    var f =[];

    for(let i = 0; i < finalNfp.length; i++){
        f.push(toNestCoordinates(finalNfp[i], config.clipperScale));
    }

    if (typeof A.source !== 'undefined' && typeof B.source !== 'undefined' && nfpCache){
        var doc = {
            A: A.source,
            B: B.source,
            Arotation: 0,
            Brotation: B.rotation,
            nfp: f
        };
        nfpCache.insert(doc, true);
    }
    
    console.log(`[INNER NFP DEBUG] Returning final NFP with ${f.length} polygons`);
    return f;
}


// helper function to analyze parts, their holes and potential fits
function analyzeParts(parts, averageHoleArea, config){
    const mainParts = [];
    const holeCandidates = [];
    const partsWithHoles = [];

    // First pass: identify parts with holes
    for (let i = 0; i < parts.length; i++){
        if(parts[i].children && parts[i].children.length > 0){
            const partHoles = [];
            for (let j = 0; j < parts[i].children.length; j++){
                const hole = parts[i].children[j];
                const holeArea = Math.abs(GeometryUtil.polygonArea(hole));
                const holeBounds = GeometryUtil.getPolygonBounds(hole);

                partHoles.push({
                    holeIndex: j,
                    area: holeArea,
                    width: holeBounds.width,
                    height: holeBounds.height,
                    isWid: holeBounds.width > holeBounds.height
                });
            }

            if (partHoles.length > 0){
                parts[i].analyzedHoles = partHoles;
                partsWithHoles.push(parts[i]);
            }
        }

        //Calculate and store the part's dimensions for later use
        const partBounds = GeometryUtil.getPolygonBounds(parts[i]);
        parts[i].bounds = {
            width: partBounds.width,
            height: partBounds.height,
            area: Math.abs(GeometryUtil.polygonArea(parts[i]))
        };
    }

    for (let i = 0; i < parts.length; i++){
        const part = parts[i];
        const partMatches = [];

        //Check if this part fits into holes of other parts
        for(let j = 0; j < partsWithHoles.length; j++){
            const partWithHoles = partsWithHoles[j];
            if (part.id === partWithHoles.id) continue; // skip self

            for (let k = 0; k < partWithHoles.analyzedHoles.length; k++){
                const hole = partWithHoles.analyzedHoles[k];

                //Check if part fits in this hole (with or without rotation)
                const fitsNormally = part.bounds.width < hole.width * 0.98 && part.bounds.height < hole.height * 0.98 && part.bounds.area < hole.area * 0.95;

                const fitsRotated = part.bounds.height < hole.width * 0.98 && part.bounds.width < hole.height * 0.98 && part.bounds.area < hole.area * 0.95;

                if (fitsNormally || fitsRotated){
                    partMatches.push({
                        partId: partWithHoles.id,
                        holeIndex: k,
                        requiresRotation: !fitsNormally && fitsRotated,
                        fitRatio: part.bounds.area / hole.area
                    });
                }
            }
        }

        // Determine if part is a hole candidate
        const isSmallEnough = part.bounds.area < config.holeAreaThreshold || part.bounds.area < averageHoleArea * 0.7;

        if (partMatches.length > 0 || isSmallEnough){
            part.holeMatches = partMatches;
            part.isHoleFitCandidate = true;
            holeCandidates.push(part);
        } else{
            mainParts.push(part);
        }
    }

    // Prioritize order of main parts - parts with holes that others fit into go first
    mainParts.sort((a, b) => {
        const aHasMatches = holeCandidates.some(p => p.holeMatches && p.holeMatches.some(match => match.partId === a.id));

        const bHasMatches = holeCandidates.some(p => p.holeMatches && p.holeMatches.some(match => match.partId === b.id));

        //First priority: parts with holes that other parts fit into
        if (aHasMatches && !bHasMatches) return -1;
        if (!aHasMatches && bHasMatches) return 1;

        //Second priority: larger parts first
        return b.bounds.area - a.bounds.area;
    });

    // For hole candidates, prioritize parts that fit into holes of parts in mainParts
    holeCandidates.sort((a, b) => {
        const aFitsInMainPart = a.holeMatches && a.holeMatches.some(match => mainParts.some(mp => mp.id === match.partId));

        const bFitsInMainPart = b.holeMatches && b.holeMatches.some(match => mainParts.some(mp => mp.id === match.partId));

        //Priority to parts that fit into holes of main parts
        if(aFitsInMainPart && !bFitsInMainPart) return -1;
        if(!aFitsInMainPart && bFitsInMainPart) return 1;

        // Then by number of matches
        const aMatchCount = a.holeMatches ? a.holeMatches.length : 0;
        const bMatchCount = b.holeMatches ? b.holeMatches.length : 0;
        if(aMatchCount !== bMatchCount) return bMatchCount - aMatchCount;

        // Then by size (smaller first for hole candidates)
        return a.bounds.area - b.bounds.area;
    });

    return { mainParts, holeCandidates };
}


//Figure out how to leverage this function for placing parts.
function placeParts(sheets, parts, config, nestindex) {
    if (!sheets) {
      return null;
    }
  
    var i, j, k, m, n, part;
  
    var totalnum = parts.length;
    var totalsheetarea = 0;
  
    // total length of merged lines
    var totalMerged = 0;
  
    // rotate paths by given rotation
    var rotated = [];
    for (let i = 0; i < parts.length; i++) {
      var r = rotatePolygon(parts[i], parts[i].rotation);
      r.rotation = parts[i].rotation;
      r.source = parts[i].source;
      r.id = parts[i].id;
      r.filename = parts[i].filename;
  
      rotated.push(r);
    }
  
    parts = rotated;
  
    // Set default holeAreaThreshold if not defined
    if (!config.holeAreaThreshold) {
      config.holeAreaThreshold = 1000; // Default value, adjust as needed
    }
  
    // Pre-analyze holes in all sheets
    const sheetHoleAnalysis = analyzeSheetHoles(sheets);
  
    // Analyze all parts to identify those with holes and potential fits
    const { mainParts, holeCandidates } = analyzeParts(parts, sheetHoleAnalysis.averageHoleArea, config);
  
    // console.log(`Analyzed parts: ${mainParts.length} main parts, ${holeCandidates.length} hole candidates`);
  
    var allplacements = [];
    var fitness = 0;
  
    // Now continue with the original placeParts logic, but use our sorted parts
  
    // Combine main parts and hole candidates back into a single array
    // mainParts first since we want to place them first
    parts = [...mainParts, ...holeCandidates];
  
    // Continue with the original placeParts logic
    // var binarea = Math.abs(GeometryUtil.polygonArea(self.binPolygon));
    var key, nfp;
    var part;
  
    while (parts.length > 0) {
  
      var placed = [];
      var placements = [];
  
      // open a new sheet
      var sheet = sheets.shift();
      var sheetarea = Math.abs(GeometryUtil.polygonArea(sheet));
      totalsheetarea += sheetarea;
  
      fitness += sheetarea; // add 1 for each new sheet opened (lower fitness is better)
  
      var clipCache = [];
      //console.log('new sheet');
      for (let i = 0; i < parts.length; i++) {
        // console.time('placement');
        part = parts[i];
  
        // inner NFP
        var sheetNfp = null;
        // try all possible rotations until it fits
        // (only do this for the first part of each sheet, to ensure that all parts that can be placed are, even if we have to to open a lot of sheets)
        for (let j = 0; j < config.rotations; j++) {
          sheetNfp = getInnerNfp(sheet, part, config, NfpCache);
  
          if (sheetNfp) {
            break;
          }
  
          var r = rotatePolygon(part, 360 / config.rotations);
          r.rotation = part.rotation + (360 / config.rotations);
          r.source = part.source;
          r.id = part.id;
          r.filename = part.filename
  
          // rotation is not in-place
          part = r;
          parts[i] = r;
  
          if (part.rotation > 360) {
            part.rotation = part.rotation % 360;
          }
        }
        // part unplaceable, skip
        if (!sheetNfp || sheetNfp.length == 0) {
          continue;
        }
  
        var position = null;
  
        if (placed.length == 0) {
          // first placement, put it on the top left corner
          for (let j = 0; j < sheetNfp.length; j++) {
            for (let k = 0; k < sheetNfp[j].length; k++) {
              if (position === null || sheetNfp[j][k].x - part[0].x < position.x || (GeometryUtil.almostEqual(sheetNfp[j][k].x - part[0].x, position.x) && sheetNfp[j][k].y - part[0].y < position.y)) {
                position = {
                  x: sheetNfp[j][k].x - part[0].x,
                  y: sheetNfp[j][k].y - part[0].y,
                  id: part.id,
                  rotation: part.rotation,
                  source: part.source,
                  filename: part.filename
                }
              }
            }
          }
          if (position === null) {
            // console.log(sheetNfp);
          }
          placements.push(position);
          placed.push(part);
  
          continue;
        }
  
        // Check for holes in already placed parts where this part might fit
        var holePositions = [];
        try {
          // Track the best rotation for each hole
          const holeOptimalRotations = new Map(); // Map of "parentIndex_holeIndex" -> best rotation
  
          for (let j = 0; j < placed.length; j++) {
            if (placed[j].children && placed[j].children.length > 0) {
              for (let k = 0; k < placed[j].children.length; k++) {
                // Check if the hole is large enough for the part
                var childHole = placed[j].children[k];
                var childArea = Math.abs(GeometryUtil.polygonArea(childHole));
                var partArea = Math.abs(GeometryUtil.polygonArea(part));
  
                // Only consider holes that are larger than the part
                if (childArea > partArea * 1) { // Multiply by 1.1 for 10% buffer for placement
                  try {
                    var holePoly = [];
                    // Create proper array structure for the hole polygon
                    for (let p = 0; p < childHole.length; p++) {
                      holePoly.push({
                        x: childHole[p].x,
                        y: childHole[p].y,
                        exact: childHole[p].exact || false
                      });
                    }
  
                    // Add polygon metadata
                    holePoly.source = placed[j].source + "_hole_" + k;
                    holePoly.rotation = 0;
                    holePoly.children = [];
  
  
                    // Get dimensions of the hole and part to match orientations
                    const holeBounds = GeometryUtil.getPolygonBounds(holePoly);
                    const partBounds = GeometryUtil.getPolygonBounds(part);
  
                    // Determine if the hole is wider than it is tall
                    const holeIsWide = holeBounds.width > holeBounds.height;
                    const partIsWide = partBounds.width > partBounds.height;
  
  
                    // Try part with current rotation
                    let bestRotationNfp = null;
                    let bestRotation = part.rotation;
                    let bestFitFill = 0;
                    let rotationPlacements = [];
  
                    // Try original rotation
                    var holeNfp = getInnerNfp(holePoly, part, config, NfpCache);
                    if (holeNfp && holeNfp.length > 0) {
                      bestRotationNfp = holeNfp;
                      bestFitFill = partArea / childArea;
  
                      for (let m = 0; m < holeNfp.length; m++) {
                        for (let n = 0; n < holeNfp[m].length; n++) {
                          rotationPlacements.push({
                            x: holeNfp[m][n].x - part[0].x + placements[j].x,
                            y: holeNfp[m][n].y - part[0].y + placements[j].y,
                            rotation: part.rotation,
                            orientationMatched: (holeIsWide === partIsWide),
                            fillRatio: bestFitFill
                          });
                        }
                      }
                    }
  
                    // Try up to 4 different rotations to find the best fit for this hole
                    const rotationsToTry = [90, 180, 270];
                    for (let rot of rotationsToTry) {
                      let newRotation = (part.rotation + rot) % 360;
                      const rotatedPart = rotatePolygon(part, newRotation);
                      rotatedPart.rotation = newRotation;
                      rotatedPart.source = part.source;
                      rotatedPart.id = part.id;
                      rotatedPart.filename = part.filename;
  
                      const rotatedBounds = GeometryUtil.getPolygonBounds(rotatedPart);
                      const rotatedIsWide = rotatedBounds.width > rotatedBounds.height;
                      const rotatedNfp = getInnerNfp(holePoly, rotatedPart, config, NfpCache);
  
                      if (rotatedNfp && rotatedNfp.length > 0) {
                        // Calculate fill ratio for this rotation
                        const rotatedFill = partArea / childArea;
  
                        // If this rotation has better orientation match or is the first valid one
                        if ((holeIsWide === rotatedIsWide && (bestRotationNfp === null || !(holeIsWide === partIsWide))) ||
                          (bestRotationNfp === null)) {
                          bestRotationNfp = rotatedNfp;
                          bestRotation = newRotation;
                          bestFitFill = rotatedFill;
  
                          // Clear previous placements for worse rotations
                          rotationPlacements = [];
  
                          for (let m = 0; m < rotatedNfp.length; m++) {
                            for (let n = 0; n < rotatedNfp[m].length; n++) {
                              rotationPlacements.push({
                                x: rotatedNfp[m][n].x - rotatedPart[0].x + placements[j].x,
                                y: rotatedNfp[m][n].y - rotatedPart[0].y + placements[j].y,
                                rotation: newRotation,
                                orientationMatched: (holeIsWide === rotatedIsWide),
                                fillRatio: bestFitFill
                              });
                            }
                          }
                        }
                      }
                    }
  
                    // If we found valid placements, add them to the hole positions
                    if (rotationPlacements.length > 0) {
                      const holeKey = `${j}_${k}`;
                      holeOptimalRotations.set(holeKey, bestRotation);
  
                      // Add all placements with complete data
                      for (let placement of rotationPlacements) {
                        holePositions.push({
                          x: placement.x,
                          y: placement.y,
                          id: part.id,
                          rotation: placement.rotation,
                          source: part.source,
                          filename: part.filename,
                          inHole: true,
                          parentIndex: j,
                          holeIndex: k,
                          orientationMatched: placement.orientationMatched,
                          rotated: placement.rotation !== part.rotation,
                          fillRatio: placement.fillRatio
                        });
                      }
                    }
                  } catch (e) {
                    // Continue with next hole
                  }
                }
              }
            }
          }
        } catch (e) {
          // Continue with normal placement, ignoring holes
        }
  
        // Fix hole creation by ensuring proper polygon structure
        var validHolePositions = [];
        if (holePositions && holePositions.length > 0) {
          // Filter hole positions to only include valid ones
          for (let j = 0; j < holePositions.length; j++) {
            try {
              // Get parent and hole info
              var parentIdx = holePositions[j].parentIndex;
              var holeIdx = holePositions[j].holeIndex;
              if (parentIdx >= 0 && parentIdx < placed.length &&
                placed[parentIdx].children &&
                holeIdx >= 0 && holeIdx < placed[parentIdx].children.length) {
                validHolePositions.push(holePositions[j]);
              }
            } catch (e) {
              // console.log('Error validating hole position:', e);
            }
          }
          holePositions = validHolePositions;
          // console.log(`Found ${holePositions.length} valid hole positions for part ${part.source}`);
        }
  
        var clipperSheetNfp = innerNfpToClipperCoordinates(sheetNfp, config);
        var clipper = new ClipperLib.Clipper();
        var combinedNfp = new ClipperLib.Paths();
        var error = false;
  
        // check if stored in clip cache
        var clipkey = 's:' + part.source + 'r:' + part.rotation;
        var startindex = 0;
        if (clipCache[clipkey]) {
          var prevNfp = clipCache[clipkey].nfp;
          clipper.AddPaths(prevNfp, ClipperLib.PolyType.ptSubject, true);
          startindex = clipCache[clipkey].index;
        }
  
        for (let j = startindex; j < placed.length; j++) {
          nfp = getOuterNfp(placed[j], part, false, NfpCache);
          // minkowski difference failed. very rare but could happen
          if (!nfp) {
            error = true;
            break;
          }
          // shift to placed location
          for (let m = 0; m < nfp.length; m++) {
            nfp[m].x += placements[j].x;
            nfp[m].y += placements[j].y;
          }
  
          if (nfp.children && nfp.children.length > 0) {
            for (let n = 0; n < nfp.children.length; n++) {
              for (let o = 0; o < nfp.children[n].length; o++) {
                nfp.children[n][o].x += placements[j].x;
                nfp.children[n][o].y += placements[j].y;
              }
            }
          }
  
          var clipperNfp = nfpToClipperCoordinates(nfp, config);
          clipper.AddPaths(clipperNfp, ClipperLib.PolyType.ptSubject, true);
        }
  
        if (error || !clipper.Execute(ClipperLib.ClipType.ctUnion, combinedNfp, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) {
          // console.log('clipper error', error);
          continue;
        }
  
        clipCache[clipkey] = {
          nfp: combinedNfp,
          index: placed.length - 1
        };
        // console.log('save cache', placed.length - 1);
  
        // difference with sheet polygon
        var finalNfp = new ClipperLib.Paths();
        clipper = new ClipperLib.Clipper();
        clipper.AddPaths(combinedNfp, ClipperLib.PolyType.ptClip, true);
        clipper.AddPaths(clipperSheetNfp, ClipperLib.PolyType.ptSubject, true);
  
        if (!clipper.Execute(ClipperLib.ClipType.ctDifference, finalNfp, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftNonZero)) {
          continue;
        }
  
        if (!finalNfp || finalNfp.length == 0) {
          continue;
        }
  
        var f = [];
        for (let j = 0; j < finalNfp.length; j++) {
          // back to normal scale
          f.push(toNestCoordinates(finalNfp[j], config.clipperScale));
        }
        finalNfp = f;
  
        // choose placement that results in the smallest bounding box/hull etc
        // todo: generalize gravity direction
        var minwidth = null;
        var minarea = null;
        var minx = null;
        var miny = null;
        var nf, area, shiftvector;
        var allpoints = [];
        for (let m = 0; m < placed.length; m++) {
          for (let n = 0; n < placed[m].length; n++) {
            allpoints.push({ x: placed[m][n].x + placements[m].x, y: placed[m][n].y + placements[m].y });
          }
        }
  
        var allbounds;
        var partbounds;
        var hull = null;
        if (config.placementType == 'gravity' || config.placementType == 'box') {
          allbounds = GeometryUtil.getPolygonBounds(allpoints);
  
          var partpoints = [];
          for (let m = 0; m < part.length; m++) {
            partpoints.push({ x: part[m].x, y: part[m].y });
          }
          partbounds = GeometryUtil.getPolygonBounds(partpoints);
        }
        else if (config.placementType == 'convexhull' && allpoints.length > 0) {
          // Calculate the hull of all already placed parts once
          hull = getHull(allpoints);
        }
  
        // Process regular sheet positions
        for (let j = 0; j < finalNfp.length; j++) {
          nf = finalNfp[j];
          for (let k = 0; k < nf.length; k++) {
            shiftvector = {
              x: nf[k].x - part[0].x,
              y: nf[k].y - part[0].y,
              id: part.id,
              source: part.source,
              rotation: part.rotation,
              filename: part.filename,
              inHole: false
            };
  
            if (config.placementType == 'gravity' || config.placementType == 'box') {
              var rectbounds = GeometryUtil.getPolygonBounds([
                // allbounds points
                { x: allbounds.x, y: allbounds.y },
                { x: allbounds.x + allbounds.width, y: allbounds.y },
                { x: allbounds.x + allbounds.width, y: allbounds.y + allbounds.height },
                { x: allbounds.x, y: allbounds.y + allbounds.height },
                // part points
                { x: partbounds.x + shiftvector.x, y: partbounds.y + shiftvector.y },
                { x: partbounds.x + partbounds.width + shiftvector.x, y: partbounds.y + shiftvector.y },
                { x: partbounds.x + partbounds.width + shiftvector.x, y: partbounds.y + partbounds.height + shiftvector.y },
                { x: partbounds.x + shiftvector.x, y: partbounds.y + partbounds.height + shiftvector.y }
              ]);
  
              // weigh width more, to help compress in direction of gravity
              if (config.placementType == 'gravity') {
                area = rectbounds.width * 5 + rectbounds.height;
              }
              else {
                area = rectbounds.width * rectbounds.height;
              }
            }
            else if (config.placementType == 'convexhull') {
              // Create points for the part at this candidate position
              var partPoints = [];
              for (let m = 0; m < part.length; m++) {
                partPoints.push({
                  x: part[m].x + shiftvector.x,
                  y: part[m].y + shiftvector.y
                });
              }
  
              var combinedHull = null;
              // If this is the first part, the hull is just the part itself
              if (allpoints.length === 0) {
                combinedHull = getHull(partPoints);
              } else {
                // Merge the points of the part with the points of the hull
                // and recalculate the combined hull (more efficient than using all points)
                var hullPoints = hull.concat(partPoints);
                combinedHull = getHull(hullPoints);
              }
  
              if (!combinedHull) {
                // console.warn("Failed to calculate convex hull");
                continue;
              }
  
              // Calculate area of the convex hull
              area = Math.abs(GeometryUtil.polygonArea(combinedHull));
              // Store for later use
              shiftvector.hull = combinedHull;
            }
  
            if (config.mergeLines) {
              // if lines can be merged, subtract savings from area calculation
              var shiftedpart = shiftPolygon(part, shiftvector);
              var shiftedplaced = [];
  
              for (let m = 0; m < placed.length; m++) {
                shiftedplaced.push(shiftPolygon(placed[m], placements[m]));
              }
  
              // don't check small lines, cut off at about 1/2 in
              var minlength = 0.5 * config.scale;
              var merged = mergedLength(shiftedplaced, shiftedpart, minlength, 0.1 * config.curveTolerance);
              area -= merged.totalLength * config.timeRatio;
            }
  
            // Check for better placement
            if (
              minarea === null ||
              (config.placementType == 'gravity' && (
                rectbounds.width < minwidth ||
                (GeometryUtil.almostEqual(rectbounds.width, minwidth) && area < minarea)
              )) ||
              (config.placementType != 'gravity' && area < minarea) ||
              (GeometryUtil.almostEqual(minarea, area) && shiftvector.x < minx)
            ) {
              // Before accepting this position, perform an overlap check
              var isOverlapping = false;
              // Create a shifted version of the part to test
              var testShifted = shiftPolygon(part, shiftvector);
              // Convert to clipper format for intersection test
              var clipperPart = toClipperCoordinates(testShifted);
              ClipperLib.JS.ScaleUpPath(clipperPart, config.clipperScale);
  
              // Check against all placed parts
              for (let m = 0; m < placed.length; m++) {
                // Convert the placed part to clipper format
                var clipperPlaced = toClipperCoordinates(shiftPolygon(placed[m], placements[m]));
                ClipperLib.JS.ScaleUpPath(clipperPlaced, config.clipperScale);
  
                // Check for intersection (overlap) between parts
                var clipSolution = new ClipperLib.Paths();
                var clipper = new ClipperLib.Clipper();
                clipper.AddPath(clipperPart, ClipperLib.PolyType.ptSubject, true);
                clipper.AddPath(clipperPlaced, ClipperLib.PolyType.ptClip, true);
  
                // Execute the intersection
                if (clipper.Execute(ClipperLib.ClipType.ctIntersection, clipSolution,
                  ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) {
  
                  // If there's any overlap (intersection result not empty)
                  if (clipSolution.length > 0) {
                    isOverlapping = true;
                    break;
                  }
                }
              }
              // Only accept this position if there's no overlap
              if (!isOverlapping) {
                minarea = area;
                if (config.placementType == 'gravity' || config.placementType == 'box') {
                  minwidth = rectbounds.width;
                }
                position = shiftvector;
                minx = shiftvector.x;
                miny = shiftvector.y;
                if (config.mergeLines) {
                  position.mergedLength = merged.totalLength;
                  position.mergedSegments = merged.segments;
                }
              }
            }
          }
        }
  
        // Now process potential hole positions using the same placement strategies
        try {
          if (holePositions && holePositions.length > 0) {
            // Count how many parts are already in each hole to encourage distribution
            const holeUtilization = new Map(); // Map of "parentIndex_holeIndex" -> count
            const holeAreaUtilization = new Map(); // Map of "parentIndex_holeIndex" -> used area percentage
  
            // Track which holes are being used
            for (let m = 0; m < placements.length; m++) {
              if (placements[m].inHole) {
                const holeKey = `${placements[m].parentIndex}_${placements[m].holeIndex}`;
                holeUtilization.set(holeKey, (holeUtilization.get(holeKey) || 0) + 1);
  
                // Calculate area used in each hole
                if (placed[m]) {
                  const partArea = Math.abs(GeometryUtil.polygonArea(placed[m]));
                  holeAreaUtilization.set(
                    holeKey,
                    (holeAreaUtilization.get(holeKey) || 0) + partArea
                  );
                }
              }
            }
  
            // Sort hole positions to prioritize:
            // 1. Unused holes first (to ensure we use all holes)
            // 2. Then holes with fewer parts
            // 3. Then orientation-matched placements
            holePositions.sort((a, b) => {
              const aKey = `${a.parentIndex}_${a.holeIndex}`;
              const bKey = `${b.parentIndex}_${b.holeIndex}`;
  
              const aCount = holeUtilization.get(aKey) || 0;
              const bCount = holeUtilization.get(bKey) || 0;
  
              // First priority: unused holes get top priority
              if (aCount === 0 && bCount > 0) return -1;
              if (bCount === 0 && aCount > 0) return 1;
  
              // Second priority: holes with fewer parts
              if (aCount < bCount) return -1;
              if (bCount < aCount) return 1;
  
              // Third priority: orientation match
              if (a.orientationMatched && !b.orientationMatched) return -1;
              if (!a.orientationMatched && b.orientationMatched) return 1;
  
              // Fourth priority: better hole fit (higher fill ratio)
              if (a.fillRatio && b.fillRatio) {
                if (a.fillRatio > b.fillRatio) return -1;
                if (b.fillRatio > a.fillRatio) return 1;
              }
  
              return 0;
            });
  
  
            for (let j = 0; j < holePositions.length; j++) {
              let holeShift = holePositions[j];
  
              // For debugging the hole's orientation
              const holeKey = `${holeShift.parentIndex}_${holeShift.holeIndex}`;
              const partsInThisHole = holeUtilization.get(holeKey) || 0;
  
              if (config.placementType == 'gravity' || config.placementType == 'box') {
                var rectbounds = GeometryUtil.getPolygonBounds([
                  // allbounds points
                  { x: allbounds.x, y: allbounds.y },
                  { x: allbounds.x + allbounds.width, y: allbounds.y },
                  { x: allbounds.x + allbounds.width, y: allbounds.y + allbounds.height },
                  { x: allbounds.x, y: allbounds.y + allbounds.height },
                  // part points
                  { x: partbounds.x + holeShift.x, y: partbounds.y + holeShift.y },
                  { x: partbounds.x + partbounds.width + holeShift.x, y: partbounds.y + holeShift.y },
                  { x: partbounds.x + partbounds.width + holeShift.x, y: partbounds.y + partbounds.height + holeShift.y },
                  { x: partbounds.x + holeShift.x, y: partbounds.y + partbounds.height + holeShift.y }
                ]);
  
                // weigh width more, to help compress in direction of gravity
                if (config.placementType == 'gravity') {
                  area = rectbounds.width * 5 + rectbounds.height;
                }
                else {
                  area = rectbounds.width * rectbounds.height;
                }
  
                // Apply small bonus for orientation match, but no significant scaling factor
                if (holeShift.orientationMatched) {
                  area *= 0.99; // Just a tiny (1%) incentive for good orientation
                }
  
                // Apply a small bonus for unused holes (just enough to break ties)
                if (partsInThisHole === 0) {
                  area *= 0.99; // 1% bonus for prioritizing empty holes
                  // console.log(`Small priority bonus for unused hole ${holeKey}`);
                }
              }
              else if (config.placementType == 'convexhull') {
                // For hole placements with convex hull, use the actual area without arbitrary factor
                area = Math.abs(GeometryUtil.polygonArea(hull || []));
                holeShift.hull = hull;
  
                // Apply tiny orientation matching bonus
                if (holeShift.orientationMatched) {
                  area *= 0.99;
                }
              }
  
              if (config.mergeLines) {
                // if lines can be merged, subtract savings from area calculation
                var shiftedpart = shiftPolygon(part, holeShift);
                var shiftedplaced = [];
  
                for (let m = 0; m < placed.length; m++) {
                  shiftedplaced.push(shiftPolygon(placed[m], placements[m]));
                }
  
                // don't check small lines, cut off at about 1/2 in
                var minlength = 0.5 * config.scale;
                var merged = mergedLength(shiftedplaced, shiftedpart, minlength, 0.1 * config.curveTolerance);
                area -= merged.totalLength * config.timeRatio;
              }
  
              // Check if this hole position is better than our current best position
              if (
                minarea === null ||
                (config.placementType == 'gravity' && area < minarea) ||
                (config.placementType != 'gravity' && area < minarea) ||
                (GeometryUtil.almostEqual(minarea, area) && holeShift.inHole)
              ) {
                // For hole positions, we need to verify it's entirely within the parent's hole
                // This is a special case where overlap is allowed, but only inside a hole
                var isValidHolePlacement = true;
                var intersectionArea = 0;
                try {
                  // Get the parent part and its specific hole where we're trying to place the current part
                  var parentPart = placed[holeShift.parentIndex];
                  var hole = parentPart.children[holeShift.holeIndex];
                  // Shift the hole based on parent's placement
                  var shiftedHole = shiftPolygon(hole, placements[holeShift.parentIndex]);
                  // Create a shifted version of the current part based on proposed position
                  var shiftedPart = shiftPolygon(part, holeShift);
  
                  // Check if the part is contained within this hole using a different approach
                  // We'll do this by reversing the hole (making it a polygon) and checking if
                  // the part is fully inside it
                  var reversedHole = [];
                  for (let h = shiftedHole.length - 1; h >= 0; h--) {
                    reversedHole.push(shiftedHole[h]);
                  }
  
                  // Convert both to clipper format
                  var clipperHole = toClipperCoordinates(reversedHole);
                  var clipperPart = toClipperCoordinates(shiftedPart);
                  ClipperLib.JS.ScaleUpPath(clipperHole, config.clipperScale);
                  ClipperLib.JS.ScaleUpPath(clipperPart, config.clipperScale);
  
                  // Use INTERSECTION instead of DIFFERENCE
                  // If part is entirely contained in hole, intersection should equal the part
                  var clipSolution = new ClipperLib.Paths();
                  var clipper = new ClipperLib.Clipper();
                  clipper.AddPath(clipperPart, ClipperLib.PolyType.ptSubject, true);
                  clipper.AddPath(clipperHole, ClipperLib.PolyType.ptClip, true);
  
                  if (clipper.Execute(ClipperLib.ClipType.ctIntersection, clipSolution,
                    ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd)) {
  
                    // If the intersection has different area than the part itself
                    // then the part is not fully contained in the hole
                    var intersectionArea = 0;
                    for (let p = 0; p < clipSolution.length; p++) {
                      intersectionArea += Math.abs(ClipperLib.Clipper.Area(clipSolution[p]));
                    }
  
                    var partArea = Math.abs(ClipperLib.Clipper.Area(clipperPart));
                    if (Math.abs(intersectionArea - partArea) > (partArea * 0.01)) { // 1% tolerance
                      isValidHolePlacement = false;
                      // console.log(`Part not fully contained in hole: ${part.source}`);
                    }
                  } else {
                    isValidHolePlacement = false;
                  }
  
                  // Also check if this part overlaps with any other placed parts
                  // (it should only overlap with its parent's hole)
                  if (isValidHolePlacement) {
                    // Bonus: Check if this part is placed on another part's contour within the same hole
                    // This incentivizes the algorithm to place parts efficiently inside holes
                    let contourScore = 0;
                    // Find other parts already placed in this hole
                    for (let m = 0; m < placed.length; m++) {
                      if (placements[m].inHole &&
                        placements[m].parentIndex === holeShift.parentIndex &&
                        placements[m].holeIndex === holeShift.holeIndex) {
                        // Found another part in the same hole, check proximity/contour usage
                        const p2 = placements[m];
  
                        // Calculate Manhattan distance between parts
                        const dx = Math.abs(holeShift.x - p2.x);
                        const dy = Math.abs(holeShift.y - p2.y);
  
                        // If parts are close to each other (touching or nearly touching)
                        const proximityThreshold = 2.0; // proximity threshold in user units
                        if (dx < proximityThreshold || dy < proximityThreshold) {
                          // This placement uses contour of another part - give it a bonus
                          contourScore += 5.0; // This value can be tuned
                          // console.log(`Found contour alignment in hole between ${part.source} and ${placed[m].source}`);
                        }
                      }
                    }
  
                    // Treat holes exactly like mini-sheets for better space utilization
                    // This approach will ensure efficient hole packing like we do with sheets
                    if (isValidHolePlacement) {
                      // Prioritize placing larger parts in holes first
                      // Apply a stronger bias for larger parts relative to hole size
                      const holeArea = Math.abs(GeometryUtil.polygonArea(shiftedHole));
                      const partArea = Math.abs(GeometryUtil.polygonArea(shiftedPart));
  
                      // Calculate how much of the hole this part fills (0-1)
                      const fillRatio = partArea / holeArea;
  
                      // Now apply standard sheet-like placement optimization for parts already in the hole
                      const partsInSameHole = [];
                      for (let m = 0; m < placed.length; m++) {
                        if (placements[m].inHole &&
                          placements[m].parentIndex === holeShift.parentIndex &&
                          placements[m].holeIndex === holeShift.holeIndex) {
                          partsInSameHole.push({
                            part: placed[m],
                            placement: placements[m]
                          });
                        }
                      }
  
                      // Apply the same edge alignment logic we use for sheet placement
                      if (partsInSameHole.length > 0) {
                        const shiftedPart = shiftPolygon(part, holeShift);
                        const bbox1 = GeometryUtil.getPolygonBounds(shiftedPart);
  
                        // Track best alignment metrics to prioritize clean edge alignments
                        let bestAlignment = 0;
                        let alignmentCount = 0;
  
                        // Examine each part already placed in this hole
                        for (let m = 0; m < partsInSameHole.length; m++) {
                          const otherPart = shiftPolygon(partsInSameHole[m].part, partsInSameHole[m].placement);
                          const bbox2 = GeometryUtil.getPolygonBounds(otherPart);
  
                          // Edge alignment detection with tighter threshold for precision
                          const edgeThreshold = 2.0;
  
                          // Check all four edge alignments
                          const leftAligned = Math.abs(bbox1.x - (bbox2.x + bbox2.width)) < edgeThreshold;
                          const rightAligned = Math.abs((bbox1.x + bbox1.width) - bbox2.x) < edgeThreshold;
                          const topAligned = Math.abs(bbox1.y - (bbox2.y + bbox2.height)) < edgeThreshold;
                          const bottomAligned = Math.abs((bbox1.y + bbox1.height) - bbox2.y) < edgeThreshold;
  
                          if (leftAligned || rightAligned || topAligned || bottomAligned) {
                            // Score based on alignment length (better packing)
                            let alignmentLength = 0;
  
                            if (leftAligned || rightAligned) {
                              // Calculate vertical overlap
                              const overlapStart = Math.max(bbox1.y, bbox2.y);
                              const overlapEnd = Math.min(bbox1.y + bbox1.height, bbox2.y + bbox2.height);
                              alignmentLength = Math.max(0, overlapEnd - overlapStart);
                            } else {
                              // Calculate horizontal overlap
                              const overlapStart = Math.max(bbox1.x, bbox2.x);
                              const overlapEnd = Math.min(bbox1.x + bbox1.width, bbox2.x + bbox2.width);
                              alignmentLength = Math.max(0, overlapEnd - overlapStart);
                            }
  
                            if (alignmentLength > bestAlignment) {
                              bestAlignment = alignmentLength;
                            }
                            alignmentCount++;
                          }
                        }
                        // Apply additional score for good edge alignments
                        if (bestAlignment > 0) {
                          // Calculate a multiplier based on alignment quality (0.7-0.9)
                          // Better alignments get lower multipliers (better scores)
                          const qualityMultiplier = Math.max(0.7, 0.9 - (bestAlignment / 100) - (alignmentCount * 0.05));
                          area *= qualityMultiplier;
                          // console.log(`Applied sheet-like alignment strategy in hole with quality ${(1-qualityMultiplier)*100}%`);
                        }
                      }
                    }
  
                    // Normal overlap check with other parts (excluding the parent)
                    for (let m = 0; m < placed.length; m++) {
                      // Skip check against parent part, as we've already verified hole containment
                      if (m === holeShift.parentIndex) continue;
  
                      var clipperPlaced = toClipperCoordinates(shiftPolygon(placed[m], placements[m]));
                      ClipperLib.JS.ScaleUpPath(clipperPlaced, config.clipperScale);
  
                      clipSolution = new ClipperLib.Paths();
                      clipper = new ClipperLib.Clipper();
                      clipper.AddPath(clipperPart, ClipperLib.PolyType.ptSubject, true);
                      clipper.AddPath(clipperPlaced, ClipperLib.PolyType.ptClip, true);
  
                      if (clipper.Execute(ClipperLib.ClipType.ctIntersection, clipSolution,
                        ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) {
                        if (clipSolution.length > 0) {
                          isValidHolePlacement = false;
                          // console.log(`Part overlaps with other part: ${part.source} with ${placed[m].source}`);
                          break;
                        }
                      }
                    }
                  }
                  if (isValidHolePlacement) {
                    // console.log(`Valid hole placement found for part ${part.source} in hole of ${parentPart.source}`);
                  }
                } catch (e) {
                  // console.log('Error in hole containment check:', e);
                  isValidHolePlacement = false;
                }
  
                // Only accept this position if placement is valid
                if (isValidHolePlacement) {
                  minarea = area;
                  if (config.placementType == 'gravity' || config.placementType == 'box') {
                    minwidth = rectbounds.width;
                  }
                  position = holeShift;
                  minx = holeShift.x;
                  miny = holeShift.y;
  
                  if (config.mergeLines) {
                    position.mergedLength = merged.totalLength;
                    position.mergedSegments = merged.segments;
                  }
                }
              }
            }
          }
        } catch (e) {
          // console.log('Error processing hole positions:', e);
        }
  
        // Continue with best non-hole position if available
        if (position) {
          // Debug placement with less verbose logging
          if (position.inHole) {
            // console.log(`Placed part ${position.source} in hole of part ${placed[position.parentIndex].source}`);
            // Adjust the part placement specifically for hole placement
            // This prevents the part from being considered as overlapping with its parent
            var parentPart = placed[position.parentIndex];
            // console.log(`Hole placement - Parent: ${parentPart.source}, Child: ${part.source}`);
  
            // Mark the relationship to prevent overlap checks between them in future placements
            position.parentId = parentPart.id;
          }
          placed.push(part);
          placements.push(position);
          if (position.mergedLength) {
            totalMerged += position.mergedLength;
          }
        } else {
          // Just log part source without additional details
          // console.log(`No placement for part ${part.source}`);
        }
  
        // send placement progress signal
        var placednum = placed.length;
        for (let j = 0; j < allplacements.length; j++) {
          placednum += allplacements[j].sheetplacements.length;
        }
        //console.log(placednum, totalnum);
        ipcRenderer.send('background-progress', { index: nestindex, progress: 0.5 + 0.5 * (placednum / totalnum) });
        // console.timeEnd('placement');
      }
  
      //if(minwidth){
      fitness += (minwidth / sheetarea) + minarea;
      //}
  
      for (let i = 0; i < placed.length; i++) {
        var index = parts.indexOf(placed[i]);
        if (index >= 0) {
          parts.splice(index, 1);
        }
      }
  
      if (placements && placements.length > 0) {
        allplacements.push({ sheet: sheet.source, sheetid: sheet.id, sheetplacements: placements });
      }
      else {
        break; // something went wrong
      }
  
      if (sheets.length == 0) {
        break;
      }
    }
  
    // there were parts that couldn't be placed
    // scale this value high - we really want to get all the parts in, even at the cost of opening new sheets
    console.log('UNPLACED PARTS', parts.length, 'of', totalnum);
    for (let i = 0; i < parts.length; i++) {
      // console.log(`Fitness before unplaced penalty: ${fitness}`);
      const penalty = 100000000 * ((Math.abs(GeometryUtil.polygonArea(parts[i])) * 100) / totalsheetarea);
      // console.log(`Penalty for unplaced part ${parts[i].source}: ${penalty}`);
      fitness += penalty;
      // console.log(`Fitness after unplaced penalty: ${fitness}`);
    }
  
    // Enhance fitness calculation to encourage more efficient hole usage
    // This rewards more efficient use of material by placing parts in holes
    for (let i = 0; i < allplacements.length; i++) {
      const placements = allplacements[i].sheetplacements;
      // First pass: identify all parts placed in holes
      const partsInHoles = [];
      for (let j = 0; j < placements.length; j++) {
        if (placements[j].inHole === true) {
          // Find the corresponding part to calculate its area
          const partIndex = j;
          if (partIndex >= 0) {
            // Add this part to our tracked list of parts in holes
            partsInHoles.push({
              index: j,
              parentIndex: placements[j].parentIndex,
              holeIndex: placements[j].holeIndex,
              area: Math.abs(GeometryUtil.polygonArea(placed[partIndex])) * 2
            });
            // Base reward for any part placed in a hole
            // console.log(`Part ${placed[partIndex].source} placed in hole of part ${placed[placements[j].parentIndex].source}`);
            // console.log(`Part area: ${Math.abs(GeometryUtil.polygonArea(placed[partIndex]))}, Hole area: ${Math.abs(GeometryUtil.polygonArea(placed[placements[j].parentIndex]))}`);
            fitness -= (Math.abs(GeometryUtil.polygonArea(placed[partIndex])) / totalsheetarea / 100);
          }
        }
      }
      // Second pass: apply additional fitness rewards for parts placed on contours of other parts within holes
      // This incentivizes the algorithm to stack parts efficiently within holes
      for (let j = 0; j < partsInHoles.length; j++) {
        const part = partsInHoles[j];
        for (let k = 0; k < partsInHoles.length; k++) {
          if (j !== k &&
            part.parentIndex === partsInHoles[k].parentIndex &&
            part.holeIndex === partsInHoles[k].holeIndex) {
            // Calculate distances between parts to see if they're using each other's contours
            const p1 = placements[part.index];
            const p2 = placements[partsInHoles[k].index];
  
            // Calculate Manhattan distance between parts (simple proximity check)
            const dx = Math.abs(p1.x - p2.x);
            const dy = Math.abs(p1.y - p2.y);
  
            // If parts are close to each other (touching or nearly touching)
            // within configurable threshold - can be adjusted based on your specific needs
            const proximityThreshold = 2.0; // proximity threshold in user units
            if (dx < proximityThreshold || dy < proximityThreshold) {
              // Award extra fitness for parts efficiently placed near each other in the same hole
              // This encourages the algorithm to place parts on contours of other parts
              fitness -= (part.area / totalsheetarea) * 0.01; // Additional 50% bonus
            }
          }
        }
      }
    }
  
    // send finish progress signal
    ipcRenderer.send('background-progress', { index: nestindex, progress: -1 });
  
    console.log('WATCH', allplacements);
  
    const utilisation = totalsheetarea > 0 ? (area / totalsheetarea) * 100 : 0;
    console.log(`Utilisation of the sheet(s): ${utilisation.toFixed(2)}%`);
  
    return { placements: allplacements, fitness: fitness, area: sheetarea, totalarea: totalsheetarea, mergedLength: totalMerged, utilisation: utilisation };
  }

export { getOuterNfp, getInnerNfp };