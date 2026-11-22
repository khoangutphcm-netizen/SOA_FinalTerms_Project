import { query, problem } from "./content-shared.mjs";
export async function moderatePost(id, caller, input) {
  const action = input?.action;
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  if (!["HIDE", "RESTORE", "TAKEDOWN", "REINSTATE"].includes(action))
    throw problem(400, "Thao tác kiểm duyệt không hợp lệ.");
  if (
    (["HIDE", "TAKEDOWN"].includes(action) && !reason) ||
    reason.length > 1000
  ) {
    throw problem(400, "Nhập lý do kiểm duyệt từ 1 đến 1000 ký tự.");
  }
  // Removing a takedown restores buyer access. Relisting requires a separate decision.
  const state = {
    HIDE: "TEMP_HIDDEN",
    RESTORE: "CLEAR",
    TAKEDOWN: "TAKEN_DOWN",
    REINSTATE: "TEMP_HIDDEN",
  }[action];
  const rows = await query(
    "CONTENT",
    `
    WITH changed AS (
      UPDATE public.posts SET
        status=CASE WHEN $2='CLEAR' AND withdrawn_at IS NULL THEN 'PUBLISHED' ELSE 'HIDDEN' END,
        moderation_state=$2, moderation_reason=$3, moderated_by=$4, moderated_at=now()
      WHERE id=$1 AND published_at IS NOT NULL AND (
        ($5='HIDE' AND status='PUBLISHED' AND moderation_state='CLEAR') OR
        ($5='RESTORE' AND status='HIDDEN' AND
          (moderation_state='TEMP_HIDDEN' OR (moderation_state='CLEAR' AND withdrawn_at IS NULL))) OR
        ($5='TAKEDOWN' AND moderation_state<>'TAKEN_DOWN') OR
        ($5='REINSTATE' AND moderation_state='TAKEN_DOWN')
      )
      RETURNING id
    )
    INSERT INTO public.post_moderation_actions (post_id,actor_id,actor_kind,action,reason)
    SELECT id,$4,'ADMIN',$5,$3 FROM changed RETURNING post_id
  `,
    [id, state, reason || null, caller.id, action],
  );
  if (!rows.length)
    throw problem(
      409,
      "Trạng thái tác phẩm không còn phù hợp. Hãy tải lại danh sách và thử lại.",
    );
}
