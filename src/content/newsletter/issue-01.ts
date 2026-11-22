export type Fact = { value: string; label: string };
export type Numbered = { n: string; title: string; text: string };
export type Bar = { label: string; value: number; display: string; tone: "ink" | "red" | "rose" };

export type Block =
  | { type: "facts"; title: string; items: Fact[] }
  | { type: "row"; cols: Block[][]; widths?: string }
  | { type: "h"; text: string; rule?: "under" | "side" }
  | { type: "sub"; text: string }
  | { type: "p"; text: string }
  | { type: "label"; text: string }
  | { type: "timeline"; stacked?: boolean; items: { when: string; text: string }[] }
  | { type: "devs"; items: { icon: "shield" | "handshake" | "leaf" | "globe"; title: string; text: string }[] }
  | { type: "numbered"; style: "big" | "small"; items: Numbered[] }
  | { type: "bars"; title: string; rows: Bar[]; note?: string; boxed?: boolean }
  | { type: "glance"; title: string; items: Fact[] }
  | { type: "figure"; label: string; src: string; width: number; height: number; alt: string; labels: string[]; caption: string }
  | { type: "callout"; title: string; text: string }
  | { type: "learned"; items: [string, string, string] };

export type Article = {
  slug: string;
  page: number;
  desk: string;
  date: string;
  kicker?: string;
  headline: string;
  dek: string;
  blocks: Block[];
  byline: string;
  sources: string;
};

export const ISSUE = {
  title: "The DelTech Times",
  masthead: {
    the: "The",
    name: "DELTECH TIMES",
    tagline: "A JOINT PUBLICATION OF DELTECH MUN AND DEBSOC",
    meta: ["ISSUE 01", "THE WORLD THIS WEEK", "2026"],
    banner: "BEYOND THE HEADLINES",
  },
  cover: {
    page: "/newsletter/issue-01/pages/page-1.webp",
    thumb: "/newsletter/issue-01/img/cover-thumb.webp",
    cartoons: "/newsletter/issue-01/img/cover-cartoons.webp",
    cartoonsWidth: 1462,
    cartoonsHeight: 1338,
    cartoonsAlt:
      "Five editorial cartoons. Three place settings labelled CHINA (chopsticks), RUSSIA (knife and fork) and USA (an empty plate); figures blown about in a storm around a COP31 TÜRKIYE banner; two figures skiing down a crack splitting a map of FRANCE; Brazil's president raised as winner in a boxing ring over fallen opponents, one beside a US flag; and a black-and-white cartoon of officials on lion-carved thrones watched by men carrying an I-T SQUAD briefcase.",
  },
  pdf: "/newsletter/issue-01/deltech-times-issue-01.pdf",
  pageImage: (page: number) => `/newsletter/issue-01/pages/page-${page}.webp`,
  note: {
    page: 7,
    label: "THE DELTECH TIMES",
    logo: "/newsletter/issue-01/img/deltech-mun-logo.webp",
    logoAlt: "DelTech MUN logo",
    title: "Every story deserves to be told.",
    subtitle: "A Note from the Content Team",
    salutation: "Dear Readers,",
    paragraphs: [
      "In a world that never stops making headlines, taking a moment to understand the stories behind them matters more than ever.",
      "With Beyond the Headlines, we set out to create something beyond a collection of news updates. Our aim was to bring together perspectives, unpack developments and explore the larger narratives shaping the world around us.",
      "Every page has been an attempt to look a little closer, ask a little more and go beyond what first meets the eye. From understanding complex global developments to recognising the stories that often go unnoticed, this edition has been a journey of curiosity, research and storytelling.\nWe hope these pages have encouraged you to question what you read, look at familiar issues from new perspectives and remain curious about a world that is constantly evolving.",
      "Thank you for taking the time to read, reflect and explore these stories with us. After all, a newspaper is not just about the stories it tells, but also the conversations it leaves behind.\nAs we bring the next edition , we leave you with a simple thought: Stay curious. Stay informed. Never stop looking beyond the headlines.",
    ],
    signoff: ["With gratitude,", "The Content Team", "DelTech MUN 2026"],
  },
};

