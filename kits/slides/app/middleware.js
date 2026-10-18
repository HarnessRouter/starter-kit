// Remote mode's gate (see remote/core.js): nothing but the sign-in page is served without the
// kit's password. Vercel runs this before every request; the console never does.
import { next } from '@vercel/functions';
import { gate } from './remote/core.js';

export const config = { matcher: '/((?!api/kit/login).*)' };

export default async function middleware(request) {
  return (await gate(request, process.env)) || next();
}
