export const community = {
  saved: (query, { userId }) =>
    query(
      "SELECT post_id FROM public.saved_posts WHERE user_id=$1 ORDER BY saved_at DESC LIMIT 50",
      [userId],
    ),
  reports: (query) =>
    query(
      "SELECT id,post_id,reason FROM public.reports WHERE status='OPEN' ORDER BY created_at DESC LIMIT 50",
    ),
  dismiss: (query, { id, userId }) =>
    query(
      "UPDATE public.reports SET status='DISMISSED',resolved_by=$2,resolved_at=now() WHERE id=$1 AND status='OPEN'",
      [id, userId],
    ),
  async detail(query, { id, userId }) {
    const comments = await query(
      "SELECT id,author_id,body,created_at FROM public.comments WHERE post_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id LIMIT 50",
      [id],
    );
    const [reaction] = await query(
      `SELECT (SELECT count(*)::int FROM public.likes WHERE post_id=$1) AS likes,
      EXISTS(SELECT 1 FROM public.likes WHERE post_id=$1 AND user_id=$2) AS liked,
      EXISTS(SELECT 1 FROM public.saved_posts WHERE post_id=$1 AND user_id=$2) AS saved`,
      [id, userId],
    );
    return { comments, reaction };
  },
  async interact(query, { action, method, id, userId, content }) {
    if (
      ["like", "save"].includes(action) &&
      ["PUT", "DELETE"].includes(method)
    ) {
      const table = action === "like" ? "likes" : "saved_posts";
      const sql =
        method === "PUT"
          ? `INSERT INTO public.${table} (user_id,post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`
          : `DELETE FROM public.${table} WHERE user_id=$1 AND post_id=$2`;
      await query(sql, [userId, id]);
      return { active: method === "PUT" };
    }
    if (action === "comments") {
      await query(
        "INSERT INTO public.comments (author_id,post_id,body) VALUES ($1,$2,$3)",
        [userId, id, content],
      );
    } else if (action === "report") {
      await query(
        `INSERT INTO public.reports (reporter_id,post_id,reason) VALUES ($1,$2,$3)
        ON CONFLICT (reporter_id,post_id) WHERE status='OPEN' DO NOTHING`,
        [userId, id, content],
      );
    } else throw new Error("Unknown interaction");
    return { saved: true };
  },
};
