"use client";

import SearchField from "./SearchField";

// The 🔐 drawer's search box (lib/vault-search.ts): narrows every shown vault to the secrets whose name or
// hint holds the query. Escape clears it first, and only an empty box lets Escape reach the drawer.
export default function VaultSearch({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  return <SearchField query={query} onQuery={onQuery} label="Filter secrets" className="mx-3 mt-2" />;
}
