import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL));
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(
      new URL("/dashboard?error=no_code", process.env.NEXTAUTH_URL)
    );
  }

  const redirectUri = "https://igautodmtest.vercel.app/api/instagram/oauth/callback";
  const appId = process.env.INSTAGRAM_APP_ID!;
  const appSecret = process.env.INSTAGRAM_APP_SECRET!;

  function fail(step: string, detail: any) {
    const msg = encodeURIComponent(`${step}: ${JSON.stringify(detail)}`);
    return NextResponse.redirect(
      new URL(`/dashboard?error=oauth_failed&detail=${msg}`, process.env.NEXTAUTH_URL)
    );
  }

  try {
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    });
    const shortData = await shortRes.json();
    const shortToken = shortData.access_token;
    const igUserId = shortData.user_id;
    if (!shortToken) return fail("short_token", shortData);

    const longRes = await fetch(
      `https://graph.instagram.com/access_token` +
        `?grant_type=ig_exchange_token` +
        `&client_secret=${appSecret}` +
        `&access_token=${shortToken}`
    );
    const longData = await longRes.json();
    const longToken = longData.access_token;
    if (!longToken) return fail("long_token", longData);

    const meRes = await fetch(
      `https://graph.instagram.com/me?fields=id,username&access_token=${longToken}`
    );
    const meData = await meRes.json();
    if (!meData.username) return fail("me_fetch", meData);

    // Subscribe this Instagram account to the app's webhooks —
    // required or comment events will never be sent, even if the
    // app-level "comments" field is toggled on in the Meta dashboard.
    const subRes = await fetch(
      `https://graph.instagram.com/v20.0/${igUserId}/subscribed_apps`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          subscribed_fields: "comments",
          access_token: longToken,
        }),
      }
    );
    const subData = await subRes.json();
    if (!subData.success) return fail("subscribe", subData);

    await prisma.instagramAccount.upsert({
      where: {
        userId_igUserId: { userId: (session.user as any).id, igUserId: String(igUserId) },
      },
      update: { username: meData.username, accessToken: longToken },
      create: {
        userId: (session.user as any).id,
        igUserId: String(igUserId),
        username: meData.username,
        accessToken: longToken,
      },
    });

    return NextResponse.redirect(new URL("/dashboard?connected=1", process.env.NEXTAUTH_URL));
  } catch (err: any) {
    return fail("exception", err.message || String(err));
  }
}
