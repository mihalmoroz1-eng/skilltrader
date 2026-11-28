import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import { useState, type FormEvent } from "react";
import { trpc } from "@/lib/trpc";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function AuthGate({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState("mihalmoroz1@gmail.com");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      setPassword("");
      setFormError("");
      await utils.auth.me.invalidate();
    },
    onError: error => setFormError(error.message),
  });

  if (me.isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">Проверка сессии…</div>;
  }
  if (me.data) return <>{children}</>;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    login.mutate({ email, password });
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="space-y-2 text-center">
          <div className="text-xs font-semibold tracking-[0.3em] text-primary">SKILL TRADER AI MAX</div>
          <h1 className="text-2xl font-semibold">Вход администратора</h1>
          <p className="text-sm text-muted-foreground">Доступ только для владельца приложения</p>
        </div>
        <label className="block space-y-2 text-sm">
          <span>Email</span>
          <input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="block space-y-2 text-sm">
          <span>Пароль</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring" />
        </label>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        <button type="submit" disabled={login.isPending || !password} className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground disabled:opacity-50">
          {login.isPending ? "Проверка…" : "Войти"}
        </button>
      </form>
    </main>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <AuthGate><Router /></AuthGate>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
