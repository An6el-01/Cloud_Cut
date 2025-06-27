//**
// This file is used to handle the nesting process.
//  */

import { DeepNest } from './deepnest';
import { SvgParser } from './svgparser';
import { PlacementWorker } from './util/placementWorker';
import { GeometryUtil } from './util/geometryutil';
import { getCompositeSkuMapping, validateSkuMapping, getAllMappedSkus } from './skuMapping';
import { createClient } from '@supabase/supabase-js';

const PADDING = 10; // 10mm padding
const SHEET_WIDTH = 980; // 1000 - 2*PADDING to ensure 10-990 range
const SHEET_HEIGHT = 1980; // 2000 - 2*PADDING to ensure 10-1990 range

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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
    
    // Validate SKU mapping configuration on initialization
    const validation = validateSkuMapping();
    if (!validation.valid) {
      console.error('SKU mapping validation failed:', validation.errors);
    }
    if (validation.warnings.length > 0) {
      console.warn('SKU mapping warnings:', validation.warnings);
    }
  }

  async processNesting(items) {
    try {
      console.log('Starting nesting process with items:', items);
      
      // Convert SVG URLs to polygons
      let allParts = await this.convertSvgsToParts(items);
      console.log('Converted items to parts:', allParts);
      
      if (allParts.length === 0) {
        console.warn('No valid parts to nest');
        return null;
      }

      // Configure nesting parameters
      const config = {
        spacing: 0, // Ensure no extra space between parts for tight packing
        tolerance: 0.1,
        rotations: [0, 90], // Allow 0 and 90 degree rotations for better packing
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
      console.log('Rotation configuration:', config.rotations);

      // Multi-sheet logic
      let allSheets = [];
      let sheetIndex = 1;
      let remainingParts = allParts.slice();
      let fitness = null;

      while (remainingParts.length > 0) {
        console.log(`\n--- Starting nesting for sheet #${sheetIndex} with ${remainingParts.length} parts ---`);
        // Run nesting algorithm for current set of parts
        const result = await this.deepNest.nest(remainingParts, config);
        console.log(`Nesting result for sheet #${sheetIndex}:`, result);

        // Find which parts were successfully placed (within bounds)
        // We need to validate each placement against the bin polygon
        const placedArr = result.placement || result.placements || [];
        const successfullyPlacedIds = new Set();
        
        // Validate each placement to see if it's actually within bounds
        for (const placement of placedArr) {
          const part = placement;
          if (part && part.id) {
            // Check if this part is within the bin bounds
            const isWithinBounds = this.isPartWithinBinBounds(part, config.binPolygon);
            if (isWithinBounds) {
              successfullyPlacedIds.add(part.id);
            } else {
              console.log(`Part ${part.id} is out of bounds, excluding from sheet #${sheetIndex}`);
            }
          }
        }
        
        const placedParts = remainingParts.filter(p => successfullyPlacedIds.has(p.id));
        const unplacedParts = remainingParts.filter(p => !successfullyPlacedIds.has(p.id));
        
        console.log(`Sheet #${sheetIndex}: Successfully placed ${placedParts.length} parts, ${unplacedParts.length} parts remaining`);

        // Format and store this sheet's placements
        const formatted = this.formatNestingResult(result, items, sheetIndex);
        if (formatted && formatted.placements && formatted.placements[0]) {
          allSheets.push(formatted.placements[0]);
        }
        if (fitness === null && formatted && formatted.fitness !== undefined) {
          fitness = formatted.fitness;
        }

        // Prepare for next sheet
        remainingParts = unplacedParts;
        sheetIndex++;

        // Safety: break if no progress (to avoid infinite loop)
        if (placedParts.length === 0) {
          console.warn('No parts could be placed on this sheet. Stopping to avoid infinite loop.');
          break;
        }
      }

      // Return all sheets as placements
      return { fitness, placements: allSheets };
    } catch (error) {
      console.error('Error in nesting process:', error);
      return null;
    }
  }

  async convertSvgsToParts(items) {
    const parts = [];
    
    console.log('=== Starting convertSvgsToParts ===');
    console.log('Input items:', items);
    
    // Test SKU mapping functionality
    console.log('\n=== Testing SKU Mapping ===');
    console.log('Testing SFI-MTBS330K mapping:', getCompositeSkuMapping('SFI-MTBS330K'));
    console.log('Testing case sensitivity - sfi-mtbs330k:', getCompositeSkuMapping('sfi-mtbs330k'));
    console.log('Testing SFI-MTC2 mapping:', getCompositeSkuMapping('SFI-MTC2'));
    console.log('All mapped SKUs:', getAllMappedSkus());
    console.log('=== End SKU Mapping Test ===\n');
    
    for (const item of items) {
      console.log(`\n--- Processing item: ${item.sku} ---`);
      console.log('Item details:', item);
      
      // Check for pack types in item name and adjust quantity
      let adjustedQuantity = item.quantity;
      let packType = null;
      
      if (item.itemName && typeof item.itemName === 'string') {
        const itemNameLower = item.itemName.toLowerCase();
        
        if (itemNameLower.includes('twin pack')) {
          adjustedQuantity = item.quantity * 2;
          packType = 'Twin Pack';
          console.log(`Detected Twin Pack in item name. Adjusting quantity from ${item.quantity} to ${adjustedQuantity}`);
        } else if (itemNameLower.includes('triple pack')) {
          adjustedQuantity = item.quantity * 3;
          packType = 'Triple Pack';
          console.log(`Detected Triple Pack in item name. Adjusting quantity from ${item.quantity} to ${adjustedQuantity}`);
        }
      }
      
      // Create a copy of the item with adjusted quantity
      const adjustedItem = {
        ...item,
        quantity: adjustedQuantity,
        packType: packType
      };
      
      // Check if this is a composite SKU that maps to multiple sub-parts
      const compositeMapping = getCompositeSkuMapping(adjustedItem.sku);
      console.log('Composite mapping result:', compositeMapping);
      
      if (compositeMapping) {
        console.log(`Processing composite SKU ${adjustedItem.sku} with sub-parts:`, compositeMapping);
        
        // Process each sub-part of the composite SKU
        for (const subPart of compositeMapping) {
          try {
            const subPartSku = subPart.sku;
            const subPartQuantity = subPart.quantity;
            
            console.log(`\n--- Processing sub-part: ${subPartSku} (quantity: ${subPartQuantity}) ---`);
            
            // Create a new item for each sub-part with the same properties as the original
            const subPartItem = {
              ...adjustedItem,
              sku: subPartSku,
              quantity: subPartQuantity, // Use the quantity from the mapping
              originalSku: adjustedItem.sku, // Keep track of the original composite SKU
              isSubPart: true,
              subPartIndex: compositeMapping.indexOf(subPart)
            };
            
            // Generate SVG URL for the sub-part
            const subPartSvgUrl = await this.generateSvgUrl(subPartSku);
            
            if (!subPartSvgUrl) {
              console.warn(`No SVG URL generated for sub-part ${subPartSku}, skipping`);
              continue;
            }
            
            subPartItem.svgUrl = [subPartSvgUrl];
            
            console.log(`Generated SVG URL for sub-part ${subPartSku}: ${subPartSvgUrl}`);
            console.log('Sub-part item:', subPartItem);
            
            // Process the sub-part
            const subPartParts = await this.processSingleItem(subPartItem);
            console.log(`Generated ${subPartParts.length} parts for sub-part ${subPartSku}`);
            parts.push(...subPartParts);
            
          } catch (error) {
            console.error(`Error processing sub-part ${subPart.sku} for composite SKU ${adjustedItem.sku}:`, error);
          }
        }
      } else if (adjustedItem.svgUrl && adjustedItem.svgUrl[0] !== 'noMatch') {
        // Process regular item (not a composite SKU) that has existing SVG URLs
        console.log(`Processing regular SKU ${adjustedItem.sku} with existing SVG URLs:`, adjustedItem.svgUrl);
        const regularParts = await this.processSingleItem(adjustedItem);
        console.log(`Generated ${regularParts.length} parts for regular SKU ${adjustedItem.sku}`);
        parts.push(...regularParts);
      } else {
        // Try to generate SVG URL for regular SKU that doesn't have one
        console.log(`Attempting to generate SVG URL for SKU ${adjustedItem.sku}`);
        const generatedSvgUrl = await this.generateSvgUrl(adjustedItem.sku);
        
        if (!generatedSvgUrl) {
          console.warn(`No SVG URL generated for SKU ${adjustedItem.sku}, skipping`);
          continue;
        }
        
        const itemWithSvg = {
          ...adjustedItem,
          svgUrl: [generatedSvgUrl]
        };
        
        console.log(`Generated SVG URL for ${adjustedItem.sku}: ${generatedSvgUrl}`);
        console.log('Item with generated SVG:', itemWithSvg);
        
        const regularParts = await this.processSingleItem(itemWithSvg);
        console.log(`Generated ${regularParts.length} parts for SKU ${adjustedItem.sku} with generated URL`);
        parts.push(...regularParts);
      }
    }
    
    console.log(`\n=== Finished convertSvgsToParts ===`);
    console.log(`Total parts generated: ${parts.length}`);
    console.log('Final parts:', parts);
    
    return parts;
  }

  async processSingleItem(item) {
    const parts = [];
    
    console.log(`\n--- processSingleItem called for SKU: ${item.sku} ---`);
    console.log('Item with SVG URLs:', item);
    
    for (const svgUrl of item.svgUrl) {
      console.log(`\n--- Processing SVG URL: ${svgUrl} ---`);
      
      try {            
        // Fetch SVG content
        console.log(`Fetching SVG from: ${svgUrl}`);
        const response = await fetch(svgUrl);
        console.log(`Fetch response status: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
          console.error(`Failed to fetch SVG for ${item.sku}: ${response.statusText}`);
          continue;
        }
        
        const svgContent = await response.text();
        console.log(`SVG content length: ${svgContent.length} characters`);
        console.log(`SVG content preview: ${svgContent.substring(0, 200)}...`);
        
        // Parse SVG content
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
        
        if (svgDoc.documentElement.nodeName === 'parsererror') {
          console.error(`Failed to parse SVG for ${item.sku}`);
          continue;
        }
        
        console.log(`SVG parsed successfully`);
        
        // Use SVG's original dimensions with 1:1 scaling (no CSV lookup needed)
        console.log(`Processing SVG for SKU ${item.sku} with 1:1 scaling`);
        
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
        console.log(`Found ${paths.length} paths in SVG`);
        
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
        console.log(`Processing ${elements.length} SVG elements`);
        
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          if (this.svgParser.polygonElements.includes(element.tagName.toLowerCase())) {
            try {
              const points = this.svgParser.polygonify(element);
              if (points && points.length > 0) {
                polygons.push(points);
                console.log(`Generated polygon with ${points.length} points from element ${element.tagName}`);
              }
            } catch (error) {
              // Ignore errors for non-outline paths
              console.log(`Skipping element ${element.tagName} (not an outline path)`);
              continue;
            }
          }
        }
        
        console.log(`Generated ${polygons.length} polygons from SVG`);
        
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
          
          console.log(`Using polygon with ${maxPoints} points as the main outline`);
          
          // --- PROCESS POLYGON WITH 1:1 SCALING ---
          const bounds = this.geometryUtil.getPolygonBounds(bestPolygon);
          const partSvgWidth = bounds.width;
          const partSvgHeight = bounds.height;
          
          console.log(`SVG bounds: ${partSvgWidth.toFixed(2)}x${partSvgHeight.toFixed(2)}`);
          
          // Use 1:1 scaling - just shift polygon to origin (0,0)
          let scaledPolygon = bestPolygon.map(pt => ({
            x: pt.x - bounds.x, // shift to (0,0)
            y: pt.y - bounds.y
          }));
          
          // --- NORMALIZE ORIENTATION: Make all polygons 'horizontal' (width >= height) ---
          const boundsNorm = this.geometryUtil.getPolygonBounds(scaledPolygon);
          if (boundsNorm.height > boundsNorm.width) {
            // Rotate by 90 degrees to make it horizontal
            scaledPolygon = this.geometryUtil.rotatePolygon(scaledPolygon, 90);
            console.log(`Rotated polygon to make it horizontal`);
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
              offset, // Store the offset for later use if needed
              // Add metadata for composite SKU tracking
              originalSku: item.originalSku || item.sku,
              isSubPart: item.isSubPart || false,
              subPartIndex: item.subPartIndex || 0
            };
            
            // validate the part before pushing
            if (!part.polygons || !Array.isArray(part.polygons[0]) || part.polygons[0].length === 0) {
              console.error('Invalid part structure:', part);
              continue;
            }
            
            console.log(`Created part: ${part.id} with ${part.polygons[0].length} polygon points`);
            parts.push(part);
          }
        } else {
          console.warn(`No polygons generated for ${item.sku}`);
        }
      } catch (error) {
        console.error(`Error processing SVG for ${item.sku}:`, error);
      }
    }
    
    console.log(`processSingleItem finished for ${item.sku}, generated ${parts.length} parts`);
    return parts;
  }

  async generateSvgUrl(sku) {
    try {
      console.log(`Generating SVG URL for SKU: ${sku}`);
      
      // List all SVG files in the bucket
      const { data: svgList, error: svgListError } = await supabase.storage
        .from('inserts')
        .list('', { 
          limit: 1000,
          sortBy: { column: 'name', order: 'asc' }
        });
      
      if (svgListError) {
        console.error('Storage bucket error:', svgListError);
        return null;
      }

      // Get all SVG file names (without .svg), lowercased and trimmed
      const svgNames = (svgList || [])
        .filter(file => file.name.endsWith('.svg'))
        .map(file => file.name.replace(/\.svg$/, '').trim());

      console.log(`Available SVG files: ${svgNames.length} files`);
      
      // Check if this SKU is part of a composite mapping
      const isCompositeSubPart = this.isCompositeSubPart(sku);
      
      let matchedSvg = null;
      
      if (isCompositeSubPart) {
        // For composite sub-parts, use exact SKU matching
        console.log(`SKU ${sku} is a composite sub-part, using exact matching`);
        
        // Look for exact match first
        const exactMatch = svgNames.find(svgName => svgName === sku);
        if (exactMatch) {
          matchedSvg = exactMatch;
          console.log(`Found exact match for composite sub-part: ${matchedSvg}`);
        } else {
          // If no exact match, try case-insensitive match
          const caseInsensitiveMatch = svgNames.find(svgName => 
            svgName.toLowerCase() === sku.toLowerCase()
          );
          if (caseInsensitiveMatch) {
            matchedSvg = caseInsensitiveMatch;
            console.log(`Found case-insensitive match for composite sub-part: ${matchedSvg}`);
          }
        }
      } else {
        // For regular SKUs, use the existing shortened SKU matching logic
        const skuOriginal = String(sku);
        const skuLower = skuOriginal.toLowerCase().trim();
        
        // Remove last three characters from SKU for matching and convert to uppercase
        const shortenedSku = (skuLower.length > 3 ? skuLower.slice(0, -3) : skuLower).toUpperCase();
        
        console.log(`SKU matching - Original: ${skuOriginal}, Lower: ${skuLower}, Shortened: ${shortenedSku}`);
        
        // Find all SVGs that are a prefix of the shortened SKU
        const matchingSvgs = svgNames.filter(svgName => shortenedSku.startsWith(svgName));
        
        // Pick the longest prefix (most specific match)
        if (matchingSvgs.length > 0) {
          matchedSvg = matchingSvgs.reduce((a, b) => (a.length > b.length ? a : b));
          console.log(`Found exact match: ${matchedSvg}`);
        } else {
          // No exact match, try trimmed version (first 8 characters of shortenedSku)
          const trimmedShortenedSku = shortenedSku.slice(0, -1);
          console.log(`Trying trimmed SKU: ${trimmedShortenedSku}`);
          
          // Find all SVGs that start with the trimmed shortened SKU
          const partSvgs = svgNames.filter(svgName => svgName.startsWith(trimmedShortenedSku));
          if (partSvgs.length > 0) {
            matchedSvg = partSvgs[0]; // Take the first match
            console.log(`Found partial match: ${matchedSvg}`);
          }
        }
      }

      if (matchedSvg) {
        const { data: urlData } = supabase.storage
          .from('inserts')
          .getPublicUrl('/' + matchedSvg + '.svg');
        
        if (urlData?.publicUrl) {
          console.log(`Generated URL for ${sku}: ${urlData.publicUrl}`);
          return urlData.publicUrl;
        }
      }
      
      console.warn(`No SVG found for SKU: ${sku}`);
      return null;
      
    } catch (error) {
      console.error(`Error generating SVG URL for ${sku}:`, error);
      return null;
    }
  }

  // Helper method to check if a SKU is a composite sub-part
  isCompositeSubPart(sku) {
    // Get all mapped SKUs (both composite and sub-parts)
    const allMappedSkus = getAllMappedSkus();
    
    console.log(`[isCompositeSubPart] Checking SKU: ${sku}`);
    console.log(`[isCompositeSubPart] All mapped SKUs:`, allMappedSkus);
    console.log(`[isCompositeSubPart] SKU ${sku} in mapped SKUs:`, allMappedSkus.includes(sku));
    
    // Check if this SKU is in the mapped SKUs list
    return allMappedSkus.includes(sku);
  }

  formatNestingResult(nestingResult, originalItems, sheetIndex = 1) {
    if (!nestingResult) {
      return null;
    }

    // Use the best individual's placements array for x/y/rotation/id
    const placementsArr = nestingResult.placements || nestingResult.placement;
    if (!placementsArr || placementsArr.length === 0) {
      return null;
    }

    // Group parts by their original SKU to handle composite SKUs
    const groupedPlacements = new Map();
    
    for (const placement of placementsArr) {
      // Find the original part by id
      const part = (nestingResult.placement || []).find(p => p.id === placement.id) || placement;
      const originalSku = part.originalSku || part.source?.sku || part.source;
      
      if (!groupedPlacements.has(originalSku)) {
        groupedPlacements.set(originalSku, []);
      }
      
      groupedPlacements.get(originalSku).push({
        ...placement,
        source: part.source,
        filename: part.source?.sku || part.filename,
        polygons: part.polygons,
        children: part.children || [],
        originalSku: part.originalSku,
        isSubPart: part.isSubPart || false,
        subPartIndex: part.subPartIndex || 0
      });
    }

    // Create a single sheet with all placements
    const sheet = {
      sheet: sheetIndex, // Use the provided sheetIndex
      sheetid: String(sheetIndex),
      parts: []
    };

    // Process each group of placements
    for (const [originalSku, placements] of groupedPlacements) {
      const originalItem = originalItems.find(item => item.sku === originalSku);
      
      if (placements.length === 1) {
        // Single part (not a composite SKU)
        const placement = placements[0];
        sheet.parts.push({
          x: placement.x,
          y: placement.y,
          rotation: placement.rotation || 0,
          id: placement.id,
          source: placement.source,
          filename: placement.filename,
          polygons: placement.polygons,
          children: placement.children || [],
          itemName: originalItem?.itemName,
          orderId: originalItem?.orderId,
          customerName: originalItem?.customerName,
          priority: originalItem?.priority,
          originalSku: placement.originalSku,
          isSubPart: placement.isSubPart,
          subPartIndex: placement.subPartIndex
        });
      } else {
        // Composite SKU with multiple sub-parts
        // Sort sub-parts by their index to maintain order
        const sortedPlacements = placements.sort((a, b) => a.subPartIndex - b.subPartIndex);
        
        for (const placement of sortedPlacements) {
          sheet.parts.push({
            x: placement.x,
            y: placement.y,
            rotation: placement.rotation || 0,
            id: placement.id,
            source: placement.source,
            filename: placement.filename,
            polygons: placement.polygons,
            children: placement.children || [],
            itemName: originalItem?.itemName,
            orderId: originalItem?.orderId,
            customerName: originalItem?.customerName,
            priority: originalItem?.priority,
            originalSku: placement.originalSku,
            isSubPart: placement.isSubPart,
            subPartIndex: placement.subPartIndex,
            // Add composite SKU metadata
            compositeSku: originalSku,
            subPartSku: placement.filename
          });
        }
      }
    }

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

  // Method to reset the nesting attempt counter
  resetNestingAttempts() {
    if (typeof GeneticAlgorithm !== 'undefined' && GeneticAlgorithm.resetNestingAttempts) {
      GeneticAlgorithm.resetNestingAttempts();
    } else {
      console.warn('[NESTING PROCESSOR] GeneticAlgorithm.resetNestingAttempts not available');
    }
  }

  // Method to get current nesting attempt information
  getNestingAttemptInfo() {
    if (typeof GeneticAlgorithm !== 'undefined' && GeneticAlgorithm.getNestingAttempts) {
      const attempts = GeneticAlgorithm.getNestingAttempts();
      const rotationIndex = (attempts - 1) % 2;
      const rotation = rotationIndex === 0 ? 0 : 90;
      return {
        attempts,
        rotation,
        rotationIndex,
        isEvenAttempt: rotationIndex === 0
      };
    } else {
      console.warn('[NESTING PROCESSOR] GeneticAlgorithm.getNestingAttempts not available');
      return null;
    }
  }

  // Add helper method to check if a part is within bin bounds
  isPartWithinBinBounds(part, binPolygon) {
    if (!part || !part.polygons || !binPolygon) {
      return false;
    }
    
    try {
      // Get the part's polygon
      const partPolygon = part.polygons[0];
      if (!partPolygon || !Array.isArray(partPolygon)) {
        return false;
      }
      
      // Transform the part polygon to its placed position
      const placedPolygon = partPolygon.map(point => ({
        x: point.x + (part.x || 0),
        y: point.y + (part.y || 0)
      }));
      
      // Check if all points of the part are within the bin polygon
      for (const point of placedPolygon) {
        if (!this.pointInPolygon(point, binPolygon)) {
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error('Error checking part bounds:', error);
      return false;
    }
  }
  
  // Helper method to check if a point is inside a polygon
  pointInPolygon(point, polygon) {
    if (!point || !polygon || polygon.length < 3) {
      return false;
    }
    
    let inside = false;
    const x = point.x;
    const y = point.y;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }
} 