require('./clipper');

// Initialize ClipperLib
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

module.exports = ClipperLib; 