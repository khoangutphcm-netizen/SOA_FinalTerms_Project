import { commerce } from "./commerce-client.mjs";
import { callService } from "./internal-services.mjs";
import { uuid, withDb, query, problem } from "./content-shared.mjs";
export async function adminDashboard() {
  const [posts, paid, reports, genres, events, totals] = await Promise.all([
    query(
      "CONTENT",
      "SELECT id,title,status,withdrawn_at,moderation_state FROM public.posts ORDER BY created_at DESC,id LIMIT 50",
    ),
    commerce("/paid-count"),
    callService("COMMUNITY", "reports"),
    query("CONTENT", "SELECT id,name,enabled FROM public.genres ORDER BY name"),
    query(
      "CONTENT",
      `SELECT e.id,e.title,e.description,e.enabled,
      ARRAY(SELECT post_id FROM public.homepage_event_items WHERE event_id=e.id ORDER BY position) AS posts
      FROM public.homepage_events e ORDER BY e.title,e.id`,
    ),
    query(
      "CONTENT",
      `SELECT count(*)::int AS posts,
      count(*) FILTER (WHERE status='PUBLISHED')::int AS published,
      count(*) FILTER (WHERE status='PUBLISHED' AND price_vnd>0)::int AS premium
      FROM public.posts`,
    ),
  ]);
  return {
    posts,
    paid: paid.count,
    reports,
    genres,
    events,
    totals: totals[0],
  };
}

export async function saveEvent(id, input) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const description =
    typeof input?.description === "string" ? input.description.trim() : "";
  const ids = Array.isArray(input?.posts) ? [...new Set(input.posts)] : [];
  if (
    !title ||
    title.length > 80 ||
    description.length > 240 ||
    typeof input?.enabled !== "boolean" ||
    (input.enabled && !ids.length) ||
    ids.length > 25 ||
    ids.some((value) => typeof value !== "string" || !uuid.test(value))
  ) {
    throw problem(
      400,
      "Kiểm tra tên, mô tả và danh sách bài. Sự kiện đang bật cần ít nhất một bài.",
    );
  }
  return withDb("CONTENT", async (client) => {
    await client.query("BEGIN");
    try {
      const { rows } = await client.query(
        "SELECT id FROM public.posts WHERE id=ANY($1::uuid[]) AND status='PUBLISHED' FOR SHARE",
        [ids],
      );
      if (rows.length !== ids.length)
        throw problem(409, "Một bài đã không còn hiển thị.");
      const result = id
        ? await client.query(
            "UPDATE public.homepage_events SET title=$1,description=$2,enabled=$3 WHERE id=$4 RETURNING id",
            [title, description, input.enabled, id],
          )
        : await client.query(
            "INSERT INTO public.homepage_events (title,description,enabled) VALUES ($1,$2,$3) RETURNING id",
            [title, description, input.enabled],
          );
      const eventId = result.rows[0]?.id;
      if (!eventId) throw problem(404, "Không tìm thấy sự kiện.");
      await client.query(
        "DELETE FROM public.homepage_event_items WHERE event_id=$1",
        [eventId],
      );
      if (ids.length)
        await client.query(
          "INSERT INTO public.homepage_event_items (event_id,post_id,position) SELECT $1,v.id,v.pos FROM unnest($2::uuid[]) WITH ORDINALITY v(id,pos)",
          [eventId, ids],
        );
      await client.query("COMMIT");
      return { id: eventId };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}
