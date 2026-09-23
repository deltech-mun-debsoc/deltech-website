# Trying online committees locally

This walks through every online-committee feature on your own machine: the
secretariat opening a session and assigning a chair, roll call, the floor
(speakers lists, motions, voting), chat, floor video and the voice lobbies. It
takes about 15 minutes to set up and 25 to walk through.

Everything runs locally. Nothing here touches staging, production or AWS.

## What you need

- Docker Desktop, running.
- Node 20 or later.
- A camera and microphone. Headphones help, because several browser windows on
  one machine will otherwise echo each other.
- Four separate browser sessions. Chrome's incognito windows all share one
  session, so use **different Chrome profiles**, or mix Chrome profiles with
  Firefox and Safari.

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
| `secretariat@demo.local` | the secretariat: opens and closes sessions, assigns chairs |
| `chair@demo.local` | the chair, not yet assigned to any committee |
| `france@demo.local` | France |
| `india@demo.local` | India |
| `kenya@demo.local` | Kenya |
| `brazil@demo.local` | Brazil |

The committee is the UN Security Council. Japan is deliberately left
unallotted, and the chair is deliberately not on the committee yet: assigning
them is your first step.

Start the video server, then the app:

```bash
docker compose -f dev/livekit.yml up -d
npm run dev
```

Open http://localhost:3000. Use `localhost`, not your machine's IP address:
browsers only allow camera and microphone access on `localhost` or HTTPS.

## 2. Sign in as four people

In each browser session, go to `/signin`, open the **Password** tab, and sign in:

- **Session A: the secretariat.** `secretariat@demo.local`, then go to **/admin/sessions**.
- **Session B: the chair.** `chair@demo.local`. You land on **/chair** by yourself.
- **Session C: France.** `france@demo.local`, then go to **/dashboard/committee**.
  You can also get there from the dashboard's "Open committee chat" button.
- **Session D: India.** `india@demo.local`, then go to **/dashboard/committee**.

Keep the windows visible if you can. Most of what follows is watching one
window react to another.

## 3. Walk through it

Each step says what to do, then what you should see. If what you see differs,
note the step number.

**The secretariat opens the committee**

1. **Chair:** look at the page.
   → *You are not chairing a committee yet.* There is no admin sidebar and no
   link to anything else. Try typing **/admin** or **/dashboard** into the
   address bar: you are sent back to /chair.
2. **Secretariat:** in *Committee sessions*, try adding `france@demo.local` as a
   chair.
   → Refused: that address belongs to a delegate's account.
3. **Secretariat:** add `chair@demo.local`.
   → Demo Chair is listed under Chairs, and **Open session** becomes
   available. Within 30 seconds the chair's page changes to *Waiting for the
   session to open*, without a reload.
4. **Secretariat:** press **Open session**.
   → The card shows *In session since* and *0 of 5 present*. The chair's page
   switches to roll call, the floor and chat by itself, and France and India
   get their video and floor panels.

**Roll call**

5. **Chair:** mark France *Present and voting*, and India and Kenya *Present*.
   → The count shows *3 of 5 present*, and a quorum badge appears. Japan's
   empty seat still counts toward the 5. The secretariat's card shows the same
   count after a reload.

**The floor**

6. **France:** press **Add me to the list**.
   → France appears on the General Speakers' List in the chair's, France's
   and India's windows, without a reload.
7. **Chair:** press **Next speaker**.
   → France is shown as speaking and the clock counts down. France sees a
   **Go live** button. India does not.
8. **France:** press **Go live** and allow the camera and microphone.
   → France's video appears for the chair and for India.
9. **Chair:** press **End**.
   → France's video disappears for everyone, and France's camera light goes
   off. The server withdrew the permission; France did nothing.

**Chat**

10. **France:** in Committee chat, choose **Direct**, pick India, and send a
    message.
    → India sees it. The chair sees it under **All direct messages**. A Kenya
    session, if you open one, would not.
11. **Chair:** press **Remove** on that message.
    → It disappears from France's and India's screens.
12. **Chair:** turn on **Hold direct messages**, then have France send India
    another direct message.
    → France sees it marked *Waiting for the dais*, and India does not see it.
    Then **Chair:** press **Approve** on it.
    → India now sees it.

**Voice lobbies**

13. **India:** in the Channels list, click **Lobby 2** and allow the microphone.
    → India is listed under Lobby 2 in every window's channel list, including
    the chair's.
14. **France:** click **Lobby 2**.
    → France and India can hear each other. Use headphones, or mute one side.
15. **France:** click **Lobby 3**, then **Lobby 2**, then **Lobby 3** again,
    quickly.
    → Each switch should feel close to instant, with no second microphone
    prompt.
16. **Chair:** click **Lobby 3**.
    → The chair joins France, and both are listed there. This is the chair
    dropping in on a caucus.
17. **India**, while still in a lobby: **Chair**, add India to the list and
    press **Next speaker**.
    → India is taken back to the floor automatically and sees **Go live**.

**Motions and voting**

18. **France:** propose a *Moderated caucus* with a topic, 5 minutes in total
    and 60 seconds per speaker.
    → The chair sees it under Motions on the floor.
19. **Chair:** press **Put to a vote**. France and India both vote *Yes*.
    → While the vote is open, delegates see only their own ballot and how many
    have voted. The chair sees the running count.
    → On this procedural vote, **Abstain** is disabled for everyone.
20. **Chair:** press **Close vote**, then **Start caucus**.
    → The caucus clock runs, and the caucus has its own speakers list.
21. **Chair:** end the caucus, then open a **substantive** vote with a simple
    majority.
    → India, marked *Present*, may abstain. France, marked *Present and
    voting*, cannot. That is the rule, not a bug.

**Ending**

22. **Secretariat:** press **Remove** next to Demo Chair, and confirm.
    → The chair's page changes to *You are not chairing a committee yet*, and
    if the chair was on video or in a lobby, they are disconnected at once.
23. **Secretariat:** add `chair@demo.local` again, then press **Close session**
    and confirm.
    → Everyone still on video or in a lobby is disconnected. The chair's page
    goes back to *Waiting for the session to open*. France and India see *The
    floor opens when the secretariat opens the session.*

## 4. What to send back

- Anything that did not match the arrow for a step, with the step number.
- How switching between lobbies felt in step 15: instant, noticeable, or slow.
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
  - the secretariat has not opened the session yet (video exists only during a
    session).
- **The chair sees "not chairing" after being added.** The page checks every
  30 seconds; reload it to see the change at once.
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
