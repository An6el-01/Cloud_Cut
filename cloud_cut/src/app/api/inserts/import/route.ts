import { NextRequest, NextResponse } from 'next/server';
import { importInsertsToSupabase } from '@/utils/insertsToSupabase';

export async function POST(request: NextRequest) {
  try {
    // Parse request body to get options
    let clearExisting = true; // Default to true
    
    try {
      const body = await request.json();
      if (body && typeof body.clearExisting === 'boolean') {
        clearExisting = body.clearExisting;
      }
    } catch (e) {
      // If JSON parsing fails, use the default value
      console.log('No body or invalid JSON, using default clearExisting=true');
    }
    
    const result = await importInsertsToSupabase(clearExisting);
    
    return NextResponse.json(
      { 
        success: true, 
        message: `Successfully imported ${result.count} inserts${result.skipped ? ` (skipped ${result.skipped} records)` : ''}`,
        data: result 
      }, 
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in import API route:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        message: `Failed to import inserts: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }, 
      { status: 500 }
    );
  }
} 