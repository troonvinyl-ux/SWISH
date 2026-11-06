-- Include Tunes Flip in shared atomic editor condition, notes, photo and option persistence.
-- Function definition only: no existing inventory or listing rows are modified.
do $$
declare definition text; marker text := '''surplus_flip'',''collectibles'') into v_antique';
begin
 definition := pg_get_functiondef('public.swish_save_listing_editor(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
 if position('''tunes_flip'') into v_antique' in definition)>0 then return; end if;
 if position(marker in definition)=0 then raise exception 'Shared editor registry changed; review required'; end if;
 execute replace(definition, marker, '''surplus_flip'',''collectibles'',''tunes_flip'') into v_antique');
end $$;
notify pgrst, 'reload schema';
