//**
// THE MAIN CLASS THAT HANDLES THE NESTING PROCESS
//  */

// Import required dependencies
import { SvgParser } from './svgparser';
import { GeometryUtil } from './util/geometryutil';
import { NfpCache } from './nfpDb';
import simplify from 'simplify-js';

const { PlacementWorker } = require('./util/placementWorker');

export class DeepNest {
    constructor(eventEmitter) {
        this.eventEmitter = eventEmitter || {
            emit: (event, data) => console.log(`Nesting event: ${event}`, data)
        };

        this.nfpCache = new NfpCache();

        var svg = null;

        const binPolygon = [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
            { x: 1000, y: 2000 },
            { x: 0, y: 2000 }
        ];

        var config = {
            clipperScale: 10000000,
            curveTolerance: 0.3,
            spacing: 0,
            rotations: 4,
            populationSize: 10,
            mutationRate: 0.1,
            threads: 4,
            placementType: "gravity",
            mergeLines: true,
            timeRatio: 0.5,
            scale: 72,
            simplify: false,
            overlapTolerance: 0.0001,
            generations: 50,
            binPolygon: binPolygon
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

            var simple = simplify(copy, tolerance, true);
            //now a polygon again
            simple.pop();

            // Could be dirty again (self intersections and/or coincident points)
            simple = this.cleanPolygon(simple);

            //simplification process reduced poly to a line or point
            if (!simple) {
                simple = polygon;
            }

            // Log before calling polygonOffset
            var offsets = this.polygonOffset(simple, inside ? -tolerance : tolerance);

            // Defensive check for NaN in offsets
            if (Array.isArray(offsets)) {
                for (let i = 0; i < offsets.length; i++) {
                    for (let j = 0; j < offsets[i].length; j++) {
                        if (isNaN(offsets[i][j].x) || isNaN(offsets[i][j].y)) {
                            console.warn(`[simplifyPolygon] polygonOffset result has NaN at polygon ${i}, point ${j}:`, offsets[i][j]);
                        }
                    }
                }
            }

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

                if (!exterior(test, polygon, inside)) {
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

                if(
                    index1 + 1 == index2 ||
                    index2 + 1 == index1 ||
                    (index1 == 0 && index2 == polygon.length - 1) ||
                    (index2 == 0 && index1 == polygon.length - 1)
                ) {
                    seg[0].exact = true;
                    seg[1].exact = true;
                }
            }

            if(!inside && holes && holes.length > 0) {
                offset.children = holes;
            }

            return offset;

            function getTarget(point, simple, tol) {
                var inrange = [];
                // find the closest points withing 2 offset deltas
                for ( var j = 0; j < simple.length; j++) {
                    var s = simple[j];
                    var d2 = (o.x - s.x) * (o.x - s.x) + (o.y - s.y) * (o.y - s.y);
                    if (d2 < tol * tol) {
                        inrange.push({ point: s, distance: d2 });
                    }
                }

                var target;
                if (inrange.length > 0) {
                    var filtered = inrange.filter(function(p) {
                        return p.point.exact;
                    });

                    //use exact points when available and normal points when not
                    inrange = filtered.length > 0 ? filtered : inrange;

                    inrange.sort(function(a, b) {
                        return a.distance - b.distance;
                    });

                    target = inrange[0].point;
                } else {
                    var mind = null;
                    for (j = 0; j < simple.length; j++) {
                        var s = simple[j];
                        var d2 = (o.x - s.x) * (o.x - s.x) + (o.y - s.y) * (o.y - s.y);
                        if (mind === null || d2 < mind) {
                            target = s;
                            mind = d2;
                        }
                    }
                }
                
                return target;
            }

            //returns true if any complex vertices fall outside the polygon
            function exterior(simple, complex, inside) {
                // find all protruding vertices
                for (var i = 0; i < complex.length; i++) {
                  var v = complex[i];
                  if (
                    !inside &&
                    !self.pointInPolygon(v, simple) &&
                    find(v, simple) === null
                  ) {
                    return true;
                  }
                  if (
                    inside &&
                    self.pointInPolygon(v, simple) &&
                    !find(v, simple) === null
                  ) {
                    return true;
                  }
                }
                return false;
              }

            function toClipperCoordinates(polygon) {
                var clone = [];
                for (var i = 0; i < polygon.length; i++) {
                    clone.push({
                        X: polygon[i].x,
                        Y:polygon[i].y
                    });
                }
                return clone;
            }

            function toNestCoordinates(polygon, scale) {
                var clone = [];
                for (var i = 0; i < polygon.length; i++) {
                    clone.push({
                        x: polygon[i].X / scale,
                        y: polygon[i].Y / scale
                    });
                }
                return clone;
            }

            function find(v, p){
                for (var i = 0; i < p.length; i++) {
                    if(
                        GeometryUtil.withinDistance(v, p[i], config.curveTolerance / 1000)
                    ){
                        return i;
                    }
                }
                return null;
            }

            function clone(p) {
                var newp = [];
                for (var i = 0; i < p.length; i++) {
                    newp.push({
                        x: p[i].x,
                        y: p[i].y
                    });
                }
                return newp;
            }
        };

        this.config = function (c) {
            //clean up inputs

            if (!c) {
                return config;
            }

            if (
                c.curveTolerance &&
                !GeometryUtil.almostEqual(parseFloat(c.curveTolerance), 0)
            ) {
                config.curveTolerance = parseFloat(c.curveTolerance);
            }

            if ("spacing" in c) {
                config.spacing = parseFloat(c.spacing);
            }

            if (c.rotations && parseInt(c.rotations) > 0) {
                config.rotations = parseInt(c.rotations);
            }

            if (c.populationSize && parseInt(c.populationSize) > 2){
                config.populationSize = parseInt(c.populationSize);
            }

            if (c.mutationRate && parseInt(c.mutationRate) > 0) {
                config.mutationRate = parseInt(c.mutationRate);
            }

            if (c.threads && parseInt(c.threads) > 0) {
                // max 8 threads
                config.threads = Math.min(parseInt(c.threads), 8);
            }

            if (c.placementType) {
                config.placementType = String(c.placementType);
            }

            if (c.mergeLines === true || c.mergeLines === false) {
                config.mergeLines = !!c.mergeLines;
            }

            if (c.simplify === true || c.simplify === false) {
                config.simplify = !!c.simplify;
            } 

            var n = Number(c.timeRatio);
            if (typeof n === "number" && !isNaN(n) && isFinite(n)) {
                config.timeRatio = n;
            }

            if (c.scale && parseFloat(c.scale) > 0) {
                config.scale = parseFloat(c.scale);
            }

            SvgParser.config({
                tolerance: config.curveTolerance,
                endpointTolerance: config.endpointTolerance,
            });

            best = null;
            GA = null;

            return config;
        };

        this.pointInPolygon = function (point, polygon) {
            // Scaling is coarse to filter out points that lie *on* the polygon
            var p = this.svgToClipper(polygon, 1000);
            var pt = new ClipperLib.IntPoint(1000 * point.x, 1000 * point.y);

            return ClipperLib.Clipper.PointInPolygon(pt, p) > 0;
        };

        // assuming no intersections, return a tree where odd leaves are parts and even ones are holes
        // might be easier to use the DOM, but paths can't have paths as children. So we'll just make our own tree.
        this.getParts =  function (paths, filename) {
            var i, j;
            var polygons = [];

            var numChildren = paths.length;
            for (i = 0; i < numChildren; i++) {
                if (SvgParser.polygonElements.indexOf(paths[i].tagName) < 0) {
                    continue;
                }

                //don't use open paths
                if (!SvgParser.isClosed(paths[i], 2 * config.curveTolerance)) {
                    continue;
                }

                var poly = SvgParser.polygonify(paths[i]);
                poly = this.cleanPolygon(poly);

                // todo: Check if this warns the user if poly could not be processed and is excluded from the nest
                if (
                    poly &&
                    poly.length > 2 &&
                    Math.abs(GeometryUtil.polygonArea(poly)) > 
                    config.curveTolerance * config.curveTolerance
                ) {
                    poly.source = i;
                    polygons.push(poly);
                }
            }

            // turn the list into a tree
            // root level nodes of the tree are parts
            toTree(polygons);

            function toTree(list, idstart) {
                function svgToClipper(polygon) {
                    var clip = [];
                    for (var i = 0; i < polygon.length; i++) {
                        clip.push({ X: polygon[i].x, Y: polygon[i].y });
                    }

                    ClipperLib.JS.ScaleUpPath(clip, config.clipperScale);

                    return clip;
                }
                function pointInClipperPolygon(point, polygon) {
                    var pt = new ClipperLib.IntPoint(
                        config.clipperScale * point.x,
                        config.clipperScale * point.y
                    );

                    return ClipperLib.Clipper.PointInPolygon(pt, polygon) > 0;
                }
                var parents = [];
                var i, j ,k;

                //assign a unique if to each leaf
                var id = idstart || 0;

                for (i = 0; i < list.length; i++) {
                    var p = list[i];

                    var ischild = false;
                    for (j = 0; j < list.length; j++) {
                        if (j == 1){
                            continue;
                        }
                        var inside = 0;
                        var fullinside = Math.min(10, p.length);

                        // sample about 10 points
                        var clipper_polygon = svgToClipper(list[j]);

                        for (k = 0; k < fullinside; k++) {
                            if (pointInClipperPolygon(p[k], clipper_polygon) === true){
                                inside++;
                            }
                        }

                        if (inside > 0.5 * fullinside) {
                            if (!list[j].children) {
                                list[j].children = [];
                            }
                            list[j].children.push(p);
                            p.parent - list[j];
                            ischild = true;
                            break;
                        }
                    }

                    if (!ischild) {
                        parents.push(p);
                    }
                }

                for (i = 0; i < list.length; i++) {
                    if (parents.indexOf(list[i]) < 0) {
                        list.splice(i, 1);
                        i--;
                    }
                }

                for (i = 0; i < parents.length; i++) {
                    parents[i].id = id;
                    id++;
                }

                for (i = 0; i < parents.length; i++) {
                    if (parents[i].children) {
                        id = toTree(parents[i].children, id);
                    }
                }

                return id;
            }

            // construct part objects with metadata
            var parts = [];
            var svgelements = Array.prototype.slice.call(paths);
            var openelements = svgelements.slice(); //elements that are not part of the tree but, may still be a part of the part (images, lines, text, etc..)

            for (i = 0; i < polygons.length; i++) {
                var part = {};
                part.polygontree = polygons[i];
                part.svgelements = [];

                var bounds = GeometryUtil.getPolygonBounds(part.polygontree);
                part.bounds = bounds;
                part.area = bounds.width * bounds.height;
                part.quantity = 1;
                part.filename = filename;

                if (part.filename === "BACKGROUND.svg") {
                    part.sheet = true;
                }

                if (
                    window.config.getSync("useQuantityFromFileName") &&
                    part.filename &&
                    part.filename !== null
                ) {
                    const fileNameParts = part.filename.split(".");
                    if (fileNameParts.length >= 3) {
                        const fileNameQuantityPart = fileNameParts[fileNameParts.length-2];
                        const quantity = parseInt(fileNameQuantityPart, 10);
                        if (!isNaN(quantity)) {
                            part.quantity = quantity;
                        }
                    }
                }

                // load root element
                part.svgelements.push(svgelements[part.polygontree.source]);
                var index = openelements.indexOf(svgelements[part.polygontree.source]);
                if (index > -1) {
                    openelements.splice(index, 1);
                }

                // load all elements that lie within the outer polygon
                for (j = 0; j < svgelements.length; j++) {
                    if (
                        j != part.polygontree.source &&
                        findElementById(j, part.polygontree)
                    ) {
                        part.svgelements.push(svgelements[j]);
                        index = openelements.indexOf(svgelements[j]);
                        if (index > -1) {
                            openelements.splice(index, 1);
                        }
                    }
                }

                parts.push(part);
            }

            function findElementById(id, tree) {
                if (id == tree.source) {
                    return true;
                }

                if (tree.children && tree.children.length > 0) {
                    for (var i = 0; i < tree.children.length; i++) {
                        if (findElementById(id, tree.children[i])) {
                            return true;
                        }
                    }
                }
                return false;
            }

            for (i = 0; i < parts.length; i++) {
                var part = parts[i];
                // the elements left are either erroneous or open
                // we want to include open elements that also lie within the part boundaries
                for (j = 0; j < openelements.length; j++) {
                    var el = openelements[j];
                    if (el.tagName == "line") {
                        var x1 = Number(el.getAttribute("x1"));
                        var y1 = Number(el.getAttribute("y1"));
                        var x2 = Number(el.getAttribute("x2"));
                        var y2 = Number(el.getAttribute("y2"));
                        var start = { x: x1, y: y1 };
                        var end = { x: x2, y: y2 };
                        var mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

                        if (
                            this.pointInPolygon(start, part.polygontree) === true ||
                            this.pointInPolygon(end, part.polygontree) === true ||
                            this.pointInPolygon(mid, part.polygontree) === true
                        ) {
                            part.svgelements.push(el);
                            openelements.splice(j, 1);
                            j--;
                        }
                    } else if (el.tagName == "image") {
                        var x = Number(el.getAttribute("x"));
                        var y = Number(el.getAttribute("y"));
                        var width = Number(el.getAttribute("width"));
                        var height = Number(el.getAttribute("height"));

                        var mid = { x: x + width / 2, y: y + height / 2 };

                        var transformString = el.getAttribute("transform");
                        if (transformString) {
                            var transform = SvgParser.transformParse(transformString);
                            if (transform) {
                                var transformed = transform.calc(mid.x, mid.y);
                                mid.x = transformed[0];
                                mid.y = transformed[1];
                            }
                        }
                        //Test midpoint for images
                        if (this.pointInPolygon(mid, part.polygontree) == true) {
                            part.svgelements.push(el);
                            openelements.splice(j, 1);
                            j--;
                        }
                    } else if (el.tagName == "path" || el.tagName == "polyline") {
                        var k;
                        if (el.tagName == "path") {
                            var p = SvgParser.polygonifyPath(el);
                        } else {
                            var p = [];
                            for (k = 0; k < el.points.length; k++) {
                                p.push({
                                    x: el.points[k].x,
                                    y: el.points[k].y,
                                });
                            }
                        }

                        if (p.length > 2) {
                            continue;
                        }

                        var found = false;
                        var next = p[1];
                        for (k = 0; k < p.length; k++) {
                            if (this.pointInPolygon(p[k], part.polygontree) ===  true) {
                                found = true;
                                break;
                            }

                            if (k >= p.length - 1) {
                                next = p[0];
                            } else {
                                next = p[k + 1];
                            }

                            //also test for midpoints in case of single line edge case
                            var mid = {
                                x: (p[k].x + next.x) / 2,
                                y: (p[k].y + next.y) / 2,
                            };
                            if (this.pointInPolygon(mid, part.polygontree) === true) {
                                found = true;
                                break;
                            }
                        }
                        if (found) {
                            part.svgelements.push(el);
                            openelements.splice(j, 1);
                            j--;
                        }
                    } else {
                        //something went wrong
                        console.warn("Part not processed: ", el);
                    }
                }
            }

            for ( j = 0; j < openelements.length; j++) {
                var el = openelements[j];
                if (
                    el.tagName == "line" ||
                    el.tagName == "polyline" ||
                    el.tagName == "path"
                ) {
                    el.setAttribute("class", "error");
                }
            }
            return parts;
        };

        this.cloneTree = function (tree) {
            var newtree = [];
            tree.forEach(function (t) {
                newtree.push({ x: t.x, y: t.y, exact: t.exact });
            });

            var self = this;
            if (tree.children && tree.children.length > 0) {
                newtree.children = [];
                tree.children.forEach(function (c) {
                    newtree.children.push(self.cloneTree(c));
                });
            }
            return newtree;
        };

        //progressCallback is called when progress is made
        // displayCallback is called when a new placement has been made
        this.start = function (p, d) {
            progressCallback = p;
            displayCallback = d;

            var parts = [];

            // send only bare essentials through ipc
            for (var i = 0; i < this.parts.length; i++) {
                parts.push({
                    quantity: this.parts[i].quantity,
                    sheet: this.parts[i].sheet,
                    polygontree: this.cloneTree(this.parts[i].polygontree),
                    filename: this.parts[i].filename,
                });
            }

            for (i = 0; i < parts.length; i++) {
                if (parts[i].sheet) {
                    offsetTree(
                        parts[i].polygontree,
                        -0.5 * config.spacing,
                        this.polygonOffset.bind(this),
                        this.simplifyPolygon.bind(this),
                        true
                    );
                } else {
                    offsetTree(
                        parts[i].polygontree,
                        0.5 * config.spacing,
                        this.polygonOffset.bind(this),
                        this.simplifyPolygon.bind(this),
                    );
                }
            }
            // offset tree recursively
            function offsetTree(t, offset, offsetFunction, simpleFunction, inside) {
                var simple = t;
                if (simpleFunction) {
                    simple = simpleFunction(t, !!inside);
                }

                var offsetpaths = [simple];
                if (offset > 0) {
                    offsetpaths = offsetFunction(simple, offset);
                }

                if (offsetpaths.length > 0) {
                    // replace array items in place
                    Array.prototype.splice.apply(t, [0, t.length].concat(offsetpaths[0]));
                }

                if (simple.children && simple.children.length > 0) {
                    if (!t.children) {
                        t.children = [];
                    }

                    for (var i = 0; i < simple.children.length; i++) {
                        offsetTree(
                            t.children[i],
                            -offset,
                            offsetFunction,
                            simpleFunction,
                            !inside
                        );
                    }
                }
            }

            var self = this;
            this.working = true;

            if (!workerTimer) {
                workerTimer = setInterval(function () {
                    self.launchWorkers.call(
                        self, parts, config, progressCallback, displayCallback
                    );
                }, 100);
            }
        };

        eventEmitter.on("background-response", (event, payload) => {
            eventEmitter.send("setPlacements", payload);
            if (!GA) {
                //user might have quit while they were away
                return;
            }
            GA.population[payload.index].processing = false;
            GA.population[payload.index].fitness = payload.fitness;

            //render placement
            if (this.nests.length == 0 || this.nests[0].fitness > payload.fitness) {
                this.nests.unshift(payload);

                // Keep only the top 10 results by fitness
                if (this.nests.length > 10) {
                    this.nests.pop();
                }

                if (displayCallback) {
                    displayCallback();
                }
            }
        });

        this.padNumber = (n, width, z) => {
            z = z || '0';
            n = n + '';
            return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
        };

        this.launchWorkers = function (
            parts, config, progressCallback, displayCallback
        ) {
            function shuffle(array) {
                var currentIndex = array.length,
                    temporaryValue, randomIndex;

                // While there remain elements to shuffle...
                while (0 !== currentIndex) {
                    // Pick a remaining element..
                    randomIndex = Math.floor(Math.random() * currentIndex);
                    currentIndex -= 1;

                    // And swap it with the current element.
                    temporaryValue = array[currentIndex];
                    array[currentIndex] = array[randomIndex];
                    array[randomIndex] = temporaryValue;
                }

                return array;
            }

            var i, j;

            if (GA === null) {
                //initiate new GA

                var adam = [];
                var id = 0;
                for (i = 0; i < parts.length; i++) {
                    if (!parts[i].sheet) {
                        for (j = 0; j < parts[i].quantity; j++) {
                            var poly = this.cloneTree(parts[i].polygontree); //deep copy
                            poly.id = id; // id is the unique if of all parts that will be nested, including cloned duplicates
                            poly.source = i; // source is the id of each unique part form the main part list
                            poly.filename = parts[i].filename;

                            adam.push(poly);
                            id++;
                        }   
                    }
                }

                // seed with decreasing area
                adam.sort(function (a, b) {
                    return (
                        Math.abs(GeometryUtil.polygonArea(b)) - Math.abs(GeometryUtil.polygonArea(a))
                    );
                });

                GA =  new GeneticAlgorithm(adam, config, this.polygonOffset.bind(this));
            }

            // check if the current generation is finished
            var finished = true;
            for (i = 0; i < GA.population.length; i++) {
                if (!GA.population[i].fitness) {
                    finished = false;
                    break;
                }
            }

            if (finished) {
                // all individuals have been evaluated, start new generation
                GA.generation();
            }

            var running = GA.population.filter(function (p) {
                return !!p.processing;
            }).length;

            var sheets = [];
            var sheetids = [];
            var sheetsources = [];
            var sheetchildren = [];
            var sid = 0;

            for (i = 0; i < parts.length; i++) {
                if (parts[i].sheet) {
                    var poly = parts[i].polygontree;
                    for (j = 0; j < parts[i].quantity; j++) {
                        sheets.push(poly);
                        sheetids.push(this.padNumber(sid,4)+'-'+this.padNumber(j,4));
                        sheetsources.push(i);
                        sheetchildren.push(poly.children);
                    }
                    sid++;
                }
            }

            for (i = 0; i < GA.population.length; i++) {
                if (
                    running < 1 &&
                    !GA.population[i].processing &&
                    !GA.population[i].fitness
                ) {
                    GA.population[i].processing = true;
                    
                    // hash values on arrays don't make it across ipc, store them in an array and reassemble on the other side...
                    var ids = [];
                    var sources = [];
                    var children = [];
                    var filenames = [];

                    for (j = 0; j < GA.population[i].placement.length; j++) {
                        var id = GA.population[i].placement[j].id;
                        var source = GA.population[i].placement[j].source;
                        var children = GA.population[i].placement[j].children;
                        var filename = GA.population[i].placement[j].filename;
                        ids[j] = id;
                        sources[j] = source;
                        children[j] = children;
                        filenames[j] = filename;
                    }

                    eventEmitter.send("background-start", {
                        index: i,
                        sheets: sheets,
                        sheetids: sheetids,
                        sheetsources: sheetsources,
                        sheetchildren: sheetchildren,
                        individual: GA.population[i],
                        config: config,
                        ids: ids,
                        sources: sources,
                        children: children,
                        filenames: filenames,
                    });
                    running++;
                }
            }
        };

        // use the clipper library to return an offset to the given polygon. Positive offset expands the polygon, negative contracts
        // note that this returns an array of polygons
        DeepNest.prototype.polygonOffset = function (polygon, offset) {
            if (!offset || offset == 0 || GeometryUtil.almostEqual(offset, 0)) {
                return polygon;
            }

            var p = this.svgToClipper(polygon);

            var miterLimit = 4;
            var co =  new ClipperLib.ClipperOffset(
                miterLimit,
                config.curveTolerance * config.clipperScale
            );
            co.AddPath(
                p,
                ClipperLib.JoinType.jtMiter,
                ClipperLib.EndType.etClosedPolygon
            );

            var newpaths = new ClipperLib.Paths();
            co.Execute(newpaths, offset * config.clipperScale);

            var result = [];
            for (var i = 0; i < newpaths.length; i++) {
                result.push(this.clipperToSvg(newpaths[i]));
            }
            for (let i = 0; i < result.length; i++) {
                for (let j = 0; j < result[i].length; j++) {
                    if (isNaN(result[i][j].x) || isNaN(result[i][j].y)) {
                        console.warn(`[polygonOffset] Result has NaN at polygon ${i}, point ${j}:`, result[i][j]);
                    }
                }
            }
            return result;
        };

        //returns a less complex polygon that satisfies the curve tolerance
        this.cleanPolygon = function (polygon) {
            var p = this.svgToClipper(polygon);
            //remove self-intersections and find the biggest polygon that is left
            var simple = ClipperLib.Clipper.SimplifyPolygon(p, ClipperLib.PolyFillType.pftNonZero);

            if (!simple || simple.length == 0) {
                return null;
            }

            var biggest = simple[0];
            var biggestarea = Math.abs(ClipperLib.Clipper.Area(biggest));
            for (var i = 1; i < simple.length; i++) {
                var area = Math.abs(ClipperLib.Clipper.Area(simple[i]));
                if (area > biggestarea) {
                    biggest = simple[i];
                    biggestarea = area;
                }
            }

            // clean up singularities, coincident points and edges
            var clean = ClipperLib.Clipper.CleanPolygon(biggest, 0.01 * config.curveTolerance * config.clipperScale);

            if (!clean || clean.length == 0) {
                return null;
            }

            var cleaned = this.clipperToSvg(clean);

            // remove duplicate endpoints
            var start = cleaned[0];
            var end = cleaned[cleaned.length  - 1];
            if (
                start == end ||
                (GeometryUtil.almostEqual(start.x, end.x) &&
                GeometryUtil.almostEqual(start.y, end.y))
            ) {
                cleaned.pop();
            }
            return cleaned;
        };

        // converts a polygon from normal float coordinates to integer coordinates used by clipper, as well as x/y -> X/Y
        this.svgToClipper = function (polygon, scale) {
            if (!polygon || !Array.isArray(polygon)) {
            } else {
                for (let i = 0; i < polygon.length; i++) {
                    if (!polygon[i] || isNaN(polygon[i].x) || isNaN(polygon[i].y)) {
                        console.warn(`[svgToClipper] Input polygon has NaN at index ${i}:`, polygon[i]);
                    }
                }
            }
            var clip = [];
            for ( var i = 0; i < polygon.length; i++) {
                clip.push({ X: polygon[i].x, Y: polygon[i].y });
            }
            ClipperLib.JS.ScaleUpPath(clip, scale || config.clipperScale);
            for (let i = 0; i < clip.length; i++) {
                if (isNaN(clip[i].X) || isNaN(clip[i].Y)) {
                    console.warn(`[svgToClipper] Output has NaN at index ${i}:`, clip[i]);
                }
            }
            return clip;
        };

        this.clipperToSvg = function (polygon) {
            var normal = [];
            for (var i = 0; i < polygon.length; i++) {
                normal.push({
                    x: polygon[i].X / config.clipperScale,
                    y: polygon[i].Y / config.clipperScale,
                });
            }
            for (let i = 0; i < normal.length; i++) {
                if (isNaN(normal[i].x) || isNaN(normal[i].y)) {
                    console.warn(`[clipperToSvg] Output has NaN at index ${i}:`, normal[i]);
                }
            }
            return normal;
        };

        //returns array of SVG elements that represent the placement, for export or rendering
        this.applyPlacement =  function (placement) {
            var i, j, k;
            var clone = [];
            for (i = 0; i < parts.length; i++) {
                clone.push(parts[i].cloneNode(false));
            }

            var svglist = [];

            for ( i = 0; i < placement.length; i++){
                var newsvg = svg.cloneNode(false);
                newsvg.setAttribute(
                    "viewBox",
                    "0 0 " + binBounds.width + " " + binBounds.height
                );
                newsvg.setAttribute("width", binBounds.width + "px");
                newsvg.setAttribute("height", binBounds.height + "px");
                var binclone = bin.cloneNode(false);

                binclone.setAttribute("class", "bin");
                binclone.setAttribute(
                    "transform",
                    "translate(" + -binBounds.x + " " + -binBounds.y + ")");
                newsvg.appendChild(binclone);

                for (j = 0; j < placement[i].length; j++){
                    var p = placement[i][j];
                    var part = tree[p.id];

                    // the original path could have transforms and stuff on it, so apply our transforms on a group
                    var partgroup = document.createElementNS(svg.namespaceURI, "g");
                    partgroup.setAttribute(
                        "transform",
                        "translate(" + p.x + " " + p.y + ") rotate(" + p.rotation + ")"
                    );
                    partgroup.appendChild(clone[part.source]);

                    if (part.children && part.children.length > 0) {
                        var flattened = __flattenTree(part.children, true);
                        for (k = 0; k < flattened.length; k++) {
                            var c = clone[flattened[k].source];
                            if (flattened[k].hole) {
                                c.setAttribute("class", "hole");
                            }
                            partgroup.appendChild(c);
                        }
                    }
                    newsvg.appendChild(partgroup);
                }

                svglist.push(newsvg);
            } 

            //flatten the given tree into a list
            function _flattenTree(t, hole) {
                var flat = [];
                for (var i = 0; i < t.length; i++) {
                    flat.push(t[i]);
                    t[i].hole = hole;
                    if (t[i].children && t[i].children.length > 0) {
                        flat = flat.concat(_flattenTree(t[i].children, !hole));
                    }
                }

                return flat;
             }
             return svglist;
        };

        this.stop = function () {
            this.working = false;
            if (GA && GA.population && GA.population.length > 0) {
                GA.population.forEach(function (i) {
                    i.processing = false;
                });
            }

            if (workerTimer) {
                clearInterval(workerTimer);
                workerTimer = null;
            }
        };

        this.reset = function () {
            GA = null;
            while (this.nests.length > 0) {
                this.nests.pop();
            }
            progressCallback = null;
            displayCallback = null;
        };
    }

