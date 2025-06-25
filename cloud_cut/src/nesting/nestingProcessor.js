//**
// This file is used to handle the nesting process.
//  */

import { DeepNest } from './deepnest';
import { SvgParser } from './svgparser';
import { PlacementWorker } from './util/placementWorker';
import { GeometryUtil } from './util/geometryutil';

const PADDING = 10; // 10mm padding
const SHEET_WIDTH = 980; // 1000 - 2*PADDING to ensure 10-990 range
const SHEET_HEIGHT = 1980; // 2000 - 2*PADDING to ensure 10-1990 range

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
        rotations: [0], // Only allow 0 degree rotations
        useHoles: true,
        populationSize: 10,
        mutationRate: 0.1,
        crossoverRate: 0.9,
        tournamentSize: 3,
        generations: 50,
        width: 1000 + 2 * PADDING,
        height: 2000 + 2 * PADDING,
        // Add bin polygon (sheet boundary) for nesting, with padding
        binPolygon: [
          {x: PADDING, y: PADDING},
          {x: 1000 + PADDING, y: PADDING},
          {x: 1000 + PADDING, y: 2000 + PADDING},
          {x: PADDING, y: 2000 + PADDING},
          {x: PADDING, y: PADDING}
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
                // Use the original scaling logic for other parts
                scaledPolygon = bestPolygon.map(pt => ({
                x: (pt.x - bounds.x) * scaleX, // shift to (0,0) then scale
                y: (pt.y - bounds.y) * scaleY
              }));
              // --- NORMALIZE ORIENTATION: Make all polygons 'horizontal' (width >= height) ---
              const boundsNorm = this.geometryUtil.getPolygonBounds(scaledPolygon);
              if (boundsNorm.height > boundsNorm.width) {
                // Rotate by 90 degrees to make it horizontal
                scaledPolygon = this.geometryUtil.rotatePolygon(scaledPolygon, 90);
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
    
    // Validate that all placements are within the specified bounds
    this.validatePlacementBounds(sheet.parts);

    return {
      fitness: nestingResult.fitness,
      placements: [sheet]
    };
  }

  validatePlacementBounds(placements) {
    const minX = PADDING; // 10
    const maxX = PADDING + SHEET_WIDTH; // 990
    const minY = PADDING; // 10
    const maxY = PADDING + SHEET_HEIGHT; // 1990
    
    let allValid = true;
    
    placements.forEach(part => {
      if (!part.polygons || !part.polygons[0]) {
        console.warn(`[BOUNDS VALIDATION] Part ${part.id} has no polygons`);
        allValid = false;
        return;
      }
      
      // Check each point of the part's polygon
      part.polygons[0].forEach((pt, index) => {
        const absX = pt.x + (part.x || 0);
        const absY = pt.y + (part.y || 0);
        
        if (absX < minX || absX > maxX || absY < minY || absY > maxY) {
          console.warn(`[BOUNDS VALIDATION] Part ${part.id} point ${index} at (${absX.toFixed(2)}, ${absY.toFixed(2)}) is outside bounds X(${minX}-${maxX}), Y(${minY}-${maxY})`);
          allValid = false;
        }
      });
    });
    
    if (allValid) {
      console.log(`[BOUNDS VALIDATION] All ${placements.length} parts are within placement bounds`);
    } else {
      console.error(`[BOUNDS VALIDATION] Some parts are outside placement bounds!`);
    }
    
    return allValid;
  }

  alignPlacementsToOrigin(placements) {
    // Check if placements need to be shifted to fit within bounds
    // Only shift if the minimum placement is outside the bounds (10-990 for X, 10-1990 for Y)
    let minX = Infinity, minY = Infinity;
    placements.forEach(part => {
      part.polygons[0].forEach(pt => {
        minX = Math.min(minX, pt.x + (part.x || 0));
        minY = Math.min(minY, pt.y + (part.y || 0));
      });
    });
    
    // Only shift if the minimum point is outside the bounds
    const minBoundX = PADDING; // 10
    const minBoundY = PADDING; // 10
    
    let shiftX = 0;
    let shiftY = 0;
    
    if (minX < minBoundX) {
      shiftX = minBoundX - minX;
    }
    if (minY < minBoundY) {
      shiftY = minBoundY - minY;
    }
    
    // Only apply shifts if needed
    if (shiftX !== 0 || shiftY !== 0) {
      console.log(`[ALIGN DEBUG] Shifting placements by (${shiftX.toFixed(2)}, ${shiftY.toFixed(2)}) to fit within bounds`);
      placements.forEach(part => {
        part.x = (part.x || 0) + shiftX;
        part.y = (part.y || 0) + shiftY;
      });
    } else {
      console.log(`[ALIGN DEBUG] Placements already within bounds, no shift needed`);
    }
    
    // --- DEBUG LOG: Confirm placements are within bounds ---
    let debugMinX = Infinity, debugMinY = Infinity, debugMaxX = -Infinity, debugMaxY = -Infinity;
    placements.forEach(part => {
      part.polygons[0].forEach(pt => {
        const absX = pt.x + (part.x || 0);
        const absY = pt.y + (part.y || 0);
        debugMinX = Math.min(debugMinX, absX);
        debugMinY = Math.min(debugMinY, absY);
        debugMaxX = Math.max(debugMaxX, absX);
        debugMaxY = Math.max(debugMaxY, absY);
      });
    });
    
    console.log(`[ALIGN DEBUG] Final placement bounds: X(${debugMinX.toFixed(2)}-${debugMaxX.toFixed(2)}), Y(${debugMinY.toFixed(2)}-${debugMaxY.toFixed(2)})`);
  }
} 