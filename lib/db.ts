// Saves generated exams in the browser (IndexedDB) so they can be printed / downloaded again later.
// Every exam belongs to ONE account (ownerUid): two teachers signing in on the same browser never see each other's exams.
// Questions are saved, and PDFs are rebuilt from them on demand.
import type { Exam } from "@/exam";

const DB_NAME = "centerapp-exams", STORE = "exams";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export async function listExams(uid: string): Promise<Exam[]> {
  if (!uid) return [];
  const all = await run<Exam[]>("readonly", (s) => s.getAll());
  return all.filter((e) => e.ownerUid === uid).sort((a, b) => b.createdAt - a.createdAt);
}
export const saveExam = (uid: string, e: Exam) => run("readwrite", (s) => s.put({ ...e, ownerUid: uid })).then(() => undefined);
export async function removeExam(uid: string, id: string): Promise<void> {
  const cur = await run<Exam | undefined>("readonly", (s) => s.get(id));
  if (!cur || cur.ownerUid !== uid) return; // never delete another account's exam
  await run("readwrite", (s) => s.delete(id));
}
