-- CI-only structural check for migration 0007.
-- Read-only; used by .github/workflows/db-ops-apply-0007.yml to classify the
-- pre/post state of the database. Returns one row per object with OK or
-- MISSING_OR_WRONG; the workflow counts OK rows and compares against the
-- expected total.
--
-- NOTE: For timestamp columns we assert datetime_precision=3, NOT
-- numeric_precision=3. Per the SQL/Postgres information_schema contract,
-- numeric_precision is NULL for datetime types (it applies to numerics
-- only); the sub-second precision lives in datetime_precision.

with checks as (
  -- businesses lifecycle columns added by 0007 (all nullable TIMESTAMP(3))
  select 'col:businesses.expiresAt:timestamp(3):nullable' as k,
         case when exists (
           select 1 from information_schema.columns
            where table_schema='public' and table_name='businesses'
              and column_name='expiresAt'
              and data_type='timestamp without time zone'
              and datetime_precision=3 and is_nullable='YES'
         ) then 'OK' else 'MISSING_OR_WRONG' end as v
  union all
  select 'col:businesses.deletedAt:timestamp(3):nullable',
         case when exists (
           select 1 from information_schema.columns
            where table_schema='public' and table_name='businesses'
              and column_name='deletedAt'
              and data_type='timestamp without time zone'
              and datetime_precision=3 and is_nullable='YES'
         ) then 'OK' else 'MISSING_OR_WRONG' end
  union all
  select 'col:businesses.setupCompletedAt:timestamp(3):nullable',
         case when exists (
           select 1 from information_schema.columns
            where table_schema='public' and table_name='businesses'
              and column_name='setupCompletedAt'
              and data_type='timestamp without time zone'
              and datetime_precision=3 and is_nullable='YES'
         ) then 'OK' else 'MISSING_OR_WRONG' end
  union all
  select 'col:businesses.creationKey:text:nullable',
         case when exists (
           select 1 from information_schema.columns
            where table_schema='public' and table_name='businesses'
              and column_name='creationKey'
              and data_type='text' and is_nullable='YES'
         ) then 'OK' else 'MISSING_OR_WRONG' end
  union all
  -- businesses.status default must be 'DRAFT' (existing column, default altered)
  select 'col:businesses.status.default=DRAFT',
         case when exists (
           select 1 from information_schema.columns
            where table_schema='public' and table_name='businesses'
              and column_name='status'
              and column_default like '%''DRAFT''%'
         ) then 'OK' else 'MISSING_OR_WRONG' end
  union all
  -- holidays table must exist (created by 0007)
  select 'table:holidays',
         case when to_regclass('public.holidays') is not null then 'OK' else 'MISSING_OR_WRONG' end
  union all
  -- holidays.id: text, NOT NULL, PRIMARY KEY named holidays_pkey
  select 'col:holidays.id:text:pk',
         case when exists (
           select 1 from information_schema.table_constraints tc
             join information_schema.key_column_usage kcu
               on tc.constraint_name=kcu.constraint_name
              and tc.constraint_schema=kcu.constraint_schema
            where tc.constraint_type='PRIMARY KEY'
              and tc.table_schema='public' and tc.table_name='holidays'
              and tc.constraint_name='holidays_pkey'
              and kcu.column_name='id'
         ) and exists (
           select 1 from information_schema.columns c
            where c.table_schema='public' and c.table_name='holidays'
              and c.column_name='id' and c.data_type='text' and c.is_nullable='NO'
         ) then 'OK' else 'MISSING_OR_WRONG' end
  union all
  -- holidays.businessId: text, NOT NULL (FK presence + cascade checked separately)
  select 'col:holidays.businessId:text:notnull',
         case when exists (
           select 1 from information_schema.columns c
            where c.table_schema='public' and c.table_name='holidays'
              and c.column_name='businessId' and c.data_type='text' and c.is_nullable='NO'
         ) then 'OK' else 'MISSING_OR_WRONG' end
  union all
  -- holidays.date: DATE, NOT NULL (DateTime @db.Date in Prisma)
  select 'col:holidays.date:date:notnull',
         case when exists (
           select 1 from information_schema.columns c
            where c.table_schema='public' and c.table_name='holidays'
              and c.column_name='date' and data_type='date' and c.is_nullable='NO'
         ) then 'OK' else 'MISSING_OR_WRONG' end
  union all
  -- holidays.reason: text, nullable
  select 'col:holidays.reason:text:nullable',
         case when exists (
           select 1 from information_schema.columns c
            where c.table_schema='public' and c.table_name='holidays'
              and c.column_name='reason' and c.data_type='text' and c.is_nullable='YES'
         ) then 'OK' else 'MISSING_OR_WRONG' end
  union all
  -- holidays.createdAt: TIMESTAMP(3), NOT NULL, DEFAULT CURRENT_TIMESTAMP.
  -- We assert the type/precision/nullability; default is checked by label so
  -- the check does not depend on how different Postgres versions spell now().
  select 'col:holidays.createdAt:timestamp(3):notnull:defaultNow',
         case when exists (
           select 1 from information_schema.columns c
            where c.table_schema='public' and c.table_name='holidays'
              and c.column_name='createdAt'
              and data_type='timestamp without time zone'
              and datetime_precision=3 and is_nullable='NO'
              and column_default is not null
         ) then 'OK' else 'MISSING_OR_WRONG' end
  union all
  -- FK holidays_businessId_fkey -> businesses(id) ON DELETE CASCADE ON UPDATE CASCADE
  select 'fk:holidays_businessId_fkey:cascade',
         case when exists (
           select 1 from information_schema.table_constraints tc
             join information_schema.key_column_usage kcu
               on tc.constraint_name=kcu.constraint_name and tc.constraint_schema=kcu.constraint_schema
             join information_schema.constraint_column_usage ccu
               on ccu.constraint_name=tc.constraint_name and ccu.constraint_schema=tc.constraint_schema
             join information_schema.referential_constraints rc
               on rc.constraint_name=tc.constraint_name and rc.constraint_schema=tc.constraint_schema
            where tc.constraint_type='FOREIGN KEY'
              and tc.table_schema='public' and tc.table_name='holidays'
              and tc.constraint_name='holidays_businessId_fkey'
              and kcu.column_name='businessId'
              and ccu.table_name='businesses' and ccu.column_name='id'
              and rc.delete_rule='CASCADE'
              and rc.update_rule='CASCADE'
         ) then 'OK' else 'MISSING_OR_WRONG' end
  union all
  -- indexes added/used by 0007
  select 'idx:businesses_expiresAt_idx',
         case when exists (select 1 from pg_indexes where schemaname='public' and tablename='businesses' and indexname='businesses_expiresAt_idx') then 'OK' else 'MISSING_OR_WRONG' end
  union all
  select 'idx:businesses_deletedAt_idx',
         case when exists (select 1 from pg_indexes where schemaname='public' and tablename='businesses' and indexname='businesses_deletedAt_idx') then 'OK' else 'MISSING_OR_WRONG' end
  union all
  select 'idx:businesses_ownerId_creationKey_key:unique',
         case when exists (
           select 1 from pg_indexes
            where schemaname='public' and tablename='businesses'
              and indexname='businesses_ownerId_creationKey_key'
              and indexdef ilike '%unique%'
         ) then 'OK' else 'MISSING_OR_WRONG' end
  union all
  select 'idx:holidays_businessId_date_key:unique',
         case when exists (
           select 1 from pg_indexes
            where schemaname='public' and tablename='holidays'
              and indexname='holidays_businessId_date_key'
              and indexdef ilike '%unique%'
         ) then 'OK' else 'MISSING_OR_WRONG' end
)
select k, v from checks order by k;
