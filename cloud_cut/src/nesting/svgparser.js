/**
 * Handles parsing and processing of SVG/DXF files
 * 
 */

const { GeometryUtil } = require('./util/geometryutil');

// Matrix class for handling SVG transformations
class Matrix {
    constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
        this.e = e;
        this.f = f;
    }

    multiply(matrix) {
        return new Matrix(
            this.a * matrix.a + this.c * matrix.b,
            this.b * matrix.a + this.d * matrix.b,
            this.a * matrix.c + this.c * matrix.d,
            this.b * matrix.c + this.d * matrix.d,
            this.a * matrix.e + this.c * matrix.f + this.e,
            this.b * matrix.e + this.d * matrix.f + this.f
        );
    }

    translate(x, y) {
        return this.multiply(new Matrix(1, 0, 0, 1, x, y));
    }

    scale(sx, sy) {
        return this.multiply(new Matrix(sx, 0, 0, sy, 0, 0));
    }

    rotate(angle) {
        const rad = angle * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        return this.multiply(new Matrix(cos, sin, -sin, cos, 0, 0));
    }

    rotateAt(angle, x, y) {
        return this.translate(x, y).rotate(angle).translate(-x, -y);
    }

    skewX(angle) {
        const rad = angle * Math.PI / 180;
        return this.multiply(new Matrix(1, 0, Math.tan(rad), 1, 0, 0));
    }

    skewY(angle) {
        const rad = angle * Math.PI / 180;
        return this.multiply(new Matrix(1, Math.tan(rad), 0, 1, 0, 0));
    }

    toString() {
        return `matrix(${this.a},${this.b},${this.c},${this.d},${this.e},${this.f})`;
    }

    static fromString(str) {
        const values = str.replace(/matrix\(|\)/g, '').split(',').map(Number);
        return new Matrix(...values);
    }

    toArray() {
        return [this.a, this.b, this.c, this.d, this.e, this.f];
    }

    isIdentity() {
        return this.a === 1 && this.b === 0 && this.c === 0 && 
               this.d === 1 && this.e === 0 && this.f === 0;
    }
}

export function SvgParser() {
    // the svg document
    this.svg;

    // the top level SVG element of the SVG document
    this.svgRoot;

    // elements that can be imported
    this.allowedElements = ['svg', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'rect', 'image', 'line'];

    // elements that can be polygonofied
    this.polygonElements = ['svg', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'rect'];

    this.conf = {
        tolerance: 2, // max bound for bezier->line segment conversion, in native SVG units
        toleranceSvg: 0.01, // fudge factor for browser inaccuracy in SVG unit handling
        scale: 72,
        endpointTolerance: 2
    };

    this.dirPath = null;
}

SvgParser.prototype.config = function (config) {
    this.conf.tolerance = Number(config.tolerance);
    this.conf.endpointTolerance = Number(config.endpointTolerance);
}

