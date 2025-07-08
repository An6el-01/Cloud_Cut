//**
// This file is used to handle the nesting process.
//  */

import { DeepNest } from './deepnest';
import { SvgParser } from './svgparser';
import { GeometryUtil } from './util/geometryutil';
import { getCompositeSkuMapping, validateSkuMapping, getAllMappedSkus, getCompositeSkuSkus, getTotalSubPartQuantity, isSkuInMapping, getCompositeSkuForSubPart, getSubPartQuantity } from './skuMapping';
import { createClient } from '@supabase/supabase-js';
import { validateSvgDimensions, generateCorrectedSvg, EXPECTED_DIMENSIONS } from '../utils/svgDimensionValidator';
import { parseSfcDimensions, getSfcFoamSheetInfo, getRetailPackInfo, getRetailPackDimensions, getStarterKitInfo, getStarterKitDimensions, getMixedPackInfo } from '../utils/skuParser';

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
      console.log('Starting multi-sheet nesting process with items:', items);
      
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
        rotations: [0], // Only allow 0 degree rotations
        useHoles: true,
        populationSize: 10,
        mutationRate: 0.1,
        crossoverRate: 0.9,
        tournamentSize: 3,
        generations: 50,
        width: 1000 + 2 * PADDING,
        height: 2000 + 2 * PADDING,
        // Add bin polygon (sheet boundary) for nesting, with proper dimensions
        binPolygon: [
          {x: PADDING, y: PADDING},
          {x: PADDING + SHEET_WIDTH, y: PADDING},
          {x: PADDING + SHEET_WIDTH, y: PADDING + SHEET_HEIGHT},
          {x: PADDING, y: PADDING + SHEET_HEIGHT},
          {x: PADDING, y: PADDING}
        ]
      };
      console.log('Using nesting config:', config);

      // Multi-sheet logic: try to nest all parts, then handle overflow
      let allSheets = [];
      let remainingParts = [...allParts]; // Copy all parts to start
      let sheetIndex = 1;
      const maxSheets = 10; // Safety limit to prevent infinite loops
      let overallFitness = 0;

      console.log(`📦 Starting multi-sheet nesting with ${remainingParts.length} parts...`);

      while (remainingParts.length > 0 && sheetIndex <= maxSheets) {
        console.log(`📦 Processing sheet ${sheetIndex} with ${remainingParts.length} remaining parts`);
        
        // Try to nest remaining parts
        const result = await this.deepNest.nest(remainingParts, config);
        console.log(`📦 Sheet ${sheetIndex} nesting completed:`, {
          placementsCount: result.placements?.length || 0,
          unplacedCount: result.paths?.length || 0,
          fitness: result.fitness
        });

        if (!result || !result.placements || result.placements.length === 0) {
          console.warn(`📦 No placements found for sheet ${sheetIndex}, stopping nesting`);
          break;
        }

        // Handle multiple placement groups from a single nesting call
        if (result.placements && Array.isArray(result.placements) && result.placements.length > 0) {
          console.log(`📦 Processing ${result.placements.length} placement groups from nesting result`);
          
          for (let groupIndex = 0; groupIndex < result.placements.length; groupIndex++) {
            const placementGroup = result.placements[groupIndex];
            if (placementGroup && placementGroup.length > 0) {
              // Create a modified result object for this specific placement group
              const groupResult = {
                ...result,
                placements: [placementGroup]  // Only include this specific placement group
              };
              
              const formatted = this.formatNestingResult(groupResult, items, sheetIndex);
              if (formatted && formatted.placements && formatted.placements[0]) {
                allSheets.push(formatted.placements[0]);
                console.log(`📦 Sheet ${sheetIndex} formatted successfully with ${formatted.placements[0].parts.length} parts (group ${groupIndex + 1}/${result.placements.length})`);
                
                if (formatted.fitness !== undefined) {
                  overallFitness += formatted.fitness;
                }
                
                sheetIndex++;
              }
            }
          }
          
          // Decrement sheetIndex by 1 since it will be incremented at the end of the loop
          sheetIndex--;
        } else {
          // Fallback to original logic if no placement groups found
          const formatted = this.formatNestingResult(result, items, sheetIndex);
          if (formatted && formatted.placements && formatted.placements[0]) {
            allSheets.push(formatted.placements[0]);
            console.log(`📦 Sheet ${sheetIndex} formatted successfully with ${formatted.placements[0].parts.length} parts`);
          }

          if (formatted && formatted.fitness !== undefined) {
            overallFitness += formatted.fitness;
          }
        }

        // Check if there are unplaced parts
        if (!result.paths || result.paths.length === 0) {
          console.log(`📦 All parts placed successfully in ${allSheets.length} sheet(s)`);
          break;
        }

        // Identify unplaced parts for next iteration
        const unplacedParts = this.identifyUnplacedParts(allParts, result.paths);
        console.log(`📦 Identified ${unplacedParts.length} unplaced parts for next sheet`);

        if (unplacedParts.length === remainingParts.length) {
          // No progress made - likely infinite loop scenario
          console.warn(`📦 No progress made on sheet ${sheetIndex}, applying order-based splitting`);
          const splitResult = this.splitPartsByOrder(unplacedParts, Math.ceil(unplacedParts.length / 2));
          remainingParts = splitResult.priorityParts;
          console.log(`📦 Reduced parts to ${remainingParts.length} for next attempt`);
          
          if (remainingParts.length === 0) {
            console.warn('📦 No parts could be prioritized, stopping nesting');
            break;
          }
        } else {
          remainingParts = unplacedParts;
        }

        sheetIndex++;
      }

      if (sheetIndex > maxSheets) {
        console.warn(`📦 Reached maximum sheet limit (${maxSheets}), some parts may remain unplaced`);
      }

      console.log(`📦 Multi-sheet nesting completed: ${allSheets.length} sheets created`);
      return { 
        fitness: overallFitness, 
        placements: allSheets,
        sheetsUsed: allSheets.length 
      };

    } catch (error) {
      console.error('Error in multi-sheet nesting process:', error);
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
        
        // Check for Twin Pack variants (twin pack, twinpack, twin-pack)
        if (itemNameLower.includes('twin pack') || itemNameLower.includes('twinpack') || itemNameLower.includes('twin-pack')) {
          adjustedQuantity = item.quantity * 2;
          packType = 'Twin Pack';
          console.log(`Detected Twin Pack in item name. Adjusting quantity from ${item.quantity} to ${adjustedQuantity}`);
        } 
        // Check for Triple Pack variants (triple pack, triplepack, triple-pack)
        else if (itemNameLower.includes('triple pack') || itemNameLower.includes('triplepack') || itemNameLower.includes('triple-pack')) {
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
              quantity: subPart.quantity * adjustedItem.quantity, // Use the quantity from the mapping
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
      } else if (adjustedItem.sku.startsWith('SFC')) {
        // Handle SFC items that don't have SVG URLs but need custom processing
        console.log(`Processing SFC SKU ${adjustedItem.sku} with custom dimensions`);
        const sfcParts = await this.processSingleItem(adjustedItem);
        console.log(`Generated ${sfcParts.length} parts for SFC SKU ${adjustedItem.sku}`);
        parts.push(...sfcParts);
      } else if (adjustedItem.sku.startsWith('SFP')) {
        // Handle retail pack items that don't have SVG URLs but need custom processing
        console.log(`Processing retail pack SKU ${adjustedItem.sku} with custom dimensions`);
        const retailPackParts = await this.processSingleItem(adjustedItem);
        console.log(`Generated ${retailPackParts.length} parts for retail pack SKU ${adjustedItem.sku}`);
        parts.push(...retailPackParts);
      } else if (adjustedItem.sku.startsWith('SFSK')) {
        // Handle starter kit items that don't have SVG URLs but need custom processing
        console.log(`Processing starter kit SKU ${adjustedItem.sku} with custom dimensions`);
        const starterKitParts = await this.processSingleItem(adjustedItem);
        console.log(`Generated ${starterKitParts.length} parts for starter kit SKU ${adjustedItem.sku}`);
        parts.push(...starterKitParts);
      } else if (adjustedItem.sku.startsWith('SFSKMP')) {
        // Handle mixed pack items
        const mixedPackInfo = getMixedPackInfo(adjustedItem.sku);
        if (!mixedPackInfo) {
          console.warn(`Could not parse mixed pack info for SKU: ${adjustedItem.sku}`);
          continue;
        }
        for (const depth of mixedPackInfo.depths) {
          const foamSheet = `${mixedPackInfo.color} ${depth}mm`;
          const partItem = {
            ...adjustedItem,
            foamSheet,
            quantity: adjustedItem.quantity, // N per depth
            dimensions: mixedPackInfo.dimensions,
            depth,
            color: mixedPackInfo.color,
            isMixedPack: true,
            svgUrl: ['mixedPack']
          };
          const mixedPackParts = await this.processSingleItem(partItem);
          parts.push(...mixedPackParts);
        }
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
    
    // Generate and log dimension validation report
    if (parts.length > 0) {
      const validationReport = this.generateDimensionValidationReport(parts);
      console.log('\n' + validationReport);
    }
    
    return parts;
  }

  async processSingleItem(item) {
    const parts = [];
    
    console.log(`\n--- processSingleItem called for SKU: ${item.sku} ---`);
    console.log('Item with SVG URLs:', item);
    
    // Handle mixed pack items with custom dimensions
    if (item.svgUrl && item.svgUrl[0] === 'mixedPack') {
      console.log(`Processing mixed pack item: ${item.sku} (${item.foamSheet}, ${item.depth}mm)`);
      const width = item.dimensions?.width || 320;
      const height = item.dimensions?.height || 400;
      // Create a simple rectangular polygon
      const polygon = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
        { x: 0, y: 0 }
      ];
      for (let i = 0; i < item.quantity; i++) {
        const part = {
          id: `${item.sku}_${item.foamSheet}_${i}`,
          source: {
            sku: item.sku,
            itemName: item.itemName,
            orderId: item.orderId,
            customerName: item.customerName,
            priority: item.priority || 10,
            foamSheet: item.foamSheet,
            depth: item.depth,
            color: item.color,
            dimensions: { width, height },
            isMixedPack: true
          },
          polygons: [polygon],
          x: 0,
          y: 0,
          rotation: 0,
          width: width,
          height: height,
          area: width * height
        };
        parts.push(part);
        console.log(`Created mixed pack part: ${part.id} (${width}mm x ${height}mm, ${item.foamSheet})`);
      }
      return parts;
    }

    // Handle SFC items with custom dimensions
    if (item.sku.startsWith('SFC') || (item.svgUrl && item.svgUrl[0] === 'custom')) {
      console.log(`Processing SFC item with custom dimensions: ${item.sku}`);
      
      // Parse dimensions from item name
      const dimensions = parseSfcDimensions(item.itemName);
      if (!dimensions) {
        console.warn(`Could not parse dimensions for SFC item: ${item.sku} - ${item.itemName}`);
        return parts;
      }

      // Get foam sheet info from SKU
      const foamSheetInfo = getSfcFoamSheetInfo(item.sku);
      if (!foamSheetInfo) {
        console.warn(`Could not parse foam sheet info for SFC item: ${item.sku}`);
        return parts;
      }

      console.log(`SFC item dimensions: ${dimensions.width}mm x ${dimensions.height}mm`);
      console.log(`SFC foam sheet: ${foamSheetInfo.color} ${foamSheetInfo.thickness}mm`);

      // Create rectangular polygon for the SFC item
      const width = dimensions.width;
      const height = dimensions.height;
      
      // Create a simple rectangular polygon
      const polygon = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
        { x: 0, y: 0 }
      ];

      // Create parts for this SFC item
      for (let i = 0; i < item.quantity; i++) {
        const part = {
          id: `${item.sku}_${i}`,
          source: {
            sku: item.sku,
            itemName: item.itemName,
            orderId: item.orderId,
            customerName: item.customerName,
            priority: item.priority || 10,
            packType: item.packType,
            foamSheet: `${foamSheetInfo.color} ${foamSheetInfo.thickness}mm`,
            dimensions: dimensions
          },
          polygons: [polygon],
          x: 0,
          y: 0,
          rotation: 0,
          width: width,
          height: height,
          area: width * height
        };
        
        parts.push(part);
        console.log(`Created SFC part: ${part.id} (${width}mm x ${height}mm)`);
      }
      
      return parts;
    }

    // Handle retail pack items with custom dimensions
    if (item.sku.startsWith('SFP') || (item.svgUrl && item.svgUrl[0] === 'retail')) {
      console.log(`Processing retail pack item with custom dimensions: ${item.sku}`);
      
      // Get retail pack info from SKU
      const retailPackInfo = getRetailPackInfo(item.sku);
      if (!retailPackInfo) {
        console.warn(`Could not parse retail pack info for item: ${item.sku}`);
        return parts;
      }

      // Get retail pack dimensions (always 600mm x 420mm)
      const dimensions = getRetailPackDimensions();

      console.log(`Retail pack dimensions: ${dimensions.width}mm x ${dimensions.height}mm`);
      console.log(`Retail pack foam sheet: ${retailPackInfo.color} ${retailPackInfo.thickness}mm`);
      console.log(`Retail pack quantity per item: ${retailPackInfo.quantity}`);

      // Create rectangular polygon for the retail pack item
      const width = dimensions.width;
      const height = dimensions.height;
      
      // Create a simple rectangular polygon
      const polygon = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
        { x: 0, y: 0 }
      ];

      // Create parts for this retail pack item
      // Each order item quantity is multiplied by the retail pack quantity
      const totalParts = item.quantity * retailPackInfo.quantity;
      for (let i = 0; i < totalParts; i++) {
        const part = {
          id: `${item.sku}_${i}`,
          source: {
            sku: item.sku,
            itemName: item.itemName,
            orderId: item.orderId,
            customerName: item.customerName,
            priority: item.priority || 10,
            packType: item.packType,
            foamSheet: `${retailPackInfo.color} ${retailPackInfo.thickness}mm`,
            dimensions: dimensions,
            retailPackQuantity: retailPackInfo.quantity
          },
          polygons: [polygon],
          x: 0,
          y: 0,
          rotation: 0,
          width: width,
          height: height,
          area: width * height
        };
        
        parts.push(part);
        console.log(`Created retail pack part: ${part.id} (${width}mm x ${height}mm)`);
      }
      
      return parts;
    }

    // Handle starter kit items with custom dimensions
    if (item.sku.startsWith('SFSK') || (item.svgUrl && item.svgUrl[0] === 'starter')) {
      console.log(`Processing starter kit item with custom dimensions: ${item.sku}`);
      
      // Get starter kit info from SKU
      const starterKitInfo = getStarterKitInfo(item.sku);
      if (!starterKitInfo) {
        console.warn(`Could not parse starter kit info for item: ${item.sku}`);
        return parts;
      }

      // Get starter kit dimensions (always 420mm x 600mm)
      const dimensions = getStarterKitDimensions();

      console.log(`Starter kit dimensions: ${dimensions.width}mm x ${dimensions.height}mm`);
      console.log(`Starter kit foam sheet: ${starterKitInfo.color} ${starterKitInfo.thickness}mm`);
      console.log(`Starter kit quantity per item: ${starterKitInfo.quantity}`);

      // Create rectangular polygon for the starter kit item
      const width = dimensions.width;
      const height = dimensions.height;
      
      // Create a simple rectangular polygon
      const polygon = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
        { x: 0, y: 0 }
      ];

      // Create parts for this starter kit item
      // Each order item quantity is multiplied by the starter kit quantity (always 3)
      const totalParts = item.quantity * starterKitInfo.quantity;
      for (let i = 0; i < totalParts; i++) {
        const part = {
          id: `${item.sku}_${i}`,
          source: {
            sku: item.sku,
            itemName: item.itemName,
            orderId: item.orderId,
            customerName: item.customerName,
            priority: item.priority || 10,
            packType: item.packType,
            foamSheet: `${starterKitInfo.color} ${starterKitInfo.thickness}mm`,
            dimensions: dimensions,
            starterKitQuantity: starterKitInfo.quantity
          },
          polygons: [polygon],
          x: 0,
          y: 0,
          rotation: 0,
          width: width,
          height: height,
          area: width * height
        };
        
        parts.push(part);
        console.log(`Created starter kit part: ${part.id} (${width}mm x ${height}mm)`);
      }
      
      return parts;
    }
    
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
        
        let svgContent = await response.text();
        console.log(`SVG content length: ${svgContent.length} characters`);
        console.log(`SVG content preview: ${svgContent.substring(0, 200)}...`);
        
        // --- SVG DIMENSION VALIDATION AND CORRECTION ---
        try {
          if (EXPECTED_DIMENSIONS[item.sku]) {
            console.log(`🔍 Validating dimensions for SKU: ${item.sku}`);
            const validation = validateSvgDimensions(item.sku, svgContent);
            
            console.log(`📏 Expected: ${validation.expectedDimensions.width}mm × ${validation.expectedDimensions.height}mm`);
            console.log(`📏 Actual: ${validation.actualDimensions.width.toFixed(2)}${validation.actualDimensions.unit} × ${validation.actualDimensions.height.toFixed(2)}${validation.actualDimensions.unit}`);
            
            if (!validation.isValid) {
              console.warn(`⚠️  Dimension validation failed for ${item.sku}:`);
              console.warn(`   Width difference: ${validation.dimensionDifference.widthDiffPercent.toFixed(1)}%`);
              console.warn(`   Height difference: ${validation.dimensionDifference.heightDiffPercent.toFixed(1)}%`);
              
              // Generate corrected SVG
              console.log(`🔧 Generating corrected SVG for ${item.sku}...`);
              const correctedSvg = generateCorrectedSvg(item.sku, svgContent);
              
              if (correctedSvg !== svgContent) {
                svgContent = correctedSvg;
                console.log(`✅ SVG dimensions corrected for ${item.sku}`);
                
                // Re-validate to confirm correction
                const revalidation = validateSvgDimensions(item.sku, svgContent);
                if (revalidation.isValid) {
                  console.log(`✅ Corrected SVG passed validation for ${item.sku}`);
                } else {
                  console.warn(`⚠️  Corrected SVG still has dimension issues for ${item.sku}`);
                }
              } else {
                console.warn(`⚠️  Could not automatically correct SVG dimensions for ${item.sku}`);
                validation.recommendations.forEach(rec => {
                  console.warn(`   💡 ${rec}`);
                });
              }
            } else {
              console.log(`✅ SVG dimensions are valid for ${item.sku}`);
            }
          } else {
            console.log(`ℹ️  No expected dimensions found for SKU: ${item.sku}, skipping validation`);
          }
        } catch (validationError) {
          console.error(`❌ Error during dimension validation for ${item.sku}:`, validationError);
          // Continue with original SVG content if validation fails
        }
        
        // Parse SVG content (now potentially corrected)
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
          
          // --- PROCESS POLYGON WITH DIMENSION-AWARE SCALING ---
          const bounds = this.geometryUtil.getPolygonBounds(bestPolygon);
          const partSvgWidth = bounds.width;
          const partSvgHeight = bounds.height;
          
          console.log(`SVG polygon bounds: ${partSvgWidth.toFixed(2)}x${partSvgHeight.toFixed(2)}`);
          
          // Apply dimension-aware scaling if expected dimensions are known
          let scaledPolygon;
          if (EXPECTED_DIMENSIONS[item.sku]) {
            const expected = EXPECTED_DIMENSIONS[item.sku];
            
            // Calculate scaling factors to match expected dimensions
            const scaleX = expected.width / partSvgWidth;
            const scaleY = expected.height / partSvgHeight;
            
            // Use uniform scaling to maintain aspect ratio (use the smaller scale factor)
            const uniformScale = Math.min(scaleX, scaleY);
            
            console.log(`📐 Applying dimension scaling for ${item.sku}:`);
            console.log(`   Expected: ${expected.width}mm × ${expected.height}mm`);
            console.log(`   Polygon bounds: ${partSvgWidth.toFixed(2)} × ${partSvgHeight.toFixed(2)}`);
            console.log(`   Scale factors: X=${scaleX.toFixed(3)}, Y=${scaleY.toFixed(3)}`);
            console.log(`   Uniform scale: ${uniformScale.toFixed(3)}`);
            
            // Apply scaling and shift to origin
            scaledPolygon = bestPolygon.map(pt => ({
              x: (pt.x - bounds.x) * uniformScale,
              y: (pt.y - bounds.y) * uniformScale
            }));
            
            // Update bounds after scaling
            const scaledBounds = this.geometryUtil.getPolygonBounds(scaledPolygon);
            console.log(`✅ Scaled polygon bounds: ${scaledBounds.width.toFixed(2)}mm × ${scaledBounds.height.toFixed(2)}mm`);
          } else {
            // Fallback to 1:1 scaling - just shift polygon to origin (0,0)
            console.log(`Using 1:1 scaling for ${item.sku} (no expected dimensions available)`);
            scaledPolygon = bestPolygon.map(pt => ({
              x: pt.x - bounds.x,
              y: pt.y - bounds.y
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
              subPartIndex: item.subPartIndex || 0,
              // Add dimension validation metadata
              dimensionValidated: EXPECTED_DIMENSIONS[item.sku] ? true : false,
              expectedDimensions: EXPECTED_DIMENSIONS[item.sku] || null,
              actualDimensions: {
                width: this.geometryUtil.getPolygonBounds(shifted).width,
                height: this.geometryUtil.getPolygonBounds(shifted).height
              }
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
    
    // Log dimension validation summary
    if (parts.length > 0) {
      const validatedParts = parts.filter(p => p.dimensionValidated);
      if (validatedParts.length > 0) {
        console.log(`📊 Dimension validation summary for ${item.sku}:`);
        console.log(`   ${validatedParts.length}/${parts.length} parts had dimension validation`);
        
        const samplePart = validatedParts[0];
        if (samplePart.expectedDimensions) {
          console.log(`   Expected: ${samplePart.expectedDimensions.width}mm × ${samplePart.expectedDimensions.height}mm`);
          console.log(`   Final: ${samplePart.actualDimensions.width.toFixed(2)}mm × ${samplePart.actualDimensions.height.toFixed(2)}mm`);
        }
      }
    }
    
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

    console.log('[FORMAT DEBUG] formatNestingResult called with:', {
      hasPlacementsArray: !!nestingResult.placements,
      placementsLength: nestingResult.placements?.length || 0,
      fitness: nestingResult.fitness,
      firstSheetLength: nestingResult.placements?.[0]?.length || 0
    });

    // Use the best individual's placements array for x/y/rotation/id
    const placementsArr = nestingResult.placements?.[0] || []; // Get the first sheet's placements
    if (!placementsArr || placementsArr.length === 0) {
      console.warn('[FORMAT DEBUG] No placements found in nesting result');
      return null;
    }

    console.log('[FORMAT DEBUG] Processing placements array with', placementsArr.length, 'items');
    
    // Debug first placement data structure
    if (placementsArr[0]) {
      const firstPlacement = placementsArr[0];
      console.log('[FORMAT DEBUG] First placement structure:', {
        keys: Object.keys(firstPlacement),
        id: firstPlacement.id,
        sku: firstPlacement.sku,
        hasPolygons: !!firstPlacement.polygons,
        polygonsType: typeof firstPlacement.polygons,
        polygonsLength: firstPlacement.polygons?.length || 0,
        x: firstPlacement.x,
        y: firstPlacement.y
      });
    }

    // Group parts by their original SKU to handle composite SKUs
    const groupedPlacements = new Map();
    
    for (const placement of placementsArr) {
      console.log('[FORMAT DEBUG] Processing placement:', {
        id: placement.id,
        sku: placement.sku,
        hasPolygons: !!placement.polygons,
        polygonCount: placement.polygons?.length || 0
      });
      
      // The placement should already have all the data we need from SVGnest integration
      const part = placement;
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
    console.log('[ALIGN DEBUG] alignPlacementsToOrigin called with placements:', placements.length);
    
    // Check if placements need to be shifted to fit within bounds
    // Only shift if the minimum placement is outside the bounds (10-990 for X, 10-1990 for Y)
    let minX = Infinity, minY = Infinity;
    placements.forEach((part, index) => {
      console.log(`[ALIGN DEBUG] Processing part ${index}:`, {
        id: part.id,
        hasPolygons: !!part.polygons,
        polygonsLength: part.polygons ? part.polygons.length : 0,
        firstPolygonLength: part.polygons && part.polygons[0] ? part.polygons[0].length : 0
      });
      
      // Defensive check for polygons
      if (!part.polygons || !part.polygons[0] || !Array.isArray(part.polygons[0])) {
        console.warn(`[ALIGN DEBUG] Part ${part.id} has invalid polygons structure, skipping`);
        return;
      }
      
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
      // Defensive check for polygons
      if (!part.polygons || !part.polygons[0] || !Array.isArray(part.polygons[0])) {
        console.warn(`[ALIGN DEBUG] Part ${part.id} has invalid polygons structure in bounds check, skipping`);
        return;
      }
      
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
      // Only support 0-degree rotation
      const rotation = 0;
      return {
        attempts,
        rotation,
        rotationIndex: 0,
        isEvenAttempt: true
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
      if (!partPolygon || !Array.isArray(partPolygon) || partPolygon.length === 0) {
        console.warn(`[BOUNDS CHECK] Part ${part.id} has invalid polygon structure`);
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

  /**
   * Generate a dimension validation report for all processed parts
   */
  generateDimensionValidationReport(parts) {
    const report = [];
    report.push('🔍 Nesting Dimension Validation Report');
    report.push('='.repeat(50));
    report.push('');
    
    const validatedParts = parts.filter(p => p.dimensionValidated);
    const skuGroups = {};
    
    // Group parts by SKU
    validatedParts.forEach(part => {
      const sku = part.source.sku;
      if (!skuGroups[sku]) {
        skuGroups[sku] = {
          sku,
          parts: [],
          expected: part.expectedDimensions,
          sample: part.actualDimensions
        };
      }
      skuGroups[sku].parts.push(part);
    });
    
    Object.values(skuGroups).forEach((group, index) => {
      report.push(`${index + 1}. ${group.sku} (${group.parts.length} parts)`);
      if (group.expected) {
        report.push(`   Expected: ${group.expected.width}mm × ${group.expected.height}mm`);
        report.push(`   Actual: ${group.sample.width.toFixed(2)}mm × ${group.sample.height.toFixed(2)}mm`);
        
        const widthDiff = Math.abs(group.sample.width - group.expected.width);
        const heightDiff = Math.abs(group.sample.height - group.expected.height);
        const widthPercent = (widthDiff / group.expected.width) * 100;
        const heightPercent = (heightDiff / group.expected.height) * 100;
        
        if (widthPercent <= 5 && heightPercent <= 5) {
          report.push(`   ✅ Dimensions within tolerance (≤5%)`);
        } else {
          report.push(`   ⚠️  Dimensions outside tolerance:`);
          report.push(`      Width difference: ${widthPercent.toFixed(1)}%`);
          report.push(`      Height difference: ${heightPercent.toFixed(1)}%`);
        }
      }
      report.push('');
    });
    
    const totalParts = parts.length;
    const validatedCount = validatedParts.length;
    report.push(`Summary: ${validatedCount}/${totalParts} parts validated`);
    
    return report.join('\n');
  }

  /**
   * Identify unplaced parts by comparing original parts with the paths returned by nesting
   */
  identifyUnplacedParts(originalParts, unplacedPaths) {
    if (!unplacedPaths || unplacedPaths.length === 0) {
      return [];
    }

    console.log('🔍 Identifying unplaced parts:', {
      originalCount: originalParts.length,
      unplacedPathsCount: unplacedPaths.length
    });

    const unplacedParts = [];
    
    // Match unplaced paths back to original parts by ID
    for (const path of unplacedPaths) {
      const originalPart = originalParts.find(part => part.id === path.id);
      if (originalPart) {
        unplacedParts.push(originalPart);
        console.log(`🔍 Found unplaced part: ${originalPart.sku || originalPart.source?.sku} (ID: ${originalPart.id})`);
      } else {
        console.warn(`🔍 Could not find original part for unplaced path ID: ${path.id}`);
      }
    }

    console.log(`🔍 Identified ${unplacedParts.length} unplaced parts`);
    return unplacedParts;
  }

  /**
   * Split parts by order, prioritizing keeping orders together
   * Returns a smaller set of parts that should fit in one sheet
   */
  splitPartsByOrder(parts, targetCount) {
    console.log(`📋 Splitting ${parts.length} parts to target ${targetCount} parts`);

    // Group parts by order ID
    const orderGroups = new Map();
    for (const part of parts) {
      const orderId = part.source?.orderId || part.source?.order_id || 'unknown';
      if (!orderGroups.has(orderId)) {
        orderGroups.set(orderId, []);
      }
      orderGroups.get(orderId).push(part);
    }

    console.log(`📋 Found ${orderGroups.size} distinct orders`);

    // Sort orders by priority (lowest priority number = highest priority)
    const sortedOrders = Array.from(orderGroups.entries()).sort((a, b) => {
      const priorityA = Math.min(...a[1].map(part => part.source?.priority || 10));
      const priorityB = Math.min(...b[1].map(part => part.source?.priority || 10));
      return priorityA - priorityB;
    });

    console.log('📋 Order priorities:', sortedOrders.map(([orderId, parts]) => ({
      orderId,
      partCount: parts.length,
      priority: Math.min(...parts.map(part => part.source?.priority || 10))
    })));

    // Select complete orders until we approach target count
    const priorityParts = [];
    const remainingParts = [];
    
    for (const [orderId, orderParts] of sortedOrders) {
      if (priorityParts.length + orderParts.length <= targetCount) {
        // Add entire order
        priorityParts.push(...orderParts);
        console.log(`📋 Added complete order ${orderId} (${orderParts.length} parts)`);
      } else {
        // Can't fit entire order, add to remaining
        remainingParts.push(...orderParts);
        console.log(`📋 Deferred order ${orderId} (${orderParts.length} parts) to remaining`);
      }
    }

    // If we haven't reached target count and there are remaining parts,
    // add individual parts from the highest priority remaining order
    if (priorityParts.length < targetCount && remainingParts.length > 0) {
      const partsToAdd = targetCount - priorityParts.length;
      const additionalParts = remainingParts.slice(0, partsToAdd);
      priorityParts.push(...additionalParts);
      remainingParts.splice(0, partsToAdd);
      console.log(`📋 Added ${additionalParts.length} individual parts to reach target`);
    }

    console.log(`📋 Split result: ${priorityParts.length} priority parts, ${remainingParts.length} deferred parts`);

    return {
      priorityParts,
      remainingParts
    };
  }
} 