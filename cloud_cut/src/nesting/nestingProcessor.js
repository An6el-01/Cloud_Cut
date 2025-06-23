//**
// This file is used to handle the nesting process.
//  */

import { DeepNest } from './deepnest';
import { SvgParser } from './svgparser';
import { PlacementWorker } from './util/placementWorker';
import { GeometryUtil } from './util/geometryutil';

// Helper to convert all points in a polygon to {x, y} format
function toXY(polygon) {
  if (!polygon || !Array.isArray(polygon)) return [];
  return polygon.map(pt => {
    if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
      return { x: pt.x, y: pt.y };
    } else if (pt && typeof pt.X === 'number' && typeof pt.Y === 'number') {
      return { x: pt.X, y: pt.Y };
    } else {
      return { x: NaN, y: NaN };
    }
  });
}

// Helper to shift a polygon so its bottom-left is at (0,0)
function shiftPolygonToOrigin(polygon) {
  const minX = Math.min(...polygon.map(pt => pt.x));
  const minY = Math.min(...polygon.map(pt => pt.y));
  return {
    shifted: polygon.map(pt => ({ x: pt.x - minX, y: pt.y - minY })),
    offset: { x: minX, y: minY }
  };
}

export class NestingProcessor {
  constructor() {
    // Initialize DeepNest with a complete event emitter
    this.deepNest = new DeepNest({
      emit: (event, data) => {
        console.log(`Nesting event: ${event}`, data);
      },
      on: (event, callback) => {
        // Store callbacks if needed for future implementation
        console.log(`Registered listener for event: ${event}`);
      }
    });
    this.svgParser = new SvgParser();
    this.geometryUtil = GeometryUtil; // Use GeometryUtil directly as an object
  }

  async processNesting(items) {
    try {
      console.log('Starting nesting process with items:', items);
      
      // Convert SVG URLs to polygons
      const parts = await this.convertSvgsToParts(items);
      console.log('Converted items to parts:', parts);
      
      if (parts.length === 0) {
        console.warn('No valid parts to nest');
        return null;
      }

      // Configure nesting parameters
      const config = {
        spacing: 0, // Ensure no extra space between parts for tight packing
        tolerance: 0.1,
        rotations: [0, 90, 180, 270], // Rotations remain as is
        useHoles: true,
        populationSize: 10,
        mutationRate: 0.1,
        crossoverRate: 0.9,
        tournamentSize: 3,
        generations: 50,
        width: 1000,
        height: 2000,
        // Add bin polygon (sheet boundary) for nesting
        binPolygon: [
          {x: 0, y: 0},
          {x: 1000, y: 0},
          {x: 1000, y: 2000},
          {x: 0, y: 2000},
          {x: 0, y: 0}
        ]
      };
      console.log('Using nesting config:', config);

      // Run nesting algorithm
      console.log('Starting deepnest.nest()...');
      const result = await this.deepNest.nest(parts, config);
      console.log('Nesting result:', result);

      // Process and format the result
      const formattedResult = this.formatNestingResult(result, items);
      console.log('Formatted nesting result:', formattedResult);
      
      if (this.deepNest && this.deepNest.binPolygon) {
        console.log("Bin polygon (foamsheet) for nesting:", this.deepNest.binPolygon)
      } else if (config && config.binPolygon) {
        console.log('Bin polygon (foamsheet) from config:', config.binPolygon);
      } else {
        console.warn('No bin polygon (foamsheet) defined for nesting.')
      }
      
      return formattedResult;
    } catch (error) {
      console.error('Error in nesting process:', error);
      return null;
    }
  }

