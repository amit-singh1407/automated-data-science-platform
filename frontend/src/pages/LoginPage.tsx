import { useState } from "react";
import type { FormEvent } from "react";
import { AlertCircle, Info, Loader2, LogIn, Sparkles, UserPlus } from "lucide-react";
import { login, register } from "../api";
import { getErrorMessage } from "../lib/format";

export function LoginPage({ onSignedIn, notice }: { onSignedIn: (token: string) => void; notice?: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const registering = mode === "register";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (registering && password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const token = registering ? await register(email.trim(), password) : await login(email.trim(), password);
      onSignedIn(token);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(registering ? "login" : "register");
    setError("");
    setConfirm("");
  }

  const input = "w-full rounded-xl border border-white/10 bg-[#070b14] px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-cyan-400";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#070b14] px-4 text-slate-100">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-blue-500/20">
            <Sparkles size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">AutoData AI</h1>
            <p className="text-xs text-slate-400">ECP cleaning and automated analysis</p>
          </div>
        </div>

        <form onSubmit={(e) => void submit(e)} className="rounded-2xl border border-white/[0.08] bg-[#0d1424] p-6 shadow-xl shadow-black/20" noValidate={false}>
          <h2 className="text-lg font-semibold text-white">{registering ? "Create an account" : "Log in"}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {registering ? "Your uploads are private to your account." : "Log in to see your datasets and results."}
          </p>

          {notice && !error && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.06] px-3 py-2 text-xs text-cyan-100" role="status">
              <Info size={14} className="mt-0.5 shrink-0" /> {notice}
            </p>
          )}
          {error && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-400/[0.08] px-3 py-2 text-xs text-rose-200" role="alert">
              <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}

          <div className="mt-5 space-y-3">
            <label className="block text-xs font-medium text-slate-300">
              Email
              <input className={`${input} mt-1`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="block text-xs font-medium text-slate-300">
              Password
              <input
                className={`${input} mt-1`}
                type="password"
                autoComplete={registering ? "new-password" : "current-password"}
                required
                minLength={registering ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {registering && <span className="mt-1 block text-[11px] text-slate-500">At least 8 characters.</span>}
            </label>
            {registering && (
              <label className="block text-xs font-medium text-slate-300">
                Confirm password
                <input className={`${input} mt-1`} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </label>
            )}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : registering ? <UserPlus size={15} /> : <LogIn size={15} />}
            {registering ? "Create account" : "Log in"}
          </button>

          <p className="mt-4 text-center text-xs text-slate-400">
            {registering ? "Already have an account?" : "No account yet?"}{" "}
            <button type="button" className="font-semibold text-cyan-300 hover:text-cyan-200" onClick={switchMode}>
              {registering ? "Log in" : "Create one"}
            </button>
          </p>
        </form>
        <p className="mt-4 text-center text-[11px] text-slate-500">
          The first account created on this server also receives any datasets uploaded before login was added.
        </p>
      </div>
    </div>
  );
}
