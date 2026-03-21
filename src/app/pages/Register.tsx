import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Loader2, Github } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "../lib/auth-client";
import { hasPendingFiles, consumePendingFiles } from "../lib/pendingImport";
import { setOnboardingMode } from "../lib/onboarding";

export function Register() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGithubLoading, setIsGithubLoading] = useState(false);

  const handleGithubRegister = async () => {
    if (hasPendingFiles()) {
      setOnboardingMode("migration");
    }
    setIsGithubLoading(true);
    try {
      await authClient.signIn.social({
        provider: "github",
        callbackURL: "/",
      });
    } catch {
      toast.error("GitHub sign-up failed");
      setIsGithubLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const { error } = await authClient.signUp.email({
        email: email.trim(),
        password: password.trim(),
        name: name.trim() || undefined,
      });
      if (error) {
        if (
          error.message?.includes("already exists") ||
          error.status === 409
        ) {
          toast.error("An account with this email already exists");
        } else {
          toast.error(error.message || "Failed to create account");
        }
      } else {
        toast.success("Account created!");
        consumePendingFiles();
        navigate("/");
      }
    } catch {
      toast.error("Failed to create account");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">Context Vault</h1>
          <p className="text-sm text-muted-foreground">Create your account</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Get started</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasPendingFiles() && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Your vault folder is ready. Entries will be imported after
                  account creation.
                </p>
              </div>
            )}

            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={handleGithubRegister}
              disabled={isGithubLoading}
            >
              {isGithubLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <Github className="size-4" />
                  Sign up with GitHub
                </>
              )}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  Or email
                </span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name (optional)</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Alex Chen"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
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
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  disabled={isSubmitting}
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  "Create account"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            to="/login"
            className="text-foreground hover:underline font-medium"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
