-- Manual read-only role-simulation regression. No fixture creation, writes or cleanup.
-- Catalog role simulation does not replace actual subscriber/owner JWT/device tests.
begin;
do $$ declare u uuid; t uuid; r jsonb; expected bigint; observed bigint; section text; begin
 if has_function_privilege('anon','public.swish_command_snapshot(uuid,boolean,text,text)','execute') then raise exception 'FAIL: anon execute'; end if;
 select user_id into u from public.swish_platform_owners limit 1;
 if u is null then raise exception 'BLOCKED: trusted owner fixture required'; end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 r:=public.swish_command_snapshot(null,true);
 if r->>'verifiedOwner'<>'true' or jsonb_array_length(r->'modules')<>12 then raise exception 'FAIL: owner registry contract'; end if;
 select count(*) into expected from public.items where public.swish_specialist_niche(specialist_id) in ('coins','motocross','bicycles','clothing','trading_cards','antiques','fossils','beauty','tech','surplus_flip','collectibles','tunes_flip');
 select sum((x->>'inventory')::bigint) into observed from jsonb_array_elements(r->'modules') x;
 if expected<>observed then raise exception 'FAIL: canonical inventory total'; end if;
 if r->'operations'->>'version' is distinct from 'minority-text-v1' or jsonb_array_length(r->'operations'->'niches')<>12 then raise exception 'FAIL: consolidated operational report';end if;
 if (r->'operations'->'performance'->>'attempts')::integer=0 and r->'operations'->'performance'->>'publicationSuccessPct' is not null then raise exception 'FAIL: fabricated empty-sample rate';end if;
 foreach section in array array['users','memberships','inventory','audit','incidents','sync','configuration'] loop
  r:=public.swish_command_snapshot(null,true,section);
  if r->>'verifiedOwner'<>'true' or jsonb_array_length(r->'rows')>50 then raise exception 'FAIL: bounded inspector'; end if;
 end loop;
 select m.user_id,m.tenant_id into u,t from public.tenant_memberships m where not public.swish_owner_for_user(m.user_id) limit 1;
 if u is null then raise exception 'BLOCKED: separate subscriber fixture required'; end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 begin perform public.swish_command_snapshot(t,true); raise exception 'FAIL: subscriber platform read'; exception when insufficient_privilege then null; end;
 begin perform public.swish_command_snapshot(t,false,'users'); raise exception 'FAIL: subscriber inspector'; exception when insufficient_privilege then null; end;
 begin perform public.swish_command_snapshot('00000000-0000-0000-0000-000000000000',false); raise exception 'FAIL: foreign tenant read'; exception when insufficient_privilege then null; end;
 r:=public.swish_command_snapshot(t,false);
 if r->>'tenantId'<>t::text or r->>'scope'<>'tenant' then raise exception 'FAIL: tenant response'; end if;
 if exists(select 1 from jsonb_array_elements(r->'modules') x where not exists(select 1 from public.niche_entitlements e where e.user_id=u and e.niche_id=x->>'id' and e.expires_at>now())) then raise exception 'FAIL: foreign niche response'; end if;
end $$;
rollback;
