import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import type { LocalVaultEntry } from "./local-vault";
import {
  openVaultDirectory,
  restoreVaultDirectory,
  scanVaultEntries,
  loadEntryBody,
  searchEntries,
} from "./local-vault";

interface LocalVaultContextType {
  // State
  entries: LocalVaultEntry[];
  isLocalMode: boolean;
  vaultPath: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  openLocalVault: () => Promise<void>;
  closeLocalVault: () => void;
  searchLocal: (query: string) => LocalVaultEntry[];
  loadBody: (entry: LocalVaultEntry) => Promise<string>;
  restoreIfAvailable: () => Promise<void>;
}

const LocalVaultContext = createContext<LocalVaultContextType | undefined>(
  undefined,
);

export function LocalVaultProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<LocalVaultEntry[]>([]);
  const [isLocalMode, setIsLocalMode] = useState(false);
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openLocalVault = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setEntries([]);

      const dirHandle = await openVaultDirectory();
      setVaultPath(dirHandle.name);
      setIsLocalMode(true);

      await scanVaultEntries(dirHandle, {
        onBatch: (batch) => {
          setEntries((prev) => [...prev, ...batch]);
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(null);
      } else {
        setError(
          err instanceof Error ? err.message : "Failed to open vault directory",
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const closeLocalVault = useCallback(() => {
    setIsLocalMode(false);
    setVaultPath(null);
    setEntries([]);
    setError(null);
  }, []);

  const searchLocal = useCallback(
    (query: string) => searchEntries(entries, query),
    [entries],
  );

  const loadBody = useCallback(
    async (entry: LocalVaultEntry) => {
      const body = await loadEntryBody(entry);
      // Update the entry in state with the loaded body
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id ? { ...e, body } : e,
        ),
      );
      return body;
    },
    [],
  );

  const restoreIfAvailable = useCallback(async () => {
    try {
      const dirHandle = await restoreVaultDirectory();
      if (!dirHandle) return;

      setVaultPath(dirHandle.name);
      setIsLocalMode(true);
      setEntries([]);

      await scanVaultEntries(dirHandle, {
        onBatch: (batch) => {
          setEntries((prev) => [...prev, ...batch]);
        },
      });
    } catch (err) {
      console.warn("Failed to restore local vault:", err);
    }
  }, []);

  const value: LocalVaultContextType = {
    entries,
    isLocalMode,
    vaultPath,
    isLoading,
    error,
    openLocalVault,
    closeLocalVault,
    searchLocal,
    loadBody,
    restoreIfAvailable,
  };

  return (
    <LocalVaultContext.Provider value={value}>
      {children}
    </LocalVaultContext.Provider>
  );
}

export function useLocalVault() {
  const context = useContext(LocalVaultContext);
  if (!context) {
    throw new Error("useLocalVault must be used within LocalVaultProvider");
  }
  return context;
}
