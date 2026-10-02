import { Hono } from "hono";
import { getAccount, type AccountRow } from "../db/accounts";
import { performCheckin, type CheckinResult } from "../checkin/run";
import { getSettings, updateSettings, CheckinSettingsError } from "../checkin/settings";
import { readJson } from "../lib/json";
import { truncateLog } from "../lib/log";
import { requireOrigin, requireOwner } from "./guard";
import type { AppEnv } from "../types";

export const checkin = new Hono<AppEnv>();

checkin.use("*", requireOwner);

interface SettingsBody {
  enabled?: boolean;
  timezone?: string;
  weekday_times?: string[];
  weekend_times?: string[];
}

function serializeSettings(settings: Awaited<ReturnType<typeof getSettings>>) {
  return {
    enabled: settings.enabled,
    timezone: settings.timezone,
    weekday_times: settings.weekday_times,
    weekend_times: settings.weekend_times,
    next_run_at: settings.next_run_at,
    lease_until: settings.lease_until,
    status: settings.status,
    last_message: settings.last_message,
    updated_at: settings.updated_at
  };
}

checkin.get("/settings", async (c) => {
  return c.json(serializeSettings(await getSettings(c.env)));
});

checkin.patch("/settings", requireOrigin, async (c) => {
  const body = await readJson<SettingsBody>(c);
  try {
    const updated = await updateSettings(c.env, {
      enabled: body.enabled,
      timezone: body.timezone,
      weekday_times: body.weekday_times,
      weekend_times: body.weekend_times
    });
    return c.json(serializeSettings(updated));
  } catch (err) {
    if (err instanceof CheckinSettingsError) {
      return c.json({ error: err.code, message: err.message }, err.status as 400);
    }
    throw err;
  }
});

checkin.post("/test", requireOrigin, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM accounts WHERE enabled=1 ORDER BY created_at ASC, id ASC"
  ).all<AccountRow>();
  const accounts = results ?? [];
  const items: CheckinResult[] = [];
  let success = 0;
  for (const row of accounts) {
    const account = (await getAccount(c.env, row.id)) ?? row;
    try {
      const result = await performCheckin(c.env, account, null, { manual: true });
      if (result.ok) success += 1;
      items.push(result);
    } catch (err) {
      items.push({
        account_id: account.id,
        ok: false,
        status: "retry",
        slot: null,
        status_code: null,
        message: truncateLog(err instanceof Error ? err.message : "manual_checkin_failed")
      });
    }
  }
  return c.json({ total: accounts.length, success, items });
});
