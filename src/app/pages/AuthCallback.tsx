import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { setStoredEncryptionSecret } from "../lib/api";
import { Loader2 } from "lucide-react";

export function AuthCallback() {
  const { loginWithApiKey } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // Capture the hash once on mount via a ref. Reading it during render causes
  // a bug: loginWithApiKey calls setToken() which re-renders this component
  // (it's an auth context consumer), but by then replaceState has cleared the
  // hash, so token becomes null, the effect re-runs, and schedules a
  // navigate("/login") that fires 3 s later even after the user is on the
  // dashboard.
  const initialHash = useRef(window.location.hash);

  useEffect(() => {
    const params = new URLSearchParams(initialHash.current.slice(1));
    const token = params.get("token");
    const encryptionSecret = params.get("encryption_secret");

    if (!token) {
      setError("No authentication token received");
      const id = setTimeout(() => navigate("/login"), 3000);
      return () => clearTimeout(id);
    }

    // Clear the hash from URL for security
    window.history.replaceState(null, "", window.location.pathname);

    if (encryptionSecret) {
      setStoredEncryptionSecret(encryptionSecret);
    }

    let cancelled = false;
    loginWithApiKey(token)
      .then(() => {
        if (!cancelled) navigate("/");
      })
      .catch(() => {
        if (!cancelled) {
          setError("Authentication failed");
          setTimeout(() => navigate("/login"), 3000);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loginWithApiKey, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-4">
        {error ? (
          <>
            <p className="text-sm text-destructive">{error}</p>
            <p className="text-xs text-muted-foreground">
              Redirecting to login...
            </p>
          </>
        ) : (
          <>
            <Loader2 className="size-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Signing you in...</p>
          </>
        )}
      </div>
    </div>
  );
}
