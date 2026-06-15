# Pickup — "transfer4cars" trigger — 2026-06-10

> Lees dit BIJ EERSTE BERICHT als user "transfer4cars" zegt. Daarna direct doorpakken, niet eerst lange-uitlegrondje.

## Waar we waren

**Doel**: admin-dashboard koppelen aan echte GA4-data, prio = live veiling-tracking (niet bevestigd, vraag indien onduidelijk).

**State**:
- gcloud-account: `webt4c@gmail.com` (active op project `transfer4cars-1781053588`)
- Service account klaar: `t4c-analytics-reader@transfer4cars-1781053588.iam.gserviceaccount.com`
- GA4 property: `540991999` (measurement-ID `G-ECSBWCG10K`, al actief in `gtag('config',…)` op sites)
- Admin dashboard pm2-proc: `admin-dashboard` uit `/opt/atx-pipeline` (admin-dashboard.js)
- **Blokker**: ADC-scopes onvoldoende → 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` op Admin API. Mist `analytics.readonly` + `analytics.manage.users`.

## Volgende stap = ADC re-auth uitvoeren

Run het 1-regel commando (in losse shell of binnen Claude — beide ok nu tmux weg is):

```bash
gcloud auth application-default login --scopes=openid,email,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/sqlservice.login,https://www.googleapis.com/auth/analytics.readonly,https://www.googleapis.com/auth/analytics.manage.users
```

User logt in met `webt4c@gmail.com` in browser, plakt verificatiecode terug.

**Let op WARNING van gcloud**: scope `analytics.readonly` wordt "soon" geblokkeerd voor de default client. Als user "Deze app is geblokkeerd" krijgt → switch naar eigen OAuth-client of SA-impersonation. Maar EERST gewoon proberen, mogelijk werkt het nog.

## Verifier na ADC-refresh

```bash
TOKEN=$(gcloud auth application-default print-access-token)
curl -sS -o /tmp/ga-test.json -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  "https://analyticsadmin.googleapis.com/v1beta/properties/540991999"
cat /tmp/ga-test.json
```

Bij HTTP 200 + property-details → scopes goed, door naar SA-koppeling.

## Daarna: SA toevoegen aan GA4 property

Endpoint: `https://analyticsadmin.googleapis.com/v1alpha/properties/540991999/accessBindings`

Body:
```json
{
  "user": "t4c-analytics-reader@transfer4cars-1781053588.iam.gserviceaccount.com",
  "roles": ["predefinedRoles/viewer"]
}
```

(Of `predefinedRoles/analyst` als rapportages-write nodig.)

## Daarna: admin-dashboard.js wijzigen

- Auth via SA-impersonation OF SA-key (kies o.b.v. wat al in /opt/atx-pipeline staat)
- GA4 Data API call: `properties.runReport` voor live tegels
- Bouw eerst live veiling-tracking widget (auctions/sessions/active-bidders per property), tenzij user andere prio noemt

## Wat NIET doen (recente lessen)

- ❌ Geen tmux-introductie meer (zie `feedback_no_auto_tmux_in_bashrc.md`). User vond tmux + mouse-mode "kanker troep". Werk met gewone ssh-shells.
- ❌ Geen ingewikkelde HTML-pagina's op live T4C-domain bouwen voor copy-paste workarounds — gewoon URL in chat, user handelt het af.
- ❌ Niet impulsief Tailscale/Cloudflared/SSH-config aanpassen. Tunnel-resilience-WIP staat geparkeerd.

## Cleanup state bij pickup

Background gcloud-login-process van vorige sessie is gekild + FIFO opgeruimd vóór tmux kill-server. Als `/tmp/gcloud-stdin` of `/tmp/gcloud-stdout` nog bestaat: gewoon rm en opnieuw beginnen.
