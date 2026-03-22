import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { UsageMeter } from "../../components/UsageMeter";
import { TierBadge } from "../../components/TierBadge";
import { Check, Loader2, X } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useUsage, useCheckout, usePortal } from "../../lib/hooks";
import { formatMegabytes } from "../../lib/format";
import { toast } from "sonner";

type BillingPeriod = "monthly" | "annual";

const PRO_MONTHLY_PRICE = 9;
const PRO_ANNUAL_PRICE = 90; // $90/yr = $7.50/mo

const plans = [
  {
    tier: "free" as const,
    features: [
      "Hosted vault & MCP",
      "Unlimited entries",
      "50 MB storage",
      "200 requests/day",
      "Unlimited API keys",
      "Community support",
    ],
  },
  {
    tier: "pro" as const,
    features: [
      "Unlimited entries",
      "5 GB storage",
      "Multi-device access",
      "Hosted MCP (always on)",
      "Unlimited API keys",
      "Export & import",
      "Priority support",
    ],
  },
  {
    tier: "team" as const,
    features: [
      "Unlimited entries",
      "20 GB storage",
      "Unlimited requests",
      "Unlimited API keys",
      "Team sharing",
      "SSO",
      "Dedicated support",
    ],
  },
];

export function Billing() {
  const { user } = useAuth();
  const { data: usage, isLoading: usageLoading } = useUsage();
  const checkoutMutation = useCheckout();
  const portalMutation = usePortal();
  const [searchParams, setSearchParams] = useSearchParams();
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const [showLocalBanner, setShowLocalBanner] = useState(
    () => localStorage.getItem("cv-dismissed-local-banner") !== "true",
  );

  const handleDismissLocalBanner = () => {
    localStorage.setItem("cv-dismissed-local-banner", "true");
    setShowLocalBanner(false);
  };

  useEffect(() => {
    if (searchParams.get("upgraded") === "true") {
      toast.success("Welcome to your new plan!");
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleManageSubscription = () => {
    portalMutation.mutate(
      { returnUrl: `${window.location.origin}/settings/billing` },
      {
        onSuccess: (data) => {
          window.location.href = data.url;
        },
        onError: () => {
          toast.error("Failed to open billing portal");
        },
      },
    );
  };

  const handleUpgrade = (tier: string) => {
    if (tier === "team") {
      toast.info("Contact us at team@context-vault.com for Team plans");
      return;
    }
    const plan =
      tier === "pro"
        ? billingPeriod === "annual"
          ? "pro_annual"
          : "pro_monthly"
        : undefined;
    checkoutMutation.mutate(
      {
        plan,
        successUrl: `${window.location.origin}/settings/billing?upgraded=true`,
        cancelUrl: window.location.href,
      },
      {
        onSuccess: (data) => {
          window.location.href = data.url;
        },
        onError: () => {
          toast.error("Failed to start checkout");
        },
      },
    );
  };

  const currentTier = user?.tier ?? "free";

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your plan and view usage.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Current Plan</CardTitle>
            <div className="flex items-center gap-2">
              <TierBadge tier={currentTier} />
              {currentTier !== "free" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  disabled={portalMutation.isPending}
                  onClick={handleManageSubscription}
                >
                  {portalMutation.isPending ? (
                    <Loader2 className="size-3 animate-spin mr-1" />
                  ) : null}
                  Manage subscription
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {usageLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-32 bg-muted animate-pulse rounded" />
                  <div className="h-1.5 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          ) : usage ? (
            <>
              <UsageMeter
                used={usage.entries.used}
                limit={usage.entries.limit}
                label="Entries"
              />
              <UsageMeter
                used={usage.storage.usedMb}
                limit={usage.storage.limitMb}
                label="Storage"
                unit="MB"
                formatValue={formatMegabytes}
              />
              {usage.requestsToday.limit === Infinity ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Requests today
                    </span>
                    <span className="font-mono">
                      {usage.requestsToday.used} (unlimited)
                    </span>
                  </div>
                </div>
              ) : (
                <UsageMeter
                  used={usage.requestsToday.used}
                  limit={usage.requestsToday.limit}
                  label="Requests today"
                />
              )}
              {usage.apiKeys.limit === Infinity ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">API keys</span>
                    <span className="font-mono">
                      {usage.apiKeys.active} (unlimited)
                    </span>
                  </div>
                </div>
              ) : (
                <UsageMeter
                  used={usage.apiKeys.active}
                  limit={usage.apiKeys.limit}
                  label="API keys"
                />
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      {showLocalBanner && (
        <div className="relative rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-800 dark:bg-blue-950/40">
          <button
            onClick={handleDismissLocalBanner}
            className="absolute right-3 top-3 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X className="size-4" />
          </button>
          <p className="font-medium text-blue-900 dark:text-blue-100 pr-6">
            Already running context-vault/core locally?
          </p>
          <p className="mt-1 text-blue-800 dark:text-blue-200">
            The hosted vault gives you what local can't:
          </p>
          <ul className="mt-2 space-y-1 text-blue-800 dark:text-blue-200">
            {[
              "Access from any device — not just localhost",
              "Hosted MCP server that's always on, no process to run",
              "Automatic cloud backup",
              "Team sharing (Pro+ coming)",
              "Web app, Chrome extension, search UI",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <Check className="size-3.5 mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-blue-800 dark:text-blue-200">
            Your local markdown files can be imported in one step.{" "}
            <Link
              to="/import"
              className="font-medium underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-100 transition-colors"
            >
              Import from local vault →
            </Link>
          </p>
        </div>
      )}

      {/* Billing period toggle — only shown when user is not yet on a paid tier */}
      {currentTier === "free" && (
        <div className="flex items-center justify-center">
          <div className="inline-flex items-center rounded-full border bg-muted p-1 gap-1">
            <button
              onClick={() => setBillingPeriod("monthly")}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                billingPeriod === "monthly"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingPeriod("annual")}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                billingPeriod === "annual"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Annual
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary leading-none">
                Save 17%
              </span>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const isCurrent = plan.tier === currentTier;
          const isProPlan = plan.tier === "pro";

          let priceDisplay = "$0";
          let periodDisplay: string | null = null;
          let savingsCallout: string | null = null;

          if (plan.tier === "free") {
            priceDisplay = "$0";
          } else if (isProPlan) {
            if (billingPeriod === "annual" && currentTier === "free") {
              priceDisplay = `$${PRO_ANNUAL_PRICE}`;
              periodDisplay = "/yr";
              savingsCallout = `$${Math.round(PRO_ANNUAL_PRICE / 12 * 10) / 10}/mo — 2 months free`;
            } else {
              priceDisplay = `$${PRO_MONTHLY_PRICE}`;
              periodDisplay = "/mo";
            }
          } else if (plan.tier === "team") {
            priceDisplay = "$29";
            periodDisplay = "/mo";
          }

          return (
            <Card key={plan.tier} className={isCurrent ? "border-primary" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base capitalize">
                    {plan.tier}
                  </CardTitle>
                  {isCurrent && (
                    <Badge variant="outline" className="text-[10px]">
                      Current
                    </Badge>
                  )}
                </div>
                <div className="mt-2">
                  <span className="text-2xl font-bold">{priceDisplay}</span>
                  {periodDisplay && (
                    <span className="text-sm text-muted-foreground">
                      {periodDisplay}
                    </span>
                  )}
                  {savingsCallout && (
                    <p className="mt-1 text-xs text-primary font-medium">
                      {savingsCallout}
                    </p>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 mb-4">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Check className="size-3.5 text-primary shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                {!isCurrent && (
                  <Button
                    className="w-full"
                    variant={plan.tier === "pro" ? "default" : "outline"}
                    disabled={checkoutMutation.isPending}
                    onClick={() => handleUpgrade(plan.tier)}
                  >
                    {checkoutMutation.isPending ? (
                      <Loader2 className="size-3.5 animate-spin mr-1.5" />
                    ) : null}
                    {plan.tier === "pro" ? "Upgrade to Pro" : "Contact Sales"}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
