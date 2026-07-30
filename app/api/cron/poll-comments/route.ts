import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSubscriptionActive } from "@/lib/subscription";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await prisma.instagramAccount.findMany({
    include: { rules: true, user: { include: { subscription: true } } },
  });

  let repliedCount = 0;

  for (const account of accounts) {
    const sub = account.user.subscription;
    if (!sub || !isSubscriptionActive(sub)) continue;

    try {
      const mediaRes = await fetch(
        `https://graph.instagram.com/me/media?fields=id,caption,timestamp&limit=10&access_token=${account.accessToken}`
      );
      const mediaData = await mediaRes.json();
      if (!mediaData.data) continue;

      for (const media of mediaData.data) {
        const commentsRes = await fetch(
          `https://graph.instagram.com/${media.id}/comments?fields=id,text,username,timestamp&access_token=${account.accessToken}`
        );
        const commentsData = await commentsRes.json();
        if (!commentsData.data) continue;

        for (const comment of commentsData.data) {
          const existing = await prisma.commentLog.findFirst({
            where: { instagramAccountId: account.id, commentId: comment.id },
          });
          if (existing) continue;

          const matchedRule = account.rules
            .filter((r) => r.isActive)
            .find((r) => {
              if (!r.keywords) return true;
              const keys = r.keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
              return keys.some((k) => comment.text.toLowerCase().includes(k));
            });

          if (!matchedRule) {
            await prisma.commentLog.create({
              data: {
                instagramAccountId: account.id,
                commentId: comment.id,
                commenterUsername: comment.username,
                commentText: comment.text,
                status: "skipped",
              },
            });
            continue;
          }

          const replyText = matchedRule.replyTemplate.replace(
            "{username}",
            comment.username ? `@${comment.username}` : ""
          );

          try {
            const replyRes = await fetch(`https://graph.instagram.com/${comment.id}/replies`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ message: replyText, access_token: account.accessToken }),
            });
            const replyData = await replyRes.json();
            if (!replyData.id) throw new Error(JSON.stringify(replyData));

            await prisma.commentLog.create({
              data: {
                instagramAccountId: account.id,
                commentId: comment.id,
                commenterUsername: comment.username,
                commentText: comment.text,
                matchedRuleId: matchedRule.id,
                replyText,
                status: "replied",
              },
            });
            repliedCount++;
          } catch {
            await prisma.commentLog.create({
              data: {
                instagramAccountId: account.id,
                commentId: comment.id,
                commenterUsername: comment.username,
                commentText: comment.text,
                matchedRuleId: matchedRule.id,
                replyText,
                status: "failed",
              },
            });
          }
        }
      }
    } catch {
      // move on to next account
    }
  }

  return NextResponse.json({ repliedCount });
}
