# Trying online committees locally

This walks through every online-committee feature on your own machine: roll
call, the floor (speakers lists, motions, voting), chat, floor video and the
voice lobbies. It takes about 15 minutes to set up and 20 to walk through.

Everything runs locally. Nothing here touches staging, production or AWS.

## What you need

- Docker Desktop, running.
- Node 20 or later.
- A camera and microphone. Headphones help, because several browser windows on
  one machine will otherwise echo each other.
- Three separate browser sessions. Chrome's incognito windows all share one
  session, so use **different Chrome profiles**, or one each of Chrome, Firefox
  and Safari.

## 1. Set up

Run these from this repository (`~/Project/mun-platform-committees`), on the
branch that carries the work you are testing:

```bash
cd ~/Project/mun-platform-committees
git fetch origin
git checkout feat/online-committees-phase5
npm ci
```

Start a fresh local database. It uses port 5433, so it will not collide with
anything on 5432:

```bash
docker run -d --name mun-local -e POSTGRES_PASSWORD=local -e POSTGRES_DB=mun_local -p 5433:5432 postgres:17
```

Create `.env.local`. It is gitignored. Every database URL here points at your
machine:

```bash
cat > .env.local <<EOF
DATABASE_URL=postgresql://postgres:local@localhost:5433/mun_local
DIRECT_URL=postgresql://postgres:local@localhost:5433/mun_local
AUTH_SECRET=$(openssl rand -base64 32)
NEXT_PUBLIC_APP_URL=http://localhost:3000
EMAIL_FROM=Local Dev <dev@localhost>
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret-devsecret-devsecret-devsecret
EOF
```

Apply the migrations, then seed the demo committee. Choose any password of 8 or
more characters. All five demo accounts will use it:

```bash
DIRECT_URL=postgresql://postgres:local@localhost:5433/mun_local npx prisma migrate deploy
DEMO_PASSWORD='choose-one' DATABASE_URL=postgresql://postgres:local@localhost:5433/mun_local npx tsx scripts/seed-committee-demo.ts
```

The seed prints the accounts:

| Account | Plays |
|---|---|
| `chair@demo.local` | the dais |
| `france@demo.local` | France |
| `india@demo.local` | India |
| `kenya@demo.local` | Kenya |
| `brazil@demo.local` | Brazil |

The committee is the UN Security Council. Japan is deliberately left
unallotted.

Start the video server, then the app:

```bash
docker compose -f dev/livekit.yml up -d
npm run dev
```

Open http://localhost:3000. Use `localhost`, not your machine's IP address:
browsers only allow camera and microphone access on `localhost` or HTTPS.

## 2. Sign in as three people

In each browser session, go to `/signin`, open the **Password** tab, and sign in:

- **Session A: the chair.** Sign in as `chair@demo.local` and go to **/admin/roll-call**.
- **Session B: France.** Sign in as `france@demo.local` and go to **/dashboard/committee**.
  You can also get there from the dashboard's "Open committee chat" button.
- **Session C: India.** Sign in as `india@demo.local` and go to **/dashboard/committee**.

Keep all three windows visible if you can. Most of what follows is watching one
window react to another.

## 3. Walk through it

Each step says what to do, then what you should see. If what you see differs,
note the step number.

**Roll call**

1. **Chair:** make sure the committee is set to *UN Security Council*, press
   **Open roll call**, then mark France *Present and voting*, and India and
   Kenya *Present*.
   → The count shows *3 of 5 present*, and a quorum badge appears. Japan's
   empty seat still counts toward the 5.

**The floor**

2. **France:** press **Add me to the list**.
   → France appears on the General Speakers' List in all three windows,
   without a reload.
3. **Chair:** press **Next speaker**.
   → France is shown as speaking and the clock counts down. France sees a
   **Go live** button. India does not.
4. **France:** press **Go live** and allow the camera and microphone.
   → France's video appears for the chair and for India.
5. **Chair:** press **End**.
   → France's video disappears for everyone, and France's camera light goes
   off. The server withdrew the permission; France did nothing.

**Chat**

6. **France:** in Committee chat, choose **Direct**, pick India, and send a
   message.
   → India sees it. The chair sees it under **All direct messages**. A Kenya
   session, if you open one, would not.
7. **Chair:** press **Remove** on that message.
   → It disappears from France's and India's screens.
8. **Chair:** turn on **Hold direct messages**, then have France send India
   another direct message.
   → France sees it marked *Waiting for the dais*, and India does not see it.
   Then **Chair:** press **Approve** on it.
   → India now sees it.

**Voice lobbies**

9. **India:** in the Channels list, click **Lobby 2** and allow the microphone.
   → India is listed under Lobby 2 in every window's channel list, including
   the chair's.
10. **France:** click **Lobby 2**.
    → France and India can hear each other. Use headphones, or mute one side.
11. **France:** click **Lobby 3**, then **Lobby 2**, then **Lobby 3** again,
    quickly.
    → Each switch should feel close to instant, with no second microphone
    prompt.
12. **Chair:** click **Lobby 3**.
    → The chair joins France, and both are listed there. This is the chair
    dropping in on a caucus.
13. **India**, while still in a lobby: **Chair**, add India to the list and
    press **Next speaker**.
    → India is taken back to the floor automatically and sees **Go live**.

**Motions and voting**

14. **France:** propose a *Moderated caucus* with a topic, 5 minutes in total
    and 60 seconds per speaker.
    → The chair sees it under Motions on the floor.
15. **Chair:** press **Put to a vote**. France and India both vote *Yes*.
    → While the vote is open, delegates see only their own ballot and how many
    have voted. The chair sees the running count.
    → On this procedural vote, **Abstain** is disabled for everyone.
16. **Chair:** press **Close vote**, then **Start caucus**.
    → The caucus clock runs, and the caucus has its own speakers list.
17. **Chair:** end the caucus, then open a **substantive** vote with a simple
    majority.
    → India, marked *Present*, may abstain. France, marked *Present and
    voting*, cannot. That is the rule, not a bug.

## 4. What to send back

- Anything that did not match the arrow for a step, with the step number.
- How switching between lobbies felt in step 11: instant, noticeable, or slow.
- Any error text shown on the page.

If you want to see what the dais's record holds, this lists who was in which
lobby and when:

```bash
docker exec mun-local psql -U postgres -d mun_local -c 'select slot, identity, "joinedAt", "leftAt" from "VoiceChannelVisit" order by "joinedAt";'
```

## Troubleshooting

- **The server log shows `JWTSessionError: no matching decryption secret`.**
  Your browser has a login cookie from an earlier local run that used a
  different `AUTH_SECRET`. You are simply signed out. Sign in again, or clear
  the site data for `localhost`.
- **"Could not connect to video."** LiveKit is not running. Run
  `docker compose -f dev/livekit.yml up -d`.
- **The video panel is missing entirely.** Two things can cause this:
  - the `LIVEKIT_*` lines are missing from `.env.local` (restart
    `npm run dev` after adding them);
  - the chair has not opened roll call yet (video exists only during a session).
- **Channel lists only update every 20 seconds.** LiveKit's webhooks are not
  reaching the app. They go to `host.docker.internal:3000`, so the app must be
  on port 3000.
- **No sound.** Press **Turn on sound**. Browsers block audio until you
  interact with the page.
- **Echo or howling.** Several windows on one machine are hearing each other.
  Use headphones, or mute all but one.
- **A port is in use.** 3000 (the app), 5433 (the database) and 7880–7882
  (LiveKit) must be free.

## Cleaning up

```bash
docker compose -f dev/livekit.yml down
docker rm -f mun-local
rm .env.local
```
