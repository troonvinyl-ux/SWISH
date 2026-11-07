-- Speed up tenant/niche-safe Quick List timing and confirmed-live evidence reads.
-- Additive index only. Existing events, canonical inventory and RLS are unchanged.
create index if not exists idx_commercial_events_quick_scope
on public.commercial_events (tenant_id,(data->>'nicheId'),created_at desc,id desc)
where entity_type='quick_list' and event_type in ('quick_list_timing','quick_list_live_confirmation');
