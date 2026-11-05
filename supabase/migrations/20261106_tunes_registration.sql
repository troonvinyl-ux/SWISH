-- Add Tunes Flip ownership to the existing taxonomy and command aggregate.
-- Preserve all existing definitions, records, RLS, grants and credentials.
-- Does not replace the legacy entitlement CHECK; subscriber rollout requires separately reviewed billing migration.
do $$
declare v_before text; v_after text;
begin
 v_before := pg_get_functiondef('public.swish_specialist_niche(text)'::regprocedure);
 if public.swish_specialist_niche('vinyl_records') is null then
  v_after := replace(v_before, '(''collectibles'',''collectibles'')) as mapping', '(''collectibles'',''collectibles''),(''vinyl_records'',''tunes_flip''),(''tunes_flip'',''tunes_flip'')) as mapping');
  if v_after=v_before then raise exception 'Current specialist definition changed; review registration migration'; end if;
  execute v_after;
 elsif public.swish_specialist_niche('vinyl_records') <> 'tunes_flip' then raise exception 'Music specialist already owned by another niche'; end if;
 v_before := pg_get_functiondef('public.swish_command_snapshot(uuid,boolean,text,text)'::regprocedure);
 if position('''tunes_flip''' in v_before)=0 then
  v_after := replace(v_before, '''surplus_flip'',''collectibles'']','''surplus_flip'',''collectibles'',''tunes_flip'']');
  if v_after=v_before then raise exception 'Current command snapshot registry changed; review migration'; end if;
  execute v_after;
 end if;
end $$;
notify pgrst, 'reload schema';
