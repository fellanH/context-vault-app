import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { setStoredEncryptionSecret } from "../lib/api";
import { Loader2 } from "lucide-react";

export function AuthCallback() {
  const { loginWithApiKey } = useAuth();
  const navigate = useNavigate();
  const hash = window.location.hash;
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get("token");
  const encryptionSecret = params.get("encryption_secret");

  const [error, setError] = useState<string | null>(
    token ? null : "No authentication token received",
  );

  useEffect(() => {
    if (!token) {
      setTimeout(() => navigate("/login"), 3000);
      return;
    }

    // Clear the hash from URL for security
    window.history.replaceState(null, "", window.location.pathname);

    if (encryptionSecret) {
      setStoredEncryptionSecret(encryptionSecret);
    }

    loginWithApiKey(token)
      .then(() => {
        navigate("/");
      })
      .catch(() => {
        setError("Authentication failed");
        setTimeout(() => navigate("/login"), 3000);
      });
  }, [token, encryptionSecret, loginWithApiKey, navigate]);

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