    async nest(parts, config) {
        try {
            
            // Use the bin polygon from config if it exists, otherwise create a default one
            let binPolygon = config.binPolygon;
            if (!binPolygon) {
                console.warn('No binPolygon in config, creating default one');
                binPolygon = [
                    { x: 0, y: 0 },
                    { x: config.width || 1000, y: 0 },
                    { x: config.width || 1000, y: config.height || 2000 },
                    { x: 0, y: config.height || 2000 }
                ];
            } else {
                console.log('Using binPolygon from config:', binPolygon);
            }

            // Create a function to offset polygons
            const polygonOffset = (polygon, offset) => {
                if (!Array.isArray(polygon)) {
                    console.warn('polygonOffset received non-array polygon:', polygon);
                    return polygon;
                }
                return polygon.map(point => ({
                    x: point.x + (offset.x || 0),
                    y: point.y + (offset.y || 0)
                }));
            };

            // Create the genetic algorithm with the bin polygon and config
            const ga = new GeneticAlgorithm(parts, {
                ...config,
                binPolygon
            }, polygonOffset, this.nfpCache);
            
            // Run the genetic algorithm
            const result = await ga.run();
            
            return result;
        } catch (error) {
            console.error('Error in nesting process:', error);
            throw error;
        }
    }
}

