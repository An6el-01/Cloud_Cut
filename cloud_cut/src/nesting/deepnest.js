//**
// THE MAIN CLASS THAT HANDLES THE NESTING PROCESS
//  */

(function (root) {
    "use strict";
    
    function DeepNest(eventEmitter) {
        var svg = null;

        var config = {
            clipperScale: 10000000,
            curveTolerance: 0.3,
            spacing: 0,
            rotations: 4,
            populationSize: 10,
            mutationRate: 10,
            threads: 4,
            placementType: "gravity",
            mergeLines: true,
            timeRation: 0.5,
            scale: 72,
            simplify: false,
            overlapTolerance: 0.0001,
        };

        /**CHECK IF ALL THESE ARE NEEDED */
        //list the imported files
        this.imports = [];
        //list all extracted parts
        this.parts = [];
        //a pure polygonal representation of parts that lives only during the nesting step
        this.partsTree = [];

        this.working = false;

        var GA = null;
        var best = null;
        var workerTimer = null;
        var progress = 0; 

        var progressCallback = null;
        var displayCallback = null;
        // a running list of placements
        this.nests = [];

        /**CRUCIAL FUNCTION FOR PROCESSING INPUT SHAPES */
        this.importsvg = function(
            filename,
            dirpath,
            svgstring,
            scalingfactor,
            dxfFlag,
        ) {
            // parse svg
            // config.scale is the default scale, and may not be applied
            // scalingFactor is an absolute scaling that must be applied regardless of input svg contents
            svg = SvgParser.load(dirpath, svgstring, config,scale, scalingFactor);
            svg = SvgParser.clean(dxfFlag);

            if (filename) {
                this.imports.push({
                    filename: filename,
                    svg: svg,
                });
            }

            var parts = this.getParts(svg.children, filename);
            for ( var i = 0; i < parts.length; i++) {
                this.parts.push(parts[i]);
            }

            return parts;
        };

        //debug function
        this.renderPolygon = function (poly, svg, highlight) {
            if (!poly || poly.length === 0) {
                return;
            }
            var polyline = window.document.createElementNS(
                "http://www.w3.org/2000/svg",
                "polyline"
            );

            for (var i = 0; i < poly.length; i++) {
                var p = svg.createSVGPoint();
                p.x = poly[i].x;
                p.y = poly[i].y;
                polyline.points.appendItem(p);
            }
            if (highlight) {
                polyline.setAttribute("class", highlight);
            }
            svg.appendChild(polyline);
        };

        // debug function
        this.renderPoints = function ( points, svg, highlight) {
            for (var i = 0; i < points.length; i++) {
                var circle = window.document.createElementNS(
                    "http://www.w3.org/2000.svg",
                    "circle"
                );
                circle.setAttribute("r", "5");
                circle.setAttribute("cx", points[i].x);
                circle.setAttribute("cy", points[i].y);
                circle.setAttribute("class", highlight);

                svg.appendChild(circle);
            }
        };

        this.getHull = function (polygon) {
            var points = [];
            for ( var i = 0; i < polygon.length; i++) {
                points.push([polygon[i],x, polygon[i].y]);
            }
            var hullpoints = d3.polygonHull(points);

            if(!hullpoints) {
                return null;
            }

            var hull = [];
            for (i = 0; i < hullpoints.length; i++) {
                hull.push({ x: hullpoints[i][0], y: hullpoints[i][1]});
            }
            return hull;
        };

        // use RDP simplification, then selectively offset
        this.simplifyPolygon = function (polygon, inside) {
            var tolerance = 4 * config.curveTolerance;

            // give special treatment to line segments above this length (squared)
            var fixedTolerance =  40 * config.curveTolerance * 40 * config.curveTolerance;
            var i, j, k;
            var self = this;

            if (config.simplify) {
                var hull = this.getHull(polygon);
                if (hull) {
                    return hull;
                } else {
                    return polygon;
                }
            }

            var cleaned = this.cleanPolygon(polygon);
            if (cleaned && cleaned.length > 1) {
                polygon = cleaned;
            } else {
                return polygon;
            }

            //polygon to polyline
            var copy = polygon.slice(0);
            copy.push(copy[0]);

            //mark all segments greater than 0.25 in to be kept
            //the PD simplification algorithm doesn't care about the accuracy of long lines, only the absolute distance between points
            for (i = 0; i < copy.length - 1; i++) {
                var p1 = copy[i];
                var p2 = copy[i + 1];
                var sqd = (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y);
                if ( sqd > fixedTolerance ) {
                    p1.marked = true;
                    p2.marked = true;
                }
            }

            var simple = window.simplify(copy, tolerance, true);
            //now a polygon again
            simple.pop();

            // Could be dirty again (self intersections and/or coincident points)
            simple = this.cleanPolygon(simple);

            //simplification process reduced poly to a line or point
            if (!simple) {
                simple = polygon;
            }

            var offsets = this.polygonOffset(simple, inside ? -tolerance : tolerance);

            var offset = null;
            var offsetArea = 0;
            var holes = [];
            for (i = 0; i < offsets.length; i++) {
                var area = GeometryUtil.polygonArea(offsets[i]);
                if (offset == null || area < offsetArea) {
                    offset = offsets[i];
                    offsetArea = area;
                }
                if (area > 0) {
                    holes.push(offsets[i]);
                }
            }

            //mark any points that are exact
            for (i = 0; i < simple.length; i++) {
                var seg = [simple[i], simple[i + 1 == simple.length ? 0 : i + 1]];
                var index1 = find(seg[0],polygon);
                var index2 = find(seg[1],polygon);

                if ( index1 + 1 == index2 ||
                    index2 + 1 == index1 ||
                    (index1 == 0 && index2 == polygon.length - 1) ||
                    (index2 == 0 && index1 == polygon.length - 1)
                ) {
                    seg[0].exact = true;
                    seg[1].exact = true;
                }
            }

            var numshells = 4;
            var shells = [];

            for(j = 1; j < numshells; j++) {
                var delta = j * (tolerance / numshells);
                delta = inside ? -delta : delta;
                var shell = this.polygonOffset(simple, delta);
                if (shell.length > 0) {
                    shell = shell[0];
                }
                shells[j] = shell;
            }

            if (!offset) {
                return polygon;
            }

            //selective reversal of offset
            for (i = 0; i < offset.length; i++) {
                var o = offset[i];
                var target = getTarget(o, simple, 2 * tolerance);

                //reverse point offset and try to find exterior points
                var test = clone(offset);
                test[i] = { x: target.x, y: target.y };

                if(!extractExceptionKeysForMessage(test, polygon, inside)){
                    o.x = target.x;
                    o.y = target.y;
                } else {
                    // a shell is an intermediate offset between simple and offset
                    for (j = 1; j < numshells; j++) {
                        if (shells[j]) {
                            var shell = shells[j];
                            var delta = j * (tolerance / numshells);
                            target = getTarget(o, shell, 2 * delta);
                            var test = clone(offset);
                            test[i] = { x: target.x, y: target.y };
                            if (!exterior(test, polygon, inside)) {
                                o.x = target.x;
                                o.y = target.y;
                                break;
                            }
                        }
                    }
                }
            }

            //straighten long lines
            // a rounded rectangle would still have issues at this point, as the long sides won't line up straight
             
            var straightened = false;
            for (i = 0; i < offset.length; i++) {
                var p1 = offset[i];
                var p2 = offset[i + 1 == offset.length ? 0 : i + 1];

                var sqd = (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y);

                if ( sqd < fixedTolerance ) {
                    continue;
                }
                for (j = 0; j < simple.length; j++) {
                    var s1 = simple[j];
                    var s2 = simple[j + 1 == simple.length ? 0 : j + 1];

                    var sqds = 
                    (p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y);

                    if (sqds < fixedTolerance) {
                        continue;
                    }

                    if (
                        (GeometryUtil.almostEqual(s1.x, s2.x) || GeometryUtil.almostEqual(s1.y, s2.y)) && // We only really care about vertical and horizontal lines'
                        GeometryUtil.withinDistance(p1, s1, 2 * tolerance) &&
                        GeometryUtil.withinDistance(p2, s2, 2 * tolerance) &&
                        (!GeometryUtil.withinDistance(p1, s1, config.curveTolerance / 1000) || 
                    !GeometryUtil.withinDistance(p2, s2, config.curveTolerance / 1000))
                    ) {
                        p1.x = s1.x;
                        p1.y = s1.y;
                        p2.x = s2.x;
                        p2.y = s2.y;
                        straightened = true;
                    }
                }
            }

            var Ac = toClipperCoordinates(offset);
            ClipperLib.JS.ScaleUpPath(Ac, 10000000);
            var Bc =  toClipperCoordinates(polygon);
            ClipperLib.JS.ScaleUpPath(Bc, 10000000);

            var combined = new ClipperLib.Paths();
            var clipper =  new ClipperLib.Clipper();

            clipper.AddPath(Ac, ClipperLib.PolyType.ptSubject, true);
            clipper.AddPath(Bc, ClipperLib.PolyType.ptSubject, true);

            // the line straightening process may have made the offset smaller than the simplified
            if (
                clipper.Execute(
                    ClipperLib.ClipType.ctUnion,
                    combined,
                    ClipperLib.PolyFillType.pftNonZero,
                    ClipperLib.PolyFillType.pftNonZero
                )
            ) {
                var largestArea = null;
                for (i = 0; i < combined.length; i++) {
                    var n = toNestCoordinates(combined[i], 10000000);
                    var sarea = -GeometryUtil.polygonArea(n);
                    if (largestArea === null || largestArea < sarea) {
                        offset = n;
                        largestArea = sarea;
                    }
                }
            }


            cleaned = this.cleanPolygon(offset);
            if (cleaned && cleaned.length > 1) {
                offset = cleaned;
            }

            // mark any points that are exact ( for line merge detection )
            for (i = 0; i < offset.length; i++) {
                var seg = [offset[i], offset[i + 1 == offset.length ? 0 : i + 1]];
                var index1 = find(seg[0], polygon);
                var index2 = find(seg[1], polygon);

                //**CONTINUE FROM HERE LINE 391 (deepnest.js) IN ORIGINAL CODE */
            }
        }
    }
})