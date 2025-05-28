/**
 * Handles the placement of parts
 */

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
    angle = (degrees * Math.PI) / 180;
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

function PlacementWorker(binPolygon, paths, ids, rotations, config, nfpCache) {
    this.binPolygon = binPolygon;
    this.paths = paths;
    this.ids = ids;
    this.rotations = rotations;
    this.config = config;
    this.nfpCache = nfpCache || {};

    // Bind methods to this instance
    this.place = this.place.bind(this);
    this.placePaths = this.placePaths.bind(this);
}

PlacementWorker.prototype.place = function(placement) {
    return this.placePaths(placement);
};

PlacementWorker.prototype.placePaths = function(placement) {
    try {
        // Initialize placement results
        const placements = [];
        let currentX = 0;
        let currentY = 0;
        let maxY = 0;

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
            if (currentX + width > 1000) { // Assuming 1000 is max width
                currentX = 0;
                currentY = maxY;
            }

            // Place the polygon
            placements.push({
                x: currentX - bounds.minX,
                y: currentY - bounds.minY,
                rotation: rotation,
                id: part.id,
                source: part.source
            });

            // Update positions
            currentX += width;
            maxY = Math.max(maxY, currentY + height);
        }

        return {
            success: true,
            placements: placements,
            area: maxY * 1000, // Total area used
            compactness: 1 - (maxY * 1000) / (1000 * 1000) // Compactness score
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