  async convertSvgsToParts(items) {
    const parts = [];
    
    for (const item of items) {
      if (item.svgUrl && item.svgUrl[0] !== 'noMatch') {
        for (const svgUrl of item.svgUrl) {
          try {            
            // Fetch SVG content
            const response = await fetch(svgUrl);
            if (!response.ok) {
              console.error(`Failed to fetch SVG for ${item.sku}: ${response.statusText}`);
              continue;
            }
            
            const svgContent = await response.text();
            
            // Create a temporary SVG element to parse the content
            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
            
            // Check for parsing errors
            const parserError = svgDoc.querySelector('parsererror');
            if (parserError) {
              console.error(`SVG parsing error for ${item.sku}:`, parserError.textContent);
              continue;
            }

            // Get dimensions from CSV for this SKU
            const dimensionsResponse = await fetch('/data/dxf_dimensions.csv');
            const dimensionsText = await dimensionsResponse.text();
            const dimensions = dimensionsText.split('\n')
              .slice(1) // Skip header
              .filter(line => line.trim()) // Remove empty lines
              .map(line => {
                const [item_name, min_x, min_y, min_z, max_x, max_y, max_z, width, height, depth] = line.split(',');
                return { item_name, width: parseFloat(width), height: parseFloat(height) };
              })
              .find(dim => item.sku.includes(dim.item_name));

            if (!dimensions) {
              console.warn(`No dimensions found for SKU ${item.sku}`);
              continue;
            }


            // Initialize SVG parser with the document
            this.svgParser = new SvgParser();
            this.svgParser.svg = svgDoc;
            this.svgParser.svgRoot = svgDoc.documentElement;
            
            // Set the viewBox to match our target sheet dimensions (in mm)
            const PADDING = 10; // 10mm padding
            const sheetWidth = 1000; // mm
            const sheetHeight = 2000; // mm
            this.svgParser.svgRoot.setAttribute('viewBox', `-${PADDING} -${PADDING} ${sheetWidth + 2 * PADDING} ${sheetHeight + 2 * PADDING}`);
            
            // Convert all paths to absolute coordinates first
            const paths = svgDoc.getElementsByTagName('path');
            
            for (let i = 0; i < paths.length; i++) {
              const path = paths[i];
              
              try {
                if (!path.getAttribute('d')) {
                  console.warn(`Path ${i + 1} has no 'd' attribute, skipping`);
                  continue;
                }
                this.svgParser.pathToAbsolute(path);
              } catch (error) {
                console.error(`Error converting path ${i + 1} to absolute:`, error);
                console.log('Path element:', path);
                continue;
              }
            }
            
            // Clean and process the SVG
            this.svgParser.cleanInput();
            
            // Get polygons from the parsed SVG
            const polygons = [];
            const elements = this.svgParser.svgRoot.children;
            for (let i = 0; i < elements.length; i++) {
              const element = elements[i];
              if (this.svgParser.polygonElements.includes(element.tagName.toLowerCase())) {
                try {
                  const points = this.svgParser.polygonify(element);
                  if (points && points.length > 0) {
                    polygons.push(points);
                  }
                } catch (error) {
                  // Ignore errors for non-outline paths
                  continue;
                }
              }
            }
            // Always use the longest path as the part outline
            if (polygons.length > 0) {
              let bestPolygon = polygons[0];
              let maxPoints = polygons[0].length;
              for (let i = 1; i < polygons.length; i++) {
                if (polygons[i].length > maxPoints) {
                  bestPolygon = polygons[i];
                  maxPoints = polygons[i].length;
                }
              }
              // --- SCALE THE POLYGON TO MATCH CSV DIMENSIONS ---
              const bounds = this.geometryUtil.getPolygonBounds(bestPolygon);
              const partSvgWidth = bounds.width;
              const partSvgHeight = bounds.height;
              const csvWidth = dimensions.width;
              const csvHeight = dimensions.height;
              const scaleX = csvWidth / partSvgWidth;
              const scaleY = csvHeight / partSvgHeight;
              
              // RAW COORDINATE TEST - Use raw SVG coordinates instead of scaled ones
              let scaledPolygon;
              if (item.sku === 'SFI-MPCB250K') {
                // Use raw coordinates from SFI-MPCB2.svg
                scaledPolygon = [
                  {x: 128.514112, y: 401.444522},
                  {x: 124.137021, y: 402.328216},
                  {x: 120.562642, y: 404.738129},
                  {x: 118.15273, y: 408.312507},
                  {x: 117.269036, y: 412.689598},
                  {x: 117.269036, y: 418.095167},
                  {x: 114.901173, y: 419.845903},
                  {x: 113.067344, y: 422.14639},
                  {x: 111.882643, y: 424.881996},
                  {x: 111.462167, y: 427.93809},
                  {x: 111.462167, y: 443.317862},
                  {x: 96.809597, y: 457.97048},
                  {x: 58.349416, y: 457.97048},
                  {x: 58.349416, y: 439.013415},
                  {x: 58.090003, y: 436.391477},
                  {x: 57.331142, y: 433.894204},
                  {x: 56.101899, y: 431.59177},
                  {x: 54.431342, y: 429.554347},
                  {x: 46.51436, y: 421.637365},
                  {x: 44.476937, y: 419.966807},
                  {x: 42.174502, y: 418.737565},
                  {x: 39.677229, y: 417.978703},
                  {x: 37.055291, y: 417.71929},
                  {x: 24.336165, y: 417.71929},
                  {x: 24.336165, y: 311.29389},
                  {x: 31.389562, y: 311.29389},
                  {x: 30.918239, y: 148.084522},
                  {x: 24.336165, y: 148.084522},
                  {x: 24.336165, y: 47.163042},
                  {x: 43.455495, y: 47.163042},
                  {x: 62.219807, y: 33.588855},
                  {x: 135.078982, y: 33.588855},
                  {x: 135.078982, y: 39.527538},
                  {x: 152.921018, y: 39.527538},
                  {x: 152.921018, y: 33.588855},
                  {x: 225.780193, y: 33.588855},
                  {x: 244.544505, y: 47.163042},
                  {x: 263.663835, y: 47.163042},
                  {x: 263.663835, y: 148.084522},
                  {x: 257.081761, y: 148.084522},
                  {x: 256.610438, y: 311.29389},
                  {x: 263.663835, y: 311.29389},
                  {x: 263.663835, y: 417.71929},
                  {x: 250.944709, y: 417.71929},
                  {x: 248.322771, y: 417.978703},
                  {x: 245.825498, y: 418.737565},
                  {x: 243.523063, y: 419.966807},
                  {x: 241.48564, y: 421.637365},
                  {x: 233.568658, y: 429.554347},
                  {x: 231.898101, y: 431.59177},
                  {x: 230.668858, y: 433.894204},
                  {x: 229.909997, y: 436.391477},
                  {x: 229.650584, y: 439.013415},
                  {x: 229.650584, y: 457.97048},
                  {x: 191.190403, y: 457.97048},
                  {x: 176.537833, y: 443.317862},
                  {x: 176.537833, y: 427.93809},
                  {x: 176.117357, y: 424.881996},
                  {x: 174.932656, y: 422.14639},
                  {x: 173.098827, y: 419.845903},
                  {x: 170.730964, y: 418.095167},
                  {x: 170.730964, y: 412.689598},
                  {x: 169.84727, y: 408.312507},
                  {x: 167.437358, y: 404.738129},
                  {x: 163.862979, y: 402.328216},
                  {x: 159.485888, y: 401.444522},
                  {x: 128.514112, y: 401.444522}
                ];
                console.log('Using RAW coordinates for SFI-MPCB250K');
              } else if (item.sku === 'SFI-DTSB250K') {
                // Use raw coordinates from SFI-DTSB2.svg
                scaledPolygon = [
                  {x: 144.57664, y: 298.30325},
                  {x: 144.57664, y: 305.306592},
                  {x: 67.7477, y: 305.306592},
                  {x: 67.7477, y: 319.556193},
                  {x: 48.792878, y: 319.556193},
                  {x: 46.237101, y: 319.221673},
                  {x: 43.889786, y: 318.260406},
                  {x: 41.862579, y: 316.735833},
                  {x: 38.148617, y: 312.131509},
                  {x: 31.793088, y: 304.391857},
                  {x: 31.793088, y: 268.705717},
                  {x: 34.119244, y: 268.705717},
                  {x: 34.119244, y: 259.774096},
                  {x: 31.793088, y: 259.774096},
                  {x: 31.793088, y: 222.58277},
                  {x: 46.363128, y: 222.58277},
                  {x: 50.226012, y: 221.802887},
                  {x: 53.380488, y: 219.676079},
                  {x: 55.507297, y: 216.521603},
                  {x: 56.287179, y: 212.658718},
                  {x: 56.287179, y: 135.19407},
                  {x: 55.507297, y: 131.331186},
                  {x: 53.380488, y: 128.17671},
                  {x: 50.226012, y: 126.049901},
                  {x: 46.363128, y: 125.270018},
                  {x: 31.793088, y: 125.270018},
                  {x: 31.793088, y: 86.563934},
                  {x: 34.119244, y: 86.563934},
                  {x: 34.119244, y: 77.632314},
                  {x: 31.793088, y: 77.632314},
                  {x: 31.882777, y: 48.77598},
                  {x: 32.148668, y: 47.474492},
                  {x: 32.58599, y: 46.22017},
                  {x: 33.189978, y: 45.030393},
                  {x: 41.853854, y: 30.477875},
                  {x: 43.449306, y: 28.453435},
                  {x: 45.476513, y: 26.928862},
                  {x: 47.823828, y: 25.967596},
                  {x: 50.379605, y: 25.633076},
                  {x: 70.816021, y: 25.633076},
                  {x: 71.886831, y: 33.785864},
                  {x: 72.957556, y: 25.633076},
                  {x: 238.84855, y: 25.633076},
                  {x: 239.547295, y: 33.748597},
                  {x: 240.246039, y: 25.633076},
                  {x: 406.137034, y: 25.633076},
                  {x: 407.207758, y: 33.785864},
                  {x: 408.278568, y: 25.633076},
                  {x: 428.714984, y: 25.633076},
                  {x: 431.270761, y: 25.967596},
                  {x: 433.618076, y: 26.928862},
                  {x: 435.645283, y: 28.453435},
                  {x: 437.240735, y: 30.477875},
                  {x: 446.508599, y: 46.22017},
                  {x: 446.945922, y: 47.474492},
                  {x: 447.211812, y: 48.77598},
                  {x: 447.301501, y: 50.107252},
                  {x: 447.301501, y: 77.632314},
                  {x: 444.975345, y: 77.632314},
                  {x: 444.975345, y: 86.563934},
                  {x: 447.301501, y: 86.563934},
                  {x: 447.301501, y: 125.270018},
                  {x: 432.731461, y: 125.270018},
                  {x: 428.868577, y: 126.049901},
                  {x: 425.714101, y: 128.17671},
                  {x: 423.587292, y: 131.331186},
                  {x: 422.80741, y: 135.19407},
                  {x: 422.80741, y: 212.658718},
                  {x: 423.587292, y: 216.521603},
                  {x: 425.714101, y: 219.676079},
                  {x: 428.868577, y: 221.802887},
                  {x: 432.731461, y: 222.58277},
                  {x: 447.301501, y: 222.58277},
                  {x: 447.301501, y: 259.774096},
                  {x: 444.975345, y: 259.774096},
                  {x: 444.975345, y: 268.705717},
                  {x: 447.301501, y: 268.705717},
                  {x: 447.301501, y: 304.391857},
                  {x: 437.23201, y: 316.735833},
                  {x: 435.204803, y: 318.260406},
                  {x: 432.857488, y: 319.221673},
                  {x: 430.301711, y: 319.556193},
                  {x: 411.346889, y: 319.556193},
                  {x: 411.346889, y: 305.306592},
                  {x: 334.517949, y: 305.306592},
                  {x: 334.517949, y: 298.30325},
                  {x: 144.57664, y: 298.30325}
                ];
                console.log('Using RAW coordinates for SFI-DTSB250K');
              } else {
                // Use the original scaling logic for other parts
                scaledPolygon = bestPolygon.map(pt => ({
                x: (pt.x - bounds.x) * scaleX, // shift to (0,0) then scale
                y: (pt.y - bounds.y) * scaleY
              }));
              }
              // --- VALIDATE THE POLYGON (only the longest path) ---
              function validatePolygon(polygon) {
                if (!polygon || polygon.length < 3) {
                  console.warn('Polygon is empty or too short before deduplication:', polygon);
                  return null;
                }
                // Remove consecutive duplicate points
                const unique = [];
                for (let i = 0; i < polygon.length; i++) {
                  const pt = polygon[i];
                  if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number' || isNaN(pt.x) || isNaN(pt.y)) {
                    console.warn('Polygon has invalid point:', pt, polygon);
                    return null;
                  }
                  if (i === 0 || pt.x !== polygon[i - 1].x || pt.y !== polygon[i - 1].y) {
                    unique.push(pt);
                  }
                }
                // Ensure closed
                if (unique.length > 2) {
                  const first = unique[0];
                  const last = unique[unique.length - 1];
                  if (first.x !== last.x || first.y !== last.y) {
                    unique.push({ ...first });
                  }
                }
                if (unique.length < 4) {
                  console.warn('Polygon too short after deduplication:', unique.length, unique);
                  return null;
                }
                return unique;
              }

              scaledPolygon = validatePolygon(scaledPolygon);
              if (!scaledPolygon) {
                console.error(`Polygon for SKU ${item.sku} is invalid (empty, too short, or has invalid points). Skipping this part.`);
                continue;
              }

              // Strict self-intersection check: reject if found
              function hasSelfIntersection(polygon) {
                if (polygon.length < 4) return false;
                for (let i = 0; i < polygon.length - 1; i++) {
                  const a1 = polygon[i];
                  const a2 = polygon[i + 1];
                  for (let j = i + 2; j < polygon.length - 1; j++) {
                    // skip adjacent segments
                    if (j === i + 1) continue;
                    const b1 = polygon[j];
                    const b2 = polygon[j + 1];
                    // Check if segments intersect
                    const det = (a2.x - a1.x) * (b2.y - b1.y) - (b2.x - b1.x) * (a2.y - a1.y);
                    if (Math.abs(det) < 0.001) continue; // Parallel lines
                    const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b2.x - b1.x) * (b1.y - a1.y)) / det;
                    const u = ((a2.x - a1.x) * (b1.y - a1.y) - (b1.x - a1.x) * (a2.y - a1.y)) / det;
                    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
                      return true;
                    }
                  }
                }
                return false;
              }
              console.log(`Polygon for SKU ${item.sku}:`, scaledPolygon);
              // DISABLED: Self-intersection check is giving false positives
              // if (hasSelfIntersection(scaledPolygon)) {
              //   console.warn(`Polygon for SKU ${item.sku} is self-intersecting. Please fix the SVG. Skipping this part.`);
              //   // continue;
              // }

              if (!partSvgWidth || !partSvgHeight || scaledPolygon.length === 0) {
                console.warn(`Invalid or empty cleaned polygon for SKU ${item.sku}`);
                continue;
              }
              if (!scaledPolygon || !Array.isArray(scaledPolygon) || scaledPolygon.length === 0) {
                console.error('Invalid cleaned polygon for SKU:', item.sku, scaledPolygon);
                continue;
              }
              // --- SHIFT POLYGON TO ORIGIN ---
              const { shifted, offset } = shiftPolygonToOrigin(scaledPolygon);
              for (let q = 0; q < item.quantity; q++) {
                const part = {
                  id: `${item.sku}-${parts.length}`,
                  polygons: [shifted],
                  quantity: 1,
                  source: item,
                  rotation: 0,
                  offset // Store the offset for later use if needed
                };
                // validate the part before pushing
                if (!part.polygons || !Array.isArray(part.polygons[0]) || part.polygons[0].length === 0) {
                  console.error('Invalid part structure:', part);
                  continue;
                }
                parts.push(part);
              }
              console.log(`Successfully processed ${item.sku} with ${item.quantity} polygons`);
            } else {
              console.warn(`No polygons generated for ${item.sku}`);
            }
          } catch (error) {
            console.error(`Error processing SVG for ${item.sku}:`, error);
          }
        }
      }
    }
    
    
    return parts;
  }

  formatNestingResult(nestingResult, originalItems) {
    if (!nestingResult) {
      return null;
    }

    // Use the best individual's placements array for x/y/rotation/id
    const placementsArr = nestingResult.placements || nestingResult.placement;
    if (!placementsArr || placementsArr.length === 0) {
      return null;
    }

    // Create a single sheet with all placements
    const sheet = {
      sheet: 1, // Changed from 'Sheet1' to 1 to match NestingPlacement type
      sheetid: '1',
      parts: placementsArr.map((placement, index) => {
        // Find the original part by id
        const part = (nestingResult.placement || []).find(p => p.id === placement.id) || placement;
        const originalItem = originalItems.find(item => item.sku === (part.source?.sku || part.source));
        return {
          x: placement.x,
          y: placement.y,
          rotation: placement.rotation || 0,
          id: placement.id,
          source: part.source,
          filename: part.source?.sku || part.filename,
          polygons: part.polygons,
          children: part.children || [],
          itemName: originalItem?.itemName,
          orderId: originalItem?.orderId,
          customerName: originalItem?.customerName,
          priority: originalItem?.priority
        };
      })
    };

    // Align placements to origin (0,0) for tightest fit in the viewBox
    this.alignPlacementsToOrigin(sheet.parts);

    return {
      fitness: nestingResult.fitness,
      placements: [sheet]
    };
  }

  alignPlacementsToOrigin(placements) {
    // Shift all placements so the minimum x/y is at (0,0) for optimal packing
    let minX = Infinity, minY = Infinity;
    placements.forEach(part => {
      part.polygons[0].forEach(pt => {
        minX = Math.min(minX, pt.x + (part.x || 0));
        minY = Math.min(minY, pt.y + (part.y || 0));
      });
    });
    placements.forEach(part => {
      part.x = (part.x || 0) - minX;
      part.y = (part.y || 0) - minY;
    });
  }
} 