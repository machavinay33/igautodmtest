import { prisma } from "./prisma";

export const TRIAL_DAYS = 1;
export const PLAN_PRICE_RS = 5;

/**
 * Creates the initial subscription row for a brand-new user:
 * a 1-day free trial starting now.
 */
export async function createTrialSubscription(userId: string) {
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

  return prisma.subscription.create({
    data: {
      userId,
      status: "TRIALING",
      planAmountRs: PLAN_PRICE_RS,
      trialEndsAt,
    },
  });
}

/**
 * Central gate used by API routes / dashboard to decide whether a user's
 * automation should run. Trial auto-expires based on trialEndsAt, no cron
 * needed for the check itself (expiry is lazily evaluated on read), but a
 * scheduled job should still flip DB status + notify users in production.
 */
export function isSubscriptionActive(sub: {
  status: string;
  trialEndsAt: Date;
  currentPeriodEnd?: Date | null;
}): boolean {
  const now = new Date();
  if (sub.status === "TRIALING") {
    return now < new Date(sub.trialEndsAt);
  }
  if (sub.status === "ACTIVE") {
    return sub.currentPeriodEnd ? now < new Date(sub.currentPeriodEnd) : true;
  }
  return false;
}

export function subscriptionLabel(sub: {
  status: string;
  trialEndsAt: Date;
}): string {
  const now = new Date();
  if (sub.status === "TRIALING") {
    const msLeft = new Date(sub.trialEndsAt).getTime() - now.getTime();
    if (msLeft <= 0) return "Trial expired";
    const hoursLeft = Math.max(1, Math.round(msLeft / (1000 * 60 * 60)));
    return `Free trial · ${hoursLeft}h left`;
  }
  if (sub.status === "ACTIVE") return "Active · ₹5/month";
  if (sub.status === "PAST_DUE") return "Payment due";
  if (sub.status === "CANCELED") return "Canceled";
  return "Expired";
}

/**
 * Placeholder for wiring a real payment provider (Razorpay is the natural
 * choice for INR). Call this from a "Subscribe" button + webhook handler.
 *
 * Razorpay integration sketch:
 *  1. Create a Razorpay Plan for ₹5/month.
 *  2. Create a Razorpay Subscription for the customer, get short-lived
 *     checkout, and open Razorpay Checkout on the client.
 *  3. On the `subscription.charged` webhook, mark status ACTIVE and set
 *     currentPeriodEnd to the next billing date.
 *  4. On `subscription.cancelled` / failed renewal, mark CANCELED / PAST_DUE.
 */
export async function activateSubscriptionAfterPayment(
  userId: string,
  providerSubscriptionId: string,
  periodEndsAt: Date
) {
  return prisma.subscription.update({
    where: { userId },
    data: {
      status: "ACTIVE",
      paymentProvider: "razorpay",
      providerSubscriptionId,
      currentPeriodEnd: periodEndsAt,
    },
  });
}