// Helper function to deep clone a part (including polygons)
function deepClonePart(part) {
    return {
        ...part,
        polygons: part.polygons ? part.polygons.map(poly => poly.map(pt => ({...pt}))) : [],
        source: part.source ? { ...part.source } : undefined,
    };
}

function GeneticAlgorithm(adam, config, polygonOffset, nfpCache) {
    // Static counter to track nesting attempts
    if (!GeneticAlgorithm.nestingAttempts) {
        GeneticAlgorithm.nestingAttempts = 0;
    }
    GeneticAlgorithm.nestingAttempts++;
    
    this.config = {
        populationSize: 10,
        mutationRate: 0.1, // Changed from 10 to 0.1 to match NestingProcessor
        rotations: [0], // Only allow 0 degree rotations
        generations: 3,
        fitnessThreshold: 0.1,
        ...config
    };
    
    console.log('[GENETIC ALGORITHM] Configuration:', this.config);
    console.log('[GENETIC ALGORITHM] Rotation configuration:', this.config.rotations);
    console.log(`[GENETIC ALGORITHM] Nesting attempt #${GeneticAlgorithm.nestingAttempts}`);
    
    // Only use 0-degree rotation
    const selectedRotation = 0;
    console.log(`[GENETIC ALGORITHM] Using rotation: ${selectedRotation}°`);
    
    // Ensure binPolygon is provided
    if (!this.config.binPolygon) {
        console.error('No binPolygon provided to GeneticAlgorithm');
        throw new Error('binPolygon is required for nesting');
    }
    
    this.nfpCache = nfpCache;
    this.polygonOffset = polygonOffset;

    // Ensure polygonOffset is a function
    if (typeof this.polygonOffset !== 'function') {
        console.warn('polygonOffset is not a function, creating default implementation');
        this.polygonOffset = (polygon, offset) => {
            return polygon.map(point => ({
                x: point.x + (offset.x || 0),
                y: point.y + (offset.y || 0)
            }));
        };
    }

    // Deep clone the initial parts for each individual
    const initialPlacement = adam.map(deepClonePart);
    
    // Group parts by order_id to ensure consistent rotation within orders
    const orderGroups = new Map();
    for (let i = 0; i < initialPlacement.length; i++) {
        const part = initialPlacement[i];
        const orderId = part.source?.orderId || part.source?.order_id || 'unknown';
        
        if (!orderGroups.has(orderId)) {
            orderGroups.set(orderId, []);
        }
        orderGroups.get(orderId).push(i);
    }
    
    // Assign rotations at the order level (all parts in same order get same rotation)
    var angles = [];
    for (var i = 0; i < initialPlacement.length; i++) {
        angles.push(selectedRotation); // Use the selected rotation for all parts
    }
    
    // Log the rotation assignment
    console.log(`[GENETIC ALGORITHM] All parts assigned rotation: ${selectedRotation}°`);
    
    // Log rotation assignment by order
    for (const [orderId, partIndices] of orderGroups) {
        console.log(`[GENETIC ALGORITHM] Order ${orderId} assigned rotation: ${selectedRotation}° (${partIndices.length} parts)`);
    }
    
    this.population = [{ placement: initialPlacement, rotation: angles }];
    
    // Create diverse initial population with different rotations
    while (this.population.length < this.config.populationSize) {
        var mutant = this.mutate(this.population[0]);
        this.population.push(mutant);
    }
    
    // Debug: Show rotation distribution in initial population
    console.log('[GENETIC ALGORITHM] Initial population rotation distribution:');
    for (let i = 0; i < this.population.length; i++) {
        const individual = this.population[i];
        const rotationCounts = {};
        individual.rotation.forEach(rot => {
            rotationCounts[rot] = (rotationCounts[rot] || 0) + 1;
        });
        console.log(`  Individual ${i}:`, rotationCounts);
    }
    
    // Test rotation consistency functionality
    this.testRotationConsistency();
}