SvgParser.prototype.load = function(dirpath, svgString, scale, scalingFactor){

    if(!svgString || typeof svgString !== 'string'){
        throw Error('invalid SVG string');
    }

    // small hack. inkscape svgs opened and saved in illustrator will fail from a lack of an inkscape xmlns
    if(/inkscape/.test(svgString) && !/xmlns:inkscape/.test(svgstring)){
        svgString = svgString.replace(/xmlns=/i, ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns=');
    }

    var parser = new DOMParser();
    var svg = parser.parseFromString(svgString, "image/svg+xml");
    this.dirPath = dirpath;

    var failed = svg.documentElement.nodeName.indexOf('parsererror')>-1;
    if(failed){
        console.log('svg DOM parsing error: '+ svg.documentElement.nodeName);
    }
    if(svg){
        // scale the svg so that our scale parameter is preserved
        var root = svg.firstElementChild;

        this.svg = svg;
        this.svgRoot = root;

        // get local scaling factor from svg root 'width' dimension
        var width = root.getAttribute('width');
        var viewBox = root.getAttribute('viewBox');

        var transform = root.getAttribute('transform') || '';

        if(!width || !viewBox){
            if(!scalingFactor){
                return this.svgRoot;
            }
            else {
                // apply absolute scaling
                transform += ' scale('+scalingFactor+')';
                root.setAttribute('transform', transform);

                this.conf.scale *= scalingFactor;
                return this.svgRoot;
            }
        }

        width = width.trim();
        viewBox = viewBox.trim().split(/[\s,]+/);

        if(!width || viewBox.length < 4){
            return this.svgRoot;
        }

        var pxwidth = viewBox[2];

        // localscale is in pixels/inches, regardless of units
        var localscale = null;

        if(/in/.test(width)){
            width = Number(width.replace(/[^0-9\.]/g, ''));
            localscale = pxwidth/width;
        }
        else if(/mm/.test(width)){
            width = Number(width.replace(/[^0-9\.]/g, ''));
            localscale = (25.4*pxwidth)/width;
        }
        else if(/cm/.test(width)){
            width = Number(width.replace(/[^0-9\.]/g, ''));
            localscale = (2.54*pxwidth)/width;
        }
        else if(/pt/.test(width)){
            width = Number(width.replace(/[^0-9\.]/g, ''));
            localscale = (72*pxwidth)/width;
        }
        else if(/pc/.test(width)){
            width = Number(width.replace(/[^0-9\.]/g, ''));
            localscale = (6*pxwidth)/width;
        }
        // these are css "pixels"
        else if(/px/.test(width)){
            width = Number(width.replace(/[^0-9\.]/g, ''));
            localscale = (96*pxwidth)/width;
        }

        if(localscale === null){
            localscale = scalingFactor;
        }
        else if(scalingFactor){
            localscale *= scalingFactor;
        }

        // no scaling factor
        if(localscale === null){
            console.log('no scale');
            return this.svgRoot;
        }
        
        transform = root.getAttribute('transform') || '';

        transform += ' scale('+(scale/localscale)+')';

        root.setAttribute('transform', transform);

        this.conf.scale *= scale/localscale;
    }

    return this.svgRoot;
}

// use the utility functions in this class to prepare the svg for CAD-CAM/nest related operations
SvgParser.prototype.cleanInput = function(dxfFlag){

    // apply any transformations, so that all path positions etc will be in the same coordinate system
    this.applyTransform(this.svgRoot, '', false, dxfFlag);

    // remove any g elements and bring all elements to the top level
    this.flatten(this.svgRoot);

    // remove any non-geometric elements like text
    this.filter(this.allowedElements);

    this.imagePaths(this.svgRoot);

    // split any compound paths into individual path elements
    this.recurse(this.svgRoot, this.splitPath);

    // merge open paths into closed paths
    // for numerically accurate exports
    this.mergeLines(this.svgRoot, this.conf.toleranceSvg);

    console.log('this is scale', this.conf.scale*(0.02),  this.conf.endpointTolerance);

    // for exports with wide gaps, roughly 0.005 inch
    this.mergeLines(this.svgRoot, this.conf.endpointTolerance);

    //finally close any open paths with a really wide margin
    this.mergeLines(this.svgRoot, 3*this.conf.endpointTolerance);

    return this.svgRoot;
}

SvgParser.prototype.imagePaths = function(svg){
    if(!this.dirPath) {
        return false;
    }
    for (var i = 0; i < svg.children.length; i++) {
        var e = svg.children[i];
        if(e.tagName == 'image'){
            var relpath = e.getAttribute('href');
            if(!relpath){
                relpath = e.getAttribute('xlink:href');
            }
            var abspath = this.dirPath + '/' + relpath;
            e.setAttribute('href', abspath);
            e.setAttribute('data-href', relpath);
        }
    }
}

// return a path from list that has one and only endpoint that is coincident with the given path
SvgParser.prototype.getCoincident = function(path, list, tolerance) {
    var index = list.indexOf(path);

    if(index < 0 || index == list.length - 1){
        return null;
    }

    var coincident = [];
    for(var i = index + 1; i < list.length; i++){
        var c = list[i];

        if(GeometryUtil.almostEqualPoints(path.endpoints.start, c.endpoints.start, tolerance)){
            coincident.push({path: c, reverse1: true, reverse2: false});
        }
        else if(GeometryUtil.almostEqualPoints(path.endpoints.start, c.endpoints.end, tolerance)){
            coincident.push({path: c, reverse1: true, reverse2: true});
        }
        else if(GeometryUtil.almostEqualPoints(path.endpoints.end, c.endpoints.end, tolerance)){
            coincident.push({path: c, reverse1: false, reverse2: true});
        }
        else if(GeometryUtil.almostEqualPoints(path.endpoints.end, c.endpoints.start, tolerance)){
            coincident.push({path: c, reverse1: false, reverse2: false});
        }
    }

    if(coincident.length > 0){
        return coincident[0];
    }
    return null;
}

SvgParser.prototype.mergeLines = function(root, tolerance) {
    var openpaths = [];
    for (var i = 0; i < root.children.length; i++){
        var p = root.children[i];
        if(!this.isClosed(p, tolerance)){
            openpaths.push(p);
        }
        else if(p.tagName == 'path'){
            // Get the path data
            const d = p.getAttribute('d');
            if (d) {
                // Check if path ends with 'z' or 'Z'
                const lastCommand = d.trim().split(/\s+/).pop();
                if(lastCommand !== 'z' && lastCommand !== 'Z'){
                    // Add close path command
                    p.setAttribute('d', d + ' Z');
                }
            }
        }
    }

    // record endpoints
    for(i = 0; i < openpaths.length; i++) {
        var p = openpaths[i];
        p.endpoints = this.getEndpoints(p);
    }

    for(i = 0; i < openpaths.length; i++) {
        var p = openpaths[i];
        var c = this.getCoincident(p, openpaths, tolerance);

        while(c){
            if(c.reverse1){
                this.reverseOpenPath(p);
            }
            if(c.reverse2){
                this.reverseOpenPath(c.path);
            }

            var merged = this.mergeOpenPaths(p, c.path);

            if(!merged){
                break;
            }

            openpaths.splice(openpaths.indexOf(c.path), 1);

            root.appendChild(merged);

            openpaths.splice(i,1, merged);

            if(this.isClosed(merged, tolerance)) {
                const d = merged.getAttribute('d');
                if (d) {
                    const lastCommand = d.trim().split(/\s+/).pop();
                    if(lastCommand !== 'z' && lastCommand !== 'Z'){
                        merged.setAttribute('d', d + ' Z');
                    }
                }
                openpaths.splice(i,1);
                i--;
                break;
            }

            merged.endpoints = this.getEndpoints(merged);

            p = merged;
            c = this.getCoincident(p, openpaths, tolerance);
        }
    }
}

// merge all line objects that overlap each other
SvgParser.prototype.mergeOverlap = function(root, tolerance) {
    var min2 = 0.001;

    var paths = Array.prototype.slice.call(root.children);

    var linelist = paths.filter(function(p){
        return p.tagName == 'line';
    });

    var merge = function(lines) {
        var count = 0;
        for(var i = 0; i < lines.length; i++) {
            var A1 = {
                x: parseFloat(lines[i].getAttribute('x1')),
                y: parseFloat(lines[i].getAttribute('y1'))
            };
            var A2 = {
                x: parseFloat(lines[i].getAttribute('x2')),
                y: parseFloat(lines[i].getAttribute('y2'))
            };

            var Ax2 = (A2.x-A1.x)*(A2.x-A1.x);
            var Ay2 = (A2.y-A1.y)*(A2.y-A1.y);

            if(Ax2+Ay2 < min2){
                continue;
            }

            var angle = Math.atan2((A2.y - A1.y), (A2.x - A1.x));

            var c = Math.cos(-angle);
            var s = Math.sin(-angle);

            var c2 = Math.cos(angle);
            var s2 = Math.sin(angle);

            var relA2 = {x: A2.x - A1.x, y: A2.y - A1.y };
            var rotA2x = relA2.x * c - relA2.y * s;

            for(var j = i + 1; j < lines.length; j++) {
                var B1 = {
                    x: parseFloat(lines[j].getAttribute('x1')),
                    y: parseFloat(lines[j].getAttribute('y1'))
                };

                var B2 = {
                    x: parseFloat(lines[j].getAttribute('x2')),
                    y: parseFloat(lines[j].getAttribute('y2'))
                };

                var Bx2 = (B2.x-B1.x)*(B2.x-B1.x);
                var By2 = (B2.y-B1.y)*(B2.y-B1.y);

                if(Bx2+By2 < min2){
                    continue;
                }

                // B relative to A1 (our point of rotation)
                var relB1 = {x: B1.x - A1.x, y: B1.y - A1.y };
                var relB2 = {x: B2.x - A1.x, y: B2.y - A1.y };

                // rotate such that A1 and A2 are horizontal
                var rotB1 = {x: relB1.x * c - relB1.y * s, y: relB1.x * s + relB1.y * c};
                var rotB2 = {x: relB2.x * c - relB2.y * s, y: relB2.x * s + relB2.y * c};

                if(!GeometryUtil.almostEqual(rotB1.y, 0, tolerance) || !GeometryUtil.almostEqual(rotB2.y, 0, tolerance)){
                    continue;
                }

                var min1 = Math.min(0, rotA2x);
                var max1 = Math.max(0, rotA2x);

                var min2  = Math.min(rotB1.x, rotB2.x);
                var max2 = Math.max(rotB1.x, rotB2.x);

                // not overlapping
                if(min2 > max1 || max2 < min1){
                    continue;
                }

                var len = 0;
                var relC1x = 0;
                var relC2x = 0;

                // A is B
                if(GeometryUtil.almostEqual(min1, min2, tolerance) && GeometryUtil.almostEqual(max1, max2, tolerance)){
                    lines.splice(j, 1);
                    j--;
                    count++;
                    continue;
                }

                // A inside B
                else if(min1 > min2 && max1 < max2){
                    lines.splice(i,1);
                    i--;
                    count++;
                    break;
                }

                // B inside A
                else if(min2 > min1 && max2 < max1){
                    lines.splice(j, 1);
                    i--;
                    count++;
                    break;
                }

                //some overlap but not total
                len = Math.max(0, Math.min(max1, max2) - Math.max(min1, min2));
                relC1x = Math.max(max1, max2);
                relC2x = Math.min(min1, min2);

                if(len*len > min2){
                    var relC1 = {x: relC1x * c2, y: relC1x * s2};
                    var relC2 = {x: relC2x * c2, y: relC2x * s2};

                    var C1 = {x: relC1.x + A1.x, y: relC1.y + A1.y};
                    var C2 = {x: relC2.x + A1.x, y: relC2.y + A1.y};

                    lines.splice(j,1);
                    lines.splice(i,1);

                    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1',C1.x);
                    line.setAttribute('y1',C1.y);
                    line.setAttribute('x2',C2.x);
                    line.setAttribute('y2',C2.y);

                    line.push(line);

                    i--;
                    count++;
                    break;
                }
            }
        }
        return count;
    }

    var c = merge(linelist);

    while(c > 0){
        c = merge(linelist);
    }

    paths = Array.prototype.slice.call(root.children);
    for(var i = 0; i < paths.length; i++) {
        if(paths[i].tagName == 'line'){
            root.removeChild(paths[i]);
        }
    }
    for(i = 0; i < linelist.length; i++) {
        root.appendChild(linelist[i]);
    }
}

//split paths and polylines into separate line objects
SvgParser.prototype.splitLines = function(root){
    var paths = Array.prototype.slice.call(root.children);

    var lines= [];
    var addline = function(x1,y1,x2,y2){
        if(x1==x2 && y1==y2){
            return;
        }
        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        root.appendChild(line);
    }

    for(var i = 0; i < paths.length; i++) {
        var path = paths[i];
        if(path.tagName == 'polyline' || path.tagName == 'polygon'){
            if(path.points.length < 2){
                continue;
            }

            for(var j = 0; j < path.points.length - 1; j++){
                var p1 = path.points[j];
                var p2 = path.points[j+1];
                addLine(p1.x, p1.y, p2.x, p2.y);
            }

            if(path.tagName == 'polygon'){
                var p1 = path.points[path.points.length - 1];
                var p2 = path.points[0];
                addLine(p1.x, p1.y, p2.x, p2.y);
            }
            root.removeChild(path);
        }
        else if(path.tagName == 'rect'){
            var x = parseFloat(path.getAttribute('x'));
            var y = parseFloat(path.getAttribute('y'));
            var w = parseFloat(path.getAttribute('width'));
            var h = parseFloat(path.getAttribute('height'));
            addLine(x,y, x+w, y);
            addLine(x+w,y, x+w, y+h);
            addLine(x+w,y+h, x, y+h);
            addLine(x,y+h, x, y);

            root.removeChild(path);
        }
        else if(path.tagName == 'path'){
            this.pathToAbsolute(path);
            var split = this.splitPathSegments(path);

            split.forEach(function(e) {
                root.appendChild(e);
            });
        }
    }
}

// turn one path into individual segments
SvgParser.prototype.splitPathSegments = function(path){
    // we'll assume that splitpath has already been run on this path, and it only has one M/m command
    var seglist = path.pathSegList;
    var split = [];

    var addLine = function(x1, y1, x2, y2){
        if(x1==x2 && y1==y2){
            return;
        }
        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        split.push(line);
    }
    
    var x=0, y=0, x0=0, y0=0, x1=0, y1=0, x2=0, y2=0, prevx=0, prevy=0;

    for(var i = 0; i < seglist.numberOfItems; i++){
        var command = seglist.getItem(i).pathSegTypeAsLetter;
        var s = seglist.getItem(i);

        prevx = x;
        prevy = y;

        if ('x' in s) x=s.x;
        if ('y' in s) y=s.y;

        //replace linear moves with M commands
        switch(command) {
            case 'L': addLine(prevx, prevy, x, y); seglist.replaceItem(path.createSVGPathSegMovetoAbs(x,y), i); break;
            case 'H': addLine(prevx, prevy, x, y); seglist.replaceItem(path.createSVGPathSegLinetoAbs(x,y), i); break;
            case 'V': addLine(prevx, prevy, x, y); seglist.replaceItem(path.createSVGPathSegLinetoAbs(x,y), i); break;
            case 'z': case 'Z': addLine(x,y,x0,y0); seglist.removeItem(i); break;
        }

        if(command == 'M' || command == 'm') x0=x, y0=y;
    }

    // this happens in place
    this.splitPath(path);

    return split;
};

// reverse an open path in place, where an open path could by any of line, polyline or path types
SvgParser.prototype.reverseOpenPath = function(path){
    if(path.tagName == 'line'){
        var x1 = path.getAttribute('x1');
        var y1 = path.getAttribute('y1');
        var x2 = path.getAttribute('x2');
        var y2 = path.getAttribute('y2');

        path.setAttribute('x1', x2);
        path.setAttribute('y1', y2);

        path.setAttribute('x2', x1);
        path.setAttribute('y2', y1);
    }
    else if(path.tagName == 'polyline'){
        var points = [];
        for(var i = 0; i < path.points.length; i++){
            points.push(path.points[i]);
        }

        points = points.reverse();
        path.points.clear();
        for(i = 0; i < points.length; i++){
            path.points.appendItem(points[i]);
        }
    }
    else if(path.tagName == 'path'){
        this.pathToAbsolute(path);

        var seglist = path.pathSegList;
        var reversed = [];

        var firstCommand = seglist.getItem(0);
        var lastCommand = seglist.getItem(seglist.numberOfItems - 1);

        var x=0, y=0, x0=0, y0=0, x1=0, y1=0, x2=0, y2=0, prevx=0, prevy=0, prevx1=0, prevy1=0, prevx2=0, prevy2=0;

        for(var i = 0; i < seglist.numberOfItems; i++){
            var s = seglist.getItem(i);
            var command = s.pathSegTypeAsLetter;

            prevx = x;
            prevy = y;

            prevx1 = x1;
            prevy1 = y1;

            prevx2 = x2;
            prevy2 = y2;

            if (/[MLHVCSQTA]/.test(command)){
                if ('x1' in s) x1=s.x1;
                if ('x2' in s) x2=s.x2;
                if ('y1' in s) y1=s.y1;
                if ('y2' in s) y2=s.y2;
                if ('x' in s) x=s.x;
                if ('y' in s) y=s.y;
            }

            switch(command){
                // linear line types
                case 'M':
                    reversed.push( y, x);
                break;
                case 'L':
                case 'H':
                case 'V':
                    reversed.push( 'L', y , x);
                break;
                // Quadratic Beziers
                case 'T':
                //implicit control point
                if(i > 0 && /[QqTt]/.test(seglist.getItem(i-1).pathSegTypeAsLetter)){
                    x1 = prevx + (prevx-prevx1);
                    y1 = prevy + (prevy-prevy1);
                }
                else{
                    x1 = prevx;
                    y1 = prevy;
                }
                case 'Q':
                    reversed.push( y1, x1, 'Q', y, x );
                break;
                case 'S':
                    if(i > 0 && /[CcSs]/.test(seglist.getItem(i-1).pathSegTypeAsLetter)){
                        x1 = prevx + (prevx-prevx2);
                        y1 = prevy + (prevy-prevy2);
                    }
                    else {
                        x1 = prevx;
                        y1 = prevy;
                    }
                case 'C':
                    reversed.push( y1, x1, y2, x2, 'C', y, x );
                break;
                case 'A':
                    //sweep flag needs to be inverted for the correct reverse path
                    reversed.push( (s.sweepFlag ? '0' : '1'), (s.largeArcFlag ? '1' : '0'), s.angle, s.r2, s.r1, 'A', y, x );
                break;
                default:
                    console.log('SVG path error:' +command);
            } 
        }

        var newpath = reversed.reverse();
        var reversedString = 'M' + newpath.join( ' ' );
        
        path.setAttribute('d', reversedString);
    }
}

// merge b into a, assuming the end of a coincides with the start of b
SvgParser.prototype.mergeOpenPaths = function(a, b){
    var topath = function(svg, p){
        if (p.tagName == 'line'){
            var pa = svg.createElementNS('http://www.w3.org/2000/svg', 'path');
            pa.pathSegList.appendItem(pa.createSVGPathSegMovetoAbs(Number(p.getAttribute('x1')),Number(p.getAttribute('y1'))));
            pa.pathSegList.appendItem(pa.createSVGPathSegLinetoAbs(Number(p.getAttribute('x2')),Number(p.getAttribute('y2'))));

            return pa;
        }
        if(p.tagName == 'polyline'){
            if(p.points.length < 2){
                return null;
            }
            pa = svg.createElementNS('http://www.w3.org/2000/svg', 'path');
            pa.pathSegList.appendItem(pa.createSVGPathSegMovetoAbs(p.points[0].x,p.points[0].y));
            for(var i = 1; i < p.points.length; i++){
                pa.pathSegList.appendItem(pa.createSVGPathSegLinetoAbs(p.points[i].x,p.points[i].y));
            }
            return pa;
        }
        return null;
    }

    var patha;
    if(a.tagName == 'path'){
        patha = a;
    }
    else {
        patha = topath(this.svg, a);
    }

    var pathb;
    if(b.tagName == 'path'){
        pathb = b;
    }
    else {
        pathb = topath(this.svg, b);
    }

    if(!patha || !pathb) {
        return null;
    }

    // merge b into a
    var seglist = pathb.pathSegList;

    // first item in M command
    var m1 = seglist.getItem(0);
    patha.pathSegList.appendItem(patha.createSVGPathSegLinetoAbs(m1.x, m1.y));

    //seglist.removeItem(0);
    for(var i = 1; i < seglist.numberOfItems; i++){
        patha.pathSegList.appendItem(seglist.getItem(i));
    }

    if(a.parentNode) {
        a.parentNode.removeChild(a);
    }

    if(b.parentNode) {
        b.parentNode.removeChild(b);
    }

    return patha;
}

SvgParser.prototype.isClosed = function(p, tolerance){
    var openElements = ['line', 'polyline', 'path'];

    if(openElements.indexOf(p.tagName) < 0){
        //things like rect, circle etx are by definition closed shapes
        return true;
    }

    if(p.tagName == 'line'){
        return false;
    }

    if(p.tagName == 'polyline'){
        // a 2-points polyline cannot be closed
        // return false to ensure that the polyline is further processed
        if(p.points.length < 3){
            return false;
        }
        var first = {
            x: p.points[0].x,
            y: p.points[0].y
        };

        var last = {
            x: p.points[p.points.length-1].x,
            y: p.points[p.points.length-1].y
        };

        if(GeometryUtil.almostEqual(first.x, last.x, tolerance || this.conf.toleranceSvg) && GeometryUtil.almostEqual(first.y, last.y, tolerance || this.conf.toleranceSvg)){
            return true;
        }
        else {
            return false;
        }
    }

    if(p.tagName == 'path'){
        // First check if pathSegList exists
        if (p.pathSegList && p.pathSegList.numberOfItems) {
            for(var j = 0; j < p.pathSegList.numberOfItems; j++){
                var c = p.pathSegList.getItem(j);
                if(c.pathSegTypeAsLetter == 'z' || c.pathSegTypeAsLetter == 'Z'){
                    return true;
                }
            }
        } else {
            // Fallback: Check path data directly for 'z' or 'Z' command
            const d = p.getAttribute('d');
            if (d && (d.includes('z') || d.includes('Z'))) {
                return true;
            }
        }

        // could still be 'closed' if start and end coincide
        var test = this.polygonifyPath(p);
        if(!test){
            return false;
        }
        if(test.length < 2){
            return true;
        }
        var first = test[0];
        var last = test[test.length-1];

        if(GeometryUtil.almostEqualPoints(first, last, tolerance || this.conf.toleranceSvg)){
            return true;
        }
    }
}

SvgParser.prototype.getEndpoints = function(p){
    var start, end;
    if(p.tagName == 'line'){
        start = {
            x: Number(p.getAttribute('x1')),
            y: Number(p.getAttribute('y1'))
        };
        end = {
            x: Number(p.getAttribute('x2')),
            y: Number(p.getAttribute('y2'))
        };
    }
    else if(p.tagName == 'polyline') {
        if(p.points.length == 0){
            return null;
        }
        start = {
            x: p.points[0].x,
            y: p.points[0].y
        };
        end = {
            x: p.points[p.points.length-1].x,
            y: p.points[p.points.length-1].y
        };
    } 
    else if(p.tagName == 'path') {
        var poly = this.polygonifyPath(p);
        if(!poly){
            return null;
        }
        start = poly[0];
        end = poly[poly.length-1];
    }
    else {
        return null;
    }
    return { start: start, end: end };
}

//set the given path as absolute coordinates (capital commands)
SvgParser.prototype.pathToAbsolute = function(path) {
    if(!path || path.tagName != 'path'){
        throw Error('invalid path');
    }

    // Get the path data
    const d = path.getAttribute('d');
    if (!d) {
        throw Error('path has no d attribute');
    }

    // Parse the path data
    const commands = d.match(/[MLHVCSQTAZmlhvcsqtaz][^MLHVCSQTAZmlhvcsqtaz]*/g);
    if (!commands) {
        throw Error('invalid path data');
    }

    let x = 0, y = 0, x0 = 0, y0 = 0, x1 = 0, y1 = 0, x2 = 0, y2 = 0;
    let absoluteCommands = [];

    for (let i = 0; i < commands.length; i++) {
        const command = commands[i];
        const type = command[0];
        const params = command.slice(1).trim().split(/[\s,]+/).map(Number);
        
        switch(type.toLowerCase()) {
            case 'm':
                if (type === 'm') {
                    x += params[0];
                    y += params[1];
                } else {
                    x = params[0];
                    y = params[1];
                }
                absoluteCommands.push(`M ${x} ${y}`);
                x0 = x;
                y0 = y;
                break;

            case 'l':
                if (type === 'l') {
                    x += params[0];
                    y += params[1];
                } else {
                    x = params[0];
                    y = params[1];
                }
                absoluteCommands.push(`L ${x} ${y}`);
                break;

            case 'h':
                if (type === 'h') {
                    x += params[0];
                } else {
                    x = params[0];
                }
                absoluteCommands.push(`H ${x}`);
                break;

            case 'v':
                if (type === 'v') {
                    y += params[0];
                } else {
                    y = params[0];
                }
                absoluteCommands.push(`V ${y}`);
                break;

            case 'c':
                if (type === 'c') {
                    x1 = x + params[0];
                    y1 = y + params[1];
                    x2 = x + params[2];
                    y2 = y + params[3];
                    x += params[4];
                    y += params[5];
                } else {
                    x1 = params[0];
                    y1 = params[1];
                    x2 = params[2];
                    y2 = params[3];
                    x = params[4];
                    y = params[5];
                }
                absoluteCommands.push(`C ${x1} ${y1} ${x2} ${y2} ${x} ${y}`);
                break;

            case 's':
                if (type === 's') {
                    x2 = x + params[0];
                    y2 = y + params[1];
                    x += params[2];
                    y += params[3];
                } else {
                    x2 = params[0];
                    y2 = params[1];
                    x = params[2];
                    y = params[3];
                }
                absoluteCommands.push(`S ${x2} ${y2} ${x} ${y}`);
                break;

            case 'q':
                if (type === 'q') {
                    x1 = x + params[0];
                    y1 = y + params[1];
                    x += params[2];
                    y += params[3];
                } else {
                    x1 = params[0];
                    y1 = params[1];
                    x = params[2];
                    y = params[3];
                }
                absoluteCommands.push(`Q ${x1} ${y1} ${x} ${y}`);
                break;

            case 't':
                if (type === 't') {
                    x += params[0];
                    y += params[1];
                } else {
                    x = params[0];
                    y = params[1];
                }
                absoluteCommands.push(`T ${x} ${y}`);
                break;

            case 'a':
                if (type === 'a') {
                    x += params[5];
                    y += params[6];
                } else {
                    x = params[5];
                    y = params[6];
                }
                absoluteCommands.push(`A ${params[0]} ${params[1]} ${params[2]} ${params[3]} ${params[4]} ${x} ${y}`);
                break;

            case 'z':
            case 'Z':
                x = x0;
                y = y0;
                absoluteCommands.push('Z');
                break;
        }
    }

    // Update the path with absolute coordinates
    path.setAttribute('d', absoluteCommands.join(' '));
};

// takes an SVG transform string and returns corresponding SVGMatrix
SvgParser.prototype.transformParse = function(transformString){
    var operations = {
        matrix: true,
        scale: true,
        rotate: true,
        translate: true,
        skewX: true,
        skewY: true
    };

    var CMD_SPLIT_RE    = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*(.+?)\s*\)[\s,]*/;
    var PARAMS_SPLIT_RE = /[\s,]+/;

    var matrix = new Matrix();
    var cmd, params;

    //Split into ['', 'translate', '10 50', '', 'scale', '2', '', 'rotate', '-45', '']
    transformString.split(CMD_SPLIT_RE).forEach(function (item) {
        // SKIP EMPTY ELEMENTS
        if (!item.length) {return;}

        // remember operation
        if (typeof operations[item] !== 'undefined') {
            cmd = item;
            return;
        }

        // extract params & att operation to matrix
        params = item.split(PARAMS_SPLIT_RE).map(function (i){
            return +i || 0;
        });

        // If params count is not correct - ignore command
        switch(cmd){
            case 'matrix':
                if(params.length === 6){
                    matrix.matrix(params);
                }
            return;

            case 'scale':
                if (params.length === 1){
                    matrix.scale(params[0], params[0]);
                } else if (params.length === 2){
                    matrix.scale(params[0], params[1]);
                }
            return;

            case 'rotate':
                if (params.length === 1){
                    matrix.rotate(params[0], 0, 0);
                } else if (params.length === 3){
                    matrix.rotate(params[0], params[1], params[2]);
                }
            return;

            case 'translate':
                if (params.length === 1){
                    matrix.translate(params[0], 0);
                } else if (params.length === 2){
                    matrix.translate(params[0], params[3]);
                }
            return;

            case 'skewX':
                if (params.length === 1){
                    matrix.skewX(params[0]);
                }
            return;

            case 'skewY':
                if (params.length === 1){
                    matrix.skewY(params[0]);
                }
            return;
        }
    });

    return matrix;
}

