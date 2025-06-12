/**
 * Handles the placement of parts
 */

const { GeometryUtil } = require("./geometryutil");

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
    console.log("PlacementWorker initialized with binPolygon:", this.binPolygon);
    console.log("PlacementWorker initialized with paths:", this.paths);

    // Bind methods to this instance
    this.place = this.place.bind(this);
    this.placePaths = this.placePaths.bind(this);

    // return a placement for the paths/rotations worker
    // happens inside a webworker
    this.placePaths = function(paths) {

        if (!this.binPolygon) {
            return null;
        }

        if(this.binPolygon && Array.isArray(this.binPolygon)) {
            // Check if polygonOffset is a function before calling it
            if (typeof this.polygonOffset === 'function') {
                const padded = this.polygonOffset(this.binPolygon, {x: -10, y: -10});
                if (padded && padded.length > 0) {
                    this.binPolygon = padded;
                }
            }
        }

        var i, j, k, m, n, path;

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
        var key, nfp;

        while (paths.length > 0) {
            var placed = [];
            var placements = [];
            fitness += 1; // Add 1 for each bin opened. The lower the fitness, the better.

            for (i = 0; i < paths.length; i++){
                path = paths[i];

                // inner NFP
                key = JSON.stringify({
                    A: -1,
                    B: path.id,
                    inside: true,
                    Arotation: 0,
                    Brotation: path.rotation,
                });
                var binNfp = this.nfpCache[key];

                // part unplaceable skip
                if (!binNfp || binNfp.length == 0) { continue;}

                var position = null;
                if (placed.length > 0) {
                    // first placement, put it on the left
                    for (j = 0; j < binNfp.length; j++){
                        for (k=0; k < binNfp[j].length; k++) {
                            if(
                                position === null ||
                                binNfp[j][k].x - path[0].x < position.x
                            ) {
                                position = {
                                    x: binNfp[j][k].x - path[0].x,
                                    y: binNfp[j][k].y - path[0].y,
                                    id: path.id,
                                    rotation: path.rotation,
                                };
                            }
                        }
                    }

                    placements.push(position);
                    placed.push(path);

                    continue;
                }

                var clipperBinNfp = [];
                for (j = 0; j < binNfp.length; j++){
                    clipperBinNfp.push(toClipperCoordinates(binNfp[j]));
                }

                ClipperLib.JS.ScaleUpPaths(clipperBinNfp, this.config.clipperScale);
               
                var clipper = new ClipperLib.Clipper();
                var combinedNfp = new ClipperLib.Paths();

                for (j = 0; j < placed.length; j++) {
                    key = JSON.stringify({
                        A: placed[j].id,
                        B: path.id,
                        inside: false,
                        Arotation: placed[j].rotation,
                        Brotation: path.rotation,
                    });
                    nfp = this.nfpCache[key];

                    if (!nfp) {
                        continue;
                    }

                    for (k = 0; k < nfp.length; k++) {
                        var clone = toClipperCoordinates(nfp[k]);
                        for (m = 0; m < clone.length; m++){
                            clone[m].X += placed[j].x;
                            clone[m].Y += placed[j].y;
                        }

                        ClipperLib.JS.ScaleUpPath(clone, this.config.clipperScale);
                        clone = ClipperLib.Clipper.CleanPolygon(
                            clone,
                            0.0001 * this.config.clipperScale
                        );
                        var area = Math.abs(ClipperLib.Clipper.Area(clone));
                        if(
                            clone.length > 2 &&
                            area > 0.1 * this.config.clipperScale * this.config.clipperScale
                        ) {
                            clipper.AddPath(clone, ClipperLib.PolyType.ptSubject, true);
                        }
                    }
                }

                if(
                    !clipper.Execute(
                        ClipperLib.ClipType.ctUnion,
                        combinedNfp,
                        ClipperLib.PolyFillType.pftNonZero,
                        ClipperLib.PolyFillType.pftNonZero
                    )
                ) { 
                    continue;
                }

                //difference with bin polygon
                var finalNfp = new ClipperLib.Paths();
                clipper = new ClipperLib.Clipper();

                clipper.AddPath(combinedNfp, ClipperLib.PolyType.ptClip, true);
                clipper.AddPath(clipperBinNfp, ClipperLib.PolyType.ptSubject, true);
                if(
                    !clipper.Execute(
                        ClipperLib.ClipType.ctDifference,
                        finalNfp,
                        ClipperLib.PolyFillType.pftNonZero,
                        ClipperLib.PolyFillType.pftNonZero
                    )
                ) {
                    continue;
                }

                finalNfp = ClipperLib.Clipper.CleanPolygons(finalNfp, 0.0001 * this.config.clipperScale);

                for(j = 0; j < finalNfp.length; j++) {
                    var area = Math.abs(ClipperLib.Clipper.Area(finalNfp[j]));
                    if(
                        finalNfp[j].length < 3 ||
                        area < 0.1 * this.config.clipperScale * this.config.clipperScale
                    ) {
                        finalNfp.splice(j, 1);
                        j--;
                    }
                }

                if(!finalNfp || finalNfp.length == 0) {
                    continue;
                }

                var f = [];
                for (j = 0; j < finalNfp.length; j++) {
                    // back to normal scale
                    f.push(toNestCoordinates(finalNfp[j], this.config.clipperScale));
                }
                finalNfp = f;

                //Choose the placement that results in the smallest bounding box
                var minwidth = null;
                var minarea = null;
                var minx = null;
                var nf, area, shiftvector;

                for (j = 0; j < finalNfp.length; j++) {
                    nf = finalNfp[j];
                    if (Math.abs(GeometryUtil.polygonArea(nf)) < 2) {
                        continue;
                    }

                    for ( k = 0; k < nf.length; k++) {
                        var allpoints = [];
                        for ( m = 0; m < placed.length; m++) {
                            for (n = 0; n < placed[m].length; n++) {
                                allpoints.push({
                                    x: placed[m][n].x + placements[m].x,
                                    y: placed[m][n].y + placements[m].y,
                                });
                            }
                        }

                        shiftvector = {
                            x: nf[k].x - path[0].x,
                            y: nf[k].y - path[0].y,
                            id: path.id,
                            rotation: path.rotation,
                            nfp : combinedNfp,
                        };

                        for (m = 0; m < path.length; m++) {
                            allpoints.push({
                                x: path[m].x + shiftvector.x,
                                y: path[m].y + shiftvector.y,
                            });
                        }

                        var rectbounds = GeometryUtil.getPolygonBounds(allpoints);

                        // weight width more to help compress in direction of gravity
                        area = rectbounds.width * 2 + rectbounds.height;

                        if(
                            minarea === null || 
                            area < minarea || 
                            (GeometryUtil.almostEqual(minarea, area) &&
                                (minx === null || shiftvector.x < minx))
                        ) {
                            minarea = area;
                            minwidth = rectbounds.width;
                            position = shiftvector;
                            minx = shiftvector.x;
                        }
                    }
                }
                if(position) {
                    placed.push(path);
                    placements.push(position);
                }
            }

            if(minwidth) {
                fitness += minwidth / binarea;
            }

            for (i = 0; i < placed.length; i++) {
                var index = paths.indexOf(placed[i]);
                if (index >= 0) {
                    paths.splice(index, 1);
                }
            }

            if (placements && placements.length > 0) {
                allplacements.push(placements);
            } else {
                break;
            }
        }

        // There were parts that could not be placed
        fitness += 2 * paths.length;

        return {
            placements: allplacements,
            fitness: fitness,
            paths: paths,
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