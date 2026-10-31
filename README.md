# dsh-memory-studio

A visual memory manager for DeepSeek Harness: local JSON stores, a **记忆** tab
with four views, and eleven tools an agent can call.

Everything is local. No API key, no server, no dependency to install.

## What it gives you

It reaches you three ways, all pointing at the same screen:

- a **conversation tab** next to Chat / Trajectory;
- a **`main` panel** (`key: memory-studio`) that fills the conversation area;
- a **row in the left rail** (`sidebar.panellist`), whose click selects that panel —
  this is the only destination a sidebar row can open, since a row cannot open a tab.

The screen has five sections:

| Section | What it is |
| --- | --- |
| **记忆** | Every durable note about the work: search, filter by kind and tag, edit, pin, archive, delete, 28-day heat strip. Matches show the sentence that hit. |
| **目录** | The same items as a tree — 按主题 (tag clusters → kind → memory) or 按会话 (session → turn → memory). Click a leaf to open it. |
| **我** | The profile — who you are, kept *apart* from work memories: identity fields plus facets under identity / work / tooling / preference / constraint / goal / style, as cards or as a 类别 → 标签 → facet tree. |
| **关系** | A force-directed graph of how memories relate: explicit links, shared tags, lexical overlap, same kind, same session, close in time. Drag, pan, zoom, click a node to see why it is connected. |
| **待审** | Proposals the capture engine was not confident enough to save on its own, each with the rule, the sentence and the confidence that produced it. Accept or dismiss in one click. |

## Capture: what gets remembered, and what does not

When a session ends (or a turn stops and then goes quiet for `debounceMs`), the
engine reads the conversation and applies a rule table in `lib/policy.js`.
Nothing is sent to a model — every candidate cites the rule and the sentence.

**Never remembered** (dropped with a reason you can see in the report):

- confirmations — `好`, `ok`, `谢谢`, `收到` …
- log lines — `WARN …`, timestamps, stack-trace frames
- code — `=>`, `const`, JSX, JSON fragments
- questions — a question asks for information, it does not state a fact
- **everything the agent said** — capture reads only your side of the
  conversation. Prose that merely sounds like a rule (`我们决定采用…`, written by
  the agent) is still dropped, because a memory should cite something *you*
  said. When the agent genuinely wants a note kept, it calls `memory_write`
  deliberately instead of hoping the classifier notices.
- imperative requests — `帮我做一个…`, `给我加个按钮` (a task for this session,
  not a fact about you; a standing rule like `以后都…` still counts as a preference)
- harness boilerplate — runtime context, file policy, the skill catalog, system
  reminders; these arrive in the user role but are not things you said
- duplicates and things already known (fuzzy match against memories + profile)
- anything without a matching rule

**Remembered**, with a weight per rule: identity and role (profile), work and
tooling context (profile), preferences, constraints, goals, decisions, todos,
insights, and plain facts worth keeping.

Confidence decides the destination: `autoSaveMemory` 0.80 and
`autoSaveProfile` 0.85 go straight in; anything lower waits in **待审**. A
user's own words outrank the agent's summary of them (+0.06 / −0.18).

The profile can be injected at the start of a session as one short paragraph, so
you do not repeat yourself — toggle it in **我 → 自动沉淀**.

## Recall: pull, not push

Nothing is injected into a session — no profile paragraph at start, no hidden
system message. A memory that sits in every prompt costs tokens on every turn
whether it is relevant or not, so recall is driven by the assistant instead:

- `memory_brief` — one small digest (profile in a line or two, titles of pinned
  and recent memories, ≤1.2k chars). Called once when a task depends on who the
  user is or what was decided earlier.
- `memory_search` — hybrid recall of the long tail, with tags and kind filters.
- `profile_read` — the full portrait, only when the answer should be tailored.

The tool descriptions carry the rule: recall when the user refers to an earlier
session, a past decision or a standing rule, or before asking something they may
already have answered. Skipping a recall is cheap; injecting everything is not.

## Retrieval: how a query is ranked

`memory_search` and the search box share one scorer in `lib/retrieval.js`, so the
assistant and the page never disagree about what "relevant" means:

```
score = 0.42 · cosine(query, memory)   ← hashed n-gram embedding, paraphrase signal
      + 0.40 · BM25(query, memory)     ← token-level keyword strength, tf·idf
      + 0.05 · exact substring         ← the whole query appears verbatim
      + 0.13 · prior                   ← importance, pinned, freshness
```

The embedding is local and dependency-free: tokens are Latin words plus CJK
uni/bi-grams, signed-hashed into 384 dimensions, weighted by `(1 + log tf) · idf`
with title and tags up-weighted. It is not a neural model — but it keeps the
store offline and deterministic (no model download, no API key), while a
paraphrase like `导出成 md` still reaches a memory that says
`加一个导出按钮，把记忆导出成 Markdown`. BM25 carries the precise half: two
memories that share the word `记忆` are ordered by how heavily each one leans on
it, not by string length. After ranking, the top hits widen one hop through the
graph, so a close neighbour of a strong hit is not left behind.

