import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/utils/supabaseServer';

export const runtime = 'nodejs';

export async function GET() {
  try {
    console.log('API Route - Starting profiles fetch');
    
    // Use admin client to fetch profiles directly
    const supabase = getSupabaseAdmin();
    console.log('API Route - Got admin client');
    
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, email, phone, role")
        .order("name", { ascending: true });
      
      console.log('API Route - Query executed');
      
      if (error) {
        console.error('API Route - Error fetching profiles:', error);
        return NextResponse.json(
          { message: error.message },
          { status: 500 }
        );
      }
      
      console.log(`API Route - Successfully fetched ${data?.length || 0} profiles`);
      const responseJson = { 
        success: true,
        profiles: data || []
      };
      console.log('API Route - Response ready:', JSON.stringify(responseJson).substring(0, 100) + '...');
      
      return NextResponse.json(responseJson);
    } catch (queryError) {
      console.error('API Route - Error during query execution:', queryError);
      return NextResponse.json(
        { message: queryError instanceof Error ? queryError.message : 'Query execution error' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('API Route - Unexpected error:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
} 