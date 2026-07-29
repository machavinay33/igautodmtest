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

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/instagram/oauth/callback`;
  const appId = process.env.INSTAGRAM_APP_ID!;
  const appSecret = process.env.INSTAGRAM_APP_SECRET!;

  try {
    // Step 1: exchange code for a short-lived user token
    const shortRes = await fetch(
      `https://graph.facebook.com/v20.0/oauth/access_token` +
        `?client_id=${appId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&client_secret=${appSecret}` +
        `&code=${code}`
    );
    const shortData = await shortRes.json();
    if (!shortData.access_token) throw new Error(JSON.stringify(shortData));

    // Step 2: exchange for a long-lived user token (~60 days)
    const longRes = await fetch(
      `https://graph.facebook.com/v20.0/oauth/access_token` +
        `?grant_type=fb_exchange_token` +
        `&client_id=${appId}` +
        `&client_secret=${appSecret}` +
        `&fb_exchange_token=${shortData.access_token}`
    );
    const longData = await longRes.json();
    const userToken = longData.access_token;
    if (!userToken) throw new Error(JSON.stringify(longData));

    // Step 3: find the Facebook Page(s) this user manages
    const pagesRes = await fetch(
      `https://graph.facebook.com/v20.0/me/accounts?access_token=${userToken}`
    );
    const pagesData = await pagesRes.json();
    const page = pagesData.data?.[0];
    if (!page) throw new Error("No connected Facebook Page found.");

    // Step 4: get the Instagram Business Account linked to that Page
    const igRes = await fetch(
      `https://graph.facebook.com/v20.0/${page.id}` +
        `?fields=instagram_business_account&access_token=${page.access_token}`
    );
    const igData = await igRes.json();
    const igAccountId = igData.instagram_business_account?.id;
    if (!igAccountId) throw new Error("No Instagram Business account linked to this Page.");

    // Step 5: get the Instagram username
    const usernameRes = await fetch(
      `https://graph.facebook.com/v20.0/${igAccountId}?fields=username&access_token=${page.access_token}`
    );
    const usernameData = await usernameRes.json();

    // Step 6: save it — page.access_token doesn't expire while the Page exists
    await prisma.instagramAccount.upsert({
      where: {
        userId_igUserId: { userId: (session.user as any).id, igUserId: igAccountId },
      },
      update: { username: usernameData.username, accessToken: page.access_token },
      create: {
        userId: (session.user as any).id,
        igUserId: igAccountId,
        username: usernameData.username,
        accessToken: page.access_token,
      },
    });

    return NextResponse.redirect(new URL("/dashboard?connected=1", process.env.NEXTAUTH_URL));
  } catch (err) {
    console.error("Instagram OAuth error", err);
    return NextResponse.redirect(
      new URL("/dashboard?error=oauth_failed", process.env.NEXTAUTH_URL)
    );
  }
}
