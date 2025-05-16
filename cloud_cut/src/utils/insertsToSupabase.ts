import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';

// Create a direct Supabase client with admin privileges for scripts/API routes
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

interface InsertItem {
  brand_name: string;
  sku: string;
  stock_available: number;
  created_at: string;
  updated_at: string;
}

/**
 * Clean brand name by removing the word "Insert"
 */
function cleanBrandName(brandName: string): string {
  return brandName.replace(/\s*Insert\s*$/i, '').trim();
}

/**
 * Imports insert data from CSV file to Supabase
 * @param clearExisting - Whether to clear existing data before import (default: true)
 */
export async function importInsertsToSupabase(clearExisting: boolean = true) {
  try {
    console.log('Starting import of inserts from CSV to Supabase');
    console.log(`Using Supabase URL: ${supabaseUrl}`);
    
    // Read CSV file
    const csvFilePath = path.join(process.cwd(), 'src', 'data', 'optimized_insert.csv');
    const csvData = fs.readFileSync(csvFilePath, 'utf8');
    
    console.log(`CSV file read successfully from ${csvFilePath}`);
    
    // Clear existing data if requested
    if (clearExisting) {
      console.log('Clearing existing inserts data...');
      const { error: deleteError } = await supabase
        .from('inserts')
        .delete()
        .neq('id', 0); // This is a trick to delete all rows
      
      if (deleteError) {
        console.error('Error clearing existing data:', deleteError);
        throw deleteError;
      }
      console.log('Existing data cleared successfully');
    }
    
    // Parse CSV data
    const records: Record<string, unknown>[] = [];
    const skippedRecords: Array<{sku: string, reason: string}> = [];
    
    // Create a parser with headers
    const parser = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    // Process each record
    for await (const record of parser) {
      const sku = record['Variant SKU'];
      
      // Skip records without a SKU that starts with SFI
      if (!sku || !sku.toString().toUpperCase().startsWith('SFI')) {
        skippedRecords.push({
          sku: sku || '(empty)',
          reason: 'SKU does not start with SFI'
        });
        continue;
      }
      
      // Clean the brand name (remove "Insert")
      const cleanedBrandName = cleanBrandName(record.Type);
      
      const insertItem: Record<string, unknown> = {
        brand_name: cleanedBrandName,
        sku: sku,
        stock_available: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      records.push(insertItem);
    }
    
    console.log(`Parsed ${records.length} valid inserts from CSV (skipped ${skippedRecords.length} records)`);
    
    if (skippedRecords.length > 0) {
      console.log(`First 5 skipped records:`, skippedRecords.slice(0, 5));
    }
    
    if (records.length === 0) {
      console.log('No valid records to insert');
      return { success: true, count: 0, skipped: skippedRecords.length };
    }
    
    // Insert all records as new
    const { data, error } = await supabase
      .from('inserts')
      .insert(records);
    
    if (error) {
      console.error('Error inserting data to Supabase:', error);
      throw error;
    }
    
    console.log(`Successfully imported ${records.length} inserts to Supabase`);
    return { 
      success: true, 
      count: records.length, 
      skipped: skippedRecords.length 
    };
  } catch (error) {
    console.error('Error importing inserts:', error);
    throw error;
  }
}

/**
 * Utility to create a script that can be run directly to import data
 */
if (require.main === module) {
  // This file is being run directly
  importInsertsToSupabase()
    .then(result => {
      console.log('Import complete:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('Import failed:', error);
      process.exit(1);
    });
}
