"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import "./login.css";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();
      const emailRedirectTo = `${window.location.origin}/auth/callback`;

      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo },
        });
        if (signUpError) throw signUpError;

        if (data.session) {
          window.location.assign("/");
          return;
        }

        setMessage("Аккаунт создан. Проверь почту и подтверди адрес, затем войди в систему.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;

        const requestedNext = searchParams.get("next");
        const safeNext = requestedNext?.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
        window.location.assign(safeNext);
        return;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить запрос авторизации.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand"><span className="auth-mark">✦</span><span>AI Seller <i>Ecosystem</i></span></div>
        <div className="auth-heading">
          <span className="auth-eyebrow">PERSONAL WORKSPACE</span>
          <h1>{mode === "signin" ? "Вход в систему" : "Создать аккаунт"}</h1>
          <p>{mode === "signin" ? "Авторизуйся, чтобы открыть своё рабочее пространство." : "Создай личный аккаунт для доступа к AI Seller."}</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="email">Электронная почта</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
          <label htmlFor="password">Пароль</label>
          <input id="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Не менее 8 символов" />
          {error && <div className="auth-error" role="alert">{error}</div>}
          {message && <div className="auth-success" role="status">{message}</div>}
          {searchParams.get("error") === "auth_callback" && <div className="auth-error" role="alert">Не удалось подтвердить вход. Попробуй запросить ссылку ещё раз.</div>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? "Подожди..." : mode === "signin" ? "Войти" : "Зарегистрироваться"}</button>
        </form>
        <div className="auth-switch">
          {mode === "signin" ? "Ещё нет аккаунта?" : "Уже есть аккаунт?"}
          <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setMessage(""); }}>
            {mode === "signin" ? "Создать аккаунт" : "Войти"}
          </button>
        </div>
        <p className="auth-footnote">Защищённая авторизация через Supabase Auth. Не передавай пароль третьим лицам.</p>
      </section>
    </main>
  );
}
