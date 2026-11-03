import { getFirebaseAuth } from "@/lib/firebase";

// fetch() that adds the signed-in user's Firebase ID token, so the server knows who is asking.
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const user = getFirebaseAuth()?.currentUser;
  if (user) headers.set("authorization", `Bearer ${await user.getIdToken()}`);
  return fetch(input, { ...init, headers });
}
