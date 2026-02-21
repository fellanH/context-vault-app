import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { Info } from "lucide-react";
import { useAuth } from "../lib/auth";
import { clearLocalConnection, getLocalPort } from "../lib/api";

interface VaultModePopoverProps {
  isLocalMode: boolean;
  connectionState: string;
  connectionBadgeClass: string;
}

const LOCAL_PORT_KEY = "cv_local_port";

export function VaultModePopover({
  isLocalMode,
  connectionState,
  connectionBadgeClass,
}: VaultModePopoverProps) {
  const [open, setOpen] = useState(false);
  const [portInput, setPortInput] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const port = getLocalPort();
  const modeLabel = isLocalMode ? "Local" : "Hosted";

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleConnectLocal = () => {
    const p = parseInt(portInput, 10);
    if (isNaN(p) || p < 1 || p > 65535) return;
    sessionStorage.setItem(LOCAL_PORT_KEY, String(p));
    logout();
    window.location.reload();
  };

  const handleChangePort = () => {
    const p = parseInt(portInput, 10);
    if (isNaN(p) || p < 1 || p > 65535) return;
    sessionStorage.setItem(LOCAL_PORT_KEY, String(p));
    logout();
    window.location.reload();
  };

  const handleSwitchToHosted = () => {
    clearLocalConnection();
    logout();
    navigate("/login");
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium cursor-pointer hover:opacity-80 transition-opacity ${connectionBadgeClass}`}
      >
        {modeLabel} • {connectionState}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-64 rounded-lg border border-border bg-card shadow-lg z-50 overflow-hidden">
          {isLocalMode ? (
            <>
              <div className="px-3 py-2.5 border-b border-border">
                <p className="text-xs font-semibold">Local Vault</p>
                <p className="text-xs text-muted-foreground">port {port}</p>
              </div>
              <div className="px-3 py-2.5 space-y-1.5">
                <p className="text-[11px] text-muted-foreground font-medium">
                  Change port
                </p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder={String(port)}
                    value={portInput}
                    onChange={(e) => setPortInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleChangePort()}
                    className="flex-1 px-2 py-1 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={handleChangePort}
                    className="px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                  >
                    Connect
                  </button>
                </div>
              </div>
              <div className="h-px bg-border" />
              <div className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={handleSwitchToHosted}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Switch to Hosted →
                </button>
              </div>
              <div className="mx-3 mb-2.5 px-2.5 py-2 bg-muted/60 rounded-md">
                <div className="flex gap-1.5 items-start">
                  <Info className="size-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Tip: append <code className="font-mono">?local=3000</code>{" "}
                    to any page URL to connect directly.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="px-3 py-2.5 border-b border-border">
                <p className="text-xs font-semibold">Hosted Vault</p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.email}
                </p>
              </div>
              <div className="px-3 py-2.5 space-y-1.5">
                <p className="text-[11px] text-muted-foreground font-medium">
                  Connect to local vault
                </p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="3000"
                    value={portInput}
                    onChange={(e) => setPortInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleConnectLocal()}
                    className="flex-1 px-2 py-1 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={handleConnectLocal}
                    className="px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                  >
                    Connect
                  </button>
                </div>
              </div>
              <div className="mx-3 mb-2.5 px-2.5 py-2 bg-muted/60 rounded-md">
                <div className="flex gap-1.5 items-start">
                  <Info className="size-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Tip: append <code className="font-mono">?local=PORT</code>{" "}
                    to any page URL to connect directly without opening this
                    panel.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
