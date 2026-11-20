import { commerce } from "./commerce-client.mjs";
import { withDb, problem, localAssetAvailable } from "./content-shared.mjs";
export async function testPurchase(id, caller, expectedPrice) {
  return withDb("CONTENT", async (content) => {
    await content.query("BEGIN");
    try {
      const {
        rows: [post],
      } = await content.query(
        "SELECT author_id, price_vnd FROM public.posts WHERE id=$1 AND status='PUBLISHED' FOR SHARE",
        [id],
      );
      if (!post) throw problem(409, "Tác phẩm hiện không mở bán.");
      if (post.author_id === caller.id || Number(post.price_vnd) <= 0)
        throw problem(409, "Chỉ mua thử bài premium của người khác.");
      if (expectedPrice !== Number(post.price_vnd))
        throw problem(409, "Giá đã thay đổi. Tải lại bài để xác nhận.");
      const { rows: files } = await content.query(
        "SELECT original_key FROM public.assets WHERE post_id=$1 AND purpose='FULL' AND status='READY'",
        [id],
      );
      if (
        !files.length ||
        !(
          await Promise.all(
            files.map((file) => localAssetAvailable(file.original_key)),
          )
        ).every(Boolean)
      ) {
        throw problem(
          409,
          "Tạm dừng mua vì một hoặc nhiều tệp Premium hiện không khả dụng.",
        );
      }
      try {
        return await commerce("/test-purchase", {
          buyerId: caller.id,
          postId: id,
          price: expectedPrice,
          authorId: post.author_id,
        });
      } catch (error) {
        if (error.status === 503) return { status: "VERIFYING" };
        throw error;
      }
    } finally {
      await content.query("ROLLBACK").catch(() => {});
    }
  });
}