export const ARTICLES: Article[] = [
  {
    slug: "trilateral-summit",
    page: 2,
    desk: "GLOBAL AFFAIRS · SPECIAL REPORT",
    date: "Wednesday, November 19, 2026",
    kicker: "TRILATERAL SUMMIT 2026 – KYLIN VILLA, SHENZHEN",
    headline: "Three Superpowers, One Table: Trump, Putin and Xi Hold Historic Summit",
    dek: "An analysis of the first-ever trilateral meeting between the leaders of Russia, the United States and China, and its implications for global peace, nuclear security and international relations.",
    blocks: [
      {
        type: "row",
        widths: "lg:grid-cols-[1.9fr_1fr]",
        cols: [
          [
            {
              type: "figure",
              label: "ILLUSTRATION",
              src: "/newsletter/issue-01/img/summit-table.webp",
              width: 960,
              height: 305,
              alt: "Illustration of an oval table with three chairs and place cards for China, Russia and the United States, with the three countries' flags in the middle.",
              labels: ["CHINA", "RUSSIA", "UNITED STATES"],
              caption: "Putin, Xi and Trump met at a round table at Kylin Villa, Shenzhen, on 19 November, on the sidelines of the APEC summit hosted by China.",
            },
          ],
          [
            {
              type: "glance",
              title: "AT A GLANCE",
              items: [
                { value: "1st", label: "meeting of the three countries’ leaders together" },
                { value: "4", label: "points in the joint “Declaration Towards Peace”" },
              ],
            },
            {
              type: "bars",
              title: "Estimated nuclear warheads",
              rows: [
                { label: "USA", value: 5000, display: "5,000+", tone: "ink" },
                { label: "Russia", value: 5000, display: "5,000+", tone: "ink" },
                { label: "China", value: 600, display: "600+", tone: "red" },
              ],
              note: "Lower-bound estimates as reported by AP. New START, the last US–Russia arms pact, expired in February 2026.",
            },
          ],
        ],
      },
      {
        type: "row",
        widths: "lg:grid-cols-3",
        cols: [
          [
            { type: "h", text: "The Bigger Picture", rule: "under" },
            {
              type: "p",
              text: "The United States, China and Russia are the world's three largest nuclear powers and permanent members of the UN Security Council. Until this, their leaders had never met together as a trio.",
            },
            {
              type: "p",
              text: "The meeting came at a tense moment. The US is at war with Iran, and attacks in the Strait of Hormuz have pushed up energy prices. Russia’s war in Ukraine continues. Trump had said for weeks that he wanted to discuss the war and denuclearisation with both leaders, and China, as this year's APEC host, brought them together in Shenzhen.",
            },
            { type: "label", text: "THE ROAD TO SHENZHEN" },
            {
              type: "timeline",
              items: [
                { when: "FEBRUARY 2026:", text: "New START, the last US–Russia nuclear arms pact, expired." },
                { when: "NOVEMBER 2026:", text: "The leaders confirm the first-ever three-way meeting at Kylin Villa with a four-point joint declaration." },
              ],
            },
          ],
          [
            { type: "h", text: "The Historic Summit", rule: "under" },
            {
              type: "p",
              text: "On 19 November, Xi hosted Trump and Putin at Kylin Villa for talks the Chinese state media said lasted about 90 minutes. Beforehand, Trump had separate meetings with Xi (about an hour) and Putin (about 40 minutes).",
            },
            { type: "p", text: "**Donald Trump:** “*We are really making history.*”" },
            { type: "p", text: "Said the three since “joint responsibility” for international peace." },
            { type: "p", text: "**Xi Jinping:** Called the meeting a “*groundbreaking event.*”" },
            { type: "label", text: "KEY DEVELOPMENTS" },
            {
              type: "devs",
              items: [
                { icon: "shield", title: "Nuclear Security:", text: "Dialogue to reduce nuclear risks and prevent proliferation; nuclear war “must never be fought.”" },
                { icon: "handshake", title: "UN Reform:", text: "Commitment to reform the UN so it responds more effectively to global challenges." },
                { icon: "leaf", title: "Energy Cooperation:", text: "Pledge to increase production and supply of reliable, affordable energy." },
                { icon: "globe", title: "International Relations:", text: "Commitment to maintaining a stronger, stable and fair international security." },
              ],
            },
          ],
          [
            { type: "h", text: "Global Impact", rule: "under" },
            {
              type: "p",
              text: "[[International politics:]] The talks reopen top-level contact among the three powers: Ukraine and its European allies, absent from the table, have voiced concern about being sidelined.",
            },
            {
              type: "p",
              text: "[[Energy markets:]] The full pledge targets a market strained by attacks in the Strait of Hormuz. No sudden or destabilising turns were announced.",
            },
            {
              type: "p",
              text: "[[Nuclear security:]] Dialogue is a first step, not a treaty. China’s far smaller arsenal gives Beijing an incentive to accept limits, while Trump seeks a new deal that includes China.",
            },
            {
              type: "p",
              text: "[[Major-power relations:]] The declaration also backed immunity for state officials and warned the International Criminal Court, which has a warrant out for Putin, against abusing its jurisdiction.",
            },
            { type: "h", text: "Unresolved Challenges" },
            {
              type: "p",
              text: "The summit produced no settlement on the Russia–Ukraine war or the Iran conflict. The declaration did not mention either war, though Trump said he was also on his own in one-on-one talks with Putin. There was also no undertaking to end the Ukraine war, and renewed calls for talks with the US–China trade truce due to expire by 10 January 2027.",
            },
          ],
        ],
      },
      {
        type: "learned",
        items: [
          "Cooperation among major powers can influence global stability.",
          "Nuclear security remains a shared international responsibility.",
          "Diplomatic agreements do not necessarily resolve ongoing conflicts.",
        ],
      },
    ],
    byline: "By Anjali • Current Affairs",
    sources: "Sources: AP, CBS News, CNBC, Al Jazeera, Fox News; declaration text via Xinhua and the Kremlin.",
  },
  {
    slug: "jio-ipo",
    page: 3,
    desk: "ECONOMY",
    date: "Wednesday, November 18, 2026",
    kicker: "MARKET & BUSINESS",
    headline: "Jio’s record IPO puts India’s market in focus",
    dek: "A ₹30,188-crore debut drew unprecedented demand. Now investors weigh growth and debt reduction against valuation and a coming share unlock.",
    blocks: [
      {
        type: "facts",
        title: "KEY FACTS",
        items: [
          { value: "₹30,188 cr", label: "Raised in India’s largest IPO" },
          { value: "22.21×", label: "Subscribed, 1,388 cr applications" },
          { value: "₹1,387*", label: "About 24% above the ₹1,119 issue price" },
          { value: "Nov 24", label: "Half of anchor shares eligible to trade" },
        ],
      },
      {
        type: "row",
        widths: "lg:grid-cols-3",
        cols: [
          [
            { type: "h", text: "The bigger picture", rule: "under" },
            { type: "sub", text: "A landmark listing" },
            {
              type: "p",
              text: "The offer crossed full subscription crore in a 100% fresh issue and began trading on BSE and NSE on October 28. Shares opened at ₹1,358, a 21.4% premium to the issue price.",
            },
            { type: "sub", text: "Demand at scale" },
            {
              type: "p",
              text: "The offer crossed full subscription in about 100 minutes. It closed 22.21× subscribed, with nearly 1.39 crore applications.",
            },
            { type: "sub", text: "A high-value debut" },
            {
              type: "p",
              text: "The IPO valued Jio at ₹10.3 lakh crore. By Nov 18, its market cap was ₹12.78 lakh crore, second only to Reliance Industries.",
            },
          ],
          [
            { type: "h", text: "From issue to market", rule: "under" },
            {
              type: "bars",
              title: "SHARE PRICE (₹)",
              boxed: true,
              rows: [
                { label: "Issue", value: 1119, display: "1,119", tone: "ink" },
                { label: "Listing", value: 1358, display: "1,358", tone: "red" },
                { label: "Nov 18*", value: 1387, display: "1,387", tone: "rose" },
              ],
              note: "*November 18 closing price; market prices move.",
            },
            { type: "sub", text: "Where the proceeds go" },
            {
              type: "p",
              text: "About ₹27,500 crore is earmarked to prepay borrowings at operating arm Reliance Jio Infocomm, supporting lower interest costs and cash flow.",
            },
            { type: "sub", text: "Business to watch" },
            {
              type: "p",
              text: "The group reported ₹530 million subscribers in Q2 FY27. More data use and potential tariff increases could support revenue growth.",
            },
          ],
          [
            { type: "h", text: "Why it matters", rule: "under" },
            {
              type: "numbered",
              style: "small",
              items: [
                { n: "1", title: "Fresh capital", text: "Debt repayment could improve financial flexibility at Jio’s telecom operating unit." },
                { n: "2", title: "Valuation test", text: "A sharp premium leaves less room for execution misses; some analysts say near-term optimism is priced in." },
                { n: "3", title: "Supply ahead", text: "On Nov 24, half of anchor shares become eligible for sale. Eligibility does not mean actual selling." },
              ],
            },
            { type: "sub", text: "What investors track" },
            {
              type: "p",
              text: "Subscriber growth, average revenue per user, tariff changes, debt and share supply will shape the next leg.",
            },
            { type: "callout", title: "OWNERSHIP", text: "Reliance held 64.48% in the later filing." },
          ],
        ],
      },
      {
        type: "learned",
        items: [
          "Investor appetite made this a record issue, demand alone docs not settle fair value.",
          "Fresh proceeds are aimed at paying down operating debt and strengthening cash flow.",
          "Watch earnings and the Nov 24 anchor unlock for clues on momentum and share supply.",
        ],
      },
    ],
    byline: "By Tanusri Bijesure• Markets",
    sources: "Sources: Jio Platforms RHP/Q2 update; basis of allotment; Indian Express; Mint; Zerodha.",
  },
  {
    slug: "faa-ground-stop",
    page: 4,
    desk: "TECHNOLOGY",
    date: "Friday, 13 November 2026",
    headline: "FAA ground stop was a network fault, not AI",
    dek: "A nationwide ground stop halted US departures for over four hours on 13 November, days after the FAA took its AI-based SMART tool national. The FAA blames an unstable legacy network, not AI.",
    blocks: [
      {
        type: "facts",
        title: "KEY FACTS",
        items: [
          { value: "4h 21m", label: "Ground stop, 3:54 to 8:15 pm ET" },
          { value: "17 of 22", label: "Route control centres hit by instability" },
          { value: "12,462", label: "Flights cancelled on the day, per the FAA" },
          { value: "$875M", label: "Value of the 12-year SMART contract" },
        ],
      },
      {
        type: "row",
        widths: "lg:grid-cols-[1.35fr_1fr]",
        cols: [
          [
            { type: "h", text: "How it unfolded", rule: "under" },
            {
              type: "p",
              text: "At about 3:30 pm ET on 13 November, the FAA's legacy network was unstable, disrupting radar feeds and aircraft communications. A nationwide ground stop followed. About 3,500 aircraft in the air landed safely, and controllers kept some frequencies and radar feeds throughout.",
            },
            {
              type: "p",
              text: "The FAA says data flooded its network at roughly 1,000 connection attempts every four to five seconds. Early findings point to a radar set in Amarillo, Texas and a radio site in El Dorado, Arkansas, where provider L3Harris had been fitting a new router. Both sites were blocked and the network settled.",
            },
            {
              type: "p",
              text: "SMART, built by Air Space Intelligence, went nationwide three days earlier. The FAA calls it a data aggregator that feeds nothing into air traffic control, and the company says it played no part. The FAA and L3Harris are still probing the root cause.",
            },
          ],
          [
            { type: "h", text: "Why it Matters", rule: "side" },
            {
              type: "numbered",
              style: "big",
              items: [
                { n: "01", title: "AI was not in the data path", text: "The FAA says SMART shows data and does not feed controllers' systems." },
                { n: "02", title: "Old equipment failed first", text: "Legacy TDM gear became unstable once the network was flooded with data." },
                { n: "03", title: "Scrutiny of SMART continues", text: "Lawmakers had already sought a pause and clearer safety testing." },
              ],
            },
          ],
        ],
      },
      {
        type: "learned",
        items: [
          "Timing is not causation: the AI tool launched days earlier, but the fault sat in old network gear.",
          "Routine work at remote sites can cascade. The FAA will review when such work is done.",
          "The root cause is unconfirmed by outside review. Questions about SMART's testing and oversight predate the outage and remain separate.",
        ],
      },
    ],
    byline: "By Satwik Shrikant• Tech Desk",
    sources: "Sources: FAA | Al Jazeera | Federal News Network",
  },
  {
    slug: "u19-asia-cup",
    page: 5,
    desk: "SPORTS",
    date: "Wednesday, November 18, 2026",
    kicker: "CRICKET CHRONICLES",
    headline: "India beat Pakistan in a last-ball U-19 Asia Cup thriller",
    dek: "India defeated defending champions Pakistan by one wicket in the final at Al Amerat, Oman, chasing 338 and finishing at 339/9 in 50 overs. Mohit Ulva struck the winning boundary from the final delivery to seal India’s record-extending ninth U-19 Asia Cup title.",
    blocks: [
      {
        type: "facts",
        title: "KEY FACTS",
        items: [
          { value: "338", label: "Target set by Pakistan" },
          { value: "252/8", label: "India’s score in the 42nd over" },
          { value: "57 runs", label: "Ninth-wicket stand by Manal Chauhan and Mohit Ulva" },
          { value: "Nov 24", label: "India’s winning total" },
        ],
      },
      {
        type: "row",
        widths: "lg:grid-cols-[1.35fr_1fr]",
        cols: [
          [
            { type: "h", text: "How the match unfolded", rule: "under" },
            {
              type: "p",
              text: "Pakistan posted 337/9 after batting first. Usman Khan led the innings with 107 off 111 balls, while Abdul Qadir made 80 off 54 and captain Farhan Yousaf added 63 off 60. For India, Kavya Patel took 4/68 and Chigurupati Venkata claimed 3/40.",
            },
            {
              type: "p",
              text: "India’s chase began with a 95-run opening stand. Captain Lakshya Raichandani scored 80 off 101 balls and Aaryavir Sehwag made 58 off 61. After the pair departed, wickets fell in a cluster and India slipped to 252/8 in the 42nd over, still needing 86 runs.",
            },
            {
              type: "p",
              text: "Manal Chauhan (47 off 32) and Mohit Ulva (49 not out off 26) revived the chase with a 57-run ninth-wicket partnership. After Manal was dismissed at 309, No. 11 Chigurupati Venkata (11 not out off 8) joined Ulva. India needed eight from the final over and three from the last ball; Ulva bit Ahmed Hussain over long-off for four, completing the chase.",
            },
          ],
          [
            { type: "h", text: "Why it Matters", rule: "side" },
            {
              type: "numbered",
              style: "big",
              items: [
                { n: "01", title: "A comeback under pressure", text: "India recovered from 252/8, showing how partnerships at the lower end can change a final." },
                { n: "02", title: "Individual performances, one team result", text: "Raichandani and Sehwag built the platform; Chauhan, Ulva and Venkata finished the job." },
                { n: "03", title: "A record ninth title", text: "The win returned the trophy to India and avenged the group-stage defeat to Pakistan." },
              ],
            },
          ],
        ],
      },
      {
        type: "learned",
        items: [
          "A 95-run opening stand gave India the platform for a challenging chase.",
          "The 57-run ninth-wicket stand showed how lower-order contributions can turn a match around.",
          "India's last-ball finish highlighted the importance of resilience and execution in high-pressure moments.",
        ],
      },
    ],
    byline: "By Mokshika Sharma • Sports",
    sources: "Sources: Firstpost | BCCI | PTI",
  },
  {
    slug: "cop31",
    page: 6,
    desk: "CLIMATE & GLOBAL AFFAIRS",
    date: "Saturday, November 21, 2026",
    kicker: "CLIMATE SUMMIT 2026 • SHARM EL-SHEIKH",
    headline: "COP31 Goes to the Wire: Climate Talks Under the Shadow of War",
    dek: "With one day left in Antalya, delegates must turn old promises into real action, while the US stays away and the Iran war pushes up fuel and fertiliser prices.",
    blocks: [
      {
        type: "facts",
        title: "KEY FACTS",
        items: [
          { value: "9–20 Nov", label: "Summit dates in Antalya, Türkiye." },
          { value: "2.5°C+", label: "Warming by 2100 even if today's national plans are fully met, says UN chief Guterres." },
          { value: "–70%", label: "Drop in climate-finance pledges, as per a Carbon Brief analysis." },
          { value: "US absent", label: "The world's second-largest polluter is missing from talks, yet again." },
        ],
      },
      {
        type: "row",
        widths: "lg:grid-cols-3",
        cols: [
          [
            { type: "h", text: "How it unfolded", rule: "under" },
            {
              type: "p",
              text: "A tense and divided atmosphere has marked COP31 in Antalya, with countries struggling to bridge deep differences on climate finance, emissions cuts and loss & damage.",
            },
            {
              type: "p",
              text: "Turkiye hosted the summit under the shadow of global instability, as the Iran war continued to rattle energy markets and push up fuel and fertiliser prices worldwide.",
            },
            {
              type: "p",
              text: "Despite renewed pledges, major emitters, including the US, remained absent from the talks, raising doubts about the summit’s ability to deliver concrete outcomes.",
            },
            {
              type: "p",
              text: "The committee failed to reach a final consensus political deal by its scheduled Friday (November 20, 2026) close and went into overtime into Saturday.",
            },
          ],
          [
            { type: "h", text: "Why it matters", rule: "under" },
            {
              type: "numbered",
              style: "small",
              items: [
                { n: "1", title: "Plans trail the science", text: "Guterres told leaders the crisis is outrunning us, and warned that today’s plans still lead past 2.5°C." },
                { n: "2", title: "War raises the stakes", text: "The Iran war has effectively closed the Strait of Hormuz, lifting prices of fuel and fertiliser worldwide." },
                { n: "3", title: "Gaps in the room", text: "The US has withdrawn its climate plan. Iran, Vietnam, Egypt and Argentina were also without new national plans." },
              ],
            },
          ],
          [
            { type: "h", text: "Timeline", rule: "under" },
            {
              type: "timeline",
              stacked: true,
              items: [
                { when: "9 NOV", text: "Talks open in Antalya." },
                { when: "11–12 NOV", text: "World Leaders’ Summit." },
                { when: "WEEK 2", text: "Ministers and heads of delegation negotiate the draft." },
                { when: "20 NOV", text: "Scheduled close. Failure to reach a consensus has led to an overrun." },
              ],
            },
            {
              type: "callout",
              title: "WATCH FOR",
              text: "Words on electrification in the cover decision, adaptation finance, and a working just-transition mechanism.",
            },
          ],
        ],
      },
      {
        type: "learned",
        items: [
          "Implementation is the real test, not new headline targets.",
          "Finance decides whether poorer nations trust the deal.",
          "The cover decision’s wording will show how much ambition survived.",
        ],
      },
    ],
    byline: "By Shreyansh Singh • Global Affairs Desk",
    sources: "Sources: AP | Carbon Brief | Down To Earth | BBC News",
  },
];

export function getArticle(slug: string) {
  const index = ARTICLES.findIndex((a) => a.slug === slug);
  if (index === -1) return null;
  return { article: ARTICLES[index], prev: ARTICLES[index - 1] ?? null, next: ARTICLES[index + 1] ?? null };
}