//returns a mutated individual with the given mutation rate
GeneticAlgorithm.prototype.mutate = function (individual) {
    // Deep clone the placement array
    var clone = {
        placement: individual.placement.map(deepClonePart),
        rotation: individual.rotation.slice(0), 
    };
    
    // Group parts by order_id for rotation consistency
    const orderGroups = new Map();
    for (let i = 0; i < clone.placement.length; i++) {
        const part = clone.placement[i];
        const orderId = part.source?.orderId || part.source?.order_id || 'unknown';
        
        if (!orderGroups.has(orderId)) {
            orderGroups.set(orderId, []);
        }
        orderGroups.get(orderId).push(i);
    }
    
    for (var i = 0; i < clone.placement.length; i++) {
        var rand = Math.random();
        if (rand < this.config.mutationRate) {
            //swap current part with the next part
            var j = i + 1;
            if (j < clone.placement.length) {
                var temp = clone.placement[i];
                clone.placement[i] = clone.placement[j];
                clone.placement[j] = temp;
            }
        }
        
        // Check if this part should have its rotation mutated
        rand = Math.random();
        if (rand < this.config.mutationRate) {
            // Find the order_id for this part
            const part = clone.placement[i];
            const orderId = part.source?.orderId || part.source?.order_id || 'unknown';
            
            // Get all parts in the same order
            const orderPartIndices = orderGroups.get(orderId) || [];
            
            
            // Apply the same rotation to all parts in this order
            const allowedRotations = [0]; // Only allow 0 degree rotations
            const newOrderRotation = 0; // Always use 0 degrees
            for (const partIndex of orderPartIndices) {
                clone.rotation[partIndex] = newOrderRotation;
            }
        }
    }
    
    // Validate and enforce rotation consistency
    this.enforceRotationConsistency(clone);
    this.validateRotationConsistency(clone);
    
    return clone;
};

