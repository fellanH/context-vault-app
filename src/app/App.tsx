import { RouterProvider } from "react-router";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider } from "./components/AuthProvider";
import { LocalVaultProvider } from "./lib/local-vault-context";
import { router } from "./routes";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
    },
  },
});

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LocalVaultProvider>
            <RouterProvider router={router} />
            <Toaster />
          </LocalVaultProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
