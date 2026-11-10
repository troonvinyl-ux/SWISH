-- Schema-only refinement: historical completed flags must not override fresh eBay evidence without an actual delivery date.
-- No existing order rows are modified during installation.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.swish_ingest_ebay_order_line(uuid,text,uuid,jsonb)'::regprocedure);
 definition:=replace(definition,'if stage=''awaiting_dispatch'' and o.fulfilment_status in (''packing'',''label_created'',''dispatched'',''delivered'',''completed'') then stage:=o.fulfilment_status; end if;','if stage=''awaiting_dispatch'' and (o.fulfilment_status in (''packing'',''label_created'') or (o.fulfilment_status=''dispatched'' and o.dispatched_at is not null) or (o.fulfilment_status in (''delivered'',''completed'') and o.delivered_at is not null)) then stage:=o.fulfilment_status; end if;');
 definition:=replace(definition,'if stage=''dispatched'' and o.fulfilment_status in (''delivered'',''completed'') then','if stage=''dispatched'' and o.fulfilment_status in (''delivered'',''completed'') and o.delivered_at is not null then');
 execute definition;
end $$;
notify pgrst,'reload schema';