// single point crossover
GeneticAlgorithm.prototype.mate = function (male, female) {
    var cutpoint = Math.round(
        Math.min(Math.max(Math.random(), 0.1), 0.9) * (male.placement.length - 1)
    );

    var gene1 = male.placement.slice(0, cutpoint);
    var rot1 = male.rotation.slice(0, cutpoint);

    var gene2 = female.placement.slice(0, cutpoint);
    var rot2 = female.rotation.slice(0, cutpoint);

    var i;

    // Helper function to get order_id from a part
    const getOrderId = (part) => part.source?.orderId || part.source?.order_id || 'unknown';
    
    // Helper function to normalize rotations for an order group
    const normalizeOrderRotations = (parts, rotations) => {
        const orderGroups = new Map();
        
        // Group parts by order_id
        for (let i = 0; i < parts.length; i++) {
            const orderId = getOrderId(parts[i]);
            if (!orderGroups.has(orderId)) {
                orderGroups.set(orderId, []);
            }
            orderGroups.get(orderId).push(i);
        }
        
        // Ensure all parts in the same order have the same rotation
        for (const [orderId, partIndices] of orderGroups) {
            if (partIndices.length > 0) {
                const firstRotation = rotations[partIndices[0]];
                for (const partIndex of partIndices) {
                    rotations[partIndex] = firstRotation;
                }
            }
        }
    };

    for (i = 0; i < female.placement.length; i++) {
        if (!contains(gene1, female.placement[i].id)) {
            gene1.push(female.placement[i]);
            rot1.push(female.rotation[i]);
        }
    }

    for (i = 0; i < male.placement.length; i++) {
        if (!contains(gene2, male.placement[i].id)) {
            gene2.push(male.placement[i]);
            rot2.push(male.rotation[i]);
        }
    }

    // Normalize rotations to ensure consistency within orders
    normalizeOrderRotations(gene1, rot1);
    normalizeOrderRotations(gene2, rot2);

    // Validate rotation consistency
    const child1 = { placement: gene1, rotation: rot1 };
    const child2 = { placement: gene2, rotation: rot2 };
    
    this.enforceRotationConsistency(child1);
    this.enforceRotationConsistency(child2);
    this.validateRotationConsistency(child1);
    this.validateRotationConsistency(child2);

    function contains(gene, id) {
        for (var i = 0; i < gene.length; i++) {
            if (gene[i].id == id) {
                return true;
            }
        }
        return false;
    }

    return [child1, child2];
};

