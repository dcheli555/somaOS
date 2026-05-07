import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
  useAuth,
} from "@clerk/clerk-react";
import { useCallback, useState } from "react";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";

/** Matches docs/medication-smoke-test.sql example unless overridden. */
const devOrgId =
  import.meta.env.VITE_DEV_ORGANIZATION_ID?.trim() ||
  "11111111-1111-4111-8111-111111111111";

function copy(text: string) {
  void navigator.clipboard.writeText(text);
}

function TokenTools() {
  const { getToken, userId, isLoaded } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetchJwt = useCallback(async () => {
    setErr(null);
    try {
      const t = await getToken();
      setToken(t ?? null);
      if (!t) setErr("getToken() returned empty (try signing out and in again).");
    } catch (e) {
      setToken(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [getToken]);

  if (!isLoaded) return <p>Loading auth…</p>;

  return (
    <section className="panel">
      <h2 style={{ marginTop: 0 }}>Session JWT (`CLERK_JWT`)</h2>
      <p className="hint">
        Paste this value as{" "}
        <code style={{ whiteSpace: "nowrap" }}>Authorization: Bearer …</code> in curl. Tokens
        expire; click refresh before each test if you get 401.
      </p>
      <p>
        Signed in as <code>{userId ?? "unknown"}</code>
      </p>
      <div className="row">
        <button type="button" onClick={() => void fetchJwt()}>
          Refresh JWT
        </button>
        {token ? (
          <button type="button" onClick={() => copy(token)}>
            Copy JWT
          </button>
        ) : null}
      </div>
      {err ? <p className="error">{err}</p> : null}
      {token ? <textarea readOnly rows={8} spellCheck={false} value={token} /> : null}
    </section>
  );
}

function OrgPanel() {
  return (
    <section className="panel">
      <h2 style={{ marginTop: 0 }}>
        Tenant id (<code>X-Organization-Id</code>)
      </h2>
      <p className="hint">
        The API only checks that this is a UUID—the value is yours to define. Use the{" "}
        <strong>same</strong> UUID in <code>medications.organization_id</code> when you seed SQL
        (see <code>docs/medication-smoke-test.md</code>).
      </p>
      <p>
        <code>{devOrgId}</code>
      </p>
      <div className="row">
        <button type="button" onClick={() => copy(devOrgId)}>
          Copy org UUID
        </button>
      </div>
      <p className="hint">
        Override via <code>VITE_DEV_ORGANIZATION_ID</code> in{" "}
        <code>apps/clerk-dev/.env</code> if needed.
      </p>
    </section>
  );
}

function SignedInChrome() {
  return (
    <>
      <div className="row" style={{ marginBottom: "1rem" }}>
        <UserButton afterSignOutUrl="/" />
      </div>
      <OrgPanel />
      <TokenTools />
    </>
  );
}

export default function App() {
  if (!publishableKey.trim()) {
    return (
      <div className="panel error">
        <strong>Missing VITE_CLERK_PUBLISHABLE_KEY.</strong>
        <p className="hint" style={{ color: "#7f1d1d" }}>
          Copy <code>apps/clerk-dev/.env.example</code> to <code>apps/clerk-dev/.env</code> and set your
          Clerk publishable key (same Clerk application as the API).
        </p>
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey.trim()} afterSignOutUrl="/">
      <header style={{ marginBottom: "1rem" }}>
        <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.25rem" }}>
          Clerk dev — JWT &amp; org header
        </h1>
        <p className="hint" style={{ margin: 0 }}>
          Run this app on <strong>http://localhost:5173</strong> while the API listens on{" "}
          <strong>http://localhost:3000</strong>.
        </p>
      </header>

      <SignedOut>
        <div className="panel">
          <p>Sign in with the same Clerk app you configured for somaOS API.</p>
          <SignInButton mode="modal">
            <button type="button">Sign in</button>
          </SignInButton>
        </div>
      </SignedOut>

      <SignedIn>
        <SignedInChrome />
      </SignedIn>
    </ClerkProvider>
  );
}
