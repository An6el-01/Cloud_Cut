/**
 * SVGnest Integration Layer for CloudCut
 * Bridges SVGnest placement algorithms with CloudCut's nesting system
 */

const { PlacementWorker, rotatePolygon } = require('./svgNestPlacementWorker');
const { generateNfp } = require('./svgNestNfpWorker');
const { GeometryUtil } = require('./geometryutil');

class SvgNestIntegration {
    constructor(config) {
        this.config = {
            clipperScale: 10000000,
            spacing: 0,
            rotations: [0], // Only 0 degree rotations as specified
            exploreConcave: false,
            ...config
        };
        
        // Ensure clipperScale is always set
        if (!this.config.clipperScale) {
            this.config.clipperScale = 10000000;
        }
        
        this.nfpCache = {};
    }

    // Convert CloudCut parts format to SVGnest format
    convertPartsToSvgNestFormat(parts) {
        return parts.map((part, index) => {
            // Handle different input formats
            let polygon;
            if (part.polygons && part.polygons[0]) {
                polygon = part.polygons[0];
            } else if (Array.isArray(part) && part.length > 0 && typeof part[0] === 'object') {
                polygon = part;
            } else {
                console.error('Invalid part format:', part);
                return null;
            }

            // Ensure polygon points have x,y properties
            const normalizedPolygon = polygon.map(pt => ({
                x: pt.x || pt.X || 0,
                y: pt.y || pt.Y || 0
            }));

            return {
                id: index,
                source: part.source || index,
                polygon: normalizedPolygon,
                rotation: 0 // CloudCut uses fixed rotations
            };
        }).filter(part => part !== null);
    }

    // Convert bin polygon to SVGnest format
    convertBinToSvgNestFormat(binPolygon) {
        if (!Array.isArray(binPolygon) || binPolygon.length < 3) {
            throw new Error('Invalid bin polygon');
        }

        return {
            id: -1,
            polygon: binPolygon.map(pt => ({
                x: pt.x || pt.X || 0,
                y: pt.y || pt.Y || 0
            }))
        };
    }

    // Generate all required NFPs for placement
    async generateAllNfps(parts, binPolygon) {
        const nfpPairs = [];
        
        // Generate bin NFPs (inner NFPs)
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            for (let rotation of this.config.rotations) {
                const key = JSON.stringify({
                    A: -1,
                    B: part.id,
                    inside: true,
                    Arotation: 0,
                    Brotation: rotation
                });

                if (!this.nfpCache[key]) {
                    const rotatedPart = rotation === 0 ? part.polygon : rotatePolygon(part.polygon, rotation);
                    const nfp = generateNfp(binPolygon.polygon, rotatedPart, true, this.config);
                    this.nfpCache[key] = nfp || [];
                }
            }
        }

        // Generate part-to-part NFPs (outer NFPs)
        for (let i = 0; i < parts.length; i++) {
            for (let j = 0; j < parts.length; j++) {
                if (i === j) continue;

                const partA = parts[i];
                const partB = parts[j];

                for (let rotationA of this.config.rotations) {
                    for (let rotationB of this.config.rotations) {
                        const key = JSON.stringify({
                            A: partA.id,
                            B: partB.id,
                            inside: false,
                            Arotation: rotationA,
                            Brotation: rotationB
                        });

                        if (!this.nfpCache[key]) {
                            const rotatedPartA = rotationA === 0 ? partA.polygon : rotatePolygon(partA.polygon, rotationA);
                            const rotatedPartB = rotationB === 0 ? partB.polygon : rotatePolygon(partB.polygon, rotationB);
                            const nfp = generateNfp(rotatedPartA, rotatedPartB, false, this.config);
                            this.nfpCache[key] = nfp || [];
                        }
                    }
                }
            }
        }