GeneticAlgorithm.prototype.generation = function () {
    // Individuals with higher fitness are more likely to be selected for mating
    this.population.sort(function (a, b) {
        return a.fitness - b.fitness;
    });

    // fittest individual is preserved in the new generation (elitism)
    var newpopulation = [this.population[0]];

    while (newpopulation.length < this.population.length) {
        var male = this.randomWeightedIndividual();
        var female = this.randomWeightedIndividual(male);

        //each mating produces two children
        var children = this.mate(male, female);

        // slightly mutate children
        newpopulation.push(this.mutate(children[0]));

        if (newpopulation.length < this.population.length) {
            newpopulation.push(this.mutate(children[1]));
        }
    }
    
    // Validate rotation consistency for the entire new population
    for (let individual of newpopulation) {
        this.enforceRotationConsistency(individual);
        this.validateRotationConsistency(individual);
    }
    
    this.population = newpopulation;
};

// returns a random individual from the population, weighted to the front of the list (lower fitness value is more likely to be selected)
GeneticAlgorithm.prototype.randomWeightedIndividual = function (exclude) {
    var pop =  this.population.slice(0);

    if (exclude && pop.indexOf(exclude) >= 0) {
        pop.slice(pop.indexOf(exclude), 1);
    }

    var rand = Math.random();

    var lower = 0;
    var weight = 1 / pop.length;
    var upper = weight;

    for (var i = 0; i < pop.length; i++) {
        // if the random number falls between lower and upper bands, select this individual
        if (rand > lower && rand < upper) {
            return pop[i];
        }
        lower = upper;
        upper += 2 * weight * ((pop.length - i) / pop.length);
    }
    return pop[0];
};

