/**
 * SVGnest PlacementWorker - Extracted and adapted for CloudCut
 * Original from SVGnest by Jack Qiao
 * Adapted for CloudCut nesting system
 */

// Import required dependencies
const { GeometryUtil } = require('./geometryutil');
const ClipperLib = require('./clipperLib');

// jsClipper uses X/Y instead of x/y...
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
    
    if(polygon.children && polygon.children.length > 0){
        rotated.children = [];
        for(var j=0; j<polygon.children.length; j++){
            rotated.children.push(rotatePolygon(polygon.children[j], degrees));
        }
    }
    
    return rotated;
}

// Helper function to try placing a single part
function tryPlaceSinglePart(path, placed, placements, worker) {
    // Validate path structure
    if (!path || !Array.isArray(path) || path.length === 0) {
        console.warn('Invalid path:', path);
        return null;
    }
    
    // Validate that path[0] has x,y properties
    if (!path[0] || typeof path[0].x !== 'number' || typeof path[0].y !== 'number') {
        console.warn('Invalid path[0]:', path[0]);
        return null;
    }
    
    // inner NFP
    var key = JSON.stringify({A:-1,B:path.id,inside:true,Arotation:0,Brotation:path.rotation});
    var binNfp = worker.nfpCache[key];
    
    // part unplaceable, skip
    if(!binNfp || binNfp.length == 0){
        return null;
    }
    
    // ensure all necessary NFPs exist
    var error = false;
    for(var j=0; j<placed.length; j++){          
        key = JSON.stringify({A:placed[j].id,B:path.id,inside:false,Arotation:placed[j].rotation,Brotation:path.rotation});
        var nfp = worker.nfpCache[key];
                            
        if(!nfp){
            error = true;
            break;
        }   
    }
    
    // part unplaceable, skip
    if(error){
        return null;
    }
    
    var position = null;
    if(placed.length == 0){
        // first placement, put it on the left
        for(var j=0; j<binNfp.length; j++){
            for(var k=0; k<binNfp[j].length; k++){
                if(position === null || binNfp[j][k].x-path[0].x < position.x ){
                    position = {
                        x: binNfp[j][k].x-path[0].x,
                        y: binNfp[j][k].y-path[0].y,
                        id: path.id,
                        rotation: path.rotation
                    }
                }
            }
        }
        
        return position;
    }
    
    var clipperBinNfp = [];
    for(var j=0; j<binNfp.length; j++){
        clipperBinNfp.push(toClipperCoordinates(binNfp[j]));
    }
    
    ClipperLib.JS.ScaleUpPaths(clipperBinNfp, worker.config.clipperScale);
    
    var clipper = new ClipperLib.Clipper();
    var combinedNfp = new ClipperLib.Paths();
    
    for(var j=0; j<placed.length; j++){          
        key = JSON.stringify({A:placed[j].id,B:path.id,inside:false,Arotation:placed[j].rotation,Brotation:path.rotation});
        nfp = worker.nfpCache[key];
                            
        if(!nfp){
            continue;
        }
        
        for(var k=0; k<nfp.length; k++){
            var clone = toClipperCoordinates(nfp[k]);
            for(var m=0; m<clone.length; m++){
                clone[m].X += placements[j].x;
                clone[m].Y += placements[j].y;
            }
            
            ClipperLib.JS.ScaleUpPath(clone, worker.config.clipperScale);
            clone = ClipperLib.Clipper.CleanPolygon(clone, 0.0001*worker.config.clipperScale);
            var area = Math.abs(ClipperLib.Clipper.Area(clone));
            if(clone.length > 2 && area > 0.1*worker.config.clipperScale*worker.config.clipperScale){
                clipper.AddPath(clone, ClipperLib.PolyType.ptSubject, true);
            }
        }       
    }
    
    if(!clipper.Execute(ClipperLib.ClipType.ctUnion, combinedNfp, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)){
        return null;
    }
    
    // difference with bin polygon
    var finalNfp = new ClipperLib.Paths();
    clipper = new ClipperLib.Clipper();
    
    clipper.AddPaths(combinedNfp, ClipperLib.PolyType.ptClip, true);
    clipper.AddPaths(clipperBinNfp, ClipperLib.PolyType.ptSubject, true);
    if(!clipper.Execute(ClipperLib.ClipType.ctDifference, finalNfp, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)){
        return null;
    }
    
    finalNfp = ClipperLib.Clipper.CleanPolygons(finalNfp, 0.0001*worker.config.clipperScale);
    
    for(var j=0; j<finalNfp.length; j++){
        var area = Math.abs(ClipperLib.Clipper.Area(finalNfp[j]));
        if(finalNfp[j].length < 3 || area < 0.1*worker.config.clipperScale*worker.config.clipperScale){
            finalNfp.splice(j,1);
            j--;
        }
    }
    
    if(!finalNfp || finalNfp.length == 0){
        return null;
    }
    
    var f = [];
    for(var j=0; j<finalNfp.length; j++){
        // back to normal scale
        f.push(toNestCoordinates(finalNfp[j], worker.config.clipperScale));
    }
    finalNfp = f;
    
    // Width-first placement strategy: prioritize filling width before height
    var minwidth = null;
    var minarea = null;
    var minx = null;
    var miny = null;
    var nf, area, shiftvector;

    for(var j=0; j<finalNfp.length; j++){
        nf = finalNfp[j];
        if(Math.abs(GeometryUtil.polygonArea(nf)) < 2){
            continue;
        }
        
        for(var k=0; k<nf.length; k++){
            var allpoints = [];
            for(var m=0; m<placed.length; m++){
                for(var n=0; n<placed[m].length; n++){
                    allpoints.push({x:placed[m][n].x+placements[m].x, y: placed[m][n].y+placements[m].y});
                }
            }
            
            shiftvector = {
                x: nf[k].x-path[0].x,
                y: nf[k].y-path[0].y,
                id: path.id,
                rotation: path.rotation,
                nfp: combinedNfp
            };
            
            for(var m=0; m<path.length; m++){
                allpoints.push({x: path[m].x+shiftvector.x, y:path[m].y+shiftvector.y});
            }
            
            var rectbounds = GeometryUtil.getPolygonBounds(allpoints);
            
            // use equal weight for width and height for better space distribution (box placement)
            area = rectbounds.width * rectbounds.height;
            
            // Before accepting this position, perform an explicit overlap check
            var isOverlapping = false;
            
            // Create a test polygon at the proposed position
            var testPolygon = [];
            for(var m = 0; m < path.length; m++){
                testPolygon.push({
                    x: path[m].x + shiftvector.x,
                    y: path[m].y + shiftvector.y
                });
            }
            
            // Check for overlaps with all already placed parts
            for(var m = 0; m < placed.length; m++){
                var placedPolygon = [];
                for(var n = 0; n < placed[m].length; n++){
                    placedPolygon.push({
                        x: placed[m][n].x + placements[m].x,
                        y: placed[m][n].y + placements[m].y
                    });
                }
                
                // Use Clipper to detect actual polygon intersection
                var clipperTest = toClipperCoordinates(testPolygon);
                var clipperPlaced = toClipperCoordinates(placedPolygon);
                ClipperLib.JS.ScaleUpPath(clipperTest, worker.config.clipperScale);
                ClipperLib.JS.ScaleUpPath(clipperPlaced, worker.config.clipperScale);
                
                var clipSolution = new ClipperLib.Paths();
                var overlapClipper = new ClipperLib.Clipper();
                overlapClipper.AddPath(clipperTest, ClipperLib.PolyType.ptSubject, true);
                overlapClipper.AddPath(clipperPlaced, ClipperLib.PolyType.ptClip, true);
                
                if(overlapClipper.Execute(ClipperLib.ClipType.ctIntersection, clipSolution, 
                   ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)){
                    // Check if there's actual overlap (intersection area > threshold)
                    var totalOverlapArea = 0;
                    for(var s = 0; s < clipSolution.length; s++){
                        var overlapArea = Math.abs(ClipperLib.Clipper.Area(clipSolution[s]));
                        totalOverlapArea += overlapArea;
                    }
                    
                    // If overlap area is significant, reject this position
                    var threshold = 0.1 * worker.config.clipperScale * worker.config.clipperScale;
                    if(totalOverlapArea > threshold){
                        isOverlapping = true;
                        break;
                    }
                }
            }
            
            // Check if the entire part fits within bin bounds (with 10mm padding)
            var fitsInBounds = true;
            var binMinX = 10, binMaxX = 990, binMinY = 10, binMaxY = 1990;
            
            for(var m = 0; m < testPolygon.length; m++){
                var px = testPolygon[m].x;
                var py = testPolygon[m].y;
                
                if(px < binMinX || px > binMaxX || py < binMinY || py > binMaxY){
                    fitsInBounds = false;
                    break;
                }
            }
            
            // Only accept this position if there's no overlap AND it fits within bounds
            // Width-first strategy: prioritize bottom positions, then left-to-right, then minimize area
            var acceptPosition = false;
            var yTolerance = 50; // 50mm tolerance for "same row"
            
            if(!isOverlapping && fitsInBounds) {
                if(position === null) {
                    // First valid position
                    acceptPosition = true;
                } else if(shiftvector.y < miny - yTolerance) {
                    // Significantly lower position (prioritize bottom-up filling)
                    acceptPosition = true;
                } else if(Math.abs(shiftvector.y - miny) <= yTolerance) {
                    // Same row level - prioritize left-to-right
                    if(shiftvector.x < minx) {
                        acceptPosition = true;
                    } else if(GeometryUtil.almostEqual(shiftvector.x, minx) && area < minarea) {
                        // Same x position - choose smaller area
                        acceptPosition = true;
                    }
                }
            }
            
            if(acceptPosition) {
                minarea = area;
                minwidth = rectbounds.width;
                position = shiftvector;
                minx = shiftvector.x;
                miny = shiftvector.y;
            }
        }
    }
    
    return position;
}

