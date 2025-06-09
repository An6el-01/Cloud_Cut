//**
// This file is used to handle the nesting process.
//  */

import { DeepNest } from './deepnest';
import { SvgParser } from './svgparser';
import { PlacementWorker } from './util/placementWorker';
import { GeometryUtil } from './util/geometryutil';

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
        spacing: 0,
        tolerance: 0.1,
        rotations: [0, 90, 180, 270],
        useHoles: true,
        populationSize: 10,
        mutationRate: 0.1,
        crossoverRate: 0.9,
        tournamentSize: 3,
        generations: 50
      };
      console.log('Using nesting config:', config);

      // Run nesting algorithm
      console.log('Starting deepnest.nest()...');
      const result = await this.deepNest.nest(parts, config);
      console.log('Nesting result:', result);

      // Process and format the result
      const formattedResult = this.formatNestingResult(result, items);
      console.log('Formatted nesting result:', formattedResult);
      
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
            console.log(`Processing SVG for ${item.sku} from URL: ${svgUrl}`);
            
            // Fetch SVG content
            const response = await fetch(svgUrl);
            if (!response.ok) {
              console.error(`Failed to fetch SVG for ${item.sku}: ${response.statusText}`);
              continue;
            }
            
            const svgContent = await response.text();
            console.log(`SVG content length: ${svgContent.length}`);
            
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

            console.log('Dimensions for ', item.sku, 'in the CSV is width: ', dimensions.width, 'and height: ', dimensions.height);

            

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
                  console.error(`Error polygonifying element ${element.tagName}:`, error);
                }
              }
            }
            
            if (polygons.length > 0) {
              // Find the polygon with the most points (most complex)
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
              const scaledPolygon = bestPolygon.map(pt => ({
                x: (pt.x - bounds.x) * scaleX, // shift to (0,0) then scale
                y: (pt.y - bounds.y) * scaleY
              }));

              console.log('Dimensions for ', item.sku, 'is width: ', partSvgWidth, 'and height: ', partSvgHeight);

              if (!partSvgWidth || !partSvgHeight) {
                console.warn(`Dimensions are zero for SKU ${item.sku}`);
                continue;
              }

              // Add to parts array
              for (let q = 0; q < item.quantity; q++) {
                parts.push({
                  id: `${item.sku}-${parts.length}`,
                  polygons: [scaledPolygon],
                  quantity: 1, // Each part is a single instance
                  source: item,
                  rotation: 0
                });
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

    // Create a single sheet with all placements
    const sheet = {
      sheet: 1, // Changed from 'Sheet1' to 1 to match NestingPlacement type
      sheetid: '1',
      parts: nestingResult.placement.map((part, index) => {
        const originalItem = originalItems.find(item => 
          item.sku === part.source.sku
        );
        
        return {
          x: part.x || 0,
          y: part.y || 0,
          rotation: nestingResult.rotation[index] || 0,
          id: part.id,
          source: part.source,
          filename: part.source.sku,
          polygons: part.polygons,
          children: part.children || [],
          itemName: originalItem?.itemName,
          orderId: originalItem?.orderId,
          customerName: originalItem?.customerName,
          priority: originalItem?.priority
        };
      })
    };

    return {
      fitness: nestingResult.fitness,
      placements: [sheet]
    };
  }
} 