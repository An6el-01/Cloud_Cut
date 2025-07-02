/**
 * SVGnest NFP Worker - Integrated with CloudCut
 * Generates No-Fit Polygons using SVGnest algorithms
 */

const { GeometryUtil } = require('./geometryutil');
const ClipperLib = require('./clipperLib');

// Coordinate transformation functions
function toClipperCoordinates(polygon){
    var clone = [];
    for(var i=0; i<polygon.length; i++){
        clone.push({
            X: polygon[i].x,
            Y: polygon[i].y
        });
    }
    return clone;
}

function toNestCoordinates(polygon, scale){
    var clone = [];
    for(var i=0; i<polygon.length; i++){
        clone.push({
            x: polygon[i].X/scale,
            y: polygon[i].Y/scale
        });
    }
    return clone;
}

// Rotate polygon by degrees
function rotatePolygon(polygon, degrees){
    var rotated = [];
    var angle = degrees * Math.PI / 180;
    for(var i=0; i<polygon.length; i++){
        var x = polygon[i].x;
        var y = polygon[i].y;
        var x1 = x*Math.cos(angle)-y*Math.sin(angle);
        var y1 = x*Math.sin(angle)+y*Math.cos(angle);
        rotated.push({x:x1, y:y1});
    }
    return rotated;
}

// Generate Inner NFP (for bin fitting)
function generateInnerNfp(binPolygon, part, config) {
    try {
        // For rectangular bins, use optimized rectangle NFP
        if (GeometryUtil.isRectangle(binPolygon, 0.001)) {
            return GeometryUtil.noFitPolygonRectangle(binPolygon, part);
        }
        
        // Use general NFP algorithm
        return GeometryUtil.noFitPolygon(binPolygon, part, true, config.exploreConcave || false);
    } catch (error) {
        console.error('Error generating inner NFP:', error);
        return null;
    }
}

// Generate Outer NFP (for part-to-part avoidance)
function generateOuterNfp(partA, partB, config) {
    try {
        // Use Minkowski difference for outer NFP
        return minkowskiDifference(partA, partB);
    } catch (error) {
        console.error('Error generating outer NFP:', error);
        // Fallback to general NFP algorithm
        return GeometryUtil.noFitPolygon(partA, partB, false, config.exploreConcave || false);
    }
}

// Minkowski difference using Clipper library
function minkowskiDifference(A, B) {
    try {
        var Ac = toClipperCoordinates(A);
        ClipperLib.JS.ScaleUpPath(Ac, 10000000);
        var Bc = toClipperCoordinates(B);
        ClipperLib.JS.ScaleUpPath(Bc, 10000000);
        
        for(var i=0; i<Bc.length; i++){
            Bc[i].X *= -1;
            Bc[i].Y *= -1;
        }
        
        var solution = ClipperLib.Clipper.MinkowskiSum(Ac, Bc, true);
        var clipperNfp;

        var largestArea = null;
        for(i=0; i<solution.length; i++){
            var n = toNestCoordinates(solution[i], 10000000);
            var sarea = GeometryUtil.polygonArea(n);
            if(largestArea === null || largestArea > sarea){
                clipperNfp = n;
                largestArea = sarea;
            }
        }

        for(var i=0; i<clipperNfp.length; i++){
            clipperNfp[i].x += B[0].x;
            clipperNfp[i].y += B[0].y;
        }

        return [clipperNfp];
    } catch (error) {
        console.error('Error in Minkowski difference:', error);
        return null;
    }
}

// Main NFP generation function
function generateNfp(partA, partB, isInner, config) {
    // Validate inputs
    if (!partA || !partB || !Array.isArray(partA) || !Array.isArray(partB)) {
        console.error('Invalid polygon inputs for NFP generation');
        return null;
    }
    
    if (partA.length < 3 || partB.length < 3) {
        console.error('Polygons must have at least 3 points');
        return null;
    }
    
    config = config || {
        clipperScale: 10000000,
        exploreConcave: false
    };
    
    if (isInner) {
        return generateInnerNfp(partA, partB, config);
    } else {
        return generateOuterNfp(partA, partB, config);
    }
}

// Export functions
module.exports = {
    generateNfp,
    generateInnerNfp,
    generateOuterNfp,
    minkowskiDifference,
    rotatePolygon,
    toClipperCoordinates,
    toNestCoordinates
}; 