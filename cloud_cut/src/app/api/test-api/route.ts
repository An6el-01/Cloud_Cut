export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ message: 'API is working' });
}

export async function POST() {
  console.log('POST test-api received');
  return Response.json({ message: 'POST request received' });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
} 