import { env } from 'cloudflare:workers';
import { deleteSession, SESSION_COOKIE } from '../lib/auth.js';

export async function POST({ cookies, redirect }) {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(env.DB, token);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/login', 303);
}
