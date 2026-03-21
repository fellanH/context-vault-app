import { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card, CardContent } from "../components/ui/card";
import { FolderOpen, Loader2, Github } from "lucide-react";
import { toast } from "sonner";
import { setPendingFiles } from "../lib/pendingImport";
import { authClient } from "../lib/auth-client";

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Handle OAuth error params
  useEffect(() => {
    const error = searchParams.get("error");
    if (!error) return;
    if (error === "oauth_denied") {
      toast.error("Sign-in was cancelled");
    } else {
      toast.error("Sign-in failed. Please try again.");
    }
    navigate("/login", { replace: true });
  }, [searchParams, navigate]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const { error } = await authClient.signIn.email({
        email: email.trim(),
        password: password.trim(),
      });
      if (error) {
        toast.error(error.message || "Invalid email or password");
      } else {
        navigate("/");
      }
    } catch {
      toast.error("Sign-in failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGithubLogin = async () => {
    setIsGithubLoading(true);
    try {
      await authClient.signIn.social({
        provider: "github",
        callbackURL: "/",
      });
    } catch {
      toast.error("GitHub sign-in failed");
      setIsGithubLoading(false);
    }
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      f.name.endsWith(".md"),
    );
    if (!files.length) {
      toast.error("No markdown files found in that folder");
      return;
    }
    setPendingFiles(files);
    navigate("/register");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Context Vault</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to your account
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isSubmitting}
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={handleGithubLogin}
              disabled={isGithubLoading}
            >
              {isGithubLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <Github className="size-4" />
                  Sign in with GitHub
                </>
              )}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  Or migrate from local vault
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground text-center">
                Coming from context-vault/core? Select your vault folder to
                migrate your entries.
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderOpen className="size-4" />
                Select vault folder
              </Button>
              <input
                ref={folderInputRef}
                type="file"
                // @ts-ignore webkitdirectory not in standard types
                webkitdirectory=""
                multiple
                className="hidden"
                onChange={handleFolderSelect}
              />
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link
            to="/register"
            className="text-foreground hover:underline font-medium"
          >
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