        return this.nfpCache;
    }

    // Perform placement using SVGnest algorithms
    async performPlacement(parts, binPolygon) {
        try {
            console.log('[SVGNEST INTEGRATION] Starting placement process');
            console.log('[SVGNEST INTEGRATION] Parts count:', parts.length);
            console.log('[SVGNEST INTEGRATION] Bin polygon points:', binPolygon.length);

            // Convert formats
            console.log('[SVGNEST INTEGRATION] Converting parts to SVGnest format...');
            const svgNestParts = this.convertPartsToSvgNestFormat(parts);
            console.log('[SVGNEST INTEGRATION] Converted parts count:', svgNestParts.length);
            
            console.log('[SVGNEST INTEGRATION] Converting bin to SVGnest format...');
            const svgNestBin = this.convertBinToSvgNestFormat(binPolygon);
            console.log('[SVGNEST INTEGRATION] Bin conversion complete:', {
                binHasPolygon: !!svgNestBin.polygon,
                binPolygonPoints: svgNestBin.polygon ? svgNestBin.polygon.length : 0
            });

            if (svgNestParts.length === 0) {
                console.warn('[SVGNEST INTEGRATION] No parts to place, returning empty result');
                return { placements: [], fitness: Infinity, paths: [] };
            }

            // Generate NFPs
            console.log('[SVGNEST INTEGRATION] Starting NFP generation...');
            await this.generateAllNfps(svgNestParts, svgNestBin);
            console.log('[SVGNEST INTEGRATION] NFP generation completed');

            // Prepare paths with rotations
            console.log('[SVGNEST INTEGRATION] Preparing paths for PlacementWorker...');
            const paths = svgNestParts.map(part => {
                const polygon = [...part.polygon]; // Create a copy of the polygon array
                polygon.id = part.id;
                polygon.source = part.source;
                polygon.rotation = 0; // Fixed rotation as per CloudCut requirements
                return polygon;
            });

            console.log('[SVGNEST INTEGRATION] Prepared paths for PlacementWorker:', {
                pathsCount: paths.length,
                samplePath: paths[0] ? {
                    length: paths[0].length,
                    id: paths[0].id,
                    firstPoint: paths[0][0],
                    isArray: Array.isArray(paths[0])
                } : null
            });

            const ids = svgNestParts.map(part => part.id);
            const rotations = svgNestParts.map(() => 0); // All parts use 0 rotation
            
            console.log('[SVGNEST INTEGRATION] IDs:', ids);
            console.log('[SVGNEST INTEGRATION] Rotations:', rotations);

            // Create placement worker
            console.log('[SVGNEST INTEGRATION] Creating PlacementWorker...');
            const worker = new PlacementWorker(
                svgNestBin.polygon,
                paths,
                ids,
                rotations,
                this.config,
                this.nfpCache
            );
            console.log('[SVGNEST INTEGRATION] PlacementWorker created successfully');

            // Run placement
            console.log('[SVGNEST INTEGRATION] Starting placePaths operation...');
            const result = worker.placePaths(paths);
            console.log('[SVGNEST INTEGRATION] placePaths completed');

            console.log('[SVGNEST INTEGRATION] Raw placement result:', {
                hasResult: !!result,
                resultKeys: result ? Object.keys(result) : [],
                placementsCount: result?.placements?.length || 0,
                fitness: result?.fitness
            });

            if (!result) {
                console.warn('[SVGNEST INTEGRATION] placePaths returned null/undefined result');
                return { placements: [], fitness: Infinity, paths: [] };
            }

            // Convert result back to CloudCut format
            console.log('[SVGNEST INTEGRATION] Converting result to CloudCut format...');
            const finalResult = this.convertResultToCloudCutFormat(result, parts);
            console.log('[SVGNEST INTEGRATION] Final result conversion completed');

            return finalResult;

        } catch (error) {
            console.error('[SVGNEST INTEGRATION] Error in SVGnest placement:', error);
            console.error('[SVGNEST INTEGRATION] Error stack:', error.stack);
            return { placements: [], fitness: Infinity, paths: [] };
        }
    }

    // Convert SVGnest result to CloudCut format
    convertResultToCloudCutFormat(result, originalParts) {
        if (!result || !result.placements || result.placements.length === 0) {
            return { placements: [], fitness: Infinity, paths: [] };
        }

        console.log('[SVGNEST INTEGRATION] Converting result, originalParts:', originalParts.length);
        console.log('[SVGNEST INTEGRATION] Raw placements:', result.placements);

        const cloudCutPlacements = result.placements.map(binPlacements => {
            return binPlacements.map(placement => {
                const originalPart = originalParts[placement.id];
                
                console.log(`[SVGNEST INTEGRATION] Converting placement ${placement.id}:`, {
                    hasOriginalPart: !!originalPart,
                    originalPartHasPolygons: originalPart ? !!originalPart.polygons : false,
                    polygonCount: originalPart?.polygons?.length || 0
                });
                
                if (!originalPart) {
                    console.error(`[SVGNEST INTEGRATION] No original part found for placement ID ${placement.id}`);
                    return null;
                }
                
                // Create a deep copy of the original part with updated position
                const placedPart = {
                    // Copy all original part properties
                    ...originalPart,
                    // Override with placement data
                    x: placement.x,
                    y: placement.y,
                    rotation: placement.rotation || 0,
                    // Ensure essential properties are preserved
                    id: originalPart.id || placement.id,
                    polygons: originalPart.polygons ? originalPart.polygons.map(poly => [...poly]) : [] // Deep copy polygons array (array of arrays)
                };
                
                console.log(`[SVGNEST INTEGRATION] Created placed part for ${placement.id}:`, {
                    id: placedPart.id,
                    sku: placedPart.sku,
                    hasPolygons: !!placedPart.polygons,
                    polygonCount: placedPart.polygons?.length || 0,
                    x: placedPart.x,
                    y: placedPart.y
                });
                
                return placedPart;
            }).filter(part => part !== null); // Remove any null parts
        });

        console.log('[SVGNEST INTEGRATION] Final cloudCutPlacements:', cloudCutPlacements);
        return {
            placements: cloudCutPlacements,
            fitness: result.fitness,
            paths: result.paths || []
        };
    }

    // Clear NFP cache
    clearCache() {
        this.nfpCache = {};
    }

    // Get cache statistics
    getCacheStats() {
        const keys = Object.keys(this.nfpCache);
        return {
            totalNfps: keys.length,
            innerNfps: keys.filter(key => key.includes('"inside":true')).length,
            outerNfps: keys.filter(key => key.includes('"inside":false')).length
        };
    }
}

// Export the integration class
module.exports = { SvgNestIntegration }; 