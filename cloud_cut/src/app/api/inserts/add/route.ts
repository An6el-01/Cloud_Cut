import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Create a direct Supabase client with admin privileges for API routes
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

// Function to convert DXF to SVG using Python script
async function convertDxfToSvg(dxfBuffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create a temporary directory for the conversion
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dxf-convert-'));
    const inputPath = path.join(tempDir, 'input.dxf');
    const outputPath = path.join(tempDir, 'output.svg');

    // Write the DXF buffer to a temporary file
    fs.writeFileSync(inputPath, Buffer.from(dxfBuffer));

    // Get the path to the Python script
    const scriptPath = path.join(process.cwd(), 'dxfTosvg', 'index.py');

    // Spawn Python process
    const pythonProcess = spawn('python', [scriptPath, inputPath]);

    let svgData = '';
    let errorData = '';

    pythonProcess.stdout.on('data', (data) => {
      svgData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    pythonProcess.on('close', (code) => {
      // Clean up temporary files
      try {
        fs.unlinkSync(inputPath);
        fs.rmdirSync(tempDir);
      } catch (err) {
        console.error('Error cleaning up temporary files:', err);
      }

      if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}: ${errorData}`));
        return;
      }

      resolve(svgData);
    });
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const brand = formData.get('brand') as string;
    const sku = formData.get('sku') as string;
    const dxfFiles = formData.getAll('dxf') as File[];

    // Validate required fields
    if (!brand || !sku || !dxfFiles.length) {
      return NextResponse.json(
        { success: false, message: 'Brand, SKU, and at least one DXF file are required' },
        { status: 400 }
      );
    }

    // Validate SKU format (should start with SFI)
    if (!sku.toUpperCase().startsWith('SFI')) {
      return NextResponse.json(
        { success: false, message: 'SKU must start with SFI' },
        { status: 400 }
      );
    }

    // Process each DXF file
    for (let i = 0; i < dxfFiles.length; i++) {
      const dxfFile = dxfFiles[i];
      const fileExtension = dxfFile.name.split('.').pop()?.toLowerCase() || 'dxf';
      
      // Create filename using the exact SKU (append -01, -02, etc. for multiple files)
      const fileName = dxfFiles.length > 1 
        ? `${sku.toUpperCase()}-${String(i + 1).padStart(2, '0')}.${fileExtension}`
        : `${sku.toUpperCase()}.${fileExtension}`;

      // Convert file to buffer
      const fileBuffer = await dxfFile.arrayBuffer();

      // Convert DXF to SVG
      let svgData;
      try {
        svgData = await convertDxfToSvg(fileBuffer);
      } catch (error) {
        console.error('Error converting DXF to SVG:', error);
        return NextResponse.json(
          { success: false, message: 'Failed to convert DXF to SVG' },
          { status: 500 }
        );
      }

      // Upload SVG to storage
      const { error: uploadError } = await supabase.storage
        .from('inserts')
        .upload(fileName.replace('.dxf', '.svg'), svgData, {
          contentType: 'image/svg+xml',
          upsert: true
        });

      if (uploadError) {
        console.error('Error uploading file:', uploadError);
        return NextResponse.json(
          { success: false, message: 'Failed to upload file' },
          { status: 500 }
        );
      }
    }

    // Add insert to database
    const { error: insertError } = await supabase
      .from('inserts')
      .insert({
        brand_name: brand,
        sku: sku.toUpperCase(),
        stock_available: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (insertError) {
      console.error('Error adding insert:', insertError);
      return NextResponse.json(
        { success: false, message: 'Failed to add insert to database' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, message: 'Insert added successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in add insert API route:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
} 