Every result carries its score, and `GET /search` returns the breakdown
(`total`, `vector`, `lexical`, `exact`, `prior`) so the UI can show why something ranked.

## Parent and child: small-to-big retrieval

A memory is the **parent**: the whole note is what the assistant needs once a
match is confirmed. But a three-paragraph note matched through one sentence
should not be scored by averaging over paragraphs it has nothing to do with —
a long note loses to a short one on the same topic simply by being long. So the
index is built on **children**: `content` is split into sentence-level chunks of
at most 180 characters (`CHUNK_CHARS`), and each chunk is scored on its own.

- `buildIndex()` returns `docs` (one per chunk, id `mem_x#0`, `mem_x#1`, …) and
  `byItem` (parent id → its chunk ids). The parent's score is its **best**
  chunk, plus a small coverage bonus (`min(0.06, 0.03 · (matches - 1))`) so a
  note that hits on three chunks outranks one that hits on one.
- Title and tags are attached only to chunk `#0`, never to every chunk — a long
  note would otherwise look like it repeats its title a hundred times and win
  on title weight alone.
- The result is always one row per parent with `match: { index, text }` naming
  the chunk that won. The UI shows that snippet under the title instead of the
  note's first line, and `memory_search` can explain the hit the same way.

The second parent is the **session an assertion came from**. A captured memory
remembers `origin.sessionId` and `origin.turn`, so `GET /episode?session=` (and
`memory_read`) reconstructs the surrounding episode in turn order — no second
copy of the conversation is stored. The UI lists those siblings as chips on the
memory card, so "what else did we say when this was decided" is one click away.

## Trees: a place to stand, not a filing cabinet

The graph answers *what is near what*; a tree answers *where am I*. The **目录**
tab offers two shapes over the same items, both three levels deep:

```
topic    全部 → 主题簇 → 类型 → 记忆
session  全部 → 会话   → 轮次 → 记忆
```

Nothing here is stored. A `parentId` column would go stale the first time a tag
was edited, and a memory usually belongs to more than one story (a decision
about retrieval is also part of a session, a project, and a tag family), so a
single stored parent would silently drop the other half of the truth.

- A **topic** is a connected component of tag-sharing, plus explicit links.
  Tags carried by more than `GENERIC_TAG = 12` memories are ignored, so a tag
  like `memory` cannot glue the entire library into one blob. A memory lands in
  exactly one component, so the tree never counts the same item twice.
- The second level is `kind` — inside a topic, grouping by type is exactly the
  right way to scan it. Items that share nothing sit under **未归类**; that
  bucket is informational, not a failure.
- The **session** tree is pure provenance: `origin.sessionId` → `origin.turn` →
  items. It costs nothing to maintain because capture already stamps it.
- Clicking a leaf switches to the memory list with that item already open, so
  the tree is a way in, not a dead end.

### The profile is the one honest hierarchy

Work memories have to be *derived* into a tree because their structure is
emergent. The profile is the opposite: `category` is a closed ontology of seven
values, one per facet, so **类别 → 标签 → 条目** is a real hierarchy, not a guess.
The 我 tab toggles between cards and this tree (`GET /api/profile/tree`):

```
关于你 → 身份卡        → 称呼 / 身份 / 所在地 / 语言 / 时区
       → 偏好/限制/…   → 标签(或 未标记) → 一条 facet
```

- The identity card comes first because it is the only part that is not a
  facet — five named fields you fill once.
- Tags are the middle layer: "preference" tells you what kind of fact it is,
  not which preference. A facet with no tag sits under 未标记 rather than being
  hidden.
- Clicking a facet leaf switches back to cards and rings that facet for a few
  seconds — the tree is a shortcut into the editor, not a read-only ornament.

### The profile also gets a graph, with different edges

The 我 tab has a third layout (`GET /api/profile/graph`). It is not the memory
graph with different colours: a person is not a library, so the signals differ.

| Edge | Weight | Why it exists |
| --- | --- | --- |
| `tag` | 2.2 | Two facets share a tag — the signal a human can check at a glance. |
| `topic` | up to 2.4 | Title + text overlap (CJK bigrams), i.e. they are about the same thing. |
| `category` | 0.55 | Same category. Real here — a facet has exactly one — but weak: "both are preferences" says less than "both are about pnpm". |

Nodes are sized by `confidence`, coloured by category, and capped at six edges
each, so a person with thirty facets still reads as a picture rather than a
hairball. Clicking a point opens a drawer with what it connects to and why;
*在卡片中查看* jumps back to the editable card.

## Install

The plugin lives in the profile's `node_modules`:

```powershell
Copy-Item -Recurse . "$env:DSH_HOME\profiles\desktop\node_modules\dsh-memory-studio"
```

Then add it to the profile package, `C:\Users\<you>\.dsh\profiles\desktop\package.json`:

