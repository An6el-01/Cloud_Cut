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

// Function to get the correct Python executable path
function getPythonPath() {
  // In production (Vercel), use the system Python
  if (process.env.VERCEL) {
    return '/usr/bin/python3';
  }
  // In development, try to use the virtual environment Python
  const venvPython = path.join(process.cwd(), 'venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  // Fallback to system Python
  return 'python';
}

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
    const scriptPath = path.join(process.cwd(), '..', 'dxfToSvg', 'index.py');

    console.log('Starting Python conversion with script:', scriptPath);
    console.log('Input file:', inputPath);
    console.log('Using Python executable:', getPythonPath());

    // Spawn Python process with the correct Python path
    const pythonProcess = spawn(getPythonPath(), [scriptPath, inputPath]);

    let svgData = '';
    let errorData = '';

    pythonProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      console.log('Python stdout chunk:', chunk.substring(0, 100) + '...');
      svgData += chunk;
    });

    pythonProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      console.error('Python stderr:', chunk);
      errorData += chunk;
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
        console.error('Python process failed with code:', code);
        console.error('Error output:', errorData);
        reject(new Error(`Python process failed: ${errorData}`));
        return;
      }

      if (!svgData) {
        console.error('No SVG data received from Python process');
        reject(new Error('No SVG data received from conversion process'));
        return;
      }

      // Validate SVG data
      if (!svgData.trim().startsWith('<?xml') || !svgData.includes('<svg')) {
        console.error('Invalid SVG data format');
        reject(new Error('Invalid SVG data format'));
        return;
      }

      console.log('SVG data length:', svgData.length);
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
      
      // Create filename using the exact SKU
      const fileName = `${sku.toUpperCase()}.${fileExtension}`;

      // Convert file to buffer
      const fileBuffer = await dxfFile.arrayBuffer();

      // Convert DXF to SVG
      let svgData;
      try {
        svgData = await convertDxfToSvg(fileBuffer);
        console.log('SVG conversion successful, data length:', svgData.length);
        
        // Validate SVG data
        if (!svgData.startsWith('<?xml') || !svgData.includes('<svg')) {
          console.error('Invalid SVG data format');
          return NextResponse.json(
            { success: false, message: 'Invalid SVG data format' },
            { status: 500 }
          );
        }

        // Ensure SVG has proper structure
        if (!svgData.includes('viewBox=')) {
          console.error('SVG missing viewBox attribute');
          return NextResponse.json(
            { success: false, message: 'Invalid SVG structure' },
            { status: 500 }
          );
        }
      } catch (error) {
        console.error('Error converting DXF to SVG:', error);
        return NextResponse.json(
          { success: false, message: 'Failed to convert DXF to SVG' },
          { status: 500 }
        );
      }

      // Upload SVG to storage
      const svgFileName = fileName.replace('.dxf', '.svg');
      console.log('Uploading SVG to storage:', svgFileName);
      
      try {
        // Convert SVG data to Buffer for upload
        const svgBuffer = Buffer.from(svgData, 'utf-8');
        
        const { error: uploadError } = await supabase.storage
          .from('inserts')
          .upload(svgFileName, svgBuffer, {
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

        // Verify the upload by trying to get the file
        const { data: fileData, error: getError } = await supabase.storage
          .from('inserts')
          .download(svgFileName);

        if (getError || !fileData) {
          console.error('Error verifying upload:', getError);
          return NextResponse.json(
            { success: false, message: 'Failed to verify file upload' },
            { status: 500 }
          );
        }

        console.log('SVG file uploaded and verified successfully');
      } catch (error) {
        console.error('Error in upload process:', error);
        return NextResponse.json(
          { success: false, message: 'Error in upload process' },
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