GeneticAlgorithm.prototype.evaluateFitness = async function(individual) {
    // --- SYNC ROTATION ARRAY TO PART OBJECTS ---
    for (let i = 0; i < individual.placement.length; i++) {
        individual.placement[i].rotation = individual.rotation[i];
    }

    // Validate rotation consistency before evaluation
    this.enforceRotationConsistency(individual);
    this.validateRotationConsistency(individual);

    // Filter out invalid parts
    const validPlacement = individual.placement.filter(p => {
        const isValid = p && p.polygons && Array.isArray(p.polygons[0]) && p.polygons[0].length > 0;
        if (!isValid) {
            console.warn('Filtering out invalid part:', p);
        }
        return isValid;
    }).map((p, i) => ({
        ...p,
        polygons: p.polygons.map(poly => Array.isArray(poly) ? poly : []),
        rotation: individual.rotation[i] || 0 // Ensure rotation is assigned to each part
    }));

    if (validPlacement.length === 0){
        console.error('No valid parts to place');
        return Number.MAX_VALUE;
    }

    // Create a new worker for this evaluation    
    const worker = new PlacementWorker(
        this.config.binPolygon,
        validPlacement,
        validPlacement.map(p => p.id),
        validPlacement.map(p => p.rotation), // Use the rotation from the part object
        this.config,
        this.nfpCache,
        this.polygonOffset
    );

    // Debug: Show rotations being passed to PlacementWorker
    console.log('[PLACEMENT WORKER DEBUG] Rotations being passed:');
    validPlacement.forEach((part, i) => {
        console.log(`  Part ${part.id}: ${part.rotation}°`);
    });

    // Place the parts and get the result
    const result = worker.place();

    // --- DEBUG: Log the raw result from placement worker ---
    console.log(`[PLACEMENT RESULT DEBUG] Worker returned:`, {
        success: result?.success,
        placementsCount: result?.placements?.length || 0,
        placements: result?.placements?.map(p => ({
            id: p.id,
            x: p.x,
            y: p.y,
            rotation: p.rotation
        })) || []
    });

    // --- FIX: Propagate placement coordinates back to individual's placement array ---
    if (result && result.success && result.placements) {
        for (const placed of result.placements) {
            const part = individual.placement.find(p => p.id === placed.id);
            if (part) {
                part.x = placed.x;
                part.y = placed.y;
                part.rotation = placed.rotation;
            }
        }
    }

    // --- POST-PLACEMENT VALIDATION: Ensure all parts are within binPolygon ---
    function rotatePolygon(polygon, degrees) {
        var rotated = [];
        var angle = (degrees * Math.PI) / 180;
        for (var i = 0; i < polygon.length; i++) {
            var x = polygon[i].x;
            var y = polygon[i].y;
            var x1 = x * Math.cos(angle) - y * Math.sin(angle);
            var y1 = x * Math.sin(angle) + y * Math.cos(angle);
            rotated.push({ x: x1, y: y1 });
        }
        return rotated;
    }
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
    function isPartWithinBin(part, binPolygon) {
        // Add null checks to prevent errors
        if (!part || !part.polygons || !part.polygons[0]) {
            console.warn(`[GA VALIDATION] Part ${part?.id || 'unknown'} has no valid polygons`);
            return false;
        }
        
        // The placement worker has already transformed the polygon to its final position
        // So we can use the polygon directly without additional rotation/translation
        const finalPolygon = part.polygons[0];
        return finalPolygon.every(pt => pointInPolygon(pt, binPolygon));
    }
    if (result && result.success && result.placements) {
        const binPoly = Array.isArray(this.config.binPolygon) ? this.config.binPolygon : (this.config.binPolygon?.polygons?.[0] || []);
        let outOfBounds = false;
        for (const placed of result.placements) {
            if (!isPartWithinBin(placed, binPoly)) {
                outOfBounds = true;
                console.warn(`[GA VALIDATION] Part ${placed.id} is out of bin bounds!`);
                break;
            }
        }
        if (outOfBounds) {
            return Number.MAX_VALUE; // Reject this solution
        }
    }

    if (!result || !result.success) {
        return Number.MAX_VALUE;
    }

    // --- DEBUG: Log coordinate information for rotated parts ---
    console.log(`[COORDINATE DEBUG] Processing ${result.placements.length} placed parts:`);
    for (const placement of result.placements) {
        const part = individual.placement.find(p => p.id === placement.id);
        if (part && part.polygons && part.polygons[0]) {
            const originalPolygon = part.polygons[0];
            const rotation = placement.rotation || 0;
            
            // Calculate bounds of original polygon
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const pt of originalPolygon) {
                minX = Math.min(minX, pt.x);
                minY = Math.min(minY, pt.y);
                maxX = Math.max(maxX, pt.x);
                maxY = Math.max(maxY, pt.y);
            }
            
            // Rotate the polygon
            const rotatedPolygon = rotatePolygon(originalPolygon, rotation);
            
            // Calculate bounds of rotated polygon
            let rotMinX = Infinity, rotMinY = Infinity, rotMaxX = -Infinity, rotMaxY = -Infinity;
            for (const pt of rotatedPolygon) {
                rotMinX = Math.min(rotMinX, pt.x);
                rotMinY = Math.min(rotMinY, pt.y);
                rotMaxX = Math.max(rotMaxX, pt.x);
                rotMaxY = Math.max(rotMaxY, pt.y);
            }
            
            // Calculate what the bottom-left should be after translation
            const expectedBottomLeftX = placement.x - rotMinX;
            const expectedBottomLeftY = placement.y - rotMinY;
            
            console.log(`[COORDINATE DEBUG] Part ${placement.id} (rotation: ${rotation}°):`);
            console.log(`  Original bounds: (${minX.toFixed(2)}, ${minY.toFixed(2)}) to (${maxX.toFixed(2)}, ${maxY.toFixed(2)})`);
            console.log(`  Rotated bounds: (${rotMinX.toFixed(2)}, ${rotMinY.toFixed(2)}) to (${rotMaxX.toFixed(2)}, ${rotMaxY.toFixed(2)})`);
            console.log(`  Placement coordinates: (${placement.x.toFixed(2)}, ${placement.y.toFixed(2)})`);
            console.log(`  Expected bottom-left: (${expectedBottomLeftX.toFixed(2)}, ${expectedBottomLeftY.toFixed(2)})`);
            
            // Check if placement coordinates represent bottom-left of rotated part
            const tolerance = 0.1;
            const isBottomLeft = Math.abs(placement.x - (expectedBottomLeftX + rotMinX)) < tolerance && 
                                Math.abs(placement.y - (expectedBottomLeftY + rotMinY)) < tolerance;
            console.log(`  Is bottom-left placement: ${isBottomLeft ? 'YES' : 'NO'}`);
        }
    }

    // Calculate total area of all parts
    let totalPartsArea = 0;
    for (const part of individual.placement) {
        const polygon = part.polygons[0];
        if (polygon) {
            const area = this.calculatePolygonArea(polygon);
            totalPartsArea += area;
        }
    }

    // Calculate bounding box of the entire nest
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    for (const placement of result.placements) {
        const part = individual.placement.find(p => p.id === placement.id);
        if (part) {
            const polygon = part.polygons[0];
            if (polygon) {
                for (const point of polygon) {
                    const x = point.x + placement.x;
                    const y = point.y + placement.y;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
        }
    }

    const boundingBoxArea = (maxX - minX) * (maxY - minY);
    
    // Calculate material usage efficiency (higher is better)
    const materialEfficiency = totalPartsArea / boundingBoxArea;
    
    // Calculate average distance between parts (lower is better)
    let totalDistance = 0;
    let distanceCount = 0;
    
    for (let i = 0; i < result.placements.length; i++) {
        for (let j = i + 1; j < result.placements.length; j++) {
            const p1 = result.placements[i];
            const p2 = result.placements[j];
            
            // Calculate center points of each part
            const center1 = this.calculatePartCenter(p1);
            const center2 = this.calculatePartCenter(p2);
            
            // Calculate distance between centers
            const distance = Math.sqrt(
                Math.pow(center2.x - center1.x, 2) + 
                Math.pow(center2.y - center1.y, 2)
            );
            
            totalDistance += distance;
            distanceCount++;
        }
    }
    
    const averageDistance = distanceCount > 0 ? totalDistance / distanceCount : 0;
    
    // Calculate fitness (lower is better)
    // We want to maximize material efficiency and minimize average distance
    const fitness = (1 / materialEfficiency) + (averageDistance * 0.1);

    return fitness;
}

// Helper method to calculate polygon area
GeneticAlgorithm.prototype.calculatePolygonArea = function(polygon) {
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        area += polygon[i].x * polygon[j].y;
        area -= polygon[j].x * polygon[i].y;
    }
    return Math.abs(area) / 2;
};

