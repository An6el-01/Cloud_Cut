const ClipperLib = require('./clipper');

// Initialize ClipperLib JS utilities
ClipperLib.JS = ClipperLib.JS || {};

ClipperLib.JS.ScaleUpPath = function(path, scale) {
    for (let i = 0; i < path.length; i++) {
        path[i].X *= scale;
        path[i].Y *= scale;
    }
};

ClipperLib.JS.ScaleDownPath = function(path, scale) {
    for (let i = 0; i < path.length; i++) {
        path[i].X /= scale;
        path[i].Y /= scale;
    }
};

ClipperLib.JS.ScaleUpPaths = function(paths, scale) {
    for (let i = 0; i < paths.length; i++) {
        ClipperLib.JS.ScaleUpPath(paths[i], scale);
    }
};

ClipperLib.JS.ScaleDownPaths = function(paths, scale) {
    for (let i = 0; i < paths.length; i++) {
        ClipperLib.JS.ScaleDownPath(paths[i], scale);
    }
};

module.exports = ClipperLib; 