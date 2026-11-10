create table if not exists slack_installations (
  id bigserial primary key,
  team_id text,                         -- null for org-wide installs
  enterprise_id text,
  is_enterprise_install boolean not null default false,
  bot_user_id text,
  installation_encrypted text not null, -- AES-256-GCM encrypted JSON of Bolt's Installation object (contains xoxb token)
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists slack_installations_team_uidx
  on slack_installations (team_id) where team_id is not null;
create unique index if not exists slack_installations_ent_uidx
  on slack_installations (enterprise_id) where is_enterprise_install;
alter table slack_installations enable row level security;