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
            
            // Initialize SVG parser with the document
            this.svgParser = new SvgParser();
            this.svgParser.svg = svgDoc;
            this.svgParser.svgRoot = svgDoc.documentElement;
            
            // Log SVG structure
            console.log(`SVG root element:`, this.svgParser.svgRoot);
            console.log(`Number of child elements:`, this.svgParser.svgRoot.children.length);
            
            // Convert all paths to absolute coordinates first
            const paths = svgDoc.getElementsByTagName('path');
            console.log(`Found ${paths.length} path elements`);
            
            for (let i = 0; i < paths.length; i++) {
              const path = paths[i];
              console.log(`Processing path ${i + 1}:`, {
                d: path.getAttribute('d'),
                transform: path.getAttribute('transform')
              });
              
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
              // Add to parts array
              parts.push({
                id: `${item.sku}-${parts.length}`,
                polygons: polygons,
                quantity: item.quantity,
                source: item,
                rotation: 0
              });
              console.log(`Successfully processed ${item.sku} with ${polygons.length} polygons`);
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