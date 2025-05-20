// import { NextRequest, NextResponse } from 'next/server';
// import Parser from 'dxf-parser';
// import { Readable } from 'stream';
// import { getServerlessClient } from '@/utils/supabaseServer';

// function dxfToSvg(parsed: any): string {
//   const lines = (parsed.entities || [])
//     .filter((e: any) => e.type === 'LINE')
//     .map(
//       (line: any) =>
//         `<line x1="${line.start.x}" y1="${line.start.y}" x2="${line.end.x}" y2="${-line.end.y}" stroke="black" stroke-width="1" />`
//     )
//     .join('\n');

//   return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">\n${lines}\n</svg>`;
// }

// async function fileToBuffer(file: File): Promise<Buffer> {
//   const arrayBuffer = await file.arrayBuffer();
//   return Buffer.from(arrayBuffer);
// }

// export async function POST(request: NextRequest) {
//   try {
//     const formData = await request.formData();
//     const brand = formData.get('brand') as string;
//     const sku = formData.get('sku') as string;
//     const dxfFile = formData.get('dxf') as File;

//     if (!brand || !sku || !dxfFile) {
//       return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
//     }

//     const buffer = await fileToBuffer(dxfFile);
//     const parser = new Parser();
//     const parsed = parser.parseSync(buffer.toString('utf8'));
//     const svg = dxfToSvg(parsed);

//     const supabase = getServerlessClient();
//     const svgFileName = `${sku}.svg`;
//     const { error: uploadError } = await supabase.storage
//       .from('inserts')
//       .upload(svgFileName, svg, { contentType: 'image/svg+xml', upsert: true });

//     if (uploadError) {
//       return NextResponse.json({ error: 'Failed to upload SVG' }, { status: 500 });
//     }

//     const { error: dbError } = await supabase
//       .from('inserts')
//       .insert([{ brand_name: brand, sku, stock_available: 0 }]);

//     if (dbError) {
//       return NextResponse.json({ error: 'Failed to insert record' }, { status: 500 });
//     }

//     return NextResponse.json({ success: true, message: 'Insert added and SVG uploaded!' });
//   } catch (error) {
//     console.error('Error processing request:', error);
//     return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
//   }
// }