function PlacementWorker(binPolygon, paths, ids, rotations, config, nfpCache){
    this.binPolygon = binPolygon;
    this.paths = paths;
    this.ids = ids;
    this.rotations = rotations;
    this.config = config || {};
    // Ensure clipperScale has a default value
    if (!this.config.clipperScale) {
        this.config.clipperScale = 10000000;
    }
    this.nfpCache = nfpCache || {};
    
    // return a placement for the paths/rotations given
    // happens inside a webworker
    this.placePaths = function(paths){
        console.log('[PLACEMENT WORKER] placePaths() called with', paths.length, 'paths');

        var self = this;

        if(!self.binPolygon){
            console.error('[PLACEMENT WORKER] No binPolygon available');
            return null;
        }       
        
        console.log('[PLACEMENT WORKER] binPolygon exists with', self.binPolygon.length, 'points');
        console.log('[PLACEMENT WORKER] nfpCache keys count:', Object.keys(self.nfpCache).length);
        
        var i, j, k, m, n, path;
        
        // rotate paths by given rotation
        console.log('[PLACEMENT WORKER] Rotating paths...');
        var rotated = [];
        for(i=0; i<paths.length; i++){
            var r = rotatePolygon(paths[i], paths[i].rotation);
            r.rotation = paths[i].rotation;
            r.source = paths[i].source;
            r.id = paths[i].id;
            rotated.push(r);
        }
        
        paths = rotated;
        console.log('[PLACEMENT WORKER] Path rotation completed');
        
        var allplacements = [];
        var fitness = 0;
        var binarea = Math.abs(GeometryUtil.polygonArea(self.binPolygon));
        console.log('[PLACEMENT WORKER] Bin area calculated:', binarea);
        var key, nfp;
        
        console.log('[PLACEMENT WORKER] Starting placement loop...');
        while(paths.length > 0){
            console.log('[PLACEMENT WORKER] Placing paths, remaining:', paths.length);
            console.log('[WIDTH-FIRST STRATEGY] Using width-first placement: bottom-to-top rows, left-to-right within rows');
            console.log('[ORDER-GROUPING STRATEGY] Attempting to place complete orders together');
            
            var placed = [];
            var placements = [];
            fitness += 1; // add 1 for each new bin opened (lower fitness is better)

            // Group paths by orderId for order-based placement
            var orderGroups = {};
            var ungroupedPaths = [];
            
            for(i = 0; i < paths.length; i++){
                var orderId = paths[i].source?.orderId || paths[i].source?.order_id || 'unknown';
                if(orderId && orderId !== 'unknown'){
                    if(!orderGroups[orderId]){
                        orderGroups[orderId] = [];
                    }
                    orderGroups[orderId].push(paths[i]);
                } else {
                    ungroupedPaths.push(paths[i]);
                }
            }
            
            console.log(`[ORDER-GROUPING] Found ${Object.keys(orderGroups).length} order groups and ${ungroupedPaths.length} ungrouped paths`);
            
            // Sort order groups by size (smaller orders first for better packing)
            var sortedOrderGroups = Object.entries(orderGroups).sort((a, b) => a[1].length - b[1].length);
            
            // Try to place complete orders first
            for(var orderIndex = 0; orderIndex < sortedOrderGroups.length; orderIndex++){
                var [orderId, orderPaths] = sortedOrderGroups[orderIndex];
                
                console.log(`[ORDER-PLACEMENT] Attempting to place order ${orderId} with ${orderPaths.length} parts`);
                
                var orderPlaced = false;
                var maxAttempts = 3;
                
                // Try up to 3 different placement strategies for this order
                for(var attempt = 1; attempt <= maxAttempts && !orderPlaced; attempt++){
                    console.log(`[ORDER-PLACEMENT] Order ${orderId} - Attempt ${attempt}/${maxAttempts}`);
                    
                    var tempPlaced = [];
                    var tempPlacements = [];
                    var attemptSuccessful = true;
                    
                    // Create a copy of current state to test order placement
                    var testPlaced = [...placed];
                    var testPlacements = [...placements];
                    
                    // Different strategies for different attempts
                    var sortedOrderPaths;
                    if(attempt === 1){
                        // Strategy 1: Place largest parts first
                        sortedOrderPaths = [...orderPaths].sort((a, b) => {
                            var aArea = Math.abs(GeometryUtil.polygonArea(a));
                            var bArea = Math.abs(GeometryUtil.polygonArea(b));
                            return bArea - aArea;
                        });
                    } else if(attempt === 2){
                        // Strategy 2: Place smallest parts first  
                        sortedOrderPaths = [...orderPaths].sort((a, b) => {
                            var aArea = Math.abs(GeometryUtil.polygonArea(a));
                            var bArea = Math.abs(GeometryUtil.polygonArea(b));
                            return aArea - bArea;
                        });
                    } else {
                        // Strategy 3: Original order
                        sortedOrderPaths = [...orderPaths];
                    }
                    
                    // Try to place all parts of this order
                    for(var partIndex = 0; partIndex < sortedOrderPaths.length; partIndex++){
                        var orderPath = sortedOrderPaths[partIndex];
                        var partPosition = null;
                        
                        // Use the same placement logic as individual parts
                        partPosition = tryPlaceSinglePart(orderPath, testPlaced, testPlacements, self);
                        
                        if(partPosition){
                            testPlaced.push(orderPath);
                            testPlacements.push(partPosition);
                            tempPlaced.push(orderPath);
                            tempPlacements.push(partPosition);
                        } else {
                            console.log(`[ORDER-PLACEMENT] Order ${orderId} - Could not place part ${orderPath.id} in attempt ${attempt}`);
                            attemptSuccessful = false;
                            break;
                        }
                    }
                    
                    if(attemptSuccessful){
                        // All parts of the order were successfully placed
                        console.log(`[ORDER-PLACEMENT] Successfully placed complete order ${orderId} with ${tempPlaced.length} parts on attempt ${attempt}`);
                        placed = testPlaced;
                        placements = testPlacements;
                        orderPlaced = true;
                        
                        // Remove this order from orderGroups so it's not processed again
                        delete orderGroups[orderId];
                    }
                }
                
                if(!orderPlaced){
                    console.log(`[ORDER-PLACEMENT] Failed to place complete order ${orderId} after ${maxAttempts} attempts - will try individual placement`);
                }
            }
            
            // Now process remaining paths individually (failed orders + ungrouped paths)
            var remainingPaths = ungroupedPaths.slice();
            
            // Add parts from failed orders back to individual processing
            for(var failedOrderId in orderGroups){
                remainingPaths = remainingPaths.concat(orderGroups[failedOrderId]);
            }
            
            console.log(`[INDIVIDUAL-PLACEMENT] Processing ${remainingPaths.length} remaining paths individually`);

            for(i=0; i<remainingPaths.length; i++){
                path = remainingPaths[i];
                
                // Use helper function to try placing this individual part
                var position = tryPlaceSinglePart(path, placed, placements, self);
                
                if(position){
                    console.log(`[INDIVIDUAL-PLACEMENT] Successfully placed ${path.id} at (${position.x.toFixed(2)}, ${position.y.toFixed(2)})`);
                    placed.push(path);
                    placements.push(position);
                } else {
                    console.log(`[INDIVIDUAL-PLACEMENT] Could not find valid position for ${path.id} on current sheet`);
                    // Part couldn't be placed on current sheet - it will remain in paths for next sheet
                }
            }
            
            // Calculate fitness based on placed parts
            var minwidth = null;
            if(placed.length > 0) {
                // Simple approximation - use the bounding box of all placed parts
                var allPoints = [];
                for(var i = 0; i < placed.length; i++){
                    for(var j = 0; j < placed[i].length; j++){
                        allPoints.push({
                            x: placed[i][j].x + placements[i].x,
                            y: placed[i][j].y + placements[i].y
                        });
                    }
                }
                if(allPoints.length > 0) {
                    var bounds = GeometryUtil.getPolygonBounds(allPoints);
                    minwidth = bounds.width;
                }
            }
            
            if(minwidth){
                fitness += minwidth/binarea;
            }
            
            for(i=0; i<placed.length; i++){
                var index = paths.indexOf(placed[i]);
                if(index >= 0){
                    paths.splice(index,1);
                }
            }
            
            if(placements && placements.length > 0){
                allplacements.push(placements);
            }
            else{
                break; // something went wrong
            }
        }
        
        // there were parts that couldn't be placed
        fitness += 2*paths.length;
        
        console.log('[PLACEMENT WORKER] placePaths completed successfully');
        console.log('[PLACEMENT WORKER] Result summary:', {
            placementsCount: allplacements.length,
            fitness: fitness,
            unplacedPaths: paths.length,
            binArea: binarea
        });
        
        return {placements: allplacements, fitness: fitness, paths: paths, area: binarea };
    };

    // Add a place() method to match the interface expected by deepnest.js
    this.place = function() {
        console.log('[PLACEMENT WORKER] place() method called');
        
        // Use the paths from the constructor or create from the provided paths
        const pathsToPlace = this.paths || [];
        
        if (pathsToPlace.length === 0) {
            console.warn('[PLACEMENT WORKER] No paths to place');
            return { success: false, placements: [], fitness: Infinity };
        }
        
        console.log(`[PLACEMENT WORKER] Placing ${pathsToPlace.length} paths`);
        
        // Call the existing placePaths method
        const result = this.placePaths(pathsToPlace);
        
        if (!result) {
            console.warn('[PLACEMENT WORKER] placePaths returned null');
            return { success: false, placements: [], fitness: Infinity };
        }
        
        // Convert the result to the expected format
        const placements = [];
        if (result.placements && result.placements.length > 0) {
            // Flatten all bin placements into a single array
            for (const binPlacements of result.placements) {
                for (const placement of binPlacements) {
                    placements.push({
                        id: placement.id,
                        x: placement.x,
                        y: placement.y,
                        rotation: placement.rotation || 0
                    });
                }
            }
        }
        
        console.log(`[PLACEMENT WORKER] Returning ${placements.length} placements with fitness ${result.fitness}`);
        
        return {
            success: placements.length > 0,
            placements: placements,
            fitness: result.fitness || Infinity,
            unplacedPaths: result.paths || []
        };
    };

}

// clipperjs uses alerts for warnings
function alert(message) { 
    console.log('alert: ', message);
}

// Export for both CommonJS and ES modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PlacementWorker, rotatePolygon, toClipperCoordinates, toNestCoordinates };
} else if (typeof window !== 'undefined') {
    window.PlacementWorker = PlacementWorker;
    window.rotatePolygon = rotatePolygon;
} else if (typeof self !== 'undefined') {
    self.PlacementWorker = PlacementWorker;
    self.rotatePolygon = rotatePolygon;
} 