// Helper method to calculate part center
GeneticAlgorithm.prototype.calculatePartCenter = function(placement) {
    // Find the original part in the population
    const originalPart = this.population[0].placement.find(p => p.id === placement.id);
    if (!originalPart || !originalPart.polygons || !originalPart.polygons[0]) {
        console.error('No polygon found for placement:', placement);
        return { x: 0, y: 0 };
    }

    const polygon = originalPart.polygons[0];
    let sumX = 0, sumY = 0;
    
    for (const point of polygon) {
        sumX += point.x + placement.x;
        sumY += point.y + placement.y;
    }
    
    return {
        x: sumX / polygon.length,
        y: sumY / polygon.length
    };
};

GeneticAlgorithm.prototype.run = async function() {
    // Run for the specified number of generations
    for (let i = 0; i < this.config.generations; i++) {
        
        // Evaluate fitness for all individuals
        for (let individual of this.population) {
            if (!individual.fitness) {
                individual.fitness = await this.evaluateFitness(individual);
            }
        }
        
        // Process current generation
        this.generation();
        
        // Get best result
        const best = this.population.reduce((best, current) => {
            return (!best || current.fitness < best.fitness) ? current : best;
        }, null);
                
        // If we've found a good enough solution, stop early
        if (best && best.fitness < this.config.fitnessThreshold) {
            break;
        }
    }
    
    // Get the best result found
    const bestResult = this.population.reduce((best, current) => {
        return (!best || current.fitness < best.fitness) ? current : best;
    }, null);
    
    // Debug the rotation assignments for the best result
    if (bestResult) {
        this.debugRotationAssignments(bestResult);
    }
    
    return bestResult;
};

// Helper function to validate rotation consistency within orders
GeneticAlgorithm.prototype.validateRotationConsistency = function(individual) {
    const orderRotations = new Map();
    let isValid = true;
    
    for (let i = 0; i < individual.placement.length; i++) {
        const part = individual.placement[i];
        const orderId = part.source?.orderId || part.source?.order_id || 'unknown';
        const rotation = individual.rotation[i];
        
        if (!orderRotations.has(orderId)) {
            orderRotations.set(orderId, rotation);
        } else if (orderRotations.get(orderId) !== rotation) {
            console.warn(`[GA VALIDATION] Inconsistent rotation for order ${orderId}: expected ${orderRotations.get(orderId)}, got ${rotation}`);
            isValid = false;
        }
    }
    
    if (!isValid) {
        console.error('[GA VALIDATION] Rotation consistency validation failed!');
    }
    
    return isValid;
};
// Helper function to enforce rotation consistency within orders
GeneticAlgorithm.prototype.enforceRotationConsistency = function(individual) {
    const orderGroups = new Map();
    
    // Group parts by order_id
    for (let i = 0; i < individual.placement.length; i++) {
        const part = individual.placement[i];
        const orderId = part.source?.orderId || part.source?.order_id || 'unknown';
        
        if (!orderGroups.has(orderId)) {
            orderGroups.set(orderId, []);
        }
        orderGroups.get(orderId).push(i);
    }
    
    // Ensure all parts in the same order have the same rotation
    for (const [orderId, partIndices] of orderGroups) {
        if (partIndices.length > 0) {
            const firstRotation = individual.rotation[partIndices[0]];
            for (const partIndex of partIndices) {
                individual.rotation[partIndex] = firstRotation;
            }
        }
    }
    
    return individual;
};

// Helper function to debug rotation assignments
GeneticAlgorithm.prototype.debugRotationAssignments = function(individual) {
    const orderRotations = new Map();
    
    for (let i = 0; i < individual.placement.length; i++) {
        const part = individual.placement[i];
        const orderId = part.source?.orderId || part.source?.order_id || 'unknown';
        const rotation = individual.rotation[i];
        
        if (!orderRotations.has(orderId)) {
            orderRotations.set(orderId, { rotation, parts: [] });
        }
        orderRotations.get(orderId).parts.push({
            id: part.id,
            sku: part.source?.sku || 'unknown',
            rotation
        });
    }
    
    for (const [orderId, data] of orderRotations) {
        data.parts.forEach(part => {
            console.log(`    - ${part.sku} (${part.id}): ${part.rotation}°`);
        });
    }
};

// Test function to verify rotation consistency
GeneticAlgorithm.prototype.testRotationConsistency = function() {    
    // Create a test individual with multiple orders
    const testIndividual = {
        placement: [
            { id: 'part1', source: { orderId: 'order1', sku: 'SKU1' } },
            { id: 'part2', source: { orderId: 'order1', sku: 'SKU2' } },
            { id: 'part3', source: { orderId: 'order2', sku: 'SKU3' } },
            { id: 'part4', source: { orderId: 'order2', sku: 'SKU4' } },
            { id: 'part5', source: { orderId: 'order1', sku: 'SKU5' } }
        ],
        rotation: [0, 0, 0, 0, 0] // Only 0 degree rotations
    };
    
    console.log('[GA TEST] Before enforcement:');
    this.debugRotationAssignments(testIndividual);
    
    // Test enforcement
    this.enforceRotationConsistency(testIndividual);
    
    console.log('[GA TEST] After enforcement:');
    this.debugRotationAssignments(testIndividual);
    
    // Test validation
    const isValid = this.validateRotationConsistency(testIndividual);
    console.log(`[GA TEST] Validation result: ${isValid ? 'PASS' : 'FAIL'}`);
    
    return isValid;
};

// Static method to reset the nesting attempt counter
GeneticAlgorithm.resetNestingAttempts = function() {
    GeneticAlgorithm.nestingAttempts = 0;
    console.log('[GENETIC ALGORITHM] Nesting attempt counter reset to 0');
};

// Static method to get current nesting attempt number
GeneticAlgorithm.getNestingAttempts = function() {
    return GeneticAlgorithm.nestingAttempts || 0;
};

