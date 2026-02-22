import { useEffect } from "react";
import { useNavigate } from "react-router";
import { setStoredEncryptionSecret } from "../lib/api";
import { Loader2 } from "lucide-react";

export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.slice(1));
    const encryptionSecret = params.get("encryption_secret");

    if (encryptionSecret) {
      setStoredEncryptionSecret(encryptionSecret);
    }

    // Clear the hash from URL
    window.history.replaceState(null, "", window.location.pathname);

    navigate("/", { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-4">
        <Loader2 className="size-8 animate-spin mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Signing you in...</p>
      </div>
    </div>
  );
}
