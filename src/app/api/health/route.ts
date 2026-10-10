import { readEnvironment } from '@/lib/environment';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const { stage } = readEnvironment(process.env);
    return Response.json(
      { status: 'ok', stage },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { status: 'configuration-error' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