// recursively apply the transform property to the given element
SvgParser.prototype.applyTransform = function(element, globalTransform, skipClosed, dxfFlag){

    globalTransform = globalTransform || '';
    var transformString = element.getAttribute('transform') || '';
    transformString = globalTransform + ' ' + transformString;

    var transform, scale, rotate;

    if(transformString && transformString.length > 0){
        var transform = this.transformParse(transformString);
    }

    if(!transform){
        transform = new Matrix();
    }

    var tarray = transform.toArray();

    //decompose affine matrix to rotate, scale components (translate is just the 3rd column)
    var rotate = Math.atan2(tarray[1], tarray[3])*180/Math.PI;
    var scale = Math.sqrt(tarray[0]*tarray[0] + tarray[2]*tarray[2]);

    if(element.tagName == 'g' || element.tagName == 'svg' || element.tagName == 'defs'){
        element.removeAttribute('transform');
        var children = Array.prototype.slice.call(element.children);
        for(var i=0; i<children.length; i++){
            this.applyTransform(children[i], transformString, skipClosed, dxfFlag);
        }
    }
    else if(transform && !transform.isIdentity()){
        switch(element.tagName){
            case 'ellipse':
                if(skipClosed){
                    element.setAttribute('transform', transformString);
                    return;
                }
                // the goal is the remove the transform property, but an ellipse without a transform property will have no rotation
                // for simplicity, we'll just replace the ellipse with a path, and apply transform to that path
                var path = this.svg.createElementNS('http://www.w3.org/2000/svg', 'path');
                var move = path.createSVGPathSegMovetoAbs(parseFloat(element.getAttribute('cx'))
                -parseFloat(element.getAttribute('rx')), parseFloat(element.getAttribute('cy')));
                var arc1 = path.createSVGPathSegArcAbs(parseFloat(element.getAttribute('cx'))
                +parseFloat(element.getAttribute('rx')), parseFloat(element.getAttribute('cy')), parseFloat(element.getAttribute('rx')),
                element.getAttribute('ry'),0,1,0);
                var arc2 = path.createSVGPathSegArcAbs(parseFloat(element.getAttribute('cx'))-parseFloat(element.getAttribute('rx')),element.getAttribute('cy'),element.getAttribute('rx'),element.getAttribute('ry'),0,1,0);

                path.pathSegList.appendItem(move);
                path.pathSegList.appendItem(arc1);
                path.pathSegList.appendItem(arc2);
                path.pathSegList.appendItem(path.createSVGPathSegClosePath());

                var transformProperty = element.getAttribute('transform');
                if(transformProperty){
                    path.setAttribute('transform', transformProperty);
                }

                element.parentElement.replaceChild(path, element);

                element = path;
            case 'path':
                if(skipClosed && this.isClosed(element)){
                    element.setAttribute('transform', transformString);
                    return;
                }
                this.pathToAbsolute(element);
                var seglist = element.pathSegList;
                var prevx = 0;
                var prevy = 0;

                for(var i = 0; i < seglist.numberOfItems; i++){
                    var s = seglist.getItem(i);
                    var command = s.pathSegTypeAsLetter;

                    if(command == 'H'){
                        seglist.replaceItem(element.createSVGPathSegLinetoAbs(s.x, prevy), i);
                        s = seglist.getItem(i);
                    }
                    // todo: fix hack from dxf conversion
                    else if(command == 'A'){
                        if(dxfFlag){
                            // fix dxf import error
                            var arcrotate = (rotate == 180) ? 0 : rotate;
                            var arcsweep = (rotate == 180) ? !s.sweepFlag : s.sweepFlag;
                        }
                        else{
                            var arcrotate = s.angle + rotate;
                            var arcsweep = s.sweepFlag;
                        }

                        seglist.replaceItem(element.createSVGPathSegArcAbs(s.x,s.y,s.r1*scale,s.r2*scale,arcrotate,s.largeArcFlag,arcsweep), i);
                        s = seglist.getItem(i);
                    }
                    if('x' in s && 'y' in s){
                        var transformed = transform.calc(s.x, s.y);
                        prevx = s.x;
                        prevy = s.y;

                        s.x = transformed[0];
                        s.y = transformed[1];
                    }
                    if('x1' in s && 'y1' in s){
                        var transformed = transform.calc(s.x1, s.y1);
                        s.x1 = transformed[0];
                        s.y1 = transformed[1];
                    }
                    if('x2' in s && 'y2' in s){
                        var transformed = transform.calc(s.x2, s.y2);
                        s.x2 = transformed[0];
                        s.y2 = transformed[1];
                    }
                }

                element.removeAttribute('transform');
            break;
            case 'image':
                element.setAttribute('transform', transformString);
            break;
            case 'line':
                var x1 = Number(element.getAttribute('x1'));
                var y1 = Number(element.getAttribute('y1'));
                var x2 = Number(element.getAttribute('x2'));
                var y2 = Number(element.getAttribute('y2'));
                var transformed1 = transform.calc(x1, y1);
                var transformed2 = transform.calc(x2, y2);

                element.setAttribute('x1', transformed1[0]);
                element.setAttribute('y1', transformed1[1]);

                element.setAttribute('x2', transformed2[0]);
                element.setAttribute('y2', transformed2[1]);

                element.removeAttribute('transform');
            break;
            case 'circle':
                if(skipClosed){
                    element.setAttribute('transform', transformString);
                    return;
                }
                var transformed = transform.calc(element.getAttribute('cx'), element.getAttribute('cy'));
                element.setAttribute('cx', transformed[0]);
                element.setAttribute('cy', transformed[1]);

                // skew not supported
                element.setAttribute('r', element.getAttribute('r')*scale);
            break;

            case 'rect':
                if(skipClosed){
                    element.setAttribute('transform', transformString);
                    return;
                }
                //similar to the ellipse, we'll replace rect with polygon
                var polygon = this.svg.createElementNS('http://www.w3.org/2000/svg', 'polygon');

                var p1 =  this.svgRoot.createSVGPoint();
                var p2 =  this.svgRoot.createSVGPoint();
                var p3 =  this.svgRoot.createSVGPoint();
                var p4 =  this.svgRoot.createSVGPoint();

                p1.x = parseFloat(element.getAttribute('x')) || 0;
                p1.y = parseFloat(element.getAttribute('y')) || 0;

                p2.x = p1.x + parseFloat(element.getAttribute(width));
                p2.y = p1.y;

                p3.x = p2.x;
                p3.y = p1.y + parseFloat(element.getAttribute('height'));

                p4.x = p1.x;
                p4.y = p3.y;

                polygon.points.appendItem(p1);
                polygon.points.appendItem(p2);
                polygon.points.appendItem(p3);
                polygon.points.appendItem(p4);

                // OnShape exports a rectangle at position 0/0, drop it
                if(p1.x === 0 && p1.y === 0){
                    polygon.points.clear();
                }

                var transformProperty = element.getAttribute('transform');
                if(transformProperty){
                    polygon.setAttribute('transform', transformProperty);
                }

                element.parentElement.replaceChild(polygon, element);
                element = polygon;

            case 'polygon':
            case 'polyline':
                if(skipClosed && this.isClosed(element)){
                    element.setAttribute('transform', transformString);
                    return;
                }
                for( var i = 0; i <  element.points.length; i++){
                    var point =  element.points[i];
                    var transformed = transform.calc(point.x, point.y);
                    point.x = transformed[0];
                    point.y = transformed[1];
                }

                element.removeAttribute('transform');
            break;
        }
    }
}

