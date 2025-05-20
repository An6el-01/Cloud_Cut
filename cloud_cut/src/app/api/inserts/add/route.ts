import { NextRequest, NextResponse } from 'next/server';
import Parser from 'dxf-parser';
import { Readable } from 'stream';
import { createClient } from '@supabase/supabase-js';

// Create admin client directly for serverless environment
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

function dxfToSvg(parsed: any): string {
  try {
    console.log('Parsed DXF entities:', parsed.entities?.length || 0);
    
    // Process both LINE and LWPOLYLINE entities
    const lines = (parsed.entities || [])
      .filter((e: any) => {
        const isValid = e.type === 'LINE' || e.type === 'LWPOLYLINE';
        if (!isValid) {
          console.log('Skipping unsupported entity:', e.type);
        }
        return isValid;
      })
      .map((entity: any) => {
        if (entity.type === 'LINE') {
          // Handle LINE entities
          const x1 = Number(entity.start.x);
          const y1 = Number(entity.start.y);
          const x2 = Number(entity.end.x);
          const y2 = Number(entity.end.y);
          
          if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
            console.log('Invalid coordinates in line:', entity);
            return null;
          }
          
          return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${-y2}" stroke="red" stroke-width="1" />`;
        } else if (entity.type === 'LWPOLYLINE') {
          // Handle LWPOLYLINE entities
          if (!entity.vertices || !Array.isArray(entity.vertices) || entity.vertices.length < 2) {
            console.log('Invalid LWPOLYLINE vertices:', entity);
            return null;
          }

          // Convert vertices to path data
          const points = entity.vertices
            .map((vertex: any) => {
              const x = Number(vertex.x);
              const y = Number(vertex.y);
              if (isNaN(x) || isNaN(y)) {
                console.log('Invalid vertex coordinates:', vertex);
                return null;
              }
              return `${x},${-y}`; // Invert Y coordinate for SVG
            })
            .filter(Boolean)
            .join(' ');

          if (points.length === 0) {
            return null;
          }

          // Create a polyline element with red stroke
          return `<polyline points="${points}" fill="none" stroke="red" stroke-width="1" />`;
        }
        return null;
      })
      .filter(Boolean) // Remove any null entries
      .join('\n');

    console.log('Generated SVG elements:', lines.length > 0 ? 'Yes' : 'No');
    
    // Calculate viewBox based on all coordinates
    const allCoords = (parsed.entities || [])
      .filter((e: any) => e.type === 'LINE' || e.type === 'LWPOLYLINE')
      .flatMap((e: any) => {
        if (e.type === 'LINE') {
          return [
            Number(e.start.x),
            Number(e.start.y),
            Number(e.end.x),
            Number(e.end.y)
          ];
        } else if (e.type === 'LWPOLYLINE' && e.vertices) {
          return e.vertices.flatMap((v: any) => [
            Number(v.x),
            Number(v.y)
          ]);
        }
        return [];
      })
      .filter((n: number) => !isNaN(n));

    if (allCoords.length === 0) {
      console.log('No valid coordinates found in DXF file');
      return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100%" height="100%" fill="#23272f"/>
<text x="50" y="50" text-anchor="middle" fill="red">No valid geometry found</text>
</svg>`;
    }

    const minX = Math.min(...allCoords.filter((_: number, i: number) => i % 2 === 0));
    const maxX = Math.max(...allCoords.filter((_: number, i: number) => i % 2 === 0));
    const minY = Math.min(...allCoords.filter((_: number, i: number) => i % 2 === 1));
    const maxY = Math.max(...allCoords.filter((_: number, i: number) => i % 2 === 1));

    const width = maxX - minX;
    const height = maxY - minY;
    const padding = Math.max(width, height) * 0.1; // 10% padding

    const viewBox = `${minX - padding} ${-maxY - padding} ${width + 2 * padding} ${height + 2 * padding}`;

    // Add a grey background only
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <rect x="${minX - padding}" y="${-maxY - padding}" width="${width + 2 * padding}" height="${height + 2 * padding}" fill="#23272f"/>
${lines}
</svg>`;

    console.log('Generated SVG length:', svg.length);
    return svg;
  } catch (error) {
    console.error('Error in dxfToSvg:', error);
    throw error;
  }
}

async function fileToBuffer(file: File): Promise<Buffer> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error('Error in fileToBuffer:', error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const brand = formData.get('brand') as string;
    const sku = formData.get('sku') as string;
    const dxfFile = formData.get('dxf') as File;

    if(!(dxfFile instanceof File)) {
      return NextResponse.json({ error: 'Invalid DXF file' }, { status: 400 });
    }

    if (!brand || !sku || !dxfFile) {
      console.log('Missing required fields:', { brand, sku, hasFile: !!dxfFile });
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate SKU format
    if (!sku.toUpperCase().startsWith('SFI')) {
      console.log('Invalid SKU format:', sku);
      return NextResponse.json({ error: 'SKU must start with SFI' }, { status: 400 });
    }

    console.log('Processing DXF file:', dxfFile.name);
    const buffer = await fileToBuffer(dxfFile);
    console.log('DXF file buffer size:', buffer.length);

    const parser = new Parser();
    const parsed = parser.parseSync(buffer.toString('utf8'));
    console.log('Parsed DXF file successfully');

    const svg = dxfToSvg(parsed);
    console.log('Generated SVG content');

    // Ensure SVG is properly formatted
    const formattedSvg = svg.trim();
    console.log('SVG size:', formattedSvg.length, 'bytes');
    console.log('SVG preview:', formattedSvg.slice(0, 200));

    // Convert SVG to buffer with proper encoding
    const svgBuffer = Buffer.from(formattedSvg, 'utf8');
    console.log('SVG buffer size:', svgBuffer.length);

    const svgFileName = `${sku}.svg`;
    
    // First, try to insert the record into the database using admin client
    const { error: dbError } = await supabaseAdmin
      .from('inserts')
      .insert([{ 
        brand_name: brand, 
        sku, 
        stock_available: 0 
      }]);

    if (dbError) {
      console.error('Database insert error:', dbError);
      return NextResponse.json({ 
        error: 'Failed to insert record',
        details: dbError.message 
      }, { status: 500 });
    }

    // Then upload the SVG to storage using admin client
    const { error: uploadError } = await supabaseAdmin.storage
      .from('inserts')
      .upload(svgFileName, svgBuffer, { 
        contentType: 'image/svg+xml',
        upsert: true,
        cacheControl: '3600'
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      // If upload fails, try to delete the database record
      await supabaseAdmin
        .from('inserts')
        .delete()
        .eq('sku', sku);
        
      return NextResponse.json({ 
        error: 'Failed to upload SVG',
        details: uploadError.message 
      }, { status: 500 });
    }

    console.log('SVG size:', svg.length, 'bytes');
    console.log('SVG preview:', svg.slice(0, 200));
    // Verify the upload by getting the public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('inserts')
      .getPublicUrl(svgFileName);
    
    console.log('SVG uploaded successfully. Public URL:', urlData.publicUrl);

    return NextResponse.json({ 
      success: true, 
      message: 'Insert added and SVG uploaded successfully!',
      svgUrl: urlData.publicUrl
    });
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
