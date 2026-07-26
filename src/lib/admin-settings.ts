function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function moneyFromCents(value: unknown): number | null {
  const cents = Number(value);
  return Number.isFinite(cents) ? cents / 100 : null;
}

export interface BillingSummary {
  plan: string;
  currency: string;
  paid_users: number | null;
  renewal_date: string | null;
  recurring_total: number | null;
  recurring_unit_cost: number | null;
  term: string | null;
  renews: boolean;
  switches_plan: boolean;
  trial: boolean;
  invoice_billing: boolean;
}

export function parseBillingOverview(html: string): BillingSummary {
  const match = html.match(
    /data-automount-component="AdminBillingOverview"[^>]*data-automount-props="([^"]*)"/,
  );
  if (!match?.[1]) {
    throw new Error("Could not find the Slack billing overview data.");
  }
  const props = JSON.parse(decodeHtmlAttribute(match[1])) as Record<
    string,
    any
  >;
  return {
    plan: props.productLevelForDisplay ?? props.productLevel ?? "unknown",
    currency: props.currency ?? props.costRecurring?.plan?.currency ?? "unknown",
    paid_users: Number.isFinite(Number(props.numPaidUsers))
      ? Number(props.numPaidUsers)
      : null,
    renewal_date: props.teamPayDateNext ?? null,
    recurring_total: moneyFromCents(props.costRecurring?.plan?.total),
    recurring_unit_cost: moneyFromCents(
      props.costRecurring?.product?.unit_cost,
    ),
    term: props.costRecurring?.product?.term ?? null,
    renews: Boolean(props.planWillRenew),
    switches_plan: Boolean(props.planWillSwitch),
    trial: Boolean(props.isOnTrial),
    invoice_billing: Boolean(props.isPayingByInvoice),
  };
}

export interface AuthSummary {
  mode: string;
  google_enabled: boolean;
  google_domain: string | null;
  saml_enabled: boolean;
  profile_sync_on_login: boolean;
  email_changes_allowed: boolean;
  display_name_changes_allowed: boolean;
  sso_optional: boolean;
  two_factor_required: boolean;
}

export interface BillingHistoryItem {
  id: string;
  type: string;
  date: string;
  status: string;
  amount: number | null;
  currency: string | null;
  plan: string | null;
  term: string | null;
  users_from: number | null;
  users_to: number | null;
  audit_id: string | null;
}

export function summarizeBillingHistory(
  items: Array<Record<string, any>>,
): BillingHistoryItem[] {
  return items.map((item) => {
    const amount = item.invoice?.amount ?? item.credits?.amount;
    const currency = item.invoice?.currency ?? item.credits?.currency;
    return {
      id: String(item.id ?? ""),
      type: String(item.type ?? "unknown"),
      date: Number.isFinite(Number(item.date_create))
        ? new Date(Number(item.date_create) * 1000).toISOString()
        : "",
      status: String(item.status || item.invoice?.status || ""),
      amount: moneyFromCents(amount),
      currency: typeof currency === "string" ? currency : null,
      plan:
        typeof item.product?.level === "string"
          ? item.product.level
          : null,
      term:
        typeof item.product?.term === "string" ? item.product.term : null,
      users_from: Number.isFinite(Number(item.num_users_from))
        ? Number(item.num_users_from)
        : null,
      users_to: Number.isFinite(Number(item.num_users_to))
        ? Number(item.num_users_to)
        : null,
      audit_id: typeof item.audit_id === "string" ? item.audit_id : null,
    };
  });
}

export function summarizeAuthPrefs(
  prefs: Record<string, unknown>,
): AuthSummary {
  return {
    mode: String(prefs.auth_mode ?? "unknown"),
    google_enabled: Boolean(prefs.google_sso_enable),
    google_domain:
      typeof prefs.google_sso_domain === "string"
        ? prefs.google_sso_domain
        : null,
    saml_enabled: Boolean(prefs.saml_enable),
    profile_sync_on_login: Boolean(prefs.sso_sync_with_provider),
    email_changes_allowed: Boolean(prefs.sso_change_email),
    display_name_changes_allowed: Boolean(prefs.sso_choose_username),
    sso_optional: Boolean(prefs.sso_optional),
    two_factor_required: Number(prefs.two_factor_auth_required) > 0,
  };
}
