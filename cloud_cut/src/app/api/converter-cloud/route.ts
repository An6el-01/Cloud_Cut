import { NextResponse } from "next/server";
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

//Initialize supabase client for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SVG_CONVERTER_SERVICE_URL = process.env.SVG_CONVERTER_SERVICE_URL!;
const TEMP_SVG_BUCKET = 'nests-svg';
const DXF_OUTPUT_BUCKET = 'nests-dxf';

export async function POST(req: Request) {
  try{
    const { svgContent, userId } = await req.json();

    if (!svgContent || !userId) {
      return NextResponse.json({ message: 'SVG content and user ID missing'}, { status: 400 });
    }

    // 1. Upload SVG content to Supabase Storage temporarily
    const svgFileName = `nested_layout_${uuidv4()}.svg`;
    const svgPath = `${userId}/${svgFileName}`;

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from(TEMP_SVG_BUCKET)
      .upload(svgPath, svgContent, {
        contentType: 'image/svg+xml',
        upsert: false,
      });

      if(uploadError) {
        console.error('Error uploading SVG to Supabase Storage:', uploadError);
        return NextResponse.json({ message: 'Failed to upload SVG to storage' }, { status: 500 });
      }

      //Get public URL for the temporary SVG
      const { data: publicUrlData } = supabaseAdmin.storage.from(TEMP_SVG_BUCKET).getPublicUrl(svgPath);
      if(!publicUrlData || !publicUrlData.publicUrl) {
        throw new Error('Failed to get public URL for temporary SVG');
      }
      const svgPublicUrl = publicUrlData.publicUrl;

      console.log(`SVG uploaded to temporary storage: ${svgPublicUrl}`);

      // 2. Call the Cloud Run SVG to DXF converter service
      const converterResponse = await fetch(`${SVG_CONVERTER_SERVICE_URL}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          //Add auth headers here if I secure the cloud run service
        },
        body: JSON.stringify({ svg_url: svgPublicUrl }),
      });

      if (!converterResponse.ok) {
        const errorBody = await converterResponse.json();
        console.error('Cloud Run conversion error:', errorBody);
        return NextResponse.json({ message: 'SVG to DXF conversion failed', details: errorBody.error }, { status: converterResponse.status });
      }

      const converterResult = await converterResponse.json();
      
      if (converterResult.status === 'success') {
        // The Python service returns the DXF path, we need to construct the public URL
        const dxfPath = converterResult.converted_dxf_path;
        const dxfPublicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${dxfPath}`;
        
        console.log(`DXF conversion successful. DXF URL: ${dxfPublicUrl}`);

        //3. Add DXF URL to Supabase Database?
        //Allows to track conversions and provide download links later

        return NextResponse.json({ dxfUrl: dxfPublicUrl }, { status: 200 });
      } else {
        console.error('Cloud Run conversion failed:', converterResult.error);
        return NextResponse.json({ message: 'SVG to DXF conversion failed', details: converterResult.error }, { status: 500 });
      }
  }catch (error) {
    console.error('API Route error:', error);
    return NextResponse.json({ message: 'Internal server error', error: (error as Error).message }, { status: 500 });
  }
}