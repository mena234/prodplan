"use client";
import { useEffect, useState } from "react";
import { Layers3, ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { ProductIntroduction } from "../../components/product-tour";
export function Login({ emailDisabled }: { emailDisabled: boolean }) {
  const [mode, setMode] = useState("signin"),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [token, setToken] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(location.search);
      if (params.get("mode") === "signup") setMode("signup");
      if (!emailDisabled && params.get("mode") === "reset") {
        setMode("reset");
        setToken(params.get("token") ?? "");
      }
      if (params.get("error"))
        setError(
          "This account link is invalid or has expired. Request a new one.",
        );
    }, 0);
    return () => clearTimeout(timer);
  }, [emailDisabled]);
  const titles: Record<string, string> = {
    signin: "Sign in to ProdPlan",
    signup: "Create your account",
    forgot: "Reset your password",
    reset: "Choose a new password",
    verify: "Verify your email",
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const route = {
        signin: "sign-in/email",
        signup: "sign-up/email",
        forgot: "request-password-reset",
        reset: "reset-password",
        verify: "send-verification-email",
      }[mode];
      const body =
        mode === "reset"
          ? { newPassword: password, token }
          : mode === "forgot"
            ? { email, redirectTo: `${location.origin}/login?mode=reset` }
            : { name, email, password, callbackURL: `${location.origin}/app` };
      const response = await fetch(`/api/auth/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        message?: string;
        code?: string;
      };
      if (!emailDisabled && result.code === "EMAIL_NOT_VERIFIED") {
        setMode("verify");
        setPassword("");
        setNotice(
          "Verify your email to sign in. Request a new verification link below.",
        );
        return;
      }
      if (!response.ok)
        throw new Error(
          result.message ?? "Please check your details and try again.",
        );
      if (mode === "signin" || (mode === "signup" && emailDisabled)) {
        // Begin a fresh authenticated client tree after the cookie changes.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        location.assign("/app");
        return;
      }
      if (mode === "reset") {
        setMode("signin");
        setPassword("");
        setNotice("Password updated. Sign in with your new password.");
      } else if (mode === "forgot")
        setNotice(
          "If an account exists for this email, a reset link will be sent.",
        );
      else {
        setMode("verify");
        setPassword("");
        setNotice(
          "Check your email and follow the verification link, then sign in.",
        );
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function change(next: string) {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
  }
  return (
    <main className="platform auth-page">
      <section className="auth-card">
        <Link href="/" className="auth-brand">
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          ProdPlan
        </Link>
        <h1>{titles[mode]}</h1>
        <p className="muted">
          Plan customer orders around your machines, materials and delivery
          deadlines.
        </p>
        <ProductIntroduction
          onFinish={() => change("signup")}
          finishLabel="Create an account"
        />
        {emailDisabled && (
          <p className="muted">
            Email is temporarily disabled. You can create an account and sign in
            without email verification.
          </p>
        )}
        <form onSubmit={submit}>
          {mode === "signup" && (
            <label className="field">
              Your name
              <input
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
              />
            </label>
          )}
          {mode !== "reset" && (
            <label className="field">
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
              />
            </label>
          )}
          {["signin", "signup", "reset"].includes(mode) && (
            <label className="field">
              Password
              <input
                aria-label="Password"
                type="password"
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === "signin" ? 1 : 12}
                maxLength={128}
              />
              {mode !== "signin" && <small>Use at least 12 characters.</small>}
            </label>
          )}
          {error && (
            <p className="p-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="p-success" role="status">
              {notice}
            </p>
          )}
          <button className="button primary full-width" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <ArrowRight size={17} />
            )}
            {busy
              ? "Please wait…"
              : {
                  signin: "Sign in",
                  signup: "Create account",
                  forgot: "Send reset link",
                  reset: "Save password",
                  verify: "Resend verification email",
                }[mode]}
          </button>
        </form>
        <div className="auth-links">
          {mode === "signin" ? (
            <>
              {!emailDisabled && (
                <button onClick={() => change("forgot")}>
                  Forgot password?
                </button>
              )}
              <button onClick={() => change("signup")}>
                Create an account
              </button>
            </>
          ) : (
            <button onClick={() => change("signin")}>Back to sign in</button>
          )}
        </div>
        <Link className="auth-demo-link" href="/">
          Try the live demo without an account
        </Link>
      </section>
    </main>
  );
}
