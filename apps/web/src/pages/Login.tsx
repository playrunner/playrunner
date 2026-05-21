import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Github, Loader2 } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "../components/ui";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth } from "../lib/firebase";

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleAuth = async (provider: string) => {
    setIsLoading(true);
    if (provider === "Google") {
      try {
        const googleProvider = new GoogleAuthProvider();
        await signInWithPopup(auth, googleProvider);
        localStorage.removeItem("hasCompletedOnboarding");
        navigate("/projects");
      } catch (error) {
        console.error("Login failed:", error);
      } finally {
        setIsLoading(false);
      }
    } else {
      // Simulate auth flow for others
      setTimeout(() => {
        localStorage.removeItem("hasCompletedOnboarding");
        setIsLoading(false);
        navigate("/projects");
      }, 800);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      {/* Background decoration */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none flex items-center justify-center">
        <div className="w-[800px] h-[600px] bg-[var(--border)] opacity-20 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      <div className="w-full max-w-sm z-10">
        <div className="text-center mb-10">
          <div className="flex flex-col items-center justify-center gap-3 mb-4">
            <img
              src="/images/playrunner-icon.svg"
              alt="Playrunner"
              className="h-14 w-14 object-contain"
            />
            <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">Playrunner</h1>
          </div>
          <p className="text-sm text-muted">No-code test orchestration and cloud runner<br/>for modern engineering teams.</p>
        </div>

        <div className="bg-surface border border-subtle rounded-2xl p-8 shadow-2xl relative overflow-hidden">
          {/* Subtle top highlight */}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent" />

          <h2 className="text-xl font-semibold text-[var(--foreground)] mb-6">
            {isLogin ? "Log in to your account" : "Create your account"}
          </h2>

          <div className="space-y-3">
            <Button
              variant="secondary"
              className="w-full gap-3"
              onClick={() => handleAuth("Google")}
              disabled={isLoading}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Continue with Google
            </Button>

            <Button
              variant="secondary"
              className="w-full gap-3"
              onClick={() => handleAuth("GitHub")}
              disabled={isLoading}
            >
              <Github className="w-4 h-4" />
              Continue with GitHub
            </Button>
          </div>

          <div className="mt-6 flex items-center justify-center px-4">
            <p className="text-xs text-center text-muted">
              Authentication is simulated in this prototype.
            </p>
          </div>
        </div>

        <div className="mt-8 text-center text-sm text-muted">
          {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-[var(--foreground)] hover:text-[var(--muted)] transition-colors focus:outline-none font-medium"
          >
            {isLogin ? "Sign up" : "Log in"}
          </button>
        </div>

        <div className="mt-12 flex items-center justify-center gap-1.5 opacity-50">
            <span className="text-xs text-muted">Powered by</span>
            <span className="text-xs font-semibold tracking-wider uppercase text-muted">Playrunner</span>
        </div>
      </div>
    </div>
  );
}
