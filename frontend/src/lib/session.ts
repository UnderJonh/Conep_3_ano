import { client } from './supabase';

let signingIn: Promise<string> | undefined;

export function ensureSession(): Promise<string> {
  signingIn ??= (async () => {
    const db = client();
    const current = await db.auth.getSession();
    if (current.error) throw current.error;
    if (current.data.session) return current.data.session.user.id;
    const result = await db.auth.signInAnonymously();
    if (result.error) throw result.error;
    return result.data.user!.id;
  })().finally(() => { signingIn = undefined; });
  return signingIn;
}