```json
"dependencies": { "dsh-memory-studio": "0.1.0", ... },
"dsh": { "profile": { "bundles": [ ..., "dsh-memory-studio" ] } }
```

Reload the app window (the browser half is fetched on page load). The **记忆**
tab appears in the conversation view bar, and the tools appear in the tool list.

## Tools

`memory_write`, `memory_search`, `memory_brief`, `memory_read`, `memory_list`,
`memory_update`, `memory_delete` — the memory library. `memory_read` also returns
the session a captured memory came from (`Origin: … · turn N`) plus its siblings,
so reading one assertion can recover the conversation it landed in.

`profile_read`, `profile_write`, `profile_forget` — the profile store.

`memory_link`, `memory_graph` — connect two memories, or walk the neighbours of
one. All parameters are strings; numbers and booleans are parsed inside.

## HTTP surface

All routes are exact-path and local to the app's web server:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/dsh-memory-studio/api/state` | items, stats, store path |
| GET | `/dsh-memory-studio/api/search` | hybrid search (`?q=&kind=&tag=&limit=&archived=1`) with score breakdown |
| POST | `/dsh-memory-studio/api/items` | create |
| POST | `/dsh-memory-studio/api/items/update` | patch one item |
| POST | `/dsh-memory-studio/api/items/delete` | delete one item |
| POST | `/dsh-memory-studio/api/items/import` | bulk import, skips duplicates |
| POST | `/dsh-memory-studio/api/items/link` | link two memories |
| POST | `/dsh-memory-studio/api/items/unlink` | drop a link |
| GET | `/dsh-memory-studio/api/export` | JSON dump (`?format=md` for Markdown) |
| GET | `/dsh-memory-studio/api/episode` | memories captured in one session (`?session=`) |
| GET | `/dsh-memory-studio/api/tree` | topic or session tree (`?mode=topic\|session&archived=1`) |
| GET | `/dsh-memory-studio/api/graph` | nodes, edges, weights (`?archived=1`) |
| GET | `/dsh-memory-studio/api/profile` | profile, categories, summary |
| GET | `/dsh-memory-studio/api/profile/tree` | profile as 类别 → 标签 → facet |
| GET | `/dsh-memory-studio/api/profile/graph` | facets as nodes, edges by tag / wording / category |
| POST | `/dsh-memory-studio/api/profile/identity` | patch identity fields |
| POST | `/dsh-memory-studio/api/profile/facets` | add a facet |
| POST | `/dsh-memory-studio/api/profile/facets/update` | patch a facet |
| POST | `/dsh-memory-studio/api/profile/facets/delete` | remove a facet |
| POST | `/dsh-memory-studio/api/profile/forget` | remove facets matching a query |
| GET | `/dsh-memory-studio/api/inbox` | pending proposals |
| POST | `/dsh-memory-studio/api/inbox/accept` | accept one |
| POST | `/dsh-memory-studio/api/inbox/dismiss` | dismiss one |
| POST | `/dsh-memory-studio/api/inbox/accept-all` | accept everything |
| POST | `/dsh-memory-studio/api/inbox/clear` | drop the queue |
| GET | `/dsh-memory-studio/api/settings` | capture settings |
| POST | `/dsh-memory-studio/api/settings` | patch settings |
| GET | `/dsh-memory-studio/api/capture` | last reports |
| POST | `/dsh-memory-studio/api/capture` | flush now (`{sessionId}` for one) |

## Storage

All under `$DSH_HOME/memory-studio/` (falls back to `~/.dsh/memory-studio/`),
override the directory with `DSH_MEMORY_STUDIO_DIR`:

- `memories.json` — the memory library (version 2: items carry `links` and
  `origin` provenance)
- `profile.json` — identity and facets
- `inbox.json` — pending proposals
- `settings.json` — capture switches and the debounce window

Writes are atomic (temp file + rename). A file that fails to parse is renamed to
`<name>.corrupt-<timestamp>` and left for inspection rather than overwritten.

Every store also re-reads its file when the mtime changes, so a second instance
sharing the same directory — a host reload, or the app and the tool host both
loading the package — sees the other side's writes instead of serving a stale
snapshot from startup.

## Development

```powershell
node test/smoke.mjs    # store, routes, tools, policy, graph, capture, loader
node test/render.mjs   # mounts each view, clicks and edits it
```

Both tests use only Node's standard library — no install step.

- `lib/index.js` — host half: stores, HTTP routes, tools, event wiring
- `lib/policy.js` — the remember / do-not-remember rule table
- `lib/capture.js` — session observation, debounce, confidence routing
- `lib/profile.js`, `lib/inbox.js`, `lib/graph.js`, `lib/text.js`,
  `lib/jsonfile.js` — the pieces
- `lib/client.js` — browser half: the `conversation.view` tab and its four
  views, plain `React.createElement`, styles injected at module load

## Uninstall

Remove the entry from `dsh.profile.bundles`, delete the package directory, and
optionally delete `~/.dsh/memory-studio/`.
