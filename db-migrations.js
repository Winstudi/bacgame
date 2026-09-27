"use strict";

/**
 * Schéma PostgreSQL central de P'tit Bac.
 * Toutes les créations/évolutions de tables passent ici.
 */

async function runDatabaseMigrations(pool) {
  if (!pool) throw new Error("PostgreSQL indisponible");

  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  // Portefeuille = source de vérité pour pièces + gemmes.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_wallets (
      token text PRIMARY KEY,
      coins integer NOT NULL CHECK (coins >= 0),
      gems integer NOT NULL DEFAULT 0 CHECK (gems >= 0),
      created_at bigint NOT NULL,
      updated_at bigint NOT NULL,
      history jsonb NOT NULL DEFAULT '[]'::jsonb
    )
  `);
  await pool.query(`
    ALTER TABLE public.ptitbac_wallets
    ADD COLUMN IF NOT EXISTS gems integer NOT NULL DEFAULT 0 CHECK (gems >= 0)
  `);

  // Profil social. Le solde de pièces n'est volontairement plus stocké ici.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      friend_code text UNIQUE NOT NULL,
      username text NOT NULL,
      avatar text DEFAULT '🐼',
      wallet_token text UNIQUE,
      lives integer NOT NULL DEFAULT 5 CHECK (lives >= 0 AND lives <= 5),
      life_updated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      admin_banned boolean NOT NULL DEFAULT false,
      admin_ban_reason text,
      admin_banned_at timestamptz
    )
  `);

  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS wallet_token text UNIQUE`);
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`);
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS lives integer NOT NULL DEFAULT 5 CHECK (lives >= 0 AND lives <= 5)`);
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS life_updated_at timestamptz NOT NULL DEFAULT now()`);
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS admin_banned boolean NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS admin_ban_reason text`);
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS admin_banned_at timestamptz`);

  // Compte permanent + sessions : le schéma est centralisé ici.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      email_normalized text UNIQUE NOT NULL,
      email_display text NOT NULL,
      password_hash text NOT NULL,
      password_salt text NOT NULL,
      password_version integer NOT NULL DEFAULT 1,
      profile_completed boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz
    )
  `);

  // Les comptes créés avant l'onboarding profil sont considérés comme déjà
  // configurés. Les nouveaux comptes conservent ensuite false par défaut.
  await pool.query(`
    ALTER TABLE public.ptitbac_accounts
    ADD COLUMN IF NOT EXISTS profile_completed boolean NOT NULL DEFAULT true
  `);
  await pool.query(`
    ALTER TABLE public.ptitbac_accounts
    ALTER COLUMN profile_completed SET DEFAULT false
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_auth_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL REFERENCES public.ptitbac_accounts(id) ON DELETE CASCADE,
      token_hash text UNIQUE NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz
    )
  `);

  // Migration sûre de l'ancien public.users.coins vers le portefeuille.
  const legacyCoins = await pool.query(`
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'coins'
     LIMIT 1
  `);

  if (legacyCoins.rowCount) {
    await pool.query(`
      INSERT INTO public.ptitbac_wallets(token, coins, gems, created_at, updated_at, history)
      SELECT wallet_token,
             GREATEST(COALESCE(coins, 0), 0),
             0,
             (extract(epoch FROM COALESCE(created_at, now())) * 1000)::bigint,
             (extract(epoch FROM COALESCE(updated_at, now())) * 1000)::bigint,
             '[]'::jsonb
        FROM public.users
       WHERE wallet_token IS NOT NULL
         AND wallet_token <> ''
      ON CONFLICT(token) DO NOTHING
    `);
    await pool.query(`ALTER TABLE public.users DROP COLUMN IF EXISTS coins`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.friend_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      receiver_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','accepted','declined')),
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (sender_id <> receiver_id),
      UNIQUE (sender_id, receiver_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.friendships (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      friend_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (user_id <> friend_id),
      UNIQUE (user_id, friend_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.economy_transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
      wallet_token text,
      kind text NOT NULL,
      coins_delta integer NOT NULL DEFAULT 0,
      gems_delta integer NOT NULL DEFAULT 0,
      lives_delta integer NOT NULL DEFAULT 0,
      room_code text,
      note text,
      idempotency_key text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE public.economy_transactions
    ADD COLUMN IF NOT EXISTS gems_delta integer NOT NULL DEFAULT 0
  `);

  // Snapshots des salons/parties actives pour reprise après redéploiement.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_active_rooms (
      code text PRIMARY KEY,
      snapshot jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      receiver_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
      created_at timestamptz NOT NULL DEFAULT now(),
      read_at timestamptz,
      CHECK (sender_id <> receiver_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_chat_hidden (
      user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      friend_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      hidden_before timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, friend_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_chat_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      reporter_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      reported_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      note text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_player_reports (
      id text PRIMARY KEY,
      reporter_wallet_token text NOT NULL,
      reported_friend_code text NOT NULL,
      reported_name text NOT NULL,
      room_code text,
      reported_player_id text,
      reason text NOT NULL DEFAULT 'lobby_profile',
      status text NOT NULL DEFAULT 'pending',
      treated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE public.ptitbac_player_reports ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'`);
  await pool.query(`ALTER TABLE public.ptitbac_player_reports ADD COLUMN IF NOT EXISTS treated_at timestamptz`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_admin_owner(
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      wallet_token text UNIQUE NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_admin_settings(
      wallet_token text PRIMARY KEY,
      infinite_coins boolean NOT NULL DEFAULT false,
      infinite_lives boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // Paramètres éditables du catalogue cosmétique. Les items officiels
  // restent déclarés dans inventory-service.js.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_item_catalog_settings(
      item_key text PRIMARY KEY,
      rarity text NOT NULL DEFAULT 'commun'
        CHECK (rarity IN ('commun','rare','epique','ultra','exclusif')),
      price integer NOT NULL DEFAULT 0
        CHECK (price >= 0 AND price <= 999999),
      currency text NOT NULL DEFAULT 'coins'
        CHECK (currency IN ('coins','gems')),
      updated_by_wallet_token text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_feedback_reports(
      id text PRIMARY KEY,
      report_type text NOT NULL CHECK(report_type IN ('report-avis','report-bug')),
      wallet_token text,
      friend_code text,
      player_name text,
      message text NOT NULL,
      room_code text,
      category text,
      answer text,
      status text NOT NULL DEFAULT 'pending',
      treated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE public.ptitbac_feedback_reports ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'`);
  await pool.query(`ALTER TABLE public.ptitbac_feedback_reports ADD COLUMN IF NOT EXISTS treated_at timestamptz`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_learned_answers(
      answer_key text PRIMARY KEY,
      category text NOT NULL,
      answer text NOT NULL,
      status text NOT NULL,
      confidence integer NOT NULL,
      source text NOT NULL,
      support_count integer NOT NULL DEFAULT 1,
      updated_at bigint NOT NULL
    )
  `);

  // Cache durable du moteur de correction. Le payload reste versionné :
  // une nouvelle politique de validation ne réutilise jamais une ancienne décision.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_validation_cache(
      cache_key text PRIMARY KEY,
      engine_version text NOT NULL,
      payload jsonb NOT NULL,
      updated_at bigint NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ptitbac_validation_cache_engine_updated_idx
      ON public.ptitbac_validation_cache(engine_version, updated_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_answer_reports(
      id text PRIMARY KEY,
      room_code text,
      player_id text,
      round_index integer,
      category text NOT NULL,
      answer text NOT NULL,
      letter text NOT NULL,
      original_reason text,
      status text NOT NULL,
      review_verdict text,
      review_confidence integer,
      created_at bigint NOT NULL,
      reviewed_at bigint
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_admin_logs(
      id text PRIMARY KEY,
      admin_wallet_token text NOT NULL,
      action text NOT NULL,
      target_friend_code text,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_player_warnings(
      id text PRIMARY KEY,
      wallet_token text NOT NULL,
      friend_code text,
      message text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      delivered_at timestamptz
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_inbox_messages(
      id text PRIMARY KEY,
      sender_wallet_token text,
      recipient_wallet_token text,
      recipient_friend_code text,
      message_type text NOT NULL DEFAULT 'message',
      title text NOT NULL,
      body text NOT NULL,
      image_data text,
      reward_type text NOT NULL DEFAULT 'none',
      reward_key text,
      reward_amount integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_inbox_receipts(
      message_id text NOT NULL REFERENCES public.ptitbac_inbox_messages(id) ON DELETE CASCADE,
      wallet_token text NOT NULL,
      read_at timestamptz,
      claimed_at timestamptz,
      PRIMARY KEY(message_id,wallet_token)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_inventory_items (
      wallet_token text NOT NULL,
      item_type text NOT NULL CHECK (item_type IN ('avatar','frame','tag')),
      item_id text NOT NULL,
      source text NOT NULL DEFAULT 'system',
      acquired_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (wallet_token, item_type, item_id)
    )
  `);

  // E8.1: l'ancien inventaire admin séparé est supprimé.
  // Si une ancienne ligne utilise déjà une clé officielle "type:id", elle est
  // transférée avant suppression. Les prototypes sans équivalent cosmétique
  // (coffres/jetons/badges de test) ne sont pas conservés.
  const legacyAdminItems = await pool.query(`
    SELECT to_regclass('public.ptitbac_player_items') AS table_name
  `);
  if (legacyAdminItems.rows?.[0]?.table_name) {
    await pool.query(`
      INSERT INTO public.ptitbac_inventory_items(wallet_token,item_type,item_id,source)
      SELECT wallet_token,
             split_part(item_key, ':', 1),
             substring(item_key FROM position(':' IN item_key) + 1),
             'legacy-admin'
        FROM public.ptitbac_player_items
       WHERE split_part(item_key, ':', 1) IN ('avatar','frame','tag')
         AND position(':' IN item_key) > 1
      ON CONFLICT(wallet_token,item_type,item_id) DO NOTHING
    `).catch(() => {});
    await pool.query(`DROP TABLE IF EXISTS public.ptitbac_player_items`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_inventory_equipped (
      wallet_token text PRIMARY KEY,
      avatar_id text NOT NULL DEFAULT '/a1.webp',
      frame_id text NOT NULL DEFAULT '',
      tag_id text NOT NULL DEFAULT 'tag_debutant',
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_progression (
      wallet_token text PRIMARY KEY,
      total_xp integer NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
      trophies integer NOT NULL DEFAULT 0 CHECK (trophies >= 0),
      completed_games integer NOT NULL DEFAULT 0 CHECK (completed_games >= 0),
      wins integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE public.ptitbac_progression
    ADD COLUMN IF NOT EXISTS trophies integer NOT NULL DEFAULT 0 CHECK (trophies >= 0)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ptitbac_progression_events (
      event_key text PRIMARY KEY,
      wallet_token text NOT NULL,
      room_code text,
      xp_delta integer NOT NULL CHECK (xp_delta >= 0),
      trophy_delta integer NOT NULL DEFAULT 0 CHECK (trophy_delta >= 0),
      before_total_xp integer NOT NULL CHECK (before_total_xp >= 0),
      after_total_xp integer NOT NULL CHECK (after_total_xp >= 0),
      before_trophies integer NOT NULL DEFAULT 0 CHECK (before_trophies >= 0),
      after_trophies integer NOT NULL DEFAULT 0 CHECK (after_trophies >= 0),
      before_level integer NOT NULL,
      after_level integer NOT NULL,
      rank integer NOT NULL DEFAULT 0,
      valid_answers integer NOT NULL DEFAULT 0,
      rounds integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE public.ptitbac_progression_events
    ADD COLUMN IF NOT EXISTS trophy_delta integer NOT NULL DEFAULT 0 CHECK (trophy_delta >= 0)
  `);
  await pool.query(`
    ALTER TABLE public.ptitbac_progression_events
    ADD COLUMN IF NOT EXISTS before_trophies integer NOT NULL DEFAULT 0 CHECK (before_trophies >= 0)
  `);
  await pool.query(`
    ALTER TABLE public.ptitbac_progression_events
    ADD COLUMN IF NOT EXISTS after_trophies integer NOT NULL DEFAULT 0 CHECK (after_trophies >= 0)
  `);

  // Indexes.
  const indexes = [
    `CREATE INDEX IF NOT EXISTS users_wallet_token_idx ON public.users(wallet_token)`,
    `CREATE INDEX IF NOT EXISTS users_friend_code_idx ON public.users(friend_code)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_accounts_email_idx ON public.ptitbac_accounts(email_normalized)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_auth_sessions_account_idx ON public.ptitbac_auth_sessions(account_id, expires_at DESC)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_auth_sessions_token_idx ON public.ptitbac_auth_sessions(token_hash)`,
    `CREATE INDEX IF NOT EXISTS friend_requests_sender_idx ON public.friend_requests(sender_id)`,
    `CREATE INDEX IF NOT EXISTS friend_requests_receiver_idx ON public.friend_requests(receiver_id)`,
    `CREATE INDEX IF NOT EXISTS friendships_user_idx ON public.friendships(user_id)`,
    `CREATE INDEX IF NOT EXISTS economy_transactions_user_idx ON public.economy_transactions(user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS economy_transactions_wallet_idx ON public.economy_transactions(wallet_token, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_active_rooms_updated_idx ON public.ptitbac_active_rooms(updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_messages_pair_created_idx ON public.ptitbac_messages(sender_id, receiver_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_messages_receiver_unread_idx ON public.ptitbac_messages(receiver_id, read_at, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_player_reports_target_idx ON public.ptitbac_player_reports(reported_friend_code, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_ptitbac_inbox_recipient ON public.ptitbac_inbox_messages(recipient_wallet_token, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_inventory_items_wallet_idx ON public.ptitbac_inventory_items(wallet_token, item_type, acquired_at)`,
    `CREATE INDEX IF NOT EXISTS ptitbac_progression_events_wallet_idx ON public.ptitbac_progression_events(wallet_token, created_at DESC)`
  ];
  for (const sql of indexes) await pool.query(sql);

  // Codes amis 5 chiffres : trigger unique pour tout le backend.
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.ptitbac_assign_friend_code_5()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      candidate text;
    BEGIN
      IF NEW.friend_code ~ '^[0-9]{5}$' THEN
        RETURN NEW;
      END IF;

      LOOP
        candidate := lpad((floor(random() * 100000))::int::text, 5, '0');
        EXIT WHEN NOT EXISTS (
          SELECT 1
          FROM public.users
          WHERE friend_code = candidate
            AND id IS DISTINCT FROM NEW.id
        );
      END LOOP;

      NEW.friend_code := candidate;
      RETURN NEW;
    END;
    $$;
  `);

  await pool.query(`DROP TRIGGER IF EXISTS ptitbac_friend_code_5_trigger ON public.users`);
  await pool.query(`
    CREATE TRIGGER ptitbac_friend_code_5_trigger
    BEFORE INSERT OR UPDATE OF friend_code
    ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.ptitbac_assign_friend_code_5()
  `);

  await pool.query(`
    UPDATE public.users
       SET friend_code = friend_code
     WHERE friend_code !~ '^[0-9]{5}$'
  `);
  // Schéma centralisé depuis inventory-service.js
  await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_inventory_reset_flags (
          wallet_token text PRIMARY KEY,
          avatars_only boolean NOT NULL DEFAULT false,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);

  // Schéma centralisé depuis quests-service.js
  await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_quest_claims(
          wallet_token text NOT NULL,
          rotation_key text NOT NULL,
          quest_id text NOT NULL,
          xp_reward integer NOT NULL DEFAULT 0 CHECK(xp_reward >= 0),
          claimed_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(wallet_token,rotation_key,quest_id)
        )
      `);
  await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_quest_chest_claims(
          wallet_token text NOT NULL,
          cycle_no integer NOT NULL CHECK(cycle_no >= 1),
          reward_result jsonb NOT NULL DEFAULT '{}'::jsonb,
          claimed_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(wallet_token,cycle_no)
        )
      `);
  await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_player_quests(
          wallet_token text NOT NULL,
          rotation_key text NOT NULL,
          quest_id text NOT NULL,
          starts_at_ms bigint NOT NULL,
          slot smallint NOT NULL DEFAULT 0 CHECK(slot >= 0 AND slot <= 2),
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(wallet_token,rotation_key,quest_id)
        )
      `);
  await pool.query(`
        CREATE INDEX IF NOT EXISTS ptitbac_quest_claims_wallet_idx
          ON public.ptitbac_quest_claims(wallet_token,claimed_at DESC)
      `);
  await pool.query(`
        CREATE INDEX IF NOT EXISTS ptitbac_player_quests_wallet_idx
          ON public.ptitbac_player_quests(wallet_token,starts_at_ms DESC,slot ASC)
      `);

  // Schéma centralisé depuis shop-service.js
  await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_shop_offers(
          id text PRIMARY KEY,
          item_key text NOT NULL,
          offer_mode text NOT NULL DEFAULT 'single',
          item_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
          display_name text NOT NULL,
          currency text NOT NULL CHECK(currency IN ('coins','gems')),
          base_price integer NOT NULL CHECK(base_price >= 1),
          discount_percent integer NOT NULL DEFAULT 0 CHECK(discount_percent BETWEEN 0 AND 90),
          block_no integer NOT NULL CHECK(block_no BETWEEN 1 AND 3),
          position_no integer NOT NULL CHECK(position_no BETWEEN 1 AND 4),
          badge text NOT NULL DEFAULT '',
          active boolean NOT NULL DEFAULT true,
          starts_at timestamptz NOT NULL DEFAULT now(),
          ends_at timestamptz NOT NULL,
          created_by_wallet_token text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
  await pool.query(`ALTER TABLE public.ptitbac_shop_offers ADD COLUMN IF NOT EXISTS offer_mode text NOT NULL DEFAULT 'single'`);
  await pool.query(`ALTER TABLE public.ptitbac_shop_offers ADD COLUMN IF NOT EXISTS item_keys jsonb NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`
        UPDATE public.ptitbac_shop_offers
           SET item_keys=jsonb_build_array(item_key)
         WHERE item_keys IS NULL OR jsonb_array_length(item_keys)=0
      `);
  await pool.query(`
        UPDATE public.ptitbac_shop_offers
           SET offer_mode='single'
         WHERE offer_mode NOT IN ('single','pack','choice')
      `);
  await pool.query(`
        CREATE INDEX IF NOT EXISTS ptitbac_shop_offers_active_slot_idx
          ON public.ptitbac_shop_offers(active,block_no,position_no,ends_at)
      `);
  await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_shop_purchases(
          id text PRIMARY KEY,
          wallet_token text NOT NULL,
          offer_id text NOT NULL,
          item_key text NOT NULL,
          selected_item_key text,
          purchased_item_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
          currency text NOT NULL,
          price_paid integer NOT NULL,
          request_id text NOT NULL,
          purchased_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(wallet_token,request_id)
        )
      `);
  await pool.query(`ALTER TABLE public.ptitbac_shop_purchases ADD COLUMN IF NOT EXISTS selected_item_key text`);
  await pool.query(`ALTER TABLE public.ptitbac_shop_purchases ADD COLUMN IF NOT EXISTS purchased_item_keys jsonb NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`
        CREATE INDEX IF NOT EXISTS ptitbac_shop_purchases_wallet_idx
          ON public.ptitbac_shop_purchases(wallet_token,purchased_at DESC)
      `);
  await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_shop_daily_rotations(
          rotation_key text PRIMARY KEY,
          reward jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
  await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_shop_daily_claims(
          wallet_token text NOT NULL,
          rotation_key text NOT NULL,
          result jsonb NOT NULL,
          claimed_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(wallet_token,rotation_key)
        )
      `);
  await pool.query(`
        UPDATE public.ptitbac_shop_offers
           SET active=false,updated_at=now()
         WHERE active=true
           AND block_no=3
           AND position_no IN (3,4)
      `);

  // Schéma centralisé depuis reward-chests-service.js
  await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_reward_claims(
          wallet_token text NOT NULL,
          claim_key text NOT NULL,
          chest_type text NOT NULL,
          star_state text NOT NULL DEFAULT '',
          result jsonb NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(wallet_token,claim_key)
        )
      `);

  // Schéma centralisé depuis level-rewards-service.js
  await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_level_reward_claims(
          wallet_token text NOT NULL,
          level integer NOT NULL CHECK(level BETWEEN 1 AND 50),
          reward_type text NOT NULL,
          reward_result jsonb NOT NULL DEFAULT '{}'::jsonb,
          claimed_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(wallet_token,level)
        )
      `);
  await pool.query(`
        CREATE TABLE IF NOT EXISTS public.ptitbac_level_unlimited_lives(
          wallet_token text PRIMARY KEY,
          expires_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
  await pool.query(`
        CREATE INDEX IF NOT EXISTS ptitbac_level_reward_claims_wallet_idx
          ON public.ptitbac_level_reward_claims(wallet_token, level)
      `);

  // Groupes d'amis persistants, indépendants des salons de jeu.
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ptitbac_parties (
    id uuid PRIMARY KEY,
    leader_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    room_code text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ptitbac_party_members (
    user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    party_id uuid NOT NULL REFERENCES public.ptitbac_parties(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ptitbac_party_members_party_idx
    ON public.ptitbac_party_members(party_id)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.ptitbac_party_invites (
    party_id uuid NOT NULL REFERENCES public.ptitbac_parties(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
    PRIMARY KEY(party_id, user_id)
  )`);

}

module.exports = {
  runDatabaseMigrations
};
