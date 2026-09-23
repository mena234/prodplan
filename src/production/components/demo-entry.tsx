"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Factory, LoaderCircle } from "lucide-react";
import { Modal } from "../../components/ui";

export async function startDemo(reset = false) {
  const response = await fetch("/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reset,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  const result = (await response.json()) as { error?: string; url: string };
  if (!response.ok)
    throw new Error(
      result.error ?? "The demo could not be opened. Please try again.",
    );
  window.location.assign(result.url);
}
export function DemoEntry() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [expired, setExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setExpired(
          new URLSearchParams(location.search).get("demo") === "expired",
        ),
      0,
    );
    return () => clearTimeout(timer);
  }, []);
  return (
    <main className="platform live-demo-entry">
      <header>
        <Link href="/" className="auth-brand">
          <Factory size={28} />
          ProdPlan
        </Link>
        <nav aria-label="Account">
          <Link href="/login">Sign in</Link>
          <Link className="button" href="/login?mode=signup">
            Create an account
          </Link>
        </nav>
      </header>
      <section className="live-demo-intro">
        <p className="tour-counter">
          PRODUCTION PLANNING, FROM ORDER TO DELIVERY
        </p>
        <h1>See what your plant can deliver.</h1>
        <p>
          Plan customer orders around machine capacity, material stock and
          delivery dates. Keep the schedule connected to what is happening on
          the production floor.
        </p>
        {expired && (
          <p className="p-setup" role="status">
            Your temporary demo has expired. Start a fresh demo below, or sign
            in to your own workspace.
          </p>
        )}
        <button
          className="button primary demo-start"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await startDemo();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Please try again.");
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <ArrowRight size={18} />
          )}
          {busy ? "Preparing your plant…" : "Try live demo"}
        </button>
        <p className="demo-start-note">
          No account needed. Your own temporary workspace, ready to explore.
        </p>
        {error && (
          <p className="p-error" role="alert">
            {error}
          </p>
        )}
        <ol className="demo-entry-steps">
          <li>
            <span>01</span>
            <h2>Plan an order</h2>
            <p>
              Explore a working plant with machines, shifts, stock and product
              recipes already set up.
            </p>
          </li>
          <li>
            <span>02</span>
            <h2>Make a change</h2>
            <p>
              Create orders, move tasks to an exact minute, fix shortages and
              record production progress.
            </p>
          </li>
          <li>
            <span>03</span>
            <h2>See the impact</h2>
            <p>
              Compare schedules, review delivery risks and export the results
              from the real application.
            </p>
          </li>
        </ol>
        <div className="demo-entry-foot">
          <p>
            Demo changes are private to your browser session and expire after 24
            hours. You can reset the sample plant at any time.
          </p>
          <p>
            Email, team invitations and paid AI are disabled. Schedule
            comparison uses the production scheduling engine.
          </p>
          <Link href="/login?mode=signup">
            Ready for your own plant? Create an account <ArrowRight size={16} />
          </Link>
          <small>
            Your new workspace starts empty. Sample data is never copied
            automatically.
          </small>
        </div>
      </section>
    </main>
  );
}

export function DemoBanner({ expiresAt }: { expiresAt: string }) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () => {
        // Begin a fresh client tree after the temporary session expires.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/?demo=expired");
      },
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return (
    <>
      <aside className="p-demo-banner" aria-label="Demo workspace">
        <div>
          <strong>Demo workspace</strong>
          <small>
            Private sample plant · expires{" "}
            {new Date(expiresAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </small>
        </div>
        <div className="p-actions">
          <button
            className="button"
            onClick={() => {
              setError("");
              setConfirm(true);
            }}
          >
            Reset demo
          </button>
          <Link className="button primary" href="/login?mode=signup">
            Create your own workspace
          </Link>
        </div>
      </aside>
      {confirm && (
        <Modal
          title="Reset this demo?"
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <div className="dialog-body">
            <p>
              This removes your changes and restores the sample plant with dates
              based on today. It only affects your demo, including other tabs
              using this demo session.
            </p>
            <p className="muted">
              Resetting does not extend the 24-hour expiry.
            </p>
            {error && (
              <p className="p-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="dialog-footer">
            <button
              className="button"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Keep my changes
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await startDemo(true);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Reset failed.");
                  setBusy(false);
                }
              }}
            >
              {busy ? "Resetting…" : "Reset sample plant"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
