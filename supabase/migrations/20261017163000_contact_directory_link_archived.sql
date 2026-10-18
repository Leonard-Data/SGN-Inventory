-- Ticket #122 follow-up: the directory's link projection states each linked property's
-- archived state. The row keeps every link the caller may read — an archived property stays
-- reachable for a reviewer, who sees it labelled — while the stated linked-property count is
-- derived from the unarchived links only, which is the same ordinary unarchived inventory
-- boundary the contact filter applies, so the count and the filtered inventory cannot
-- disagree. `create or replace` keeps the wrapper's signature, return columns, grants, RLS
-- boundary and paging rule; only the projected fields change.
begin;

create or replace function public.list_contacts(
  p_query text default null,
  p_after_id uuid default null,
  p_owners_only boolean default false,
  p_limit integer default 31
) returns table(
  id uuid,
  display_name text,
  contact_type text,
  phones text[],
  raw_phone_text text,
  revision uuid,
  links jsonb
) language sql stable security invoker set search_path='' as $$
  with input as materialized (
    select nullif(btrim(coalesce(p_query, ''), ' '), '') as query_text,
      coalesce(p_owners_only, false) as owners_only
  ), pattern as materialized (
    select '%' || replace(replace(replace(i.query_text, chr(92), chr(92) || chr(92)),
      '%', chr(92) || '%'), '_', chr(92) || '_') || '%' as like_pattern
    from input i
  )
  select c.id, c.display_name, c.contact_type, c.phones, c.raw_phone_text, c.revision,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'property_id', p.id,
        'property_code', p.property_code,
        'relation', pc.relation,
        'is_primary', pc.is_primary,
        'archived', p.archived_at is not null) order by p.property_code, p.id)
      from public.property_contacts pc join public.properties p on p.id = pc.property_id
      where pc.contact_id = c.id
    ), '[]'::jsonb) as links
  from public.contacts c cross join input i cross join pattern p
  where (
      i.query_text is null
      or (length(i.query_text) <= 120 and c.display_name ilike p.like_pattern escape E'\\')
    )
    and (p_after_id is null or c.id > p_after_id)
    and (not i.owners_only or exists(
      select 1 from public.property_contacts pc
      where pc.contact_id = c.id and pc.relation = 'owner'))
  order by c.id
  limit least(greatest(coalesce(p_limit, 31), 1), 31);
$$;
commit;
