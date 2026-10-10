import { NextRequest } from 'next/server';
import { recoveryCallback } from '@/features/employees/recovery';
export function GET(request: NextRequest) {
  return recoveryCallback(request, 'token');
}