//bring all child elements to the top level
SvgParser.prototype.flatten = function(element){
    for(var i = 0; i < element.children.length; i++){
        this.flatten(element.children[i]);
    }

    if(element.tagName != 'svg' && element.parentElement){
        while(element.children.length > 0){
            element.parentElement.appendChild(element.children[0]);
        }
    }
}

// remove all elements with tag name not in whitelist
// use this to remove <text>, <g> etc that don't represent shapes
SvgParser.prototype.filter = function(whitelist, element){
    if(!whitelist || whitelist.length == 0){
        throw Error('invalid whitelist');
    }

    element = element || this.svgRoot;

    for(var i = 0; i < element.children.length; i++){
        this.filter(whitelist, element.children[i]);
    }

    if(element.children.length == 0 && whitelist.indexOf(element.tagName) < 0){
        element.parentElement.removeChild(element);
    }
}

//split a compound path (paths with M, m commands) into an array of paths
SvgParser.prototype.splitPath = function(path) {
    if (!path || !path.pathSegList) {
        return false;
    }

    var seglist = path.pathSegList;
    if (!seglist || !seglist.numberOfItems) {
        return false;
    }

    var x=0, y=0, x0=0, y0=0;
    var paths = [];
    
    var p;

    var lastM = 0;

    for(var i = seglist.numberOfItems - 1; i >= 0; i--){
        if(i > 0 && seglist.getItem(i).pathSegTypeAsLetter == 'M' || seglist.getItem(i).pathSegTypeAsLetter == 'm'){
            lastM = i;
            break;
        }
    }

    if(lastM == 0){
        return false; //only on 1 M command, there is no need to split
    }

    for(i = 0; i < seglist.numberOfItems; i++){
        var s = seglist.getItem(i);
        var command = s.pathSegTypeAsLetter;
        if (command == 'M' || command == 'm'){
            p = path.cloneNode();
            p.setAttribute('d','');
            paths.push(p);
        }

        if(/[MLHVCSQTA]/.test(command)){
            if ('x' in s) x= s.x;
            if ('y' in s) y= s.y;

            p.pathSegList.appendItem(s);
        }
        else{
            if( 'x' in s) x+=s.x;
            if( 'y' in s) y+=s.y;
            if(command == 'm'){
                p.pathSegList.appendItem(path.createSVGPathSegMovetoAbs(x,y));
            }
            else{
                if(command == 'Z' || command == 'z'){
                    x = x0;
                    y = y0;
                }
                p.pathSegList.appendItem(s);
            }
        }

        //Record the part of a subpath
        if (command == 'M' || command == 'm'){
            x0 = x, y0 = y;
        }
    }

    var addedPaths = [];
    for( i = 0; i < paths.length; i++){
        //don't add trivial paths from sequential M commands
        if(paths[i].pathSegList && paths[i].pathSegList.numberOfItems > 1){
            path.parentElement.insertBefore(paths[i], path);
            addedPaths.push(paths[i]);
        }
    }

    path.remove();

    return addedPaths;
}

