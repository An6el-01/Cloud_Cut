import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Create a direct Supabase client with admin privileges for API routes
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

// Function to get the base URL for API calls
function getBaseUrl() {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.NEXT_PUBLIC_VERCEL_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

// Function to convert DXF to SVG using the Python API
async function convertDxfToSvg(dxfBuffer: ArrayBuffer): Promise<string> {
  try {
    // Convert ArrayBuffer to base64
    const base64Data = Buffer.from(dxfBuffer).toString('base64');
    
    // Construct the full URL
    const baseUrl = getBaseUrl();
    const apiUrl = `${baseUrl}/api/convert`;
    
    console.log('Calling Python API at:', apiUrl);
    
    // Call the Python API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ dxf: base64Data }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Python API error response:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: errorText
      });
      throw new Error(`Python API responded with status: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('Python API response:', { success: result.success, error: result.error });
    
    if (!result.success) {
      throw new Error(result.error || 'Conversion failed');
    }

    if (!result.svg) {
      throw new Error('No SVG data received from conversion');
    }

    return result.svg;
  } catch (error) {
    console.error('Error converting DXF to SVG:', error);
    throw error;
  }
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