// recursively run the given function on the given element
SvgParser.prototype.recurse = function(element, func){
    // only operate on original DOM tree, ignore any children that are added. Avoid infinite loops
    var children = Array.prototype.slice.call(element.children);
    for(var i = 0; i < children.length; i++){
        this.recurse(children[i], func);
    }
    func(element);
}

//return polygon from the given SVG element in the form of an array of points
SvgParser.prototype.polygonify = function(element) {
    var poly = [];
    var i;

    switch(element.tagName){
        case 'polygon':
        case 'polyline':
            for( i = 0; i < element.points.length; i++){
                poly.push({
                    x: element.points[i].x,
                    y: element.points[i].y
                });
            }
        break;

        case 'rect':
            var p1 = {};
            var p2 = {};
            var p3 = {};
            var p4 = {};

            p1.x = parseFloat(element.getAttribute('x')) || 0;
            p1.y = parseFloat(element.getAttribute('y')) || 0;

            p2.x = p1.x + parseFloat(element.getAttribute('width'));
            p2.y = p1.y;

            p3.x = p2.x;
            p3.y = p1.y + parseFloat(element.getAttribute('height'));

            p4.x = p1.x;
            p4.y = p3.y;

            poly.push(p1);
            poly.push(p2);
            poly.push(p3);
            poly.push(p4);
        break;

        case 'circle':
            var radius = parseFloat(element.getAttribute('r'));
            var cx = parseFloat(element.getAttribute('cx'));
            var cy = parseFloat(element.getAttribute('cy'));

            // num is the smallest number of segments required to approximate the circle to the given tolerance
            var num = Math.ceil((2*Math.PI)/Math.acos(1 - (this.conf.tolerance/radius)));

            if (num < 3){
                num = 3;
            }

            for(var i = 0; i < num; i++){
                var theta = i * ( (2*Math.PI) / num);
                var point = {};
                point.x = radius*Math.cos(theta) + cx;
                point.y = radius*Math.sin(theta) + cy;

                poly.push(point);
            }
        break;
        
        case 'ellipse':
            // same as circle case. There is probably a way to reduce points but for convenience just flatten the equivalent circular polygon
            var rx = parseFloat(element.getAttribute('rx'));
            var ry = parseFloat(element.getAttribute('ry'));
            var maxradius = Math.max(rx, ry);

            var cx = parseFloat(element.getAttribute('cx'));
            var cy = parseFloat(element.getAttribute('cy'));

            var num = Math.ceil((2*Math.PI)/Math.acos(1 - (this.conf.tolerance/maxradius)));

            if(num<3){
                num = 3;
            }

            for(var i = 0; i < num; i++){
                var theta = i * ( (2*Math.PI) / num);
                var point = {};
                point.x = rx*Math.cos(theta) + cx;
                point.y = ry*Math.sin(theta) + cy;

                poly.push(point);
            }
        break;

        case 'path':
            poly = this.polygonifyPath(element);
        break;
    }

    // do not include last point if coincident with starting point
    while(poly.length > 0 && GeometryUtil.almostEqual(poly[0].x,poly[poly.length-1].x, this.conf.toleranceSvg) && GeometryUtil.almostEqual(poly[0].y,poly[poly.length-1].y, this.conf.toleranceSvg)){
        poly.pop();
    }

    return poly;
};

SvgParser.prototype.polygonifyPath = function(path) {
    if (!path) {
        return null;
    }

    // Get the path data
    const d = path.getAttribute('d');
    if (!d) {
        return null;
    }

    // Parse the path data
    const commands = d.match(/[MLHVCSQTAZmlhvcsqtaz][^MLHVCSQTAZmlhvcsqtaz]*/g);
    if (!commands) {
        return null;
    }

    const points = [];
    let x = 0, y = 0, x0 = 0, y0 = 0;

    for (let i = 0; i < commands.length; i++) {
        const command = commands[i];
        const type = command[0];
        const params = command.slice(1).trim().split(/[\s,]+/).map(Number);
        
        switch(type.toLowerCase()) {
            case 'm':
                if (type === 'm') {
                    x += params[0];
                    y += params[1];
                } else {
                    x = params[0];
                    y = params[1];
                }
                points.push({x, y});
                x0 = x;
                y0 = y;
                break;

            case 'l':
                if (type === 'l') {
                    x += params[0];
                    y += params[1];
                } else {
                    x = params[0];
                    y = params[1];
                }
                points.push({x, y});
                break;

            case 'h':
                if (type === 'h') {
                    x += params[0];
                } else {
                    x = params[0];
                }
                points.push({x, y});
                break;

            case 'v':
                if (type === 'v') {
                    y += params[0];
                } else {
                    y = params[0];
                }
                points.push({x, y});
                break;

            case 'z':
            case 'Z':
                x = x0;
                y = y0;
                points.push({x, y});
                break;

            // Add support for other commands if needed
            default:
                console.warn('Unsupported path command:', type);
        }
    }

    return points;
}

// Export the allowed elements and polygon elements as static properties
SvgParser.allowedElements = ['svg', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'rect', 'image', 'line'];
SvgParser.polygonElements = ['svg', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